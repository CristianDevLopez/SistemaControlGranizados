import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import {
  DexterDB,
  migrateBranchCache,
  retryLegacyDatabaseConflicts,
  type OutboxEntry,
} from '../src/lib/db.ts';
import { admin, cmd, fixture } from './support/fixture.ts';
it('actualiza IndexedDB v1 conservando comandos originales, fotos y PIN; el paso se ejecuta una sola vez', async () => {
  const name = `branch-cache-${crypto.randomUUID()}`;
  const legacy = crypto.randomUUID();
  const old = new Dexie(name);
  old.version(1).stores({
    meta: 'key',
    outbox: 'id, actorId, sequence, status, [actorId+status]',
    photos: 'id, actorId, status',
  });
  const command = cmd('save_flavor', { name: 'Pendiente', alcohol: false }, admin);
  const pin = { userId: admin.id, salt: 'original-salt', hash: 'original-hash' };
  await old
    .table('outbox')
    .add({ id: command.id, actorId: admin.id, sequence: 1, command, optimistic: false, status: 'pending' });
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const photoId = crypto.randomUUID();
  await old
    .table('photos')
    .add({ id: photoId, actorId: admin.id, bytes, mime: 'image/jpeg', status: 'pending' });
  await old.table('meta').bulkPut([
    {
      key: 'snapshot',
      value: {
        state: fixture(),
        actor: admin,
        revision: 12,
        profiles: [],
        devices: [],
        serverAt: '2026-10-28T00:00:00Z',
      },
    },
    { key: 'local-pin', value: pin },
    { key: 'active-outage', value: 'original-outage' },
  ]);
  old.close();
  const upgraded = new DexterDB(name);
  try {
    await migrateBranchCache(legacy, upgraded);
    expect((await upgraded.outbox.get(command.id))?.command).toEqual(command);
    expect((await upgraded.outbox.get(command.id))?.branchId).toBe(legacy);
    expect((await upgraded.photos.get(photoId))?.bytes).toEqual(bytes);
    expect((await upgraded.photos.get(photoId))?.branchId).toBe(legacy);
    expect((await upgraded.meta.get(`local-pin:${legacy}:${admin.id}`))?.value).toEqual({
      ...pin,
      branchId: legacy,
    });
    expect(((await upgraded.meta.get(`snapshot:${legacy}:${admin.id}`))?.value as any).actor.branchId).toBe(
      legacy,
    );
    expect((await upgraded.meta.get(`active-outage:${legacy}`))?.value).toBe('original-outage');
    const another = crypto.randomUUID();
    await migrateBranchCache(another, upgraded);
    expect((await upgraded.outbox.get(command.id))?.branchId).toBe(legacy);
  } finally {
    await upgraded.delete();
  }
});

it('reintenta el timeout previo con el mismo comando y preserva las revisiones registradas', async () => {
  const database = new DexterDB(`sync-recovery-${crypto.randomUUID()}`);
  const orderId = crypto.randomUUID();
  const timeout = cmd('update_order', { orderId }, admin, { sequence: 11 });
  const followUp = cmd('pay', { orderId }, admin, { sequence: 12 });
  const reviewed = cmd('create_order', {}, admin, { sequence: 13 });
  const businessConflict = cmd('update_order', { orderId: crypto.randomUUID() }, admin, { sequence: 14 });
  const entries: OutboxEntry[] = [timeout, followUp, reviewed, businessConflict].map((command) => ({
    id: command.id,
    sequence: command.sequence,
    command,
    actorId: admin.id,
    optimistic: true,
    status: 'conflict',
    result: {
      id: command.id,
      status: 'conflict',
      message: 'Error de sincronización',
      code: command === businessConflict ? 'ORDER_VERSION_CONFLICT' : '57014',
    },
  }));
  entries[1] = { ...entries[1], status: 'pending', result: undefined, dependsOnConflict: timeout.id };
  const state = fixture();
  state.pendingSyncReviewIds = [reviewed.id];
  try {
    await database.outbox.bulkAdd(entries);
    const recovered = await retryLegacyDatabaseConflicts(entries, state, database);
    expect(recovered.map((entry) => entry.status)).toEqual(['pending', 'pending', 'conflict', 'conflict']);
    expect(await database.outbox.get(timeout.id)).toMatchObject({ command: timeout, status: 'pending' });
    expect((await database.outbox.get(followUp.id))?.dependsOnConflict).toBeUndefined();
  } finally {
    await database.delete();
  }
});
