import type { SupabaseClient } from '@supabase/supabase-js';

export async function requireGoogleProvider(url: string, publicKey: string, request = fetch) {
  try {
    const response = await request(`${url}/auth/v1/settings`, {
      headers: { apikey: publicKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error();
    const settings = await response.json();
    if (!settings.external?.google)
      throw new Error('Google aún no está habilitado. Puedes ingresar con tu correo y contraseña.');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Google aún')) throw error;
    throw new Error('No se pudo conectar con Google. Intenta de nuevo o usa tu correo y contraseña.');
  }
}

export async function signInAdminWithGoogle(client: SupabaseClient, origin: string) {
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: new URL('/?acceso=google', origin).href,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error)
    throw new Error('No se pudo iniciar sesión con Google. Intenta de nuevo o usa tu correo y contraseña.');
}

export function googleLoginError(location: { hash: string; search: string }) {
  const params = new URLSearchParams(location.search);
  if (params.get('acceso') !== 'google') return '';
  const hash = new URLSearchParams(location.hash.slice(1));
  return params.has('error') || params.has('error_code') || hash.has('error') || hash.has('error_code')
    ? 'No se completó el acceso con Google. Intenta de nuevo o usa tu correo y contraseña.'
    : '';
}
