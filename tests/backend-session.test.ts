import { it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseBackend } from '../src/server/backend.ts';
it('lee la sesión del JWT solo después de validarlo con Auth, sin usar metadatos editables', async () => {
  const sessionId = crypto.randomUUID(),
    userId = crypto.randomUUID();
  const payload = Buffer.from(
    JSON.stringify({ session_id: sessionId, aal: 'aal2', user_metadata: { session_id: 'falso' } }),
  ).toString('base64url');
  const token = `header.${payload}.signature`;
  const getUser = vi.fn(async () => ({ data: { user: { id: userId } }, error: null }));
  const backend = new SupabaseBackend({ auth: { getUser } } as unknown as SupabaseClient, () => {
    throw new Error('No crear sesiones');
  });
  expect(await backend.verifyUser(token)).toEqual({ id: userId, aal: 'aal2', sessionId });
  expect(getUser).toHaveBeenCalledWith(token);
  getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'JWT inválido' } } as any);
  expect(await backend.verifyUser(token)).toBeNull();
});
it('el acceso por PIN no cambia la sesión del cliente con privilegios del servidor', async () => {
  const serviceVerify = vi.fn(() => {
    throw new Error('No adoptar una sesión de empleado en el cliente de servicio');
  });
  const service = {
    auth: {
      verifyOtp: serviceVerify,
      admin: {
        getUserById: async () => ({ data: { user: { email: 'test@staff.invalid' } }, error: null }),
        generateLink: async () => ({ data: { properties: { hashed_token: 'one-time-token' } }, error: null }),
      },
    },
  } as unknown as SupabaseClient;
  const verify = vi.fn(async () => ({ data: { session: { access_token: 'employee-jwt' } }, error: null })),
    factory = vi.fn(() => ({ auth: { verifyOtp: verify } }) as unknown as SupabaseClient);
  const backend = new SupabaseBackend(service, factory);
  expect((await backend.pinSession(crypto.randomUUID())).access_token).toBe('employee-jwt');
  expect(serviceVerify).not.toHaveBeenCalled();
  expect(factory).toHaveBeenCalledTimes(1);
});
