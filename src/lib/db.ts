import Dexie, { type EntityTable } from 'dexie';
import type { Command, Result, Snapshot } from '../domain/types.ts';
export interface OutboxEntry {
  id: string;
  branchId?: string;
  actorId: string;
  sequence: number;
  command: Command;
  optimistic: boolean;
  status: 'pending' | 'acknowledged' | 'conflict' | 'reconciled';
  result?: Result;
  message?: string;
}
export interface LocalPhoto {
  id: string;
  branchId?: string;
  actorId: string;
  bytes?: ArrayBuffer;
  mime?: string;
  blob?: Blob;
  status: 'pending' | 'uploaded';
  error?: string;
}
export interface Meta {
  key: string;
  value: unknown;
}
export class DexterDB extends Dexie {
  meta!: EntityTable<Meta, 'key'>;
  outbox!: EntityTable<OutboxEntry, 'id'>;
  photos!: EntityTable<LocalPhoto, 'id'>;
  constructor(name = 'dexter-v1') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      outbox: 'id, actorId, sequence, status, [actorId+status]',
      photos: 'id, actorId, status',
    });
    this.version(2).stores({
      meta: 'key',
      outbox: 'id, actorId, branchId, sequence, status, [actorId+status], [branchId+actorId]',
      photos: 'id, actorId, branchId, status, [branchId+actorId]',
    });
  }
}
export const db = new DexterDB();
export function photoBlob(photo: LocalPhoto): Blob {
  if (photo.bytes) return new Blob([photo.bytes], { type: photo.mime ?? 'image/jpeg' });
  if (photo.blob) return photo.blob;
  throw new Error('No se pudo recuperar la fotografía local.');
}
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}
export async function migrateBranchCache(legacyBranchId: string, database = db) {
  await database.transaction('rw', database.meta, database.outbox, database.photos, async () => {
    if ((await database.meta.get('branch-cache-migrated'))?.value) return;
    await database.outbox.toCollection().modify((entry) => {
      entry.branchId ??= legacyBranchId;
    });
    await database.photos.toCollection().modify((photo) => {
      photo.branchId ??= legacyBranchId;
    });
    const pin = (await database.meta.get('local-pin'))?.value as
      { userId: string; branchId?: string } | undefined;
    if (pin?.userId) {
      const bound = { ...pin, branchId: pin.branchId ?? legacyBranchId };
      await database.meta.put({ key: `local-pin:${bound.branchId}:${pin.userId}`, value: bound });
      await database.meta.put({ key: 'local-pin', value: bound });
    }
    const snapshot = (await database.meta.get('snapshot'))?.value as Snapshot | undefined;
    if (snapshot?.actor) {
      const bound = {
        ...snapshot,
        access: undefined,
        actor: {
          ...snapshot.actor,
          branchId: snapshot.actor.branchId ?? legacyBranchId,
          superAdmin: undefined,
        },
      };
      await database.meta.put({ key: `snapshot:${bound.actor.branchId}:${bound.actor.id}`, value: bound });
      await database.meta.put({ key: 'snapshot', value: bound });
    }
    for (const key of ['active-outage', 'active-order']) {
      const previous = await database.meta.get(key);
      if (previous) await database.meta.put({ key: `${key}:${legacyBranchId}`, value: previous.value });
    }
    await database.meta.put({ key: 'branch-cache-migrated', value: true });
  });
}
export interface DeviceCredential {
  id: string;
  token: string;
  branchId?: string;
  userId?: string;
}
export interface OfflineAuthorizer {
  id: string;
  branchId?: string;
  adminId: string;
  name: string;
  expiresAt: string;
  salt: string;
  iv: string;
  encrypted: string;
}
export type CachedSnapshot = Snapshot;
export function belongsToBranch(entry: { actorId: string; branchId?: string }, snapshot: Snapshot | null) {
  return (
    !!snapshot &&
    entry.actorId === snapshot.actor.id &&
    (entry.branchId ?? snapshot.access?.legacyBranchId) === snapshot.actor.branchId
  );
}
