import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { Command, Result, Role, Snapshot } from '../domain/types.ts';
import { getMeta, setMeta, migrateBranchCache, type DeviceCredential } from './db.ts';
import { hasRecoveryLinkError } from './recovery.ts';
import type { Access, Branch } from '../domain/platform.ts';

export const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const testGateway =
  import.meta.env.DEV || import.meta.env.MODE === 'e2e'
    ? (import.meta.env.VITE_TEST_GATEWAY as string | undefined)
    : undefined;
export const recoveryLinkError = typeof window !== 'undefined' && hasRecoveryLinkError(window.location);
export const supabase: SupabaseClient | null = url && publicKey ? createClient(url, publicKey) : null;
export const configured = !!((url && publicKey) || testGateway);
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
let testToken: string | undefined;
let previewRole: Role | null = null;
export const previewReadOnlyMessage =
  'Esta vista es de consulta. Cambia a Administrador o Superadministrador para guardar cambios.';
export function setPreviewRole(role: Role | null) {
  previewRole = role;
}
export async function getActiveBranch(userId: string) {
  const tabValue =
    typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(`dexter-branch:${userId}`);
  if (tabValue) return { id: tabValue, userId };
  return getMeta<{ id: string; userId: string }>('active-branch');
}
export async function setActiveBranch(id: string, userId: string) {
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(`dexter-branch:${userId}`, id);
  await setMeta('active-branch', { id, userId });
}
export async function session(): Promise<Session | null> {
  if (testGateway) {
    testToken ??= await getMeta<string>('test-token');
    return testToken ? ({ access_token: testToken, user: { id: testToken } } as Session) : null;
  }
  return (await supabase?.auth.getSession())?.data.session ?? null;
}
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  if (previewRole && !['snapshot', 'quote', 'attachments/read', 'export'].includes(path.split('?')[0]))
    throw new ApiError(previewReadOnlyMessage, 'PREVIEW_READ_ONLY', 403);
  const current = await session();
  const selection = current ? await getActiveBranch(current.user.id) : undefined;
  const branchId = selection?.userId === current?.user.id ? selection?.id : undefined;
  const legacyDevice = await getMeta<DeviceCredential>('device');
  const device =
    (branchId ? await getMeta<DeviceCredential>(`device:${branchId}:${current?.user.id}`) : undefined) ??
    (legacyDevice && (!branchId || legacyDevice.branchId === branchId || !legacyDevice.branchId)
      ? legacyDevice
      : undefined);
  const response = await fetch(`${testGateway ?? `${url}/functions/v1/dexter`}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(publicKey ? { apikey: publicKey } : {}),
      ...(current ? { Authorization: `Bearer ${current.access_token}` } : {}),
      ...(device ? { 'X-Device-Id': device.id, 'X-Device-Token': device.token } : {}),
      ...(previewRole ? { 'X-Preview-Role': previewRole } : {}),
      ...(branchId ? { 'X-Branch-Id': branchId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error ?? 'No se pudo completar la operación.',
      data.code ?? 'SERVER_ERROR',
      response.status,
    );
  return data;
}
export async function loginAdmin(email: string, password: string) {
  if (testGateway) {
    const data = await api('test-login', { email, password });
    testToken = data.token;
    await setMeta('test-token', testToken);
    await setMeta('device', data.device);
    return;
  }
  const response = await supabase!.auth.signInWithPassword({ email, password });
  if (response.error) throw response.error;
}
export async function loginPin(data: Record<string, unknown>) {
  const device = await getMeta<DeviceCredential>('device'),
    result = await api('login-pin', { ...data, deviceId: device?.id, deviceToken: device?.token });
  if (testGateway) {
    testToken = result.session.access_token;
    await setMeta('test-token', testToken);
  } else await supabase!.auth.setSession(result.session);
  if (result.branchId) await setActiveBranch(result.branchId, result.profile.id);
  if (result.deviceToken) await saveDeviceCredential({ id: result.deviceId, token: result.deviceToken });
  return result;
}
export async function saveDeviceCredential(device: DeviceCredential) {
  const user = (await session())?.user;
  const selection = user ? await getActiveBranch(user.id) : undefined;
  const credential = {
    ...device,
    userId: user?.id,
    branchId: selection?.userId === user?.id ? selection?.id : undefined,
  };
  await setMeta('device', credential);
  if (credential.branchId && user) await setMeta(`device:${credential.branchId}:${user.id}`, credential);
}
export async function ensureBranch(): Promise<Access> {
  const access = await api<Access>('access');
  if (!(await getMeta('branch-cache-migrated'))) await migrateBranchCache(access.legacyBranchId);
  const user = (await session())!.user;
  const saved = await getActiveBranch(user.id);
  const device = await getMeta<DeviceCredential>('device');
  const branch =
    access.branches.find((b) => saved?.userId === user.id && b.id === saved.id) ??
    access.branches.find((b) => b.id === device?.branchId) ??
    access.branches.find((b) => b.id === access.legacyBranchId) ??
    access.branches[0];
  if (!branch)
    throw new ApiError('Aún no tienes locales asignados. Contacta al desarrollador.', 'NO_BRANCHES', 403);
  await setActiveBranch(branch.id, user.id);
  if (device && !device.branchId && branch.id === access.legacyBranchId) await saveDeviceCredential(device);
  return access;
}
export async function logout() {
  setPreviewRole(null);
  testToken = undefined;
  await dbTokenClear();
  if (supabase) await supabase.auth.signOut();
}
async function dbTokenClear() {
  await setMeta('test-token', null);
}
export async function sendCommands(commands: Command[]): Promise<{ results: Result[]; serverAt: string }> {
  return api('commands', { commands });
}
export async function snapshot(revision?: number): Promise<
  | Snapshot
  | {
      unchanged: true;
      actor: Snapshot['actor'];
      serverAt: string;
      revision: number;
      access?: Access;
      branch?: Branch;
    }
> {
  return api(`snapshot${revision === undefined ? '' : `?since=${revision}`}`);
}
