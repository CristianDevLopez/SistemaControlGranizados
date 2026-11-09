import { afterAll, beforeAll, expect, it } from 'vitest';
import { PgBackend } from './support/backend.ts';
import { createGateway } from '../src/server/gateway.ts';
import { admin, other, owner, cashier, cmd, ids, NOW } from './support/fixture.ts';
import type { Access, PlatformView } from '../src/domain/platform.ts';
import { belongsToBranch } from '../src/lib/db.ts';
import { sha256 } from '../src/server/crypto.ts';
let db: PgBackend, gateway: ReturnType<typeof createGateway>;
let legacy: string, second: string, foreign: string, business: string;
let secondDevice = '';
beforeAll(async () => {
  db = await PgBackend.create();
  gateway = createGateway({ backend: db, allowedOrigins: [], now: () => new Date(NOW) });
  const access = (await db.platform(admin.id, 'access')) as Access;
  legacy = access.legacyBranchId;
  business = access.businesses[0].id;
}, 60000);
afterAll(async () => {
  await db?.db.close();
});
async function request(route: string, body?: unknown, actor = owner, branchId?: string, deviceId?: string) {
  const response = await gateway(
    new Request(`http://localhost/dexter/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${actor.id}`,
        'content-type': 'application/json',
        'x-device-id': deviceId ?? actor.deviceId,
        'x-device-token': 'test-device-token',
        ...(branchId ? { 'x-branch-id': branchId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: response.status, body: await response.json() };
}
it('el propietario solicita un segundo local sin activar ni fijar su tarifa', async () => {
  const response = await request(
    'platform/branches',
    { businessId: business, name: 'Segunda sede', city: 'Medellín', status: 'active', monthlyFee: 1 },
    admin,
  );
  expect(response.status).toBe(200);
  second = response.body.id;
  const access = (await db.platform(admin.id, 'access')) as Access;
  expect(access.branches).toHaveLength(2);
  expect(access.branches.find((b) => b.id === second)).toMatchObject({
    status: 'requested',
    monthlyFee: null,
    role: 'admin',
    isOwner: true,
  });
  expect((await db.forBranch(second).load()).state).toMatchObject({
    orders: [],
    stock: [],
    shifts: [],
    flavors: [],
    payments: [],
  });
  expect((await db.forBranch(second).load()).state.sizes).toHaveLength(5);
  const inactiveSnapshot = (await request('snapshot', undefined, owner, second)).body;
  const inactiveCommand = {
    ...cmd('request_shift', { base: 0 }, owner),
    branchId: second,
    deviceId: inactiveSnapshot.actor.deviceId,
  };
  expect((await request('commands', { commands: [inactiveCommand] }, owner, second)).status).toBe(403);
  expect(
    (
      await request(
        'platform/branches/update',
        { id: second, status: 'active', monthlyFee: 80000, billingStart: '2026-10-01' },
        admin,
      )
    ).status,
  ).toBe(403);
  expect((await request('platform/branches', { businessId: business, name: 'Ajeno' }, other)).status).toBe(
    403,
  );
});
it('solo el desarrollador activa y tarifa el local; la cuenta propietaria conserva acceso a ambos', async () => {
  expect((await request('platform/branches/update', { id: second, status: 'active' })).status).toBe(400);
  expect(
    (
      await request('platform/branches/update', {
        id: second,
        status: 'active',
        monthlyFee: 80000,
        billingStart: '2026-10-01',
      })
    ).status,
  ).toBe(200);
  const device = crypto.randomUUID();
  secondDevice = device;
  await db.forBranch(second).saveDevice({
    id: device,
    userId: admin.id,
    name: 'Admin segunda sede',
    active: true,
    primary: false,
    tokenHash: await sha256('test-device-token'),
  });
  const response = await request('snapshot', undefined, admin, second, device);
  expect(response.status).toBe(200);
  expect(response.body.branch.id).toBe(second);
  expect(response.body.access.branches).toHaveLength(2);
  expect(response.body.state.orders).toEqual([]);
  expect(response.body.state.shifts).toEqual([]);
  expect(response.body.profiles.some((p: { id: string }) => p.id === cashier.id)).toBe(false);
});
it('cajas, revisiones, inventarios y operaciones se aíslan por local', async () => {
  const before = await db.load();
  const snap = (await request('snapshot', undefined, admin, second, secondDevice)).body;
  const operation = {
    ...cmd('request_shift', { base: 12000 }, admin),
    branchId: second,
    deviceId: secondDevice,
    configVersion: 1,
    shiftId: undefined,
  };
  const opened = await request('commands', { commands: [operation] }, admin, second, secondDevice);
  expect(opened.body.results[0].status).toBe('accepted');
  expect((await db.forBranch(second).load()).state.shifts).toHaveLength(1);
  expect((await db.load()).state).toEqual(before.state);
  expect(await db.revision()).toBe(before.revision);
  expect(await db.forBranch(second).revision()).toBeGreaterThan(snap.revision);
  const crossed = await request(
    'commands',
    { commands: [{ ...operation, id: crypto.randomUUID(), branchId: legacy }] },
    admin,
    second,
    secondDevice,
  );
  expect(crossed.status).toBe(403);
  const legacyCommand = await request(
    'commands',
    {
      commands: [
        { ...cmd('save_flavor', { name: 'Sin local', alcohol: false }, admin), deviceId: secondDevice },
      ],
    },
    admin,
    second,
    secondDevice,
  );
  expect(legacyCommand.status).toBe(403);
  const loaded = await db.forBranch(second).load();
  loaded.state.flavors.push((await db.load()).state.flavors[0]);
  await expect(
    db
      .forBranch(second)
      .commit(
        loaded.revision,
        { ...cmd('save_flavor', {}, admin), branchId: second, deviceId: secondDevice },
        loaded.state,
        { id: crypto.randomUUID(), status: 'accepted', message: '' },
      ),
  ).rejects.toThrow(/otro local/);
});
it('otra empresa queda fuera del alcance del propietario y de sus empleados', async () => {
  const response = await request('platform/businesses', {
    name: 'Otra empresa',
    ownerId: other.id,
    localName: 'Local ajeno',
  });
  expect(response.status).toBe(200);
  foreign = response.body.branchId;
  expect((await request('snapshot', undefined, admin, foreign)).status).toBe(403);
  expect((await request('snapshot', undefined, cashier, second)).status).toBe(403);
  expect(((await db.platform(admin.id, 'access')) as Access).branches.map((b) => b.id)).not.toContain(
    foreign,
  );
  expect(((await db.platform(other.id, 'access')) as Access).branches.map((b) => b.id)).toContain(foreign);
  const exported = await request('export', undefined, admin, second, secondDevice);
  expect(exported.body.branch.id).toBe(second);
  expect(exported.body.state.shifts.every((s: { deviceId: string }) => s.deviceId === secondDevice)).toBe(
    true,
  );
});
it('registra una mensualidad por periodo y local, pagos parciales e idempotencia', async () => {
  const invoice = await request('platform/invoices', {
    branchId: second,
    period: '2026-10-01',
    dueDate: '2026-10-31',
  });
  expect(invoice.status).toBe(200);
  expect(
    (await request('platform/invoices', { branchId: second, period: '2026-10-01', dueDate: '2026-11-10' }))
      .body.id,
  ).toBe(invoice.body.id);
  const payment = {
    id: crypto.randomUUID(),
    invoiceId: invoice.body.id,
    amount: 30000,
    paidAt: '2026-10-23',
    reference: 'Transferencia 123',
  };
  expect((await request('platform/payments', payment, admin)).status).toBe(403);
  expect((await request('platform/payments', payment)).status).toBe(200);
  expect((await request('platform/payments', payment)).status).toBe(200);
  expect((await request('platform/payments', { ...payment, amount: 1 })).status).toBe(400);
  expect(
    (await request('platform/payments', { ...payment, id: crypto.randomUUID(), amount: 50001 })).status,
  ).toBe(400);
  expect(
    (await request('platform/invoices/void', { id: invoice.body.id, reason: 'Corrección' })).status,
  ).toBe(400);
  const view = (await request('platform/view', undefined, admin)).body as PlatformView;
  expect(view.invoices).toHaveLength(1);
  expect(view.invoices[0]).toMatchObject({ amount: 80000, paid: 30000, branchId: second });
  expect(view.payments).toHaveLength(1);
  expect((await request('platform/view', undefined, other)).body.invoices).toHaveLength(0);
  await request('platform/branches/update', { id: second, monthlyFee: 90000 });
  expect((await request('platform/view')).body.invoices[0].amount).toBe(80000);
  const next = await request('platform/invoices', {
    branchId: second,
    period: '2026-11-01',
    dueDate: '2026-11-10',
  });
  expect(next.status).toBe(200);
  expect(
    (await request('platform/view')).body.invoices.find((i: { id: string }) => i.id === next.body.id).amount,
  ).toBe(90000);
});
it('crea propietarios independientes con primer local pendiente y sin asignarlos al local existente', async () => {
  const result = await request('platform/businesses', {
    name: 'Negocio nuevo',
    ownerName: 'Nueva propietaria',
    email: 'new-owner@test.invalid',
    password: 'test-password-123456',
    localName: 'Primera sede',
  });
  expect(result.status).toBe(200);
  const businesses = (await request('platform/view')).body.businesses as { id: string; ownerId: string }[];
  const newOwner = businesses.find((b) => b.id === result.body.id)!.ownerId;
  const access = (await db.platform(newOwner, 'access')) as Access;
  expect(access.developer).toBe(false);
  expect(access.branches).toHaveLength(1);
  expect(access.branches[0]).toMatchObject({ id: result.body.branchId, status: 'requested', isOwner: true });
  expect(access.branches[0].id).not.toBe(legacy);
  expect((await db.forBranch(legacy).profiles()).some((p) => p.id === newOwner)).toBe(false);
  expect((await db.forBranch(result.body.branchId).load()).state.parameters).toHaveLength(1);
});
it('no suspende un local con caja abierta y mantiene las tablas y RPCs inaccesibles al navegador', async () => {
  expect((await request('platform/branches/update', { id: second, status: 'suspended' })).status).toBe(400);
  for (const role of ['anon', 'authenticated']) {
    await db.db.exec(`set role ${role}`);
    try {
      await expect(
        db.db.query('select public.dexter_platform($1,$2,$3)', [admin.id, 'view', {}]),
      ).rejects.toThrow(/permission denied/);
      await expect(db.db.query('select public.dexter_branch_read_state($1)', [second])).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.db.query('select * from private.subscription_payments')).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.db.exec('reset role');
    }
  }
});
it('el caché solo aplica operaciones del usuario y del local correspondientes', async () => {
  const snapshot = (await request('snapshot', undefined, admin, second, secondDevice)).body;
  expect(belongsToBranch({ actorId: admin.id, branchId: second }, snapshot)).toBe(true);
  expect(belongsToBranch({ actorId: admin.id, branchId: legacy }, snapshot)).toBe(false);
  expect(belongsToBranch({ actorId: cashier.id, branchId: second }, snapshot)).toBe(false);
  expect(belongsToBranch({ actorId: admin.id }, snapshot)).toBe(false);
});
