import { beforeAll, afterAll, it, expect } from 'vitest';
import { PgBackend } from './support/backend.ts';
import { admin, cashier, support, ids, cmd, NOW } from './support/fixture.ts';
import { createGateway } from '../src/server/gateway.ts';
import { applyCommand } from '../src/domain/engine.ts';
let db: PgBackend, gateway: (req: Request) => Promise<Response>;
beforeAll(async () => {
  db = await PgBackend.create();
  gateway = createGateway({
    backend: db,
    allowedOrigins: ['http://localhost:5173'],
    now: () => new Date(NOW),
  });
}, 60000);
afterAll(async () => {
  await db?.db.close();
});
async function request(route: string, payload: unknown, actor = cashier) {
  const r = await gateway(
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
  return { status: r.status, body: await r.json() };
}
it('ejecuta la migración completa en PostgreSQL y conserva las restricciones', async () => {
  expect((await db.load()).state.sizes).toHaveLength(5);
  const r = await db.db.query<any>(
    "select count(*)::integer as n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity",
  );
  expect(r.rows[0].n).toBe(29);
});
it('impide leer y mutar tablas o invocar comandos desde roles del navegador', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.db.exec(`set role ${role}`);
    try {
      await expect(db.db.query('select * from public.payments')).rejects.toThrow(/permission denied/);
      await expect(db.db.query('select public.dexter_read_state()')).rejects.toThrow(/permission denied/);
      await expect(db.db.query("select public.dexter_security('revision','{}')")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.db.exec('reset role');
    }
  }
});
it('aplica límites de intentos de forma atómica', async () => {
  const values = await Promise.all([1, 2, 3, 4].map(() => db.rate('test-rate', 3)));
  expect(values).toEqual([true, true, true, false]);
});
it('la API no revela conteos esperados y rechaza accesos sin MFA', async () => {
  const response = await request('snapshot', {});
  expect(response.status).toBe(200);
  expect(response.body.state.stock).toEqual([]);
  db.tokens.set(admin.id, { id: admin.id, aal: 'aal1' });
  try {
    expect((await request('snapshot', {}, admin)).status).toBe(403);
  } finally {
    db.tokens.set(admin.id, { id: admin.id, aal: 'aal2' });
  }
});
it('reintenta un mismo comando sin duplicar pagos ni consumos', async () => {
  const state = (await db.load()).state,
    create = cmd('create_order', {
      lines: [{ flavorId: ids.flavor, sizeId: state.sizes[0].id, quantity: 1 }],
    });
  const a = await request('commands', { commands: [create] });
  expect(a.body.results[0].status).toBe('accepted');
  const oid = a.body.results[0].referenceId,
    pay = cmd('pay', { orderId: oid, deliver: true });
  await request('commands', { commands: [pay] });
  await request('commands', { commands: [pay] });
  const result = (await db.load()).state;
  expect(result.payments.filter((p) => p.eventId === pay.id)).toHaveLength(1);
  expect(result.deliveries.filter((p) => p.eventId === pay.id)).toHaveLength(1);
});
it('guarda todos los sabores del combinado en PostgreSQL y conserva sus consumos por separado', async () => {
  const loaded = await db.load(),
    create = cmd('create_order', {
      lines: [{ flavorIds: [ids.plain, ids.flavor], sizeId: loaded.state.sizes[0].id, quantity: 1 }],
    });
  const created = await request('commands', { commands: [create] });
  expect(created.body.results[0].status).toBe('accepted');
  const orderId = created.body.results[0].referenceId;
  const paid = await request('commands', { commands: [cmd('pay', { orderId, deliver: true })] });
  expect(paid.body.results[0].status).toBe('accepted');
  const stored = await db.db.query<any>('select data from public.order_lines where order_id=$1', [orderId]);
  expect(stored.rows[0].data.flavorIds).toEqual([ids.flavor, ids.plain]);
  const state = (await db.load()).state;
  const liquids = state.stock.filter(
    (movement) => movement.referenceId === orderId && movement.article.startsWith('liquid:'),
  );
  expect(liquids).toHaveLength(2);
  expect(liquids.map((movement) => movement.quantity)).toEqual([-6, -6]);
});

