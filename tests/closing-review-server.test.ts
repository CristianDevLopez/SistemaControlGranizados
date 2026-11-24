import { closingPreview, openingExpectedCash, visibleClosingPreview } from '../src/domain/engine.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PgBackend } from './support/backend.ts';
import { createGateway } from '../src/server/gateway.ts';
import { blindCountArticles, shiftCountArticles, stockBalances } from '../src/domain/engine.ts';
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

it('agrega paquetes, confirma con traslado en camino y atribuye el arqueo al cierre anterior', async () => {
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
  const packages = `package:${size.id}`;
  for (const [key, count] of [
    [article, 5],
    [packages, 3],
  ] as const) {
    const id = crypto.randomUUID();
    await db.db.query('insert into public.stock(id,branch_id,data) values($1,$2,$3)', [
      id,
      branchId,
      {
        id,
        article: key,
        quantity: count,
        reason: 'initial',
        by: admin.id,
        referenceId: id,
        at: now,
        eventId: id,
      },
    ]);
  }
  const opened = await accepted('request_shift', {});
  const shiftId = opened.referenceId!;
  let state = (await store.load()).state;
  let shift = state.shifts.find((item) => item.id === shiftId)!;
  expect((await request('closing-preview', { shiftId, visible: true }, cashier)).status).toBe(400);
  const opening = Object.fromEntries(
    shiftCountArticles(state, shift, 'opening').map(({ id }) => [id, stockBalances(state)[id] ?? 0]),
  );
  await accepted('submit_blind_count', {
    shiftId,
    kind: 'opening',
    attempt: 1,
    items: opening,
    cash: shift.base,
  });
  const before = (await store.load()).state.notifications.length;

  now = '2026-11-20T17:01:00.000Z';
  await accepted('open_package', { shiftId, quantities: { [size.id]: 3 } });
  state = (await store.load()).state;
  shift = state.shifts.find((item) => item.id === shiftId)!;
  expect(stockBalances(state)).toMatchObject({ [article]: 65, [packages]: 0 });
  expect(state.notifications).toHaveLength(before);
  const originalPreview = visibleClosingPreview(state, shift);

  now = '2026-11-20T17:02:00.000Z';
  await accepted('expense', {
    shiftId,
    source: 'cash',
    amount: 10000,
    category: state.settings[0].expenseCategories[0],
    supplier: 'Proveedor',
    notes: 'Compra en caja.',
  });
  const previewResponse = await request('closing-preview', { shiftId, visible: true }, cashier);
  expect(previewResponse.status).toBe(200);
  const preview = previewResponse.body;
  expect(preview.expectedCash).toBe(originalPreview.expectedCash - 10000);
  expect(preview.cups[article]).toMatchObject({ initial: 5, packages: 60, sold: 0, damage: 0 });
  expect(preview.expectedItems).toMatchObject({ [article]: 65, [packages]: 0 });
  expect(Object.keys(preview.expectedItems).some((id) => id.startsWith('sealed_bag:'))).toBe(false);

  now = '2026-11-20T17:03:00.000Z';
  const count = await accepted('submit_blind_count', {
    shiftId,
    kind: 'closing',
    attempt: 1,
    preview,
    items: { ...preview.expectedItems, [article]: 64 },
    payments: preview.expectedPayments,
    cash: preview.expectedCash,
    notes: 'Faltó un vaso de 16 oz.',
  });
  const sent = 2000;
  const distribution = {
    shiftId,
    countId: count.referenceId,
    retained: preview.expectedCash - sent,
    sent,
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
  expect((await send('request_shift', {}, other)).message).toMatch(/confirmar el cierre anterior/);
  expect(
    (await send('confirm_transfer', { transferId: transfer.id, receivedAmount: sent }, other)).code,
  ).toBe('FORBIDDEN');
  const added = await accepted(
    'open_package',
    {
      shiftId,
      correction: true,
      reviewClosing: true,
      sizeId: size.id,
      openedAt: '2026-11-20T17:02:30.000Z',
      notes: 'Paquete faltante del turno.',
    },
    other,
  );
  let updated = (await store.load()).state;
  expect(stockBalances(updated)[article]).toBe(85);
  expect(
    closingPreview(
      updated,
      shiftId,
      updated.counts.find((item) => item.id === count.referenceId),
    ).expectedItems[article],
  ).toBe(85);
  await accepted(
    'review_shift',
    {
      shiftId,
      action: 'correct_opening',
      openingId: added.referenceId,
      openedAt: '2026-11-20T17:01:20.000Z',
      notes: 'Se verificó la hora.',
    },
    other,
  );
  updated = (await store.load()).state;
  expect(updated.packages.find((item) => item.id === added.referenceId)?.openedAt).toBe(
    '2026-11-20T17:01:20.000Z',
  );
  expect(stockBalances(updated)[article]).toBe(85);
  await accepted(
    'review_shift',
    {
      shiftId,
      action: 'correct_opening',
      openingId: added.referenceId,
      remove: true,
      notes: 'Era un duplicado.',
    },
    other,
  );
  expect(stockBalances((await store.load()).state)[article]).toBe(65);
  const receiver = (await request('snapshot', {}, admin)).body.state;
  expect(receiver.transfers.find((item: { id: string }) => item.id === transfer.id)).toMatchObject({
    amount: 0,
    blindReceipt: true,
  });
  const receiverCount = receiver.counts.find((item: { id: string }) => item.id === count.referenceId);
  expect(receiverCount.blindHandoff).toBe(true);
  expect(receiverCount.cash).toBeUndefined();

  expect((await send('approve_closing', { shiftId, cash: sent - 1 }, other)).message).toMatch(
    /cubrir el traslado/,
  );
  const correctedCash = preview.expectedCash - 1500;
  await accepted('approve_closing', { shiftId, cash: correctedCash, adjustInventory: false }, other);
  const beforeAudit = (await store.load()).state;
  expect(openingExpectedCash(beforeAudit)).toBe(correctedCash - sent);
  expect(stockBalances(beforeAudit)[article]).toBe(65);
  expect(
    beforeAudit.shifts.find((item) => item.id === shiftId)?.closingReview?.inventoryVerification?.status,
  ).toBe('pending');
  await accepted('confirm_transfer', { transferId: transfer.id, receivedAmount: 1000 }, admin);
  expect(
    (await store.load()).state.shifts.find((item) => item.id === shiftId)?.closingReview?.handoffDifferences,
  ).toMatchObject({
    [transfer.id]: -1000,
  });

  now = '2026-11-21T17:00:00.000Z';
  const next = await accepted('request_shift', {});
  state = (await store.load()).state;
  shift = state.shifts.find((item) => item.id === next.referenceId)!;
  expect(shift.base).toBe(correctedCash - sent);
  expect(shift.reconcileClosingId).toBe(shiftId);
  expect(shift.blindOpening?.depth).toBe('deep');
  const items = Object.fromEntries(
    shiftCountArticles(state, shift, 'opening').map(({ id }) => [id, stockBalances(state)[id] ?? 0]),
  );
  expect(items).toHaveProperty('nevera');
  const audit = await accepted('submit_blind_count', {
    shiftId: shift.id,
    kind: 'opening',
    attempt: 1,
    items: { ...items, [article]: 64 },
    cash: shift.base,
  });
  expect(audit.code).toBe('COUNT_REVIEW');
  expect(stockBalances((await store.load()).state)[article]).toBe(65);
  await accepted('review_blind_opening', { shiftId: shift.id, action: 'approve_count' }, other);
  const final = (await store.load()).state;
  expect(stockBalances(final)[article]).toBe(64);
  expect(final.shifts.find((item) => item.id === shiftId)?.closingReview).toMatchObject({
    inventoryVerification: { status: 'verified' },
    openingChecks: [{ differences: { [article]: -1 } }],
  });
  expect(final.shifts.find((item) => item.id === shift.id)?.blindOpening?.status).toBe('reviewed');
});
