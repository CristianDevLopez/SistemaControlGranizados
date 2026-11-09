import { test, expect, type Page } from '@playwright/test';

const userId = '70000000-0000-4000-8000-000000000001';
const factorId = '70000000-0000-4000-8000-000000000002';
function sessionToken(aal: string) {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: userId, aud: 'authenticated', role: 'authenticated', aal, session_id: '70000000-0000-4000-8000-000000000003', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.${Buffer.from('isolated-test-signature').toString('base64url')}`;
}
async function mockAuth(page: Page, mfa = false) {
  const sent: { body: any; redirect: string | null }[] = [],
    changed: any[] = [];
  const user = {
    id: userId,
    email: 'admin@test.invalid',
    aud: 'authenticated',
    role: 'authenticated',
    created_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {},
    identities: [],
    factors: mfa
      ? [{ id: factorId, factor_type: 'totp', status: 'verified', created_at: new Date().toISOString() }]
      : [],
  };
  await page.route('**/auth/v1/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname,
      method = request.method();
    const reply = (json: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (path.endsWith('/recover')) {
      sent.push({ body: request.postDataJSON(), redirect: url.searchParams.get('redirect_to') });
      return reply({});
    }
    if (path.endsWith('/user') && method === 'GET') return reply(user);
    if (path.endsWith('/user') && method === 'PUT') {
      if (mfa) {
        const payload = JSON.parse(
          Buffer.from(request.headers().authorization.split('.')[1], 'base64url').toString(),
        );
        if (payload.aal !== 'aal2') return reply({ code: 'insufficient_aal', message: 'MFA required' }, 403);
      }
      changed.push(request.postDataJSON());
      return reply(user);
    }
    if (path.endsWith('/challenge'))
      return reply({ id: 'challenge', expires_at: Math.floor(Date.now() / 1000) + 120, type: 'totp' });
    if (path.endsWith('/verify')) {
      if (request.postDataJSON().code !== '123456')
        return reply({ message: 'Invalid code', code: 'mfa_verification_failed' }, 422);
      return reply({
        access_token: sessionToken('aal2'),
        refresh_token: 'isolated-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user,
      });
    }
    return route.abort();
  });
  return {
    sent,
    changed,
    link:
      '/recuperar-contrasena#' +
      new URLSearchParams({
        access_token: sessionToken('aal1'),
        refresh_token: 'isolated-refresh',
        token_type: 'bearer',
        expires_in: '3600',
        type: 'recovery',
      }).toString(),
  };
}
test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:5180/reset');
});

test('solicita recuperación desde administrador sin revelar si el correo existe', async ({
  page,
}, testInfo) => {
  const auth = await mockAuth(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByRole('button', { name: 'Olvidé mi contraseña', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recuperar contraseña', exact: true })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill('ADMIN@test.invalid');
  await page.screenshot({ path: testInfo.outputPath('recuperar-contrasena.png'), fullPage: true });
  await page.getByRole('button', { name: 'Enviar enlace de recuperación', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo', exact: true })).toBeVisible();
  await expect(page.getByText('Si el correo pertenece a una cuenta,', { exact: false })).toBeVisible();
  expect(auth.sent).toHaveLength(1);
  expect(auth.sent).toMatchObject([
    { body: { email: 'admin@test.invalid' }, redirect: 'http://127.0.0.1:5174/recuperar-contrasena' },
  ]);
  expect(auth.changed).toHaveLength(0);
});
test('el enlace exige MFA y confirmación antes de actualizar la contraseña', async ({ page }) => {
  const auth = await mockAuth(page, true);
  await page.goto(auth.link);
  await expect(page.getByRole('heading', { name: 'Verifica tu identidad' })).toBeVisible();
  await expect(page.getByLabel('Nueva contraseña', { exact: true })).toHaveCount(0);
  await page.getByLabel('Código de seis dígitos').fill('111111');
  await page.getByRole('button', { name: 'Verificar código', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Código incorrecto');
  expect(auth.changed).toHaveLength(0);
  await page.getByLabel('Código de seis dígitos').fill('123456');
  await page.getByRole('button', { name: 'Verificar código', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Elige tu nueva contraseña' })).toBeVisible();
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('nueva-contraseña-de-prueba');
  await page.getByLabel('Confirmar nueva contraseña').fill('contraseña-que-no-coincide');
  await page.getByRole('button', { name: 'Guardar nueva contraseña', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('no coinciden');
  expect(auth.changed).toHaveLength(0);
  await page.getByLabel('Confirmar nueva contraseña').fill('nueva-contraseña-de-prueba');
  await page.getByRole('button', { name: 'Guardar nueva contraseña', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contraseña actualizada', exact: true })).toBeVisible();
  expect(auth.changed).toHaveLength(1);
  expect(auth.changed[0].password).toBe('nueva-contraseña-de-prueba');
});
test('un enlace vencido permite solicitar otro sin mostrar el formulario de contraseña', async ({ page }) => {
  const auth = await mockAuth(page);
  await page.goto('/recuperar-contrasena#error=access_denied&error_code=otp_expired');
  await expect(page.getByRole('heading', { name: 'Solicita un nuevo enlace' })).toBeVisible();
  await expect(page.getByLabel('Nueva contraseña', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Solicitar otro enlace' }).click();
  await expect(page.getByRole('heading', { name: 'Recuperar contraseña', exact: true })).toBeVisible();
  expect(auth.changed).toHaveLength(0);
});
test('el superadministrador puede solicitar recuperación desde su sesión sin cerrarla', async ({ page }) => {
  await mockAuth(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill('owner@test.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByLabel('Vista de la aplicación')).toBeVisible();
  const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: /Superadmin de prueba/ }).click();
  await page.getByRole('button', { name: 'Recuperar mi contraseña', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recuperar contraseña', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver al acceso', exact: true }).click();
  await expect(page.getByLabel('Vista de la aplicación')).toBeVisible();
});
