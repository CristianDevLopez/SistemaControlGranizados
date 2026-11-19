import { afterAll, beforeAll, expect, it } from 'vitest';
import { PgBackend } from './support/backend.ts';
import { createGateway } from '../src/server/gateway.ts';
import { applyCommand, closingPreview, countArticles, stockBalances } from '../src/domain/engine.ts';
import { admin, cashier, cmd, ids, NOW, support } from './support/fixture.ts';
import type { Actor, Command } from '../src/domain/types.ts';

let db: PgBackend, gateway: ReturnType<typeof createGateway>, branchId: string;
beforeAll(async () => {
  db = await PgBackend.create();
  branchId = (await db.platform(admin.id, 'access')).legacyBranchId;
  gateway = createGateway({ backend: db, allowedOrigins: [], now: () => new Date(NOW) });
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

it('la comparación solo revela los esperados al cajero autorizado de ese turno, sin guardar un conteo', async () => {
  expect((await request('closing-preview', { shiftId: ids.shift })).body.expectedCash).toBe(20000);
  expect((await request('closing-preview', { shiftId: ids.shift }, support)).status).toBe(403);
  expect((await request('closing-preview', { shiftId: ids.shift }, admin)).status).toBe(403);
  await request('users/update', { userId: cashier.id, permissions: { shifts: false } }, admin);
  expect((await request('closing-preview', { shiftId: ids.shift })).status).toBe(403);
  await request('users/update', { userId: cashier.id, permissions: { shifts: true } }, admin);
  expect((await db.load()).state.counts).toHaveLength(0);
});

it('persiste la revisión y el ajuste atómicamente, exige admin también en SQL y no duplica al reintentar', async () => {
  let state = (await db.load()).state;
  const cup = `cup:${state.sizes[0].id}`;
  expect((await submit(cmd('open_package', { sizeId: state.sizes[0].id }))).status).toBe('accepted');
  const preview = (await request('closing-preview', { shiftId: ids.shift })).body;
  expect(preview.expectedItems[cup]).toBe(20);
  const payload = {
    kind: 'closing',
    shiftId: ids.shift,
    cash: 20000,
    retained: 20000,
    payments: preview.expectedPayments,
    items: { ...preview.expectedItems, [cup]: 16 },
    preview,
  };
  expect((await submit(cmd('count', payload))).status).toBe('accepted');
  state = (await db.load()).state;
  const original = structuredClone(state.counts[0]);
  const approval = {
    shiftId: ids.shift,
    cash: 20000,
    items: original.items,
    payments: original.payments,
    verified: true,
    notes: 'Recontamos: faltan cuatro vasos de exhibición.',
    employeeCharge: 10000,
    preview: closingPreview(state, ids.shift, original),
  };
  expect((await submit(cmd('approve_closing', approval))).status).toBe('conflict');
  const invalid = cmd(
    'approve_closing',
    { ...approval, preview: { ...approval.preview, expectedCash: 1 } },
    admin,
  );
  expect((await submit(invalid, admin)).code).toBe('CLOSING_CHANGED');
  const command = cmd('approve_closing', approval, admin, { branchId });
  const candidate = applyCommand(state, command, admin, NOW);
  const loaded = await db.forBranch(branchId).load();
  const forged = { ...command, id: crypto.randomUUID(), actorId: cashier.id, deviceId: cashier.deviceId };
  await expect(
    db
      .forBranch(branchId)
      .commit(loaded.revision, forged, candidate.state, { ...candidate.result, id: forged.id }),
  ).rejects.toThrow(/ADMIN_REQUIRED/);
  expect((await submit(command, admin)).status).toBe('accepted');
  expect((await submit(command, admin)).status).toBe('accepted');
  state = (await db.load()).state;
  expect(state.counts[0]).toEqual(original);
  expect(state.counts).toHaveLength(2);
  expect(stockBalances(state)[cup]).toBe(16);
  expect(state.stock.filter((m) => m.reason === 'closing_adjustment')).toHaveLength(1);
  expect(state.shifts[0].closingReview?.status).toBe('approved');
  const deduction = {
    shiftId: ids.shift,
    amount: 4000,
    paidOn: '2026-10-23',
    confirmed: true,
    expectedRecovered: 0,
  };
  const recover = cmd('record_employee_recovery', deduction, admin, { branchId });
  const proposed = applyCommand(state, recover, admin, NOW);
  const latest = await db.forBranch(branchId).load();
  const forbidden = { ...recover, id: crypto.randomUUID(), actorId: cashier.id, deviceId: cashier.deviceId };
  await expect(
    db.forBranch(branchId).commit(latest.revision, forbidden, proposed.state, {
      ...proposed.result,
      id: forbidden.id,
    }),
  ).rejects.toThrow(/ADMIN_REQUIRED/);
  expect((await submit(cmd('record_employee_recovery', deduction))).status).toBe('conflict');
  expect((await submit(recover, admin)).status).toBe('accepted');
  expect((await submit(recover, admin)).status).toBe('accepted');
  expect((await submit(cmd('record_employee_recovery', deduction, admin), admin)).code).toBe(
    'RECOVERY_CHANGED',
  );
  expect(
    (
      await submit(
        cmd('record_employee_recovery', { ...deduction, expectedRecovered: 4000, amount: 7000 }, admin),
        admin,
      )
    ).status,
  ).toBe('conflict');
  const recovered = (await db.load()).state;
  expect(recovered.shifts[0].closingReview?.recoveries).toEqual([
    expect.objectContaining({ by: admin.id, amount: 4000, paidOn: '2026-10-23' }),
  ]);
  expect(recovered.payments).toEqual(state.payments);
  const cashierView = await gateway(
    new Request('http://localhost/dexter/snapshot', {
      headers: {
        authorization: `Bearer ${cashier.id}`,
        'x-device-id': cashier.deviceId,
        'x-device-token': 'test-device-token',
        'x-branch-id': branchId,
      },
    }),
  );
  expect((await cashierView.json()).state.shifts[0].closingReview).toEqual({ status: 'approved' });
  expect((await submit(cmd('request_shift', { base: 0 }, admin, { shiftId: undefined }), admin)).status).toBe(
    'accepted',
  );
  state = (await db.load()).state;
  const next = state.shifts.find((s) => s.status === 'open')!;
  const opening = cmd(
    'count',
    {
      kind: 'opening',
      shiftId: next.id,
      cash: 20000,
      items: Object.fromEntries(
        countArticles(state, 'opening').map((a) => [a.id, Math.max(0, stockBalances(state)[a.id] ?? 0)]),
      ),
    },
    admin,
    { shiftId: next.id },
  );
  expect((await submit(opening, admin)).status).toBe('accepted');
  const count = (await db.load()).state.counts.find((c) => c.shiftId === next.id)!;
  expect(count.differences?.[cup]).toBe(0);
});
