import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGateway } from '../src/server/gateway.ts';
import type { Actor, CommandType } from '../src/domain/types.ts';
import { PgBackend } from './support/backend.ts';
import {
  admin,
  cashier,
  other,
  owner,
  support,
  cmd,
  countedItems,
  fixture,
  ids,
  NOW,
  run,
} from './support/fixture.ts';

let db: PgBackend;
let gateway: (req: Request) => Promise<Response>;
beforeEach(async () => {
  db = await PgBackend.create();
  await db.db.exec('delete from public.shifts');
  await db.db.query("update public.locations set data=jsonb_set(data,'{custodianId}',to_jsonb($1::text))", [
    other.id,
  ]);
  gateway = createGateway({ backend: db, allowedOrigins: [], now: () => new Date(NOW) });
}, 60000);
afterEach(async () => {
  await db?.db.close();
});

async function request(route: string, payload: unknown, actor: Actor = admin) {
  const response = await gateway(
    new Request(`http://localhost/dexter/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${actor.id}`,
        'x-device-id': actor.deviceId,
        'x-device-token': 'test-device-token',
      },
      body: JSON.stringify(payload),
    }),
  );
  return { status: response.status, body: await response.json() };
}
async function send(type: CommandType, payload: Record<string, unknown>, actor: Actor = admin) {
  const state = (await db.load()).state;
  const command = cmd(type, payload, actor, {
    configVersion: state.settings[0].version,
    shiftId: state.shifts.find((s) => ['open', 'requested', 'provisional'].includes(s.status))?.id,
  });
  const response = await request('commands', { commands: [command] }, actor);
  expect(response.status).toBe(200);
  return { command, result: response.body.results[0] };
}
async function accepted(type: CommandType, payload: Record<string, unknown>, actor: Actor = admin) {
  const response = await send(type, payload, actor);
  expect(response.result.status, response.result.message).toBe('accepted');
  return response;
}

it.each([admin, owner])(
  '$name inicia, cuenta, cobra y cierra su caja sin otro admin activo',
  async (actor) => {
    for (const profile of await db.profiles())
      if (profile.role === 'admin' && profile.id !== actor.id)
        await db.saveProfile({ ...profile, active: false });
    const primary = (await db.devices()).find((d) => d.primary);
    const opening = await accepted('request_shift', { base: 12000 }, actor);
    let state = (await db.load()).state;
    const shiftId = opening.result.referenceId;
    expect(state.shifts).toHaveLength(1);
    expect(state.shifts[0]).toMatchObject({
      id: shiftId,
      cashierId: actor.id,
      deviceId: actor.deviceId,
      status: 'open',
      authorizedBy: actor.id,
      base: 12000,
      openedAt: NOW,
    });
    await request('commands', { commands: [opening.command] }, actor);
    expect((await db.load()).state.shifts).toHaveLength(1);
    expect((await request('snapshot', {}, actor)).body.actor.primary).toBe(false);
    await accepted('count', { kind: 'opening', shiftId, cash: 12000, items: countedItems(state) }, actor);
    const order = await accepted(
      'create_order',
      {
        lines: [
          { flavorId: ids.flavor, sizeId: state.sizes.find((s) => s.name === '12 oz')!.id, quantity: 1 },
        ],
      },
      actor,
    );
    expect((await request('quote', { orderId: order.result.referenceId, codes: [] }, actor)).body.total).toBe(
      14000,
    );
    await accepted('pay', { orderId: order.result.referenceId, deliver: true }, actor);
    state = (await db.load()).state;
    expect(state.payments[0]).toMatchObject({ cashierId: actor.id, amount: 14000 });
    await accepted(
      'count',
      {
        kind: 'closing',
        payments: { [`transfer:${ids.location}`]: 0 },
        shiftId,
        cash: 26000,
        retained: 10000,
        locationId: ids.location,
        items: countedItems(state),
      },
      actor,
    );
    state = (await db.load()).state;
    expect(state.shifts[0].status).toBe('closed');
    await accepted('execute_transfer', { transferId: state.transfers[0].id, evidenceId: ids.photo }, actor);
    await accepted('request_shift', { base: 99999 }, actor);
    state = (await db.load()).state;
    expect(state.shifts.find((s) => s.status === 'open')?.base).toBe(10000);
    expect(state.audit.find((a) => a.eventId === opening.command.id)).toMatchObject({
      by: actor.id,
      deviceId: actor.deviceId,
    });
    expect((await db.devices()).find((d) => d.primary)).toEqual(primary);
  },
);

