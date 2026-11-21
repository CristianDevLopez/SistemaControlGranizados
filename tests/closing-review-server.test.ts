import { afterAll, beforeAll, expect, it } from 'vitest';
import { PgBackend } from './support/backend.ts';
import { createGateway } from '../src/server/gateway.ts';
import {
  blindCountArticles,
  compensatedInventory,
  shiftCountArticles,
  stockBalances,
} from '../src/domain/engine.ts';
import { admin, cashier, cmd, ids, NOW, other, support } from './support/fixture.ts';
import type { Actor, Command } from '../src/domain/types.ts';

let now = NOW;
let db: PgBackend, gateway: ReturnType<typeof createGateway>, branchId: string;
beforeAll(async () => {
  db = await PgBackend.create();
  branchId = (await db.platform(admin.id, 'access')).legacyBranchId;
  gateway = createGateway({ backend: db, allowedOrigins: [], now: () => new Date(now) });
}, 60000);
afterAll(async () => {
  await db?.db.close();
});

it('las funciones de commit conservan ejecución exclusiva de servicio y no elevan privilegios', async () => {
  for (const name of [
    'public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb)',
    'private.branch_commit_operational_controls(uuid,bigint,jsonb,jsonb,jsonb)',
    'public.dexter_commit(bigint,jsonb,jsonb,jsonb)',
    'private.commit_before_closing_review(bigint,jsonb,jsonb,jsonb)',
  ]) {
    const result = await db.db.query(
      `select has_function_privilege('anon',$1,'EXECUTE') as anon,
      has_function_privilege('authenticated',$1,'EXECUTE') as authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') as service`,
      [name],
    );
    expect(result.rows[0]).toEqual({ anon: false, authenticated: false, service: true });
  }
  const functions = await db.db.query<{ prosecdef: boolean }>(`select prosecdef from pg_proc
    where pronamespace='public'::regnamespace and proname in ('dexter_commit','dexter_branch_commit')`);
  expect(functions.rows).toHaveLength(2);
  expect(functions.rows.every((f) => !f.prosecdef)).toBe(true);
});
async function request(route: string, body: unknown, actor: Actor = cashier) {
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
async function submit(command: Command, actor: Actor = cashier) {
  return (await request('commands', { commands: [{ ...command, branchId }] }, actor)).body.results[0];
}

it('limita la proyección de empleados y conserva los dos conteos ciegos para el administrador', async () => {
  const denied = await request('closing-preview', { shiftId: ids.shift });
  expect(denied.status).toBe(403);
  expect(denied.body).not.toHaveProperty('expectedCash');
  expect((await request('closing-preview', { shiftId: ids.shift }, support)).status).toBe(403);
  const before = (await db.load()).state;
  const items = Object.fromEntries(
    blindCountArticles(before).map(({ id }) => [id, stockBalances(before)[id] ?? 0]),
  );
  const payload = { kind: 'closing', shiftId: ids.shift, cash: 15000, items };
  const first = cmd('submit_blind_count', { ...payload, attempt: 1 });
  const firstResult = await submit(first);
  expect(firstResult).toMatchObject({
    code: 'COUNT_RECOUNT',
    message: 'Algo no coincide. Vuelve a contar todo.',
  });
  expect(await submit(first)).toEqual(firstResult);
  expect(JSON.stringify(firstResult)).not.toMatch(/expected|5000|20000|difference/i);
  const snapshot = (await request('snapshot', {}, cashier)).body;
  expect(snapshot.state.payments).toEqual([]);
  expect(snapshot.state.counts).toEqual([]);
  expect(snapshot.state.stock).toEqual([]);
  expect(snapshot.state.settings[0]).not.toHaveProperty('liquidTolerance');
  expect(snapshot.state.shifts[0]).not.toHaveProperty('base');
  expect(snapshot.state.shifts[0].blindClosing).toEqual({ status: 'recount' });
  const assistant = (await request('snapshot', {}, support)).body;
  expect(assistant.state.shifts).toEqual([]);
  expect(assistant.state.sharedShift).toEqual({ id: ids.shift, blocked: true });
  expect((await submit(cmd('count', payload))).code).toBe('FORBIDDEN');
  const second = await submit(cmd('submit_blind_count', { ...payload, attempt: 2 }));
  expect(second).toMatchObject({ code: 'COUNT_REVIEW', message: 'Turno enviado a revisión' });
  const employeeView = (await request('snapshot', {}, cashier)).body.state;
  expect(employeeView.counts).toEqual([]);
  expect(employeeView.shifts[0].blindClosing).toEqual({ status: 'review' });
  const adminView = (await request('snapshot', {}, admin)).body.state;
  expect(adminView.counts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ cash: 15000, expectedCash: 20000, difference: -5000, blindAttempt: 1 }),
      expect.objectContaining({ cash: 15000, expectedCash: 20000, difference: -5000, blindAttempt: 2 }),
    ]),
  );
  expect((await submit(cmd('submit_blind_count', { ...payload, attempt: 2 }))).status).toBe('conflict');
  expect((await db.load()).state.counts).toHaveLength(2);
  const resolved = await submit(
    cmd(
      'review_shift',
      {
        shiftId: ids.shift,
        action: 'resolve',
        outcome: 'shortage',
        notes: 'Se contó dos veces.',
      },
      admin,
    ),
    admin,
  );
  expect(resolved.status).toBe('accepted');
  expect((await db.load()).state.counts).toEqual(adminView.counts);
  expect((await request('snapshot', {}, cashier)).body.state.shifts[0].closingReview).toEqual({
    status: 'approved',
  });
});

