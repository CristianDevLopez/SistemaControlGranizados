import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { PgBackend } from './support/backend.ts';
import { admin, NOW } from './support/fixture.ts';
let root: PgBackend, store: PgBackend, branch: string;
beforeAll(async () => {
  root = await PgBackend.create();
  branch = (await root.platform(admin.id, 'access')).legacyBranchId;
  store = root.forBranch(branch);
}, 60000);
afterAll(async () => {
  await root?.db.close();
});
beforeEach(async () => {
  await root.db.exec('delete from public.notifications;delete from private.notification_dispatch;');
});
async function seed() {
  const id = crypto.randomUUID();
  await root.db.query('insert into public.notifications(id,branch_id,data)values($1,$2,$3)', [
    id,
    branch,
    { id, at: NOW, text: 'Prueba', channel: 'mermas', type: 'cierre', status: 'pending', attempts: 0 },
  ]);
  return id;
}
it('se detiene al quinto fallo y el reintento manual abre un ciclo nuevo', async () => {
  const id = await seed();
  for (let n = 1; n <= 5; n++) {
    const notices = await store.security('notifications_claim');
    expect(notices).toHaveLength(1);
    expect(notices[0].attempts).toBe(n);
    await store.security('notification_finish', { id, ok: false, error: 'Fallo temporal' });
    const rows = await root.db.query<any>(
      'select status,lease_until>now() as waits from private.notification_dispatch where id=$1',
      [id],
    );
    expect(rows.rows[0]).toMatchObject({ status: n === 5 ? 'failed' : 'pending', waits: true });
    await root.db.query(
      "update private.notification_dispatch set lease_until=now()-interval '1 second' where id=$1",
      [id],
    );
  }
  expect(await store.security('notifications_claim')).toEqual([]);
  await store.security('notification_retry', { id });
  expect((await store.security('notifications_claim'))[0]).toMatchObject({ id, attempts: 1 });
});
it('conserva message_id y bloquea dos despachadores concurrentes', async () => {
  const id = await seed();
  const [a, b] = await Promise.all([
    store.security('notifications_claim'),
    store.security('notifications_claim'),
  ]);
  expect(a.length + b.length).toBe(1);
  await store.security('notification_finish', { id, ok: true, messageId: 12345, chatId: '-123' });
  expect((await store.security('notification_status'))[0]).toMatchObject({
    id,
    status: 'sent',
    messageId: 12345,
    chatId: '-123',
  });
  expect(await store.security('notifications_claim')).toEqual([]);
});
it('la preparación periódica deduplica el resumen y deja las pérdidas en historial', async () => {
  const id = crypto.randomUUID(),
    notice = { id, key: 'resumen:2026-11-28', type: 'resumen', at: NOW, text: 'Resumen' };
  await store.security('telegram_prepare', { notices: [notice] });
  await store.security('telegram_prepare', { notices: [{ ...notice, id: crypto.randomUUID() }] });
  expect((await root.db.query<any>('select count(*)::int as n from public.notifications')).rows[0].n).toBe(1);
});
it('la resolución conserva el mensaje y su respuesta para evitar reenviarlos', async () => {
  const id = await seed();
  await store.security('notifications_claim');
  await store.security('notification_finish', { id, ok: true, messageId: 7, chatId: '-123' });
  await root.db.query('update public.notifications set data=data||$2 where id=$1', [
    id,
    { resolved: { by: 'Admin', at: NOW } },
  ]);
  expect((await store.security('telegram_resolutions'))[0]).toMatchObject({
    id,
    messageId: 7,
    chatId: '-123',
  });
  await store.security('telegram_resolution_finish', { id, ok: true, replyId: 8 });
  expect(await store.security('telegram_resolutions')).toEqual([]);
});

it('cada nueva resolución tiene cinco intentos como máximo', async () => {
  const id = await seed();
  await store.security('notifications_claim');
  await store.security('notification_finish', { id, ok: true, messageId: 9, chatId: '-123' });
  for (const eventId of ['version-1', 'version-2']) {
    await root.db.query('update public.notifications set data=data||$2 where id=$1', [
      id,
      { resolved: { by: 'Admin', at: NOW, eventId } },
    ]);
    for (let n = 1; n <= 5; n++) {
      expect(await store.security('telegram_resolutions')).toHaveLength(1);
      await store.security('telegram_resolution_finish', { id, ok: false, error: 'Temporal' });
      await root.db.query('update private.notification_dispatch set lease_until=null where id=$1', [id]);
    }
    expect(await store.security('telegram_resolutions')).toEqual([]);
  }
});
