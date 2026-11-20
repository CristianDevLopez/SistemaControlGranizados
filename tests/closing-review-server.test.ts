import { afterAll, beforeAll, expect, it } from 'vitest';
import { PgBackend } from './support/backend.ts';
import { createGateway } from '../src/server/gateway.ts';
import { blindCountArticles, stockBalances } from '../src/domain/engine.ts';
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
