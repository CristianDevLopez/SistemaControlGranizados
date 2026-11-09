import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import type { Session } from '@supabase/supabase-js';
import type { AuthIdentity, Backend, DeviceSecret } from '../../src/server/backend.ts';
import { COLLECTIONS, type Command, type Profile, type Result, type State } from '../../src/domain/types.ts';
import { sha256, pinHash } from '../../src/server/crypto.ts';
import { admin, other, cashier, support, owner, ids, fixture } from './fixture.ts';
export class PgBackend implements Backend {
  files = new Map<string, Blob>();
  tokens = new Map<string, AuthIdentity>();
  constructor(
    public db: PGlite,
    public readonly branchId?: string,
  ) {}
  forBranch(branchId: string): PgBackend {
    const scoped = new PgBackend(this.db, branchId);
    scoped.files = this.files;
    scoped.tokens = this.tokens;
    return scoped;
  }
  async platform(actorId: string, action: string, payload: Record<string, unknown> = {}) {
    return (
      await this.db.query<any>('select public.dexter_platform($1,$2,$3) as value', [actorId, action, payload])
    ).rows[0].value;
  }
  static async create() {
    const db = new PGlite();
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text);create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);grant usage on schema public to service_role;`,
    );
    const migrations = new URL('../../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(migrations)).filter((f) => f.endsWith('.sql')).sort())
      await db.exec(await readFile(new URL(file, migrations), 'utf8'));
    const b = new PgBackend(db);
    for (const a of [
      admin,
      other,
      { ...admin, id: ids.third, name: 'Tercer administrador' },
      cashier,
      support,
      owner,
    ]) {
      await db.query('insert into auth.users(id,email)values($1,$2)', [a.id, `${a.id}@test.invalid`]);
      await b.saveProfile({
        id: a.id,
        name: a.name,
        username: a.role === 'admin' ? undefined : a.username,
        role: a.role,
        active: true,
      });
      b.tokens.set(a.id, {
        id: a.id,
        aal: a.aal,
        ...(a.id === owner.id ? { sessionId: owner.deviceId } : {}),
      });
    }
    await db.query(
      'insert into private.superadmin_access(email, user_id, claimed_at) values($1, $2, now())',
      ['owner@test.invalid', owner.id],
    );
    await db.query('update private.businesses set owner_id=$1', [admin.id]);
    await db.exec(
      'insert into private.branch_members(branch_id,user_id,role,active) select private.legacy_branch(),id,role,active from public.profiles where id not in(select user_id from private.superadmin_access)',
    );
    for (const d of [
      { id: ids.device, userId: cashier.id, primary: true },
      { id: ids.remote, userId: admin.id, primary: false },
      { id: ids.supportDevice, userId: support.id, primary: false },
    ])
      await b.saveDevice({
        ...d,
        name: 'Dispositivo de prueba',
        active: true,
        tokenHash: await sha256('test-device-token'),
      });
    const state = fixture();
    for (const key of COLLECTIONS) {
      for (const item of state[key])
        await db.query(
          `insert into public.${key}(id,data)values($1,$2)on conflict(id)do update set data=excluded.data`,
          [item.id, item],
        );
    }
    await b.security('staff_set', {
      userId: cashier.id,
      salt: 'test-salt',
      hash: await pinHash('123456', 'test-salt'),
    });
    return b;
  }
  async verifyUser(t: string) {
    return this.tokens.get(t) ?? null;
  }
  async profile(id: string) {
    return (await this.profiles()).find((p) => p.id === id) ?? null;
  }
  async profiles() {
    if (this.branchId)
      return (await this.db.query<any>('select public.dexter_branch_profiles($1) as value', [this.branchId]))
        .rows[0].value as Profile[];
    const r = await this.db.query<any>('select id,name,username,role,active from public.profiles');
    return r.rows as Profile[];
  }
  async saveProfile(p: Profile) {
    if (this.branchId) {
      await this.db.query('select public.dexter_branch_profile_save($1,$2)', [this.branchId, p]);
      return;
    }
    await this.db.query(
      'insert into public.profiles(id,name,username,role,active)values($1,$2,$3,$4,$5)on conflict(id)do update set name=excluded.name,username=excluded.username,role=excluded.role,active=excluded.active',
      [p.id, p.name, p.username ?? null, p.role, p.active],
    );
  }
  async devices() {
    return (
      await this.db.query<DeviceSecret>(
        'select id,branch_id as "branchId",user_id as "userId",name,active,is_primary as primary,token_hash as "tokenHash" from public.devices where $1::uuid is null or branch_id=$1',
        [this.branchId ?? null],
      )
    ).rows;
  }
  async saveDevice(d: DeviceSecret) {
    await this.db.query(
      'insert into public.devices(id,user_id,name,active,is_primary,token_hash,branch_id)values($1,$2,$3,$4,$5,$6,coalesce($7,private.legacy_branch()))on conflict(id)do update set active=excluded.active,is_primary=excluded.is_primary',
      [d.id, d.userId, d.name, d.active, d.primary, d.tokenHash, this.branchId ?? null],
    );
  }
  async setPrimary(id: string) {
    await this.security('device_primary', { id });
  }
  async load() {
    const raw = (
      await this.db.query<{ value: { state: State; revision: number } }>(
        'select public.dexter_branch_read_state(coalesce($1,private.legacy_branch()))as value',
        [this.branchId ?? null],
      )
    ).rows[0].value;
    const uploads = await this.security('media_list');
    raw.state.attachments = raw.state.attachments.map((a) => ({
      ...a,
      ...uploads.find((u: any) => u.id === a.id),
    }));
    return raw;
  }
  async revision() {
    return (await this.security('revision')).revision as number;
  }
  async receipt(id: string) {
    const r = await this.db.query<any>(
      'select actor_id as "actorId",result from public.command_receipts where id=$1 and branch_id=coalesce($2,private.legacy_branch())',
      [id, this.branchId ?? null],
    );
    return r.rows[0] ?? null;
  }
  async commit(revision: number, command: Command, state: State, result: Result) {
    return (
      await this.db.query<{ value: Result }>(
        'select public.dexter_branch_commit(coalesce($5,private.legacy_branch()),$1,$2,$3,$4)as value',
        [revision, command, state, result, this.branchId ?? null],
      )
    ).rows[0].value;
  }
  async security(action: string, payload: Record<string, unknown> = {}) {
    if (action === 'sync_conflict') {
      await this.db.query(
        'select public.dexter_branch_conflict(coalesce($3,private.legacy_branch()),$1,$2)',
        [payload.command, payload.message, this.branchId ?? null],
      );
      return null;
    }
    return (
      await this.db.query<any>(
        'select public.dexter_branch_security(coalesce($3,private.legacy_branch()),$1,$2)as value',
        [action, payload, this.branchId ?? null],
      )
    ).rows[0].value;
  }
  async superAdmin(action: string, payload: Record<string, unknown> = {}) {
    return (await this.db.query<any>('select public.dexter_superadmin($1,$2) as value', [action, payload]))
      .rows[0].value;
  }
  async rate(key: string, limit = 5, seconds = 300) {
    return (
      await this.db.query<any>('select public.dexter_rate_limit($1,$2,$3)as value', [key, limit, seconds])
    ).rows[0].value;
  }
  async createAuthUser(email: string, _password: string) {
    const id = crypto.randomUUID();
    await this.db.query('insert into auth.users(id,email)values($1,$2)', [id, email]);
    return id;
  }
  async deleteAuthUser(id: string) {
    await this.db.query('delete from auth.users where id=$1', [id]);
  }
  async pinSession(id: string) {
    this.tokens.set(id, { id, aal: 'aal1' });
    return {
      access_token: id,
      refresh_token: 'test-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      user: { id },
    } as Session;
  }
  async signedUpload(path: string) {
    return { path, token: 'test-upload', signedUrl: `http://127.0.0.1:5180/test-upload/${path}` };
  }
  async download(path: string) {
    const found = this.files.get(path);
    if (!found) throw new Error('Archivo no encontrado');
    return found;
  }
  async signedDownload(path: string) {
    return `http://127.0.0.1:5180/test-files/${encodeURIComponent(path)}`;
  }
  async finalizePhoto(from: string, to: string) {
    if (this.files.has(to)) throw new Error('La fotografía definitiva ya existe');
    this.files.set(to, await this.download(from));
    this.files.delete(from);
  }
  async securityAudit(actorId: string, deviceId: string, action: string, detail: string) {
    await this.db.query(
      'select public.dexter_branch_audit(coalesce($5,private.legacy_branch()),$1,$2,$3,$4)',
      [actorId, deviceId, action, detail, this.branchId ?? null],
    );
  }
}
