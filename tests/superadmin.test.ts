import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGateway } from '../src/server/gateway.ts';
import { isReadOnlyView, rolePreview } from '../src/domain/views.ts';
import type { Actor, CommandType, Snapshot } from '../src/domain/types.ts';
import { sha256 } from '../src/server/crypto.ts';
import { PgBackend } from './support/backend.ts';
import { admin, cashier, owner, support, fixture, cmd, NOW } from './support/fixture.ts';

let db: PgBackend;
let gateway: (req: Request) => Promise<Response>;
beforeAll(async () => {
  db = await PgBackend.create();
  gateway = createGateway({ backend: db, allowedOrigins: [] });
}, 60000);
afterAll(async () => {
  await db?.db.close();
});
async function request(route: string, payload?: unknown, actor: Actor = owner, previewRole?: string) {
  const response = await gateway(
    new Request(`http://localhost/dexter/${route}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${actor.id}`,
        'x-device-id': actor.deviceId,
        'x-device-token': 'test-device-token',
        ...(previewRole === undefined ? {} : { 'x-preview-role': previewRole }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

it('solo la identidad privada recibe el acceso y no aparece en el equipo de otros usuarios', async () => {
  const own = await request('snapshot');
  expect(own.status).toBe(200);
  expect(own.body.actor.superAdmin).toBe(true);
  for (const actor of [admin, cashier, support]) {
    const other = await request('snapshot', undefined, actor);
    expect(other.status).toBe(200);
    expect(other.body.actor.superAdmin).toBeUndefined();
    expect(other.body.profiles.some((p: Actor) => p.id === owner.id)).toBe(false);
    expect(other.body.devices.some((d: { userId: string }) => d.userId === owner.id)).toBe(false);
  }
});

it('exige doble factor al superadministrador', async () => {
  db.tokens.set(owner.id, { id: owner.id, aal: 'aal1' });
  try {
    expect((await request('snapshot')).body.code).toBe('MFA_REQUIRED');
  } finally {
    db.tokens.set(owner.id, { id: owner.id, aal: 'aal2', sessionId: owner.deviceId });
  }
});
it('el superadministrador entra sin equipo registrado y conserva la caja real', async () => {
  const sessionId = crypto.randomUUID();
  const primaryBefore = (await db.devices()).find((d) => d.primary);
  const withoutDevice = () =>
    gateway(
      new Request('http://localhost/dexter/snapshot', { headers: { authorization: `Bearer ${owner.id}` } }),
    );
  db.tokens.set(owner.id, { id: owner.id, aal: 'aal2', sessionId });
  try {
    const response = await withoutDevice();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.actor).toMatchObject({ id: owner.id, superAdmin: true, deviceId: sessionId, primary: false });
    expect(data.devices.some((d: { userId: string }) => d.userId === owner.id)).toBe(false);
    expect((await db.devices()).find((d) => d.primary)).toEqual(primaryBefore);
    await withoutDevice();
    expect((await db.devices()).filter((d) => d.id === sessionId)).toHaveLength(1);
    expect((await request('devices/self', { name: 'No crear', primary: true })).status).toBe(403);
    expect((await request('devices/update', { deviceId: sessionId, primary: true })).status).toBe(403);
    for (const actor of [admin, cashier, support]) {
      const response = await gateway(
        new Request('http://localhost/dexter/snapshot', { headers: { authorization: `Bearer ${actor.id}` } }),
      );
      expect((await response.json()).code).toBe('DEVICE_REQUIRED');
    }
  } finally {
    db.tokens.set(owner.id, { id: owner.id, aal: 'aal2', sessionId: owner.deviceId });
  }
});
it('el acceso privado exige una sesión de Auth válida y no adopta la caja de otro usuario', async () => {
  try {
    db.tokens.set(owner.id, { id: owner.id, aal: 'aal2' });
    expect((await request('snapshot')).body.code).toBe('UNAUTHORIZED');
    db.tokens.set(owner.id, { id: owner.id, aal: 'aal2', sessionId: cashier.deviceId });
    expect((await request('snapshot')).status).toBe(403);
    expect((await db.devices()).find((d) => d.id === cashier.deviceId)?.userId).toBe(cashier.id);
  } finally {
    db.tokens.set(owner.id, { id: owner.id, aal: 'aal2', sessionId: owner.deviceId });
  }
});

it('los administradores no pueden otorgarse el acceso ni modificar al titular o sus dispositivos', async () => {
  for (const payload of [{ active: false }, { role: 'apoyo' }, { pin: '123456' }]) {
    expect((await request('users/update', { userId: owner.id, ...payload }, admin)).status).toBe(403);
  }
  expect((await request('devices/update', { deviceId: owner.deviceId, active: false }, admin)).status).toBe(
    403,
  );
  expect(
    (
      await request(
        'users',
        {
          name: 'Acceso falso',
          username: 'falso',
          role: 'superadmin',
        },
        admin,
      )
    ).status,
  ).not.toBe(200);
  expect(
    (
      await request(
        'users',
        {
          name: 'Correo reservado',
          username: 'reservado',
          role: 'admin',
          email: 'OWNER@test.invalid',
          password: 'contraseña-de-pruebas',
        },
        admin,
      )
    ).status,
  ).toBe(403);
  await request('users/update', { userId: admin.id, superAdmin: true }, admin);
  expect((await request('snapshot', undefined, admin)).body.actor.superAdmin).toBeUndefined();
  expect((await db.profile(owner.id))?.active).toBe(true);
});

it('el servidor bloquea las escrituras en consulta y rechaza vistas solicitadas por otros roles', async () => {
  const revision = await db.revision();
  const users = (await db.profiles()).length;
  for (const role of ['admin', 'encargado', 'apoyo']) {
    expect((await request('snapshot', undefined, owner, role)).status).toBe(200);
    expect((await request('commands', { commands: [cmd('save_goal', {}, owner)] }, owner, role)).status).toBe(
      403,
    );
    expect((await request('users', { role: 'admin' }, owner, role)).status).toBe(403);
    expect((await request('attachments/upload', {}, owner, role)).status).toBe(403);
    expect((await request('snapshot', undefined, admin, role)).status).toBe(403);
  }
  expect((await request('snapshot', undefined, owner, 'superadmin')).status).toBe(403);
  expect(await db.revision()).toBe(revision);
  expect(await db.profiles()).toHaveLength(users);
});

it('la reserva y su función no son accesibles con roles del navegador', async () => {
  const result = await db.db.query<{ readable: boolean; callable: boolean }>(`
    select has_table_privilege('authenticated', 'private.superadmin_access', 'SELECT') as readable,
    has_function_privilege('authenticated', 'public.dexter_superadmin(text,jsonb)', 'EXECUTE') as callable
  `);
  expect(result.rows[0]).toEqual({ readable: false, callable: false });
});

it('las vistas usan los permisos y la identidad del rol sin alterar la sesión del titular', async () => {
  const snapshot: Snapshot = {
    state: fixture(),
    actor: owner,
    profiles: [owner, admin, cashier, support],
    devices: [owner, admin, cashier, support].map((a) => ({
      id: a.deviceId,
      userId: a.id,
      name: a.name,
      primary: a.primary,
      active: true,
    })),
    revision: 0,
    serverAt: NOW,
  };
  snapshot.state.audit.push({
    id: 'audit',
    eventId: 'event',
    by: owner.id,
    deviceId: owner.deviceId,
    at: NOW,
    receivedAt: NOW,
    action: 'test',
    detail: 'Privado',
  });
  const cash = rolePreview(snapshot, 'encargado');
  expect(cash.actor.id).toBe(cashier.id);
  expect(cash.actor.deviceId).toBe(cashier.deviceId);
  expect(cash.actor.primary).toBe(true);
  expect(cash.state.audit).toEqual([]);
  expect(cash.profiles.some((p) => p.id === owner.id)).toBe(false);
  expect(rolePreview(snapshot, 'apoyo').actor.primary).toBe(false);
  expect(rolePreview(snapshot, 'admin').state.audit).toHaveLength(1);
  expect(rolePreview(snapshot, 'admin').actor).toMatchObject({
    id: owner.id,
    deviceId: owner.deviceId,
    role: 'admin',
    superAdmin: false,
  });
  expect(isReadOnlyView('admin')).toBe(false);
  expect(isReadOnlyView('encargado')).toBe(true);
  expect(isReadOnlyView('apoyo')).toBe(true);
  expect(snapshot.actor.superAdmin).toBe(true);
  expect(snapshot.state.audit).toHaveLength(1);
  expect(() => rolePreview({ ...snapshot, actor: admin }, 'encargado')).toThrow(/exclusivo/);
});

it.each([admin, owner])(
  '$name guarda el catálogo y la configuración siendo el único admin activo',
  async (actor) => {
    const profiles = await db.profiles();
    try {
      for (const profile of profiles.filter((p) => p.role === 'admin' && p.id !== actor.id))
        await db.saveProfile({ ...profile, active: false });
      expect((await db.profiles()).filter((p) => p.active && p.role === 'admin')).toHaveLength(1);
      const before = (await db.load()).state;
      const commands: [CommandType, Record<string, unknown>][] = [
        ['save_flavor', { name: `Sabor de ${actor.name}`, alcohol: false, active: true }],
        ['save_size', { ...before.sizes[0], alcoholPrice: 13000, plainPrice: 9000, active: true }],
        ['configure', { courtesyQuota: 7, cashLimit: 120000 }],
        [
          'save_promotion',
          {
            name: `Promoción de ${actor.name}`,
            effect: 'fixed',
            delivery: 'schedule',
            fixedPrice: 8000,
            startsAt: '2026-10-01T00:00:00Z',
            endsAt: '2026-11-01T00:00:00Z',
          },
        ],
        [
          'save_goal',
          {
            period: 'week',
            startsAt: '2026-10-25T00:00:00Z',
            endsAt: '2026-11-01T00:00:00Z',
            cups: 100,
            amount: 1000000,
          },
        ],
      ];
      const events: string[] = [];
      for (const [type, payload] of commands) {
        const state = (await db.load()).state;
        const command = cmd(type, payload, actor, { configVersion: state.settings[0].version });
        const response = await request('commands', { commands: [command] }, actor);
        expect(response.status).toBe(200);
        expect(response.body.results[0]).toMatchObject({ id: command.id, status: 'accepted' });
        events.push(command.id);
      }
      const state = (await db.load()).state;
      expect(state.flavors).toContainEqual(
        expect.objectContaining({ name: `Sabor de ${actor.name}`, active: true }),
      );
      expect(state.sizes.find((s) => s.id === before.sizes[0].id)).toMatchObject({
        alcoholPrice: 13000,
        plainPrice: 9000,
        active: true,
      });
      expect(state.settings[0]).toMatchObject({ courtesyQuota: 7, cashLimit: 120000 });
      expect(state.promotions.find((p) => p.name === `Promoción de ${actor.name}`)).toMatchObject({
        by: actor.id,
      });
      expect(state.goals.find((g) => !before.goals.some((previous) => previous.id === g.id))).toMatchObject({
        cups: 100,
        amount: 1000000,
        by: actor.id,
      });
      expect(state.requests).toEqual(before.requests);
      expect(state.audit.filter((a) => events.includes(a.eventId))).toHaveLength(commands.length);
      expect(state.audit.filter((a) => events.includes(a.eventId)).every((a) => a.by === actor.id)).toBe(
        true,
      );
      const versions = state.parameters.filter(
        (p) => !before.parameters.some((previous) => previous.id === p.id),
      );
      expect(versions).toHaveLength(4);
      expect(versions.every((p) => p.by === actor.id)).toBe(true);
    } finally {
      for (const profile of profiles) await db.saveProfile(profile);
    }
  },
);

describe('activación privada de un solo uso', () => {
  const token = 'b'.repeat(64),
    email = 'titular@test.invalid';
  it('el rol de servicio reclama el acceso sin leer auth.users', async () => {
    const email = 'servicio@test.invalid';
    const userId = await db.createAuthUser(email, 'contraseña-larga-de-prueba');
    await db.db.exec('delete from private.superadmin_access');
    await db.db.query(
      "insert into private.superadmin_access(email,setup_hash,expires_at) values($1,$2,now()+interval '1 day')",
      [email, await sha256(token)],
    );
    await db.db.exec('set role service_role');
    try {
      expect(
        (await db.superAdmin('claim', { email, userId, hash: await sha256(token), name: 'Titular' }))?.ok,
      ).toBe(true);
    } finally {
      await db.db.exec('reset role');
    }
  });
  it('rechaza correos y tokens ajenos, activa una sola identidad y exige MFA después', async () => {
    await db.db.exec('delete from private.superadmin_access');
    await db.db.query(
      "insert into private.superadmin_access(email,setup_hash,expires_at) values($1,$2,now()+interval '1 day')",
      [email, await sha256(token)],
    );
    const data = { token, email, name: 'Titular', password: 'contraseña-larga-de-prueba' };
    expect((await request('superadmin/setup', { ...data, email: 'ajeno@test.invalid' })).status).toBe(403);
    expect((await request('superadmin/setup', { ...data, token: 'a'.repeat(64) })).status).toBe(403);
    const claimed = await request('superadmin/setup', data);
    expect(claimed.status).toBe(200);
    const access = (
      await db.db.query<{ user_id: string; setup_hash: string | null; expires_at: string | null }>(
        'select user_id,setup_hash,expires_at from private.superadmin_access',
      )
    ).rows[0];
    expect(access.setup_hash).toBeNull();
    expect(access.expires_at).toBeNull();
    expect((await request('superadmin/setup', data)).status).toBe(403);
    db.tokens.set(access.user_id, { id: access.user_id, aal: 'aal1' });
    expect((await request('snapshot', undefined, { ...owner, id: access.user_id })).body.code).toBe(
      'MFA_REQUIRED',
    );
    expect((await db.db.query('select id from auth.users where email=$1', [email])).rows).toHaveLength(1);
  });
  it('rechaza activaciones vencidas y resuelve carreras sin dejar usuarios huérfanos', async () => {
    await db.db.exec('delete from private.rate_limits');
    await db.db.exec('delete from private.superadmin_access');
    await db.db.query(
      "insert into private.superadmin_access(email,setup_hash,expires_at) values($1,$2,now()-interval '1 second')",
      ['carrera@test.invalid', await sha256(token)],
    );
    const data = {
      token,
      email: 'carrera@test.invalid',
      name: 'Titular',
      password: 'contraseña-larga-de-prueba',
    };
    expect((await request('superadmin/setup', data)).status).toBe(403);
    await db.db.exec("update private.superadmin_access set expires_at=now()+interval '1 day'");
    const results = await Promise.all([request('superadmin/setup', data), request('superadmin/setup', data)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await db.db.query('select id from auth.users where email=$1', [data.email])).rows).toHaveLength(
      1,
    );
  });
});

it('el cliente bloquea también las llamadas directas de escritura durante la consulta', async () => {
  const { api, setPreviewRole } = await import('../src/lib/api.ts');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  setPreviewRole('admin');
  try {
    await expect(api('users', {})).rejects.toThrow(/vista es de consulta/);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    setPreviewRole(null);
    vi.unstubAllGlobals();
  }
});