it('archiva avisos previos al arqueo de referencia sin eliminarlos de PostgreSQL', async () => {
  const auditId = crypto.randomUUID();
  const cutoff = '2026-11-18T18:00:00.000Z';
  const noticeId = crypto.randomUUID();
  await db.db.query('insert into public.counts(id,branch_id,data) values($1,$2,$3)', [
    auditId,
    branchId,
    { id: auditId, at: cutoff, by: admin.id, kind: 'audit', notes: '', items: {} },
  ]);
  await db.db.query('insert into public.notifications(id,branch_id,data) values($1,$2,$3)', [
    noticeId,
    branchId,
    {
      id: noticeId,
      at: '2026-11-19T19:00:00.000Z',
      channel: 'mermas',
      text: 'Aviso reciente',
      status: 'pending',
      attempts: 0,
    },
  ]);
  expect((await submit(cmd('archive_rehearsal', { countId: auditId }, admin), admin)).status).toBe(
    'accepted',
  );
  const store = db.forBranch(branchId);
  expect((await store.load()).state.notifications).toHaveLength(2);
  expect(await store.security('notifications_claim')).toEqual([expect.objectContaining({ id: noticeId })]);
});

it('reparte efectivo, protege la recepción y compensa el sobrante contra el cierre sin reescribir conteos', async () => {
  now = '2026-11-20T17:00:00.000Z';
  const store = db.forBranch(branchId);
  const send = async (type: Command['type'], payload: Record<string, unknown>, actor: Actor = cashier) =>
    submit(cmd(type, payload, actor, { at: now, shiftId: payload.shiftId as string | undefined }), actor);
  const accepted = async (type: Command['type'], payload: Record<string, unknown>, actor?: Actor) => {
    const result = await send(type, payload, actor);
    expect(result.status, result.message).toBe('accepted');
    return result;
  };
  const initial = (await store.load()).state;
  const size = initial.sizes.find((item) => item.name === '16 oz')!;
  const article = `cup:${size.id}`;
  const movementId = crypto.randomUUID();
  await db.db.query('insert into public.stock(id,branch_id,data) values($1,$2,$3)', [
    movementId,
    branchId,
    {
      id: movementId,
      article,
      quantity: 20,
      reason: 'initial',
      by: admin.id,
      referenceId: movementId,
      at: now,
      eventId: movementId,
    },
  ]);
  const opened = await accepted('request_shift', {});
  const shiftId = opened.referenceId;
  const state = (await store.load()).state;
  const shift = state.shifts.find((item) => item.id === shiftId)!;
  const balances = stockBalances(state);
  const items = Object.fromEntries(
    shiftCountArticles(state, shift, 'opening').map(({ id }) => [id, balances[id] ?? 0]),
  );
  await accepted('submit_blind_count', { shiftId, kind: 'opening', attempt: 1, items, cash: shift.base });
  const closingItems = Object.fromEntries(
    shiftCountArticles(state, shift, 'closing').map(({ id }) => [id, balances[id] ?? 0]),
  );
  closingItems[article] = 18;
  const count = await accepted('submit_blind_count', {
    shiftId,
    kind: 'closing',
    attempt: 1,
    items: closingItems,
    cash: 20000,
  });
  const recount = await accepted('submit_blind_count', {
    shiftId,
    kind: 'closing',
    attempt: 2,
    items: closingItems,
    cash: 20000,
  });
  const distribution = {
    shiftId,
    countId: recount.referenceId,
    retained: 10000,
    sent: 10000,
    locationId: ids.location,
    verified: true,
    cashTotal: 0,
    transferTotal: 0,
  };
  expect((await send('submit_closing', { ...distribution, sent: 0 })).message).toMatch(/igual al efectivo/);
  await accepted('submit_closing', distribution);
  const submitted = (await store.load()).state;
  const transfer = submitted.transfers.find((item) => item.shiftId === shiftId)!;
  expect(transfer.status).toBe('in_transit');
  expect(
    (await send('confirm_transfer', { transferId: transfer.id, receivedAmount: 10000 }, other)).code,
  ).toBe('FORBIDDEN');
  expect((await send('approve_closing', { shiftId }, other)).message).toMatch(/custodio/);
  const receiver = (await request('snapshot', {}, admin)).body.state;
  expect(receiver.transfers.find((item: { id: string }) => item.id === transfer.id)).toMatchObject({
    amount: 0,
    blindReceipt: true,
  });
  expect(receiver.counts.some((item: { id: string }) => item.id === count.referenceId)).toBe(false);
  await accepted('confirm_transfer', { transferId: transfer.id, receivedAmount: 8000 }, admin);
  await accepted('return_closing', { shiftId, notes: 'Revisa la diferencia del turno.' }, other);
  await accepted('submit_closing', { ...distribution, notes: 'Confirmé el conteo y los comprobantes.' });
  const approval = await accepted('approve_closing', { shiftId }, other);
  expect(approval.approvalPending).toBeUndefined();
  const approved = (await store.load()).state;
  const reviewed = approved.counts.find((item) => item.id === approval.referenceId)!;
  expect(stockBalances(approved)[article]).toBe(18);
  expect(reviewed.paymentDifferences).toEqual({ [`handoff:${transfer.id}`]: -2000 });
  expect((await send('request_shift', {})).message).toMatch(/Responde/);
  await accepted('respond_closing', { shiftId, outcome: 'accepted', notes: 'De acuerdo.' });
  now = '2026-11-21T17:00:00.000Z';
  const next = await accepted('request_shift', { base: 1 }, other);
  const nextState = (await store.load()).state;
  const nextShift = nextState.shifts.find((item) => item.id === next.referenceId)!;
  expect(nextShift.blindOpening?.depth).toBe('deep');
  expect(nextShift.base).toBe(10000);
  const nextItems = Object.fromEntries(
    shiftCountArticles(nextState, nextShift, 'opening').map(({ id }) => [
      id,
      stockBalances(nextState)[id] ?? 0,
    ]),
  );
  expect(nextItems).toHaveProperty('nevera');
  nextItems[article] = 20;
  await accepted(
    'submit_blind_count',
    {
      shiftId: nextShift.id,
      kind: 'opening',
      attempt: 1,
      items: nextItems,
      cash: 10000,
    },
    other,
  );
  const compensated = (await store.load()).state;
  expect(stockBalances(compensated)[article]).toBe(20);
  expect(compensatedInventory(compensated, reviewed, article)).toBe(2);
  const surplus = compensated.counts.find(
    (item) => item.shiftId === nextShift.id && item.kind === 'opening',
  )!;
  expect(compensatedInventory(compensated, surplus, article)).toBe(2);
  expect(compensated.counts.find((item) => item.id === reviewed.id)).toEqual(reviewed);

  const nextShiftId = nextShift.id;
  const order = await accepted(
    'create_order',
    { shiftId: nextShiftId, lines: [{ flavorId: ids.flavor, sizeId: size.id, quantity: 1 }] },
    other,
  );
  await accepted(
    'pay',
    {
      shiftId: nextShiftId,
      orderId: order.referenceId,
      method: 'transfer',
      accountId: ids.location,
      deliver: true,
    },
    other,
  );
  const sold = (await store.load()).state;
  const nextClosing = await accepted(
    'submit_blind_count',
    {
      shiftId: nextShiftId,
      kind: 'closing',
      attempt: 1,
      items: Object.fromEntries(
        shiftCountArticles(sold, nextShift, 'closing').map(({ id }) => [id, stockBalances(sold)[id] ?? 0]),
      ),
      cash: 10000,
    },
    other,
  );
  await accepted(
    'submit_closing',
    {
      shiftId: nextShiftId,
      countId: nextClosing.referenceId,
      retained: 10000,
      sent: 0,
      cashTotal: 0,
      transferTotal: 17000,
      verified: true,
    },
    other,
  );
  expect((await send('approve_closing', { shiftId: nextShiftId }, admin)).message).toMatch(/Verifica todas/);
  const paymentId = sold.payments.find((item) => item.shiftId === nextShiftId)!.id;
  await accepted(
    'review_shift',
    { shiftId: nextShiftId, action: 'verify_transfer', paymentId, missing: true },
    admin,
  );
  const final = await accepted('approve_closing', { shiftId: nextShiftId }, admin);
  expect(
    (await store.load()).state.counts.find((item) => item.id === final.referenceId)?.paymentDifferences,
  ).toEqual({ [`payment:${paymentId}`]: -17000 });
  expect(
    (
      await send(
        'respond_closing',
        { shiftId: nextShiftId, outcome: 'unanswered', notes: 'Sin respuesta.' },
        admin,
      )
    ).message,
  ).toMatch(/vigente el plazo/);
  now = '2026-11-24T17:00:01.000Z';
  await accepted(
    'respond_closing',
    { shiftId: nextShiftId, outcome: 'unanswered', notes: 'Sin respuesta.' },
    admin,
  );
});