it('elimina una degustación por API y persiste la restitución sin duplicar los ajustes al reintentar', async () => {
  const taste = cmd('taste', { flavorId: ids.flavor });
  const created = await request('commands', { commands: [taste] });
  expect(created.body.results[0].status).toBe('accepted');
  const orderId = created.body.results[0].referenceId;
  const tasting = (await db.load()).state.orders.find((order) => order.id === orderId)!;
  const remove = cmd('remove_tasting', {
    orderId,
    tastingId: tasting.tastings[0].id,
    expectedVersion: tasting.version,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const removed = await request('commands', { commands: [remove] });
    expect(removed.body.results[0].status).toBe('accepted');
  }
  const stored = await db.db.query<any>('select data from public.orders where id=$1', [orderId]);
  expect(stored.rows[0].data).toMatchObject({ status: 'cancelled', tastings: [] });
  const adjustments = (await db.load()).state.stock.filter((movement) => movement.referenceId === orderId);
  expect(adjustments).toHaveLength(4);
  expect(
    adjustments
      .filter((movement) => movement.article === 'copita')
      .reduce((sum, movement) => sum + movement.quantity, 0),
  ).toBe(0);
  expect(
    adjustments
      .filter((movement) => movement.article === `liquid:${ids.flavor}`)
      .reduce((sum, movement) => sum + movement.quantity, 0),
  ).toBe(0);
});

it('un cliente no puede modificar eventos ya registrados', async () => {
  const payment = (await db.load()).state.payments[0];
  await expect(
    db.db.query('update public.payments set data=data||$2::jsonb where id=$1', [payment.id, { amount: 1 }]),
  ).rejects.toThrow(/Immutable/);
});
it('resuelve dos canjes concurrentes con un solo ganador', async () => {
  let state = (await db.load()).state;
  const promotion = cmd(
    'save_promotion',
    {
      name: 'Cupón de prueba',
      effect: 'free',
      delivery: 'coupon',
      sizeIds: [],
      flavorIds: [],
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2027-01-01T00:00:00Z',
    },
    admin,
    { configVersion: state.settings[0].version },
  );
  let r = await request('commands', { commands: [promotion] }, admin);
  expect(r.body.results[0].status).toBe('accepted');
  const promoId = r.body.results[0].referenceId;
  state = (await db.load()).state;
  const issue = cmd('issue_coupon', { promotionId: promoId, expiresAt: '2026-11-01T00:00:00Z' }, admin, {
    configVersion: state.settings[0].version,
  });
  r = await request('commands', { commands: [issue] }, admin);
  expect(r.body.results[0].status).toBe('accepted');
  const coupon = (await db.load()).state.coupons.find((c) => c.id === r.body.results[0].referenceId)!;
  const orders = [];
  for (let i = 0; i < 2; i++) {
    state = (await db.load()).state;
    const create = cmd(
      'create_order',
      { lines: [{ flavorId: ids.flavor, sizeId: state.sizes[0].id, quantity: 1 }] },
      cashier,
      { configVersion: state.settings[0].version },
    );
    const a = await request('commands', { commands: [create] });
    orders.push(a.body.results[0].referenceId);
  }
  state = (await db.load()).state;
  const results = await Promise.all(
    orders.map((orderId) =>
      request('commands', {
        commands: [
          cmd('pay', { orderId, codes: [coupon.code], deliver: true }, cashier, {
            configVersion: state.settings[0].version,
          }),
        ],
      }),
    ),
  );
  expect(results.map((r) => r.body.results[0].status).sort()).toEqual(['accepted', 'conflict']);
  expect((await db.load()).state.coupons.find((c) => c.id === coupon.id)?.status).toBe('redeemed');
});
it('rechaza acciones administrativas de empleado aunque se invoquen por API', async () => {
  const c = cmd('configure', { cashLimit: 1 });
  const result = await request('commands', { commands: [c] });
  expect(result.body.results[0].status).toBe('conflict');
  expect((await db.load()).state.settings[0].cashLimit).toBe(500000);
});
it('detecta cambio de revisión y dispositivos desactivados en el servidor', async () => {
  const loaded = await db.load(),
    c = cmd('taste', { flavorId: ids.flavor });
  const applied = applyCommand(loaded.state, c, cashier, NOW);
  await expect(db.commit(loaded.revision - 1, c, applied.state, applied.result)).rejects.toThrow(
    /REVISION_CONFLICT/,
  );
  const device = (await db.devices()).find((d) => d.id === cashier.deviceId)!;
  await db.saveDevice({ ...device, active: false });
  try {
    expect((await request('snapshot', {})).status).toBe(403);
  } finally {
    await db.saveDevice(device);
  }
});
it('rechaza un cambio de pedido desactualizado entre caja y apoyo', async () => {
  const state = (await db.load()).state;
  const create = cmd(
    'create_order',
    { lines: [{ flavorId: ids.flavor, sizeId: state.sizes[0].id, quantity: 2 }] },
    cashier,
    { configVersion: state.settings[0].version },
  );
  const a = await request('commands', { commands: [create] });
  const oid = a.body.results[0].referenceId;
  const first = cmd('deliver', { orderId: oid, expectedVersion: 1 }, support, {
    configVersion: state.settings[0].version,
  });
  await request('commands', { commands: [first] }, support);
  const second = cmd('deliver', { orderId: oid, expectedVersion: 1 }, cashier, {
    configVersion: state.settings[0].version,
  });
  const b = await request('commands', { commands: [second] });
  expect(b.body.results[0].status).toBe('conflict');
});

it('persiste el arqueo solicitado por admin y permite presentarlo solo a la caja responsable', async () => {
  const state = (await db.load()).state,
    cup = `cup:${state.sizes[0].id}`;
  const start = cmd('start_audit', { shiftId: ids.shift, cash: false, items: [cup] }, admin, {
    configVersion: state.settings[0].version,
  });
  expect((await request('commands', { commands: [start] }, admin)).body.results[0].status).toBe('accepted');
  const loaded = await db.load(),
    auditId = loaded.state.settings[0].auditId;
  const snapshot = await request('snapshot', {});
  expect(snapshot.body.state.settings[0].auditRequest).toMatchObject({ items: [cup], cash: false });
  expect(snapshot.body.state.settings[0].auditRequest.expectedItems).toBeUndefined();
  for (const actor of [admin, support]) {
    const forbidden = cmd('finish_audit', { shiftId: ids.shift, auditId, items: { [cup]: 3 } }, actor, {
      configVersion: loaded.state.settings[0].version,
    });
    await expect(
      db.commit(loaded.revision, forbidden, loaded.state, {
        id: forbidden.id,
        status: 'accepted',
        message: '',
      }),
    ).rejects.toThrow(/CASHIER_REQUIRED/);
  }
  const finish = cmd('finish_audit', { shiftId: ids.shift, auditId, items: { [cup]: 3 } }, cashier, {
    configVersion: loaded.state.settings[0].version,
  });
  const startedByCashier = cmd('start_audit', { shiftId: ids.shift, cash: true });
  await expect(
    db.commit(loaded.revision, startedByCashier, loaded.state, {
      id: startedByCashier.id,
      status: 'accepted',
      message: '',
    }),
  ).rejects.toThrow(/ADMIN_REQUIRED/);
  const stale = { ...finish, payload: { ...finish.payload, auditId: ids.other } };
  await expect(
    db.commit(loaded.revision, stale, loaded.state, { id: stale.id, status: 'accepted', message: '' }),
  ).rejects.toThrow(/ACTIVE_AUDIT_REQUIRED/);
  expect((await request('commands', { commands: [finish] })).body.results[0].status).toBe('accepted');
  const completed = (await db.load()).state;
  expect(completed.settings[0].auditId).toBeUndefined();
  expect(completed.counts.find((c) => c.auditId === auditId)).toMatchObject({
    by: cashier.id,
    requestedBy: admin.id,
    items: { [cup]: 3 },
  });
  const countSnapshot = structuredClone(completed.counts);
  expect((await request('commands', { commands: [finish] })).body.results[0].status).toBe('accepted');
  expect((await db.load()).state.counts).toEqual(countSnapshot);
  for (const role of ['anon', 'authenticated']) {
    const access = await db.db.query<{ allowed: boolean }>(
      "select has_function_privilege($1, 'public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb)', 'EXECUTE') as allowed",
      [role],
    );
    expect(access.rows[0].allowed).toBe(false);
  }
});