it('el encargado sigue solicitando autorización y apoyo no puede abrir caja', async () => {
  expect((await send('request_shift', {}, support)).result.status).toBe('conflict');
  const opening = await accepted(
    'request_shift',
    { role: 'admin', status: 'open', authorizedBy: cashier.id, base: 500 },
    cashier,
  );
  const shiftId = opening.result.referenceId;
  expect((await db.load()).state.shifts[0]).toMatchObject({ status: 'requested', cashierId: cashier.id });
  expect((await send('authorize_shift', { shiftId }, cashier)).result.status).toBe('conflict');
  expect(
    (await send('count', { kind: 'opening', shiftId, cash: 500, items: countedItems(fixture()) }, cashier))
      .result.status,
  ).toBe('conflict');
  await accepted('authorize_shift', { shiftId, base: 500 });
  await accepted('count', { kind: 'opening', shiftId, cash: 500, items: countedItems(fixture()) }, cashier);
});

it('el titular retoma su caja desde su nueva sesión MFA y otro admin no puede cobrarla', async () => {
  await accepted('request_shift', { base: 0 }, owner);
  const state = (await db.load()).state;
  const order = await accepted(
    'create_order',
    { lines: [{ flavorId: ids.flavor, sizeId: state.sizes[0].id, quantity: 1 }] },
    owner,
  );
  expect((await request('quote', { orderId: order.result.referenceId, codes: [] }, other)).status).toBe(403);
  expect((await send('pay', { orderId: order.result.referenceId }, other)).result.status).toBe('conflict');
  const loaded = await db.load();
  const forged = cmd('pay', { orderId: order.result.referenceId }, other, {
    shiftId: loaded.state.shifts[0].id,
  });
  await expect(
    db.commit(loaded.revision, forged, loaded.state, {
      id: forged.id,
      status: 'accepted',
      message: 'Prueba de permisos',
    }),
  ).rejects.toThrow(/CASHIER_REQUIRED/);
  const sessionActor = { ...owner, deviceId: crypto.randomUUID() };
  db.tokens.set(owner.id, { id: owner.id, aal: 'aal2', sessionId: sessionActor.deviceId });
  expect(
    (await request('quote', { orderId: order.result.referenceId, codes: [] }, sessionActor)).status,
  ).toBe(200);
  const payment = await accepted('pay', { orderId: order.result.referenceId, deliver: true }, sessionActor);
  expect((await db.load()).state.audit.find((a) => a.eventId === payment.command.id)).toMatchObject({
    by: owner.id,
    deviceId: sessionActor.deviceId,
  });
  expect((await db.load()).state.shifts[0].deviceId).toBe(owner.deviceId);
});

it('dos aperturas simultáneas de admins producen una sola caja abierta', async () => {
  const results = await Promise.all([
    send('request_shift', { base: 100 }, admin),
    send('request_shift', { base: 200 }, owner),
  ]);
  expect(results.map((r) => r.result.status).sort()).toEqual(['accepted', 'conflict']);
  expect((await db.load()).state.shifts).toHaveLength(1);
});

it('exige MFA y no convierte una apertura offline en una apertura directa', async () => {
  db.tokens.set(admin.id, { id: admin.id, aal: 'aal1' });
  expect((await request('commands', { commands: [cmd('request_shift', { base: 0 }, admin)] })).status).toBe(
    403,
  );
  db.tokens.set(admin.id, { id: admin.id, aal: 'aal2' });
  expect((await send('request_shift', { offline: true })).result.status).toBe('conflict');
  expect((await db.load()).state.shifts).toHaveLength(0);
  const state = fixture();
  state.shifts = [];
  const requested = run(state, 'request_shift', {}, { ...admin, primary: true, online: false }).state
    .shifts[0];
  expect(requested.status).toBe('requested');
  expect(requested.authorizedBy).toBeUndefined();
});
