import { shiftCountArticles, stockBalances } from '../src/domain/engine.ts';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGateway } from '../src/server/gateway.ts';
import { blindCountArticles, locationBalance } from '../src/domain/engine.ts';
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
  '$name inicia, cobra y presenta su caja, que debe confirmar otro admin',
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
    await accepted(
      'submit_blind_count',
      { kind: 'opening', shiftId, cash: 12000, items: countedItems(state), attempt: 1 },
      actor,
    );
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
    const items = Object.fromEntries(
      shiftCountArticles(state, state.shifts[0], 'closing').map(({ id }) => [
        id,
        stockBalances(state)[id] ?? 0,
      ]),
    );
    // La venta de prueba no parte de inventario inicial. Se registra el conteo físico en cero.
    const locked = await accepted(
      'submit_blind_count',
      {
        kind: 'closing',
        shiftId,
        cash: 26000,
        items: Object.fromEntries(Object.keys(items).map((id) => [id, Math.max(0, items[id])])),
        attempt: 1,
      },
      actor,
    );
    await accepted(
      'submit_closing',
      {
        shiftId,
        countId: locked.result.referenceId,
        retained: 26000,
        sent: 0,
        verified: true,
        cashTotal: 14000,
        transferTotal: 0,
      },
      actor,
    );
    state = (await db.load()).state;
    expect(state.shifts[0].status).toBe('closed');
    expect((await send('approve_closing', { shiftId }, actor)).result.code).toBe('FORBIDDEN');
    expect((await send('request_shift', { base: 99999 }, actor)).result.message).toMatch(
      /confirmar el cierre anterior/,
    );
    expect(state.audit.find((a) => a.eventId === opening.command.id)).toMatchObject({
      by: actor.id,
      deviceId: actor.deviceId,
    });
    expect((await db.devices()).find((d) => d.primary)).toEqual(primary);
  },
);

it('el encargado abre con un conteo ciego y apoyo no puede abrir caja', async () => {
  expect((await send('request_shift', {}, support)).result.status).toBe('conflict');
  const opening = await accepted(
    'request_shift',
    { role: 'admin', status: 'open', authorizedBy: cashier.id, base: 500 },
    cashier,
  );
  const shiftId = opening.result.referenceId;
  expect((await db.load()).state.shifts[0]).toMatchObject({
    status: 'requested',
    cashierId: cashier.id,
    base: 0,
    blindOpening: { status: 'pending' },
  });
  expect((await send('authorize_shift', { shiftId }, cashier)).result.status).toBe('conflict');
  expect(
    (await send('count', { kind: 'opening', shiftId, cash: 500, items: countedItems(fixture()) }, cashier))
      .result.status,
  ).toBe('conflict');
  const items = Object.fromEntries(blindCountArticles(fixture()).map((a) => [a.id, 0]));
  expect(
    (await send('submit_blind_count', { kind: 'opening', shiftId, cash: 0, attempt: 1, items }, cashier))
      .result.status,
  ).toBe('conflict');
  await accepted('authorize_shift', { shiftId, base: 0, openingItems: [`sealed_bag:${ids.flavor}`] });
  expect((await db.load()).state.shifts[0]).toMatchObject({
    status: 'open',
    authorizedBy: admin.id,
    blindOpening: { status: 'pending', items: [`sealed_bag:${ids.flavor}`] },
  });
  const counted = await accepted(
    'submit_blind_count',
    { kind: 'opening', shiftId, cash: 0, attempt: 1, items },
    cashier,
  );
  expect(counted.result).toMatchObject({ code: 'COUNT_MATCHED', message: 'Todo coincide. ¡Buen turno!' });
});

it('un retiro de Nequi reduce la cuenta al ejecutar y aumenta el efectivo al confirmar', async () => {
  const account = await accepted('save_location', {
    name: 'Nequi',
    type: 'bank',
    bank: 'Nequi',
    account: '3000000000',
    custodianId: admin.id,
    openingBalance: 85000,
  });
  const custody = await accepted('save_location', {
    name: 'Caja principal',
    type: 'treasury',
    custodianId: other.id,
  });
  const from = account.result.referenceId!;
  const to = custody.result.referenceId!;
  expect(
    (await send('execute_transfer', { from, to, amount: 20000, notes: 'Retiro ajeno' }, other)).result.status,
  ).toBe('conflict');
  const movement = await accepted('execute_transfer', { from, to, amount: 20000, notes: 'Retiro' });
  const transferId = movement.result.referenceId;
  await request('commands', { commands: [movement.command] });
  let { state } = await db.load();
  expect(state.transfers).toMatchObject([{ id: transferId, status: 'in_transit', executedBy: admin.id }]);
  expect([locationBalance(state, from), locationBalance(state, to)]).toEqual([65000, 0]);
  await accepted('confirm_transfer', { transferId, receivedAmount: 20000 }, other);
  ({ state } = await db.load());
  expect([locationBalance(state, from), locationBalance(state, to)]).toEqual([65000, 20000]);
});

it('confirma al ejecutar un traslado entre cuentas del mismo custodio', async () => {
  const origin = await accepted('save_location', {
    name: 'Nequi',
    type: 'bank',
    bank: 'Nequi',
    account: '3000000000',
    custodianId: admin.id,
    openingBalance: 85000,
  });
  const destination = await accepted('save_location', {
    name: 'Caja propia',
    type: 'treasury',
    custodianId: admin.id,
  });
  const from = origin.result.referenceId!;
  const to = destination.result.referenceId!;
  const movement = await accepted('execute_transfer', { from, to, amount: 20000, notes: 'Retiro propio' });
  const transferId = movement.result.referenceId;
  const { state } = await db.load();
  expect([locationBalance(state, from), locationBalance(state, to)]).toEqual([65000, 20000]);
  expect(state.transfers.find((item) => item.id === transferId)).toMatchObject({
    status: 'confirmed',
    executedBy: admin.id,
    confirmedBy: admin.id,
    receivedAmount: 20000,
  });
});

it('el titular retoma su caja desde su nueva sesión MFA y otro admin no puede cobrarla', async () => {
  const opening = await accepted('request_shift', { base: 0 }, owner);
  await accepted(
    'submit_blind_count',
    {
      kind: 'opening',
      shiftId: opening.result.referenceId,
      cash: 0,
      items: countedItems(fixture()),
      attempt: 1,
    },
    owner,
  );
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

it('permite abrir con contraseña y no convierte una apertura offline en una apertura directa', async () => {
  db.tokens.set(admin.id, { id: admin.id, aal: 'aal1' });
  const opened = await request('commands', { commands: [cmd('request_shift', { base: 0 }, admin)] });
  expect(opened.status).toBe(200);
  expect(opened.body.results[0].status).toBe('accepted');
  await db.db.exec('delete from public.shifts');
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
