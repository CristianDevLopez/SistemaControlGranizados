import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hasRecoveryLinkError,
  recoveryFactor,
  requestPasswordRecovery,
  updateRecoveredPassword,
  validateNewPassword,
} from '../src/lib/recovery.ts';

function client(mfa = false, elevated = false) {
  const auth = {
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null as any })),
    getUser: vi.fn(async () => ({ data: { user: { id: 'owner' } as any }, error: null as any })),
    updateUser: vi.fn(async () => ({ data: { user: { id: 'owner' } }, error: null as any })),
    mfa: {
      listFactors: vi.fn(async () => ({
        data: { totp: mfa ? [{ id: 'totp', status: 'verified' }] : [] },
        error: null,
      })),
      getAuthenticatorAssuranceLevel: vi.fn(async () => ({
        data: { currentLevel: elevated ? 'aal2' : 'aal1', nextLevel: mfa ? 'aal2' : 'aal1' },
        error: null,
      })),
    },
  };
  return { auth, client: { auth } as unknown as SupabaseClient };
}
it('envía la recuperación al correo normalizado con retorno al mismo negocio', async () => {
  const c = client();
  await requestPasswordRecovery(c.client, '  PROPIETARIO@example.com ', 'https://negocio.example');
  expect(c.auth.resetPasswordForEmail).toHaveBeenCalledWith('propietario@example.com', {
    redirectTo: 'https://negocio.example/recuperar-contrasena',
  });
});
it('no expone si el correo existe ni devuelve errores internos del proveedor', async () => {
  const c = client();
  c.auth.resetPasswordForEmail.mockResolvedValue({
    data: {},
    error: { message: 'SMTP internal detail', status: 500 },
  });
  await expect(
    requestPasswordRecovery(c.client, 'correo@example.com', 'https://negocio.example'),
  ).rejects.toThrow('No se pudo enviar el enlace');
});
it('indica cuándo hay que esperar antes de solicitar otro correo', async () => {
  const c = client();
  c.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: { status: 429 } });
  await expect(
    requestPasswordRecovery(c.client, 'correo@example.com', 'https://negocio.example'),
  ).rejects.toThrow('Espera unos minutos');
});
it('rechaza correos inválidos antes de contactar con Auth', async () => {
  const c = client();
  await expect(requestPasswordRecovery(c.client, 'inválido', 'https://negocio.example')).rejects.toThrow(
    'correo electrónico válido',
  );
  expect(c.auth.resetPasswordForEmail).not.toHaveBeenCalled();
});
it('identifica enlaces vencidos o rechazados tanto en fragmento como en query', () => {
  expect(hasRecoveryLinkError({ hash: '#error_code=otp_expired', search: '' })).toBe(true);
  expect(hasRecoveryLinkError({ hash: '', search: '?error=access_denied' })).toBe(true);
  expect(hasRecoveryLinkError({ hash: '#type=recovery', search: '' })).toBe(false);
});
it('rechaza una sesión ausente en el enlace de recuperación', async () => {
  const c = client();
  c.auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
  await expect(recoveryFactor(c.client)).rejects.toThrow('El enlace venció o no es válido');
});
it('mantiene el doble factor y bloquea la contraseña hasta verificarlo', async () => {
  const c = client(true);
  expect(await recoveryFactor(c.client)).toBe('totp');
  await expect(
    updateRecoveredPassword(c.client, 'nueva-contraseña-larga', 'nueva-contraseña-larga'),
  ).rejects.toThrow('Verifica el doble factor');
  expect(c.auth.updateUser).not.toHaveBeenCalled();
});
it('cambia la contraseña de una sesión ya verificada sin modificar su MFA ni sus permisos', async () => {
  const c = client(true, true);
  await updateRecoveredPassword(c.client, 'nueva-contraseña-larga', 'nueva-contraseña-larga');
  expect(c.auth.updateUser).toHaveBeenCalledWith({ password: 'nueva-contraseña-larga' });
});
it('conserva las reglas de longitud y confirmación antes de guardar', async () => {
  const c = client();
  expect(() => validateNewPassword('corta', 'corta')).toThrow('14 y 200');
  await expect(
    updateRecoveredPassword(c.client, 'nueva-contraseña-larga', 'contraseña-distinta'),
  ).rejects.toThrow('no coinciden');
  expect(c.auth.updateUser).not.toHaveBeenCalled();
});
it('permite corregir una contraseña igual a la anterior sin confirmar un cambio inexistente', async () => {
  const c = client(false, true);
  c.auth.updateUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: { code: 'same_password' } });
  await expect(
    updateRecoveredPassword(c.client, 'nueva-contraseña-larga', 'nueva-contraseña-larga'),
  ).rejects.toThrow('distinta de la anterior');
});
