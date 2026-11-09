import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Command, Device, Profile, Result, State } from '../domain/types.ts';
export interface DeviceSecret extends Device {
  tokenHash: string;
}
export interface AuthIdentity {
  id: string;
  aal: 'aal1' | 'aal2';
  sessionId?: string;
}
export interface Backend {
  readonly branchId?: string;
  forBranch(branchId: string): Backend;
  platform(actorId: string, action: string, payload?: Record<string, unknown>): Promise<any>;
  verifyUser(token: string): Promise<AuthIdentity | null>;
  profile(id: string): Promise<Profile | null>;
  profiles(): Promise<Profile[]>;
  saveProfile(profile: Profile): Promise<void>;
  devices(): Promise<DeviceSecret[]>;
  saveDevice(device: DeviceSecret): Promise<void>;
  setPrimary(id: string): Promise<void>;
  load(): Promise<{ state: State; revision: number }>;
  revision(): Promise<number>;
  receipt(id: string): Promise<{ actorId: string; result: Result } | null>;
  commit(revision: number, command: Command, state: State, result: Result): Promise<Result>;
  security(action: string, payload?: Record<string, unknown>): Promise<any>;
  superAdmin(action: string, payload?: Record<string, unknown>): Promise<any>;
  rate(key: string, limit?: number, seconds?: number): Promise<boolean>;
  createAuthUser(email: string, password: string): Promise<string>;
  deleteAuthUser(id: string): Promise<void>;
  pinSession(id: string): Promise<Session>;
  signedUpload(path: string): Promise<{ path: string; token: string; signedUrl: string }>;
  download(path: string): Promise<Blob>;
  signedDownload(path: string): Promise<string>;
  finalizePhoto(from: string, to: string): Promise<void>;
  securityAudit(actorId: string, deviceId: string, action: string, detail: string): Promise<void>;
}
function checked<T>(result: { data: T; error: any }): NonNullable<T> {
  if (result.error) throw result.error;
  return result.data as NonNullable<T>;
}
export class SupabaseBackend implements Backend {
  constructor(
    public client: SupabaseClient,
    private authClient: () => SupabaseClient,
    public readonly branchId?: string,
  ) {}
  forBranch(branchId: string): Backend {
    return new SupabaseBackend(this.client, this.authClient, branchId);
  }
  async platform(actorId: string, action: string, payload: Record<string, unknown> = {}) {
    return checked(
      await this.client.rpc('dexter_platform', { p_actor: actorId, p_action: action, p_payload: payload }),
    );
  }
  async verifyUser(token: string) {
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) return null;
    try {
      const claims = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
      return {
        id: data.user.id,
        aal: claims.aal === 'aal2' ? 'aal2' : 'aal1',
        sessionId: typeof claims.session_id === 'string' ? claims.session_id : undefined,
      } as const;
    } catch {
      return null;
    }
  }
  async profile(id: string) {
    if (this.branchId) return (await this.profiles()).find((p: Profile) => p.id === id) ?? null;
    const data = checked(await this.client.from('profiles').select('*').eq('id', id).maybeSingle());
    return data ? this.toProfile(data) : null;
  }
  private toProfile(p: any): Profile {
    return { id: p.id, name: p.name, username: p.username, role: p.role, active: p.active };
  }
  async profiles() {
    if (this.branchId)
      return checked(
        await this.client.rpc('dexter_branch_profiles', { p_branch: this.branchId }),
      ) as Profile[];
    return checked(await this.client.from('profiles').select('*').order('created_at')).map((p: any) =>
      this.toProfile(p),
    );
  }
  async saveProfile(p: Profile) {
    if (this.branchId) {
      checked(await this.client.rpc('dexter_branch_profile_save', { p_branch: this.branchId, p_profile: p }));
      return;
    }
    checked(
      await this.client
        .from('profiles')
        .upsert({ id: p.id, name: p.name, username: p.username ?? null, role: p.role, active: p.active }),
    );
  }
  async devices() {
    let query = this.client.from('devices').select('*');
    if (this.branchId) query = query.eq('branch_id', this.branchId);
    return checked(await query).map((d: any) => ({
      id: d.id,
      userId: d.user_id,
      name: d.name,
      active: d.active,
      primary: d.is_primary,
      tokenHash: d.token_hash,
      lastSeen: d.last_seen,
      branchId: d.branch_id,
    }));
  }
  async saveDevice(d: DeviceSecret) {
    checked(
      await this.client.from('devices').upsert({
        id: d.id,
        user_id: d.userId,
        name: d.name,
        active: d.active,
        is_primary: d.primary,
        token_hash: d.tokenHash,
        last_seen: new Date().toISOString(),
        ...(this.branchId ? { branch_id: this.branchId } : {}),
      }),
    );
  }
  async setPrimary(id: string) {
    await this.security('device_primary', { id });
  }
  async load() {
    const raw = checked(
      await this.client.rpc(
        this.branchId ? 'dexter_branch_read_state' : 'dexter_read_state',
        this.branchId ? { p_branch: this.branchId } : {},
      ),
    );
    const uploads = await this.security('media_list');
    raw.state.attachments = raw.state.attachments.map((a: any) => ({
      ...a,
      ...uploads.find((u: any) => u.id === a.id),
    }));
    const dispatch = await this.security('notification_status');
    raw.state.notifications = raw.state.notifications.map((n: any) => ({
      ...n,
      ...dispatch.find((d: any) => d.id === n.id),
    }));
    return raw as { state: State; revision: number };
  }
  async revision() {
    return (await this.security('revision')).revision as number;
  }
  async receipt(id: string) {
    let query = this.client.from('command_receipts').select('actor_id,result').eq('id', id);
    if (this.branchId) query = query.eq('branch_id', this.branchId);
    const row = checked(await query.maybeSingle());
    return row ? { actorId: row.actor_id, result: row.result as Result } : null;
  }
  async commit(revision: number, command: Command, state: State, result: Result) {
    return checked(
      await this.client.rpc(this.branchId ? 'dexter_branch_commit' : 'dexter_commit', {
        ...(this.branchId ? { p_branch: this.branchId } : {}),
        p_revision: revision,
        p_command: command,
        p_state: state,
        p_result: result,
      }),
    ) as Result;
  }
  async security(action: string, payload: Record<string, unknown> = {}) {
    if (action === 'sync_conflict')
      return checked(
        await this.client.rpc(this.branchId ? 'dexter_branch_conflict' : 'dexter_record_conflict', {
          ...(this.branchId ? { p_branch: this.branchId } : {}),
          p_command: payload.command,
          p_message: payload.message,
        }),
      );
    return checked(
      await this.client.rpc(this.branchId ? 'dexter_branch_security' : 'dexter_security', {
        ...(this.branchId ? { p_branch: this.branchId } : {}),
        p_action: action,
        p_payload: payload,
      }),
    );
  }
  async superAdmin(action: string, payload: Record<string, unknown> = {}) {
    return checked(await this.client.rpc('dexter_superadmin', { p_action: action, p_payload: payload }));
  }
  async rate(key: string, limit = 5, seconds = 300) {
    return checked(
      await this.client.rpc('dexter_rate_limit', { p_key: key, p_limit: limit, p_seconds: seconds }),
    ) as boolean;
  }
  async createAuthUser(email: string, password: string) {
    const { data, error } = await this.client.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    return data.user.id;
  }
  async deleteAuthUser(id: string) {
    const { error } = await this.client.auth.admin.deleteUser(id);
    if (error) throw error;
  }
  async pinSession(id: string) {
    const found = await this.client.auth.admin.getUserById(id);
    if (found.error || !found.data.user?.email) throw found.error ?? new Error('Usuario no disponible.');
    const link = await this.client.auth.admin.generateLink({
      type: 'magiclink',
      email: found.data.user.email,
    });
    if (link.error || !link.data.properties) throw link.error ?? new Error('No se pudo crear la sesión.');
    const response = await this.authClient().auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: 'magiclink',
    });
    if (response.error || !response.data.session)
      throw response.error ?? new Error('No se pudo iniciar sesión.');
    return response.data.session;
  }
  async signedUpload(path: string) {
    const data = checked(await this.client.storage.from('evidence').createSignedUploadUrl(path));
    return { path: data.path, token: data.token, signedUrl: data.signedUrl };
  }
  async download(path: string) {
    return checked(await this.client.storage.from('evidence').download(path));
  }
  async signedDownload(path: string) {
    return checked(await this.client.storage.from('evidence').createSignedUrl(path, 300)).signedUrl;
  }
  async finalizePhoto(from: string, to: string) {
    checked(await this.client.storage.from('evidence').copy(from, to));
    await this.client.storage.from('evidence').remove([from]);
  }
  async securityAudit(actorId: string, deviceId: string, action: string, detail: string) {
    checked(
      await this.client.rpc(this.branchId ? 'dexter_branch_audit' : 'dexter_security_audit', {
        ...(this.branchId ? { p_branch: this.branchId } : {}),
        p_actor: actorId,
        p_device: deviceId,
        p_action: action,
        p_detail: detail,
      }),
    );
  }
}
