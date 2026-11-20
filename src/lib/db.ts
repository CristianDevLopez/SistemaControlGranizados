import Dexie, { type EntityTable } from 'dexie';
import type { Command, Result, Snapshot } from '../domain/types.ts';
import { employeeView } from '../domain/employee-view.ts';
export interface OutboxEntry {
  id: string;
  branchId?: string;
  actorId: string;
  sequence: number;
  command: Command;
  optimistic: boolean;
  status: 'pending' | 'acknowledged' | 'conflict' | 'reconciled' | 'rejected';
  result?: Result;
  message?: string;
}
export function awaitsSync(entry: OutboxEntry) {
  return entry.status === 'pending' || entry.status === 'conflict';
}
// Respuestas inequívocas del gateway anterior: el cupón no llegó a guardarse.
const legacyCouponRejections = new Set([
  'La cuota se agotó. Otro admin debe aprobar una cortesía adicional.',
  'Esta autorización ya se utilizó.',
  'Vencimiento inválido.',
  'Fecha de vencimiento inválida.',
]);
export function isFinalRejection(entry: OutboxEntry, result = entry.result) {
  if (entry.optimistic !== false || result?.status !== 'conflict' || result.id !== entry.id) return false;
  if (result.finalRejection === true) return true;
  return (
    entry.command.type === 'issue_coupon' &&
    result.code === 'VALIDATION' &&
    legacyCouponRejections.has(result.message)
  );
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
export function offlineSnapshot(value: Snapshot): Snapshot {
  const state = employeeView(value.state, value.actor);
  const sellers = new Set(state.orders.map((order) => order.sellerId));
  return {
    ...value,
    actor: { ...value.actor, superAdmin: undefined },
    access: undefined,
    branch: value.branch && { ...value.branch, monthlyFee: null, billingStart: null },
    profiles: value.profiles
      .filter((profile) => profile.id === value.actor.id || sellers.has(profile.id))
      .map(({ id, name, role, active }) => ({ id, name, role, active })),
    devices: value.devices.filter((device) => device.userId === value.actor.id),
    state,
  };
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
    this.on('ready', () =>
      this.transaction('rw', this.meta, async () => {
        if (await this.meta.get('employee-cache-scoped')) return;
        await this.meta.toCollection().modify((row) => {
          if (row.key !== 'snapshot' && !row.key.startsWith('snapshot:')) return;
          const value = row.value as Snapshot | undefined;
          if (value?.state && value.actor) row.value = offlineSnapshot(value);
        });
        await this.meta.put({ key: 'employee-cache-scoped', value: true });
      }),
    );
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
