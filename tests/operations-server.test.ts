import { afterAll, beforeAll, expect, it } from 'vitest';
import { PgBackend } from './support/backend.ts';
import { createGateway } from '../src/server/gateway.ts';
import { admin, cashier, support, cmd, ids, NOW, countedItems } from './support/fixture.ts';
import type { Actor, CommandType } from '../src/domain/types.ts';
import { applyCommand } from '../src/domain/engine.ts';

let db: PgBackend, gateway: ReturnType<typeof createGateway>, branchId: string;
beforeAll(async () => {
  db = await PgBackend.create();
  gateway = createGateway({ backend: db, allowedOrigins: [], now: () => new Date(NOW) });
  branchId = (await db.platform(admin.id, 'access')).legacyBranchId;
}, 60000);
afterAll(async () => {
  await db?.db.close();
});
async function request(route: string, body: unknown, actor: Actor = admin) {
  const response = await gateway(
    new Request(`http://localhost/dexter/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${actor.id}`,
        'x-device-id': actor.deviceId,
        'x-device-token': 'test-device-token',
        'x-branch-id': branchId,
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}
async function execute(type: CommandType, payload: Record<string, unknown>, actor: Actor = admin) {
  const s = (await db.load()).state;
  const c = cmd(type, payload, actor, {
    branchId,
    configVersion: s.settings[0].version,
    shiftId: s.shifts.find((shift) => shift.status === 'open')?.id ?? ids.shift,
  });
  return (await request('commands', { commands: [c] }, actor)).body.results[0];
}

it('guarda permisos por local, los aplica en nuevas solicitudes y rechaza cambios de trabajadores', async () => {
  expect(
    (await request('users/update', { userId: support.id, permissions: { orders: false } }, cashier)).status,
  ).toBe(403);
  expect((await request('users/update', { userId: support.id, permissions: { unknown: true } })).status).toBe(
    400,
  );
  expect((await request('users/update', { userId: support.id, permissions: { orders: false } })).status).toBe(
    200,
  );
  expect((await db.forBranch(branchId).profile(support.id))?.permissions).toEqual({ orders: false });
  expect((await db.profile(support.id))?.permissions).toEqual({});
  const snapshot = await request('snapshot', {}, support);
  expect(snapshot.body.actor.permissions).toEqual({ orders: false });
  const lines = [{ flavorId: ids.flavor, sizeId: snapshot.body.state.sizes[0].id, quantity: 1 }];
  const rejected = await execute('create_order', { lines }, support);
  expect(rejected).toMatchObject({ status: 'conflict', code: 'FORBIDDEN' });
  expect((await db.load()).state.orders).toHaveLength(0);
  await request('users/update', { userId: support.id, permissions: { orders: true } });
  const created = await execute('create_order', { lines }, support);
  expect(created.status).toBe('accepted');
  expect((await request('snapshot', {}, cashier)).body.state.orders[0]).toMatchObject({
    sellerId: support.id,
  });
  expect((await execute('pay', { orderId: created.referenceId }, support)).status).toBe('conflict');
  await request('users/update', { userId: cashier.id, permissions: { payments: false } });
  expect((await execute('pay', { orderId: created.referenceId }, cashier)).code).toBe('FORBIDDEN');
  // Simula un contexto que fue calculado antes de revocar el permiso.
  const loaded = await db.forBranch(branchId).load();
  const staleCommand = cmd('pay', { orderId: created.referenceId }, cashier, { branchId });
  const staleState = applyCommand(loaded.state, staleCommand, cashier, NOW);
  await expect(
    db.forBranch(branchId).commit(loaded.revision, staleCommand, staleState.state, staleState.result),
  ).rejects.toThrow(/PERMISSION_DENIED/);
  await request('users/update', { userId: cashier.id, permissions: {} });
  expect(
    (
      await execute(
        'pay',
        { orderId: created.referenceId, method: 'transfer', accountId: ids.location },
        cashier,
      )
    ).status,
  ).toBe('accepted');
});

it('el servidor guarda el cuadre por cuenta y solo admite correcciones administrativas tras cerrar', async () => {
  const state = (await db.load()).state;
  expect(
    (
      await execute(
        'count',
        {
          kind: 'closing',
          shiftId: ids.shift,
          cash: 20000,
          retained: 10000,
          locationId: ids.location,
          items: countedItems(state),
          payments: { [`transfer:${ids.location}`]: 13000 },
        },
        cashier,
      )
    ).status,
  ).toBe('accepted');
  const closed = (await db.load()).state;
  expect(closed.counts[0].difference).toBe(0);
  expect(closed.counts[0].expectedPayments).toEqual({ [`transfer:${ids.location}`]: 14000 });
  expect(closed.counts[0].paymentDifferences).toEqual({ [`transfer:${ids.location}`]: -1000 });
  const transferId = closed.transfers[0].id;
  const loaded = await db.forBranch(branchId).load();
  const bypass = cmd('execute_transfer', { transferId }, cashier, { branchId, shiftId: undefined });
  await expect(
    db
      .forBranch(branchId)
      .commit(loaded.revision, bypass, closed, { id: bypass.id, status: 'accepted', message: '' }),
  ).rejects.toThrow(/SHIFT_CLOSED/);
  expect((await execute('execute_transfer', { transferId, evidenceId: ids.photo }, cashier)).code).toBe(
    'SHIFT_CLOSED',
  );
  expect((await execute('expense', { source: 'cash', amount: 1000 }, cashier)).code).toBe('SHIFT_CLOSED');
  expect(
    (
      await execute('expense', {
        shiftId: ids.shift,
        source: 'cash',
        amount: 1000,
        category: state.settings[0].expenseCategories[0],
        supplier: 'Proveedor',
        notes: 'Corrección',
      })
    ).status,
  ).toBe('accepted');
  expect((await db.load()).state.expenses[0].shiftId).toBe(ids.shift);
  expect((await db.load()).state.counts).toEqual(closed.counts);
  expect((await execute('execute_transfer', { transferId, evidenceId: ids.photo })).status).toBe('accepted');
});

it('confirma un canje parcial de tres códigos con la venta y preserva el no utilizado en PostgreSQL', async () => {
  expect((await execute('request_shift', { base: 0 })).status).toBe('accepted');
  const state = (await db.load()).state;
  const promotion = await execute('save_promotion', {
    name: 'Cortesía exacta',
    effect: 'free',
    delivery: 'coupon',
    sizeIds: [state.sizes[0].id],
    flavorIds: [ids.flavor],
    stackable: true,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2027-01-01T00:00:00Z',
  });
  expect(promotion.status).toBe('accepted');
  for (let i = 0; i < 3; i++)
    expect(
      (
        await execute('issue_coupon', {
          promotionId: promotion.referenceId,
          courtesy: true,
          expiresAt: '2026-12-01T00:00:00Z',
        })
      ).status,
    ).toBe('accepted');
  const coupons = (await db.load()).state.coupons;
  expect(coupons.every((c) => c.benefit?.sizeIds[0] === state.sizes[0].id)).toBe(true);
  const created = await execute('create_order', {
    lines: [{ flavorId: ids.flavor, sizeId: state.sizes[0].id, quantity: 2 }],
  });
  const quote = await request('quote', { orderId: created.referenceId, codes: coupons.map((c) => c.code) });
  expect(quote.body).toMatchObject({ total: 0 });
  expect(quote.body.applications).toHaveLength(2);
  expect(quote.body.unusedCodes).toHaveLength(1);
  const result = await execute('redeem_coupon', {
    orderId: created.referenceId,
    codes: coupons.map((c) => c.code),
    expectedTotal: 0,
  });
  expect(result.status, JSON.stringify(result)).toBe('accepted');
  const paid = (await db.load()).state;
  expect(paid.coupons.filter((c) => c.status === 'redeemed')).toHaveLength(2);
  expect(paid.coupons.find((c) => c.code === quote.body.unusedCodes[0])?.status).toBe('issued');
  expect(paid.payments.filter((p) => p.orderId === created.referenceId)).toEqual([]);
});

it('las nuevas funciones de perfiles siguen inaccesibles para roles del navegador', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.db.exec(`set role ${role}`);
    try {
      await expect(
        db.db.query('select public.dexter_branch_profile_save($1,$2)', [
          branchId,
          { id: support.id, role: 'admin', active: true, permissions: {} },
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(db.db.query('select permissions from private.branch_members')).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.db.exec('reset role');
    }
  }
});
