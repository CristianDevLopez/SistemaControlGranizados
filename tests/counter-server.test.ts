import { expect, it, vi } from 'vitest';
import { applyCommand } from '../src/domain/engine.ts';
import type { Actor, Command } from '../src/domain/types.ts';
import { counterChanges, counterScope, counterState } from '../src/server/counter-state.ts';
import { createGateway } from '../src/server/gateway.ts';
import { PgBackend } from './support/backend.ts';
import { admin, cashier, cmd, ids, NOW, support } from './support/fixture.ts';

it('envía y cobra desde dos equipos con historial, conserva los movimientos y reintenta sin duplicados', async () => {
  const db = await PgBackend.create();
  try {
    const branchId = (await db.platform(admin.id, 'access')).legacyBranchId;
    const store = db.forBranch(branchId);
    const gateway = createGateway({ backend: db, allowedOrigins: [], now: () => new Date(NOW) });
    const submit = async (actor: Actor, command: Command) => {
      const response = await gateway(
        new Request('http://localhost/dexter/commands', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${actor.id}`,
            'x-branch-id': branchId,
            'x-device-id': actor.deviceId,
            'x-device-token': 'test-device-token',
          },
          body: JSON.stringify({ commands: [command] }),
        }),
      );
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result.results[0], JSON.stringify(result)).toMatchObject({ id: command.id, status: 'accepted' });
      return result.results[0];
    };
    const previousShift = crypto.randomUUID();
    await db.db.query(
      `insert into public.shifts(id, branch_id, data)
      select $1, branch_id, data || jsonb_build_object('id', $1::uuid, 'status', 'closed')
      from public.shifts where branch_id=$2 and id=$3`,
      [previousShift, branchId, ids.shift],
    );
    await db.db.query(
      `with orders as (select gen_random_uuid() id from generate_series(1, 500)),
      inserted as (
        insert into public.orders(id, branch_id, data)
        select id, $1, jsonb_build_object('id', id, 'shiftId', $2::uuid, 'status', 'paid', 'lines', '[]'::jsonb)
        from orders returning id
      ), payments as (select gen_random_uuid() id, inserted.id order_id from inserted)
      insert into public.payments(id, branch_id, data)
      select id, $1, jsonb_build_object('id', id, 'orderId', order_id, 'shiftId', $2::uuid, 'amount', 9000)
      from payments`,
      [branchId, previousShift],
    );
    await db.db.query(
      `with history as (
      select gen_random_uuid() id, gen_random_uuid() event_id from generate_series(1, 2500)
    ), audited as (
      insert into public.audit(id, branch_id, data)
      select id, $1, jsonb_build_object('id', id, 'eventId', event_id, 'deviceId', $2::uuid,
        'action', 'pay', 'at', '2026-10-22T18:00:00.000Z') from history returning id, data
    ) insert into public.stock(id, branch_id, data)
      select id, $1, jsonb_build_object('id', id, 'eventId', data->>'eventId', 'article', $3::text,
        'quantity', 1, 'at', '2026-10-22T18:00:00.000Z') from audited`,
      [branchId, cashier.deviceId, `liquid:${ids.flavor}`],
    );

    // The latest valid occurrence must be chosen by instant, including historical time-zone offsets.
    await db.db.query(
      `with timestamps as (
      select gen_random_uuid() id, value as at from unnest($3::text[]) as input(value)
    ) insert into public.audit(id, branch_id, data)
      select id, $1, jsonb_build_object('id', id, 'eventId', gen_random_uuid(), 'deviceId', $2::uuid, 'at', at)
      from timestamps`,
      [branchId, cashier.deviceId, ['2026-10-23T15:50:00.000Z', '2026-10-23T10:59:00.000-05:00']],
    );

    const original = await store.load();
    const lines = [{ flavorId: ids.flavor, sizeId: original.state.sizes[0].id, quantity: 1 }];
    const draft = cmd('create_order', { lines, cashDraft: true }, support, {
      branchId,
      at: '2026-10-23T15:52:00.000Z',
    });
    const otherOrder = cmd('create_order', { lines }, cashier, { branchId, at: '2026-10-23T15:45:00.000Z' });
    const [created, other] = await Promise.all([submit(support, draft), submit(cashier, otherOrder)]);
    const orderId = created.referenceId;
    expect(other.referenceId).not.toBe(orderId);
    await submit(
      support,
      cmd('send_order', { orderId }, support, { branchId, at: '2026-10-23T15:53:00.000Z' }),
    );
    const pay = cmd('pay', { orderId, deliver: true }, cashier, { branchId, at: '2026-10-23T15:45:00.000Z' });

    const full = await store.load();
    const scoped = await store.loadCounter(counterScope(pay)!);
    expect(scoped.revision).toBe(full.revision);
    expect(scoped.state.orders?.map((order) => order.id)).toEqual([orderId]);
    expect(scoped.state.payments).toEqual([]);
    expect(JSON.stringify(scoped.state).length).toBeLessThan(JSON.stringify(full.state).length / 10);
    const projected = counterState(scoped.state);
    const reference = applyCommand(full.state, pay, cashier, NOW);
    const scopedResult = applyCommand(projected, pay, cashier, NOW);
    expect(scopedResult.result).toEqual(reference.result);
    expect(counterChanges(projected, scopedResult.state)).toEqual(
      counterChanges(full.state, reference.state),
    );
    expect(scopedResult.state.audit.at(-1)?.at).toBe('2026-10-23T15:59:00.000Z');

    const commit = vi.spyOn(PgBackend.prototype, 'commit');
    try {
      const saved = await submit(cashier, pay);
      expect(await submit(cashier, pay)).toEqual(saved);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit.mock.calls[0][2]).toEqual(counterChanges(full.state, reference.state));
    } finally {
      commit.mockRestore();
    }
    const saved = (await store.load()).state;
    expect(saved.orders).toHaveLength(502);
    expect(saved.payments).toHaveLength(501);
    expect(saved.payments.at(-1)).toMatchObject({ orderId, eventId: pay.id });
    expect(saved.deliveries).toHaveLength(1);
    expect(saved.stock.filter((item) => item.eventId === pay.id).map((item) => item.article)).toContain(
      `liquid:${ids.flavor}`,
    );
  } finally {
    await db.db.close();
  }
});
