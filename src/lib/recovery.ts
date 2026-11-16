import type { SupabaseClient } from '@supabase/supabase-js';

export const recoveryPath = '/recuperar-contrasena';
export function hasRecoveryLinkError(location: { hash: string; search: string }) {
  return [location.hash.slice(1), location.search.slice(1)].some((part) => {
    const params = new URLSearchParams(part);
    return params.has('error') || params.has('error_code');
  });
}
export const recoveryConfirmation =
  'Si el correo pertenece a una cuenta, recibirás un enlace para recuperar la contraseña. Revisa también la carpeta de spam.';

export function validateNewPassword(password: string, confirmation: string) {
  if (password.length < 14 || password.length > 200)
    throw new Error('La contraseña debe tener entre 14 y 200 caracteres.');
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
}

export async function requestPasswordRecovery(client: SupabaseClient, email: string, origin: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new Error('Escribe un correo electrónico válido.');
  const { error } = await client.auth.resetPasswordForEmail(normalized, {
    redirectTo: new URL(recoveryPath, origin).href,
  });
  if (error) {
    if (error.status === 429)
      throw new Error('Ya se solicitó un enlace recientemente. Espera unos minutos y revisa tu correo.');
    throw new Error('No se pudo enviar el enlace de recuperación. Inténtalo de nuevo en unos minutos.');
  }
}

export async function validateRecoverySession(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('El enlace venció o no es válido. Solicita uno nuevo.');
}

export async function updateRecoveredPassword(
  client: SupabaseClient,
  password: string,
  confirmation: string,
) {
  validateNewPassword(password, confirmation);
  await validateRecoverySession(client);
  const { error } = await client.auth.updateUser({ password });
  if (error) {
    if (error.code === 'same_password') throw new Error('Elige una contraseña distinta de la anterior.');
    throw new Error('No se pudo cambiar la contraseña. Abre de nuevo el enlace o solicita uno nuevo.');
  }
}
