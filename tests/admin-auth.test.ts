import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { googleLoginError, requireGoogleProvider, signInAdminWithGoogle } from '../src/lib/admin-auth.ts';

it('evita enviar al administrador a un proveedor Google deshabilitado', async () => {
  const request = vi.fn(async () => Response.json({ external: { google: false } }));
  await expect(requireGoogleProvider('https://auth.example', 'public-key', request)).rejects.toThrow(
    'Google aún no está habilitado',
  );
});

it('permite Google cuando está habilitado y trata fallos de conexión', async () => {
  await expect(
    requireGoogleProvider('https://auth.example', 'public-key', async () =>
      Response.json({ external: { google: true } }),
    ),
  ).resolves.toBeUndefined();
  await expect(
    requireGoogleProvider('https://auth.example', 'public-key', async () => {
      throw new Error('network');
    }),
  ).rejects.toThrow('No se pudo conectar');
});

it('inicia Google con selección de cuenta y vuelve al acceso del mismo negocio', async () => {
  const signInWithOAuth = vi.fn(async () => ({ error: null }));
  await signInAdminWithGoogle(
    { auth: { signInWithOAuth } } as unknown as SupabaseClient,
    'https://negocio.example',
  );
  expect(signInWithOAuth).toHaveBeenCalledWith({
    provider: 'google',
    options: {
      redirectTo: 'https://negocio.example/?acceso=google',
      queryParams: { prompt: 'select_account' },
    },
  });
});

it('ofrece acceso por contraseña si falla Google sin exponer errores internos', async () => {
  const client = {
    auth: { signInWithOAuth: vi.fn(async () => ({ error: { message: 'internal secret' } })) },
  } as unknown as SupabaseClient;
  await expect(signInAdminWithGoogle(client, 'https://negocio.example')).rejects.toThrow(
    'usa tu correo y contraseña',
  );
});

it('detecta la cancelación de Google en query o fragmento y no la confunde con recuperación', () => {
  expect(googleLoginError({ search: '?acceso=google&error=access_denied', hash: '' })).toContain(
    'No se completó',
  );
  expect(googleLoginError({ search: '?acceso=google', hash: '#error_code=access_denied' })).toContain(
    'No se completó',
  );
  expect(googleLoginError({ search: '?acceso=google', hash: '#access_token=token' })).toBe('');
  expect(googleLoginError({ search: '', hash: '#error_code=otp_expired' })).toBe('');
});
