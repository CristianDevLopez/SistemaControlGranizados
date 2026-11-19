import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:5180/reset');
});

test('el administrador puede elegir Google sin completar la contraseña', async ({ page }) => {
  await page.route('**/auth/v1/settings', (route) => route.fulfill({ json: { external: { google: true } } }));
  await page.route('**/auth/v1/authorize**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Proveedor Google simulado</p>' }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar con Google', exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/v1\/authorize\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('provider')).toBe('google');
  expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:5174/?acceso=google');
  expect(url.searchParams.get('prompt')).toBe('select_account');
});

test('si Google no está configurado conserva el formulario de contraseña', async ({ page }) => {
  await page.route('**/auth/v1/settings', (route) =>
    route.fulfill({ json: { external: { google: false } } }),
  );
  await page.goto('/?acceso=google');
  await page.getByRole('button', { name: 'Continuar con Google', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Google aún no está habilitado');
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeEditable();
  await expect(page).toHaveURL('/?acceso=google');
});

test('al cancelar Google permite entrar con la cuenta administradora existente', async ({
  page,
}, testInfo) => {
  await page.goto('/?acceso=google#error=access_denied&error_description=internal-detail');
  await expect(page.getByRole('heading', { name: 'Acceso de administrador' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('No se completó el acceso con Google');
  await expect(page.getByLabel('Código de seis dígitos')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('acceso-administrador.png'), fullPage: true });
  await page.getByLabel('Correo electrónico').fill('admin@test.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.getByLabel('Código de seis dígitos')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
});
