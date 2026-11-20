import { afterAll, beforeAll, expect, it } from 'vitest';
import { createGateway } from '../src/server/gateway.ts';
import type { Actor, Command, CommandType } from '../src/domain/types.ts';
import { PgBackend } from './support/backend.ts';
import { admin, cashier, cmd, ids, NOW, other, support } from './support/fixture.ts';

let db: PgBackend, gateway: ReturnType<typeof createGateway>, branchId: string;
const third = { ...admin, id: ids.third };

beforeAll(async () => {
  db = await PgBackend.create();
  gateway = createGateway({ backend: db, allowedOrigins: [], now: () => new Date(NOW) });
  branchId = (await db.platform(admin.id, 'access')).legacyBranchId;
}, 60000);
afterAll(async () => {
  await db?.db.close();
});

async function request(route: string, body: unknown, actor = admin) {
  const response = await gateway(
    new Request(`http://localhost/dexter/${route}`, {
      method: 'POST',
      headers: {
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

async function execute(command: Command, actor: Actor) {
  return (await request('commands', { commands: [command] }, actor)).body.results[0];
}

async function submit(type: CommandType, payload: Record<string, unknown>, actor = admin) {
  return execute(cmd(type, payload, actor, { branchId }), actor);
}

it('publica un precio solo después de la aprobación de otro admin y agrega un registro inmutable', async () => {
  const size = (await db.load()).state.sizes[0];
  const proposed = await submit('save_size', { ...size, alcoholPrice: 17300 });
  expect(proposed).toMatchObject({ status: 'accepted', approvalPending: true });
  expect((await db.load()).state.sizes[0].alcoholPrice).toBe(size.alcoholPrice);
  const payload = { requestId: proposed.referenceId, approve: true };
  expect((await submit('resolve_change', payload)).code).toBe('FORBIDDEN');
  expect((await submit('resolve_change', payload, cashier)).code).toBe('FORBIDDEN');
  const approval = cmd('resolve_change', payload, other, { branchId });
  await db.db.exec('set role service_role');
  try {
    expect(await execute(approval, other)).toMatchObject({ status: 'accepted' });
    expect(await execute(approval, other)).toMatchObject({ status: 'accepted' });
  } finally {
    await db.db.exec('reset role');
  }
  const state = (await db.load()).state;
  expect(state.sizes.find((entry) => entry.id === size.id)?.alcoholPrice).toBe(17300);
  const records = state.audit.filter((entry) => entry.change?.kind === 'save_size');
  expect(records).toHaveLength(1);
  expect(records[0].change).toMatchObject({
    before: { alcoholPrice: size.alcoholPrice },
    after: { alcoholPrice: 17300 },
    proposedBy: { by: admin.id },
    votes: [{ by: other.id }],
  });
  await expect(db.db.query('delete from public.audit where id=$1', [records[0].id])).rejects.toThrow(
    /immutable/i,
  );
  expect(
    (await db.db.query("select has_table_privilege('service_role', 'public.audit', 'truncate') as allowed"))
      .rows[0],
  ).toEqual({ allowed: false });
  const employee = (await request('snapshot', {}, cashier)).body;
  expect(employee.state.audit).toEqual([]);
  expect(employee.state.requests.some((entry: { type: string }) => entry.type === 'change')).toBe(false);
});

it('requiere dos personas distintas después de aprobar el nuevo parámetro', async () => {
  const parameter = await submit('set_approval_requirement', { required: 2 });
  expect(parameter.approvalPending).toBe(true);
  await submit('resolve_change', { requestId: parameter.referenceId, approve: true }, other);
  expect((await db.load()).state.settings[0].requiredChangeApprovals).toBe(2);

  const submitted = await request('users/update', { userId: support.id, permissions: { orders: false } });
  expect(submitted.body.result.approvalPending).toBe(true);
  const payload = { requestId: submitted.body.result.referenceId, approve: true };
  expect(await submit('resolve_change', payload, other)).toMatchObject({
    status: 'accepted',
    approvalPending: true,
  });
  expect((await db.forBranch(branchId).profile(support.id))?.permissions).toEqual({});
  expect((await submit('resolve_change', payload, other)).status).toBe('conflict');
  expect(await submit('resolve_change', payload, third)).toMatchObject({
    status: 'accepted',
    message: 'Cambio aprobado y aplicado.',
  });
  expect((await db.forBranch(branchId).profile(support.id))?.permissions).toEqual({ orders: false });
});

it('revoca usuario y dispositivo de inmediato y registra quién lo hizo', async () => {
  const permissions = (await db.forBranch(branchId).profile(support.id))?.permissions;
  const user = await request('users/update', { userId: support.id, active: false });
  expect(user.body.result.message).toBe('Acceso desactivado.');
  expect(await request('snapshot', {}, support)).toMatchObject({
    status: 403,
    body: { code: 'USER_REVOKED' },
  });
  const device = await request('devices/update', { deviceId: cashier.deviceId, active: false });
  expect(device.body.result.message).toBe('Acceso desactivado.');
  expect(await request('snapshot', {}, cashier)).toMatchObject({
    status: 403,
    body: { code: 'DEVICE_REVOKED' },
  });
  const state = (await db.load()).state;
  const revocations = state.audit.filter(
    (entry) => entry.change?.kind === 'change_access' && !entry.change.votes.length,
  );
  expect(revocations.map((entry) => entry.change)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        access: 'user',
        after: { role: 'apoyo', active: false, permissions },
        proposedBy: expect.objectContaining({ by: admin.id }),
      }),
      expect.objectContaining({ access: 'device', after: { active: false, primary: false } }),
    ]),
  );
});
