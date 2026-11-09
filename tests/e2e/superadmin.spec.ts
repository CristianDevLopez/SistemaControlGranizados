import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:5180/reset');
});
test('el enlace privado abre la activación desde el acceso abierto y retira el token de la URL', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenido al mostrador' })).toBeVisible();
  await page.goto('/#activar-superadmin=' + 'a'.repeat(64));
  await expect(page.getByRole('heading', { name: 'Activar tu acceso privado' })).toBeVisible();
  await expect(page.getByLabel('Tu nombre', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('minlength', '14');
  expect(new URL(page.url()).hash).toBe('');
  await enter(page, 'admin@test.invalid');
  await page.goto('/#activar-superadmin=' + 'b'.repeat(64));
  await expect(page.getByRole('heading', { name: 'Activar tu acceso privado' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});
async function enter(page: Page, email: string) {
  await page.goto('/');
  await expect(page.getByText('Superadministrador', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
}
async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  }
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}
test('el titular consulta los roles de caja y administra el catálogo con su propia identidad', async ({
  page,
}, testInfo) => {
  await enter(page, 'owner@test.invalid');
  const selector = page.getByLabel('Vista de la aplicación');
  await expect(selector).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Registrar este equipo' })).toHaveCount(0);
  await expect(page.getByLabel('Nombre del equipo')).toHaveCount(0);
  await expect(page.getByLabel('PIN local para respaldo offline')).toHaveCount(0);
  await expect(selector).toHaveValue('superadmin');
  await page.screenshot({ path: testInfo.outputPath('superadmin.png'), fullPage: true });
  await selector.selectOption('encargado');
  await expect(page.getByRole('status').filter({ hasText: 'Solo consulta' })).toContainText(
    'Encargado de caja',
  );
  await page.screenshot({ path: testInfo.outputPath('vista-encargado.png'), fullPage: true });
  await expect(
    page.getByRole('navigation').getByRole('button', { name: 'Configuración', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await expect(page.getByText('Esta vista es de consulta.', { exact: false }).first()).toBeVisible();
  await selector.selectOption('apoyo');
  await expect(page.getByRole('button', { name: 'Cobrar y entregar', exact: true })).toHaveCount(0);
  await selector.selectOption('admin');
  await expect(page.getByRole('status').filter({ hasText: 'Edición habilitada' })).toBeVisible();
  await nav(page, 'Configuración');
  await page.getByRole('button', { name: 'Agregar sabor', exact: true }).click();
  await page.getByLabel('Nombre del sabor').fill('Sabor agregado por el titular');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Sabor agregado por el titular', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('Sincronizado');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('administrador-edicion.png'), fullPage: true });
  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'v2' })).toContainText('Superadmin de prueba');
  await page.getByRole('button', { name: 'Volver a superadministrador', exact: true }).click();
  await expect(selector).toHaveValue('superadmin');
  await nav(page, 'Configuración');
  await expect(page.getByText('Sabor agregado por el titular', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('Sincronizado');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(selector).toHaveValue('superadmin');
});
test('otros administradores editan el catálogo sin ver el acceso privado ni el selector', async ({
  page,
}) => {
  await enter(page, 'admin@test.invalid');
  await expect(page.getByLabel('Vista de la aplicación')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Vistas de superadministrador' })).toHaveCount(0);
  await nav(page, 'Configuración');
  await page.getByRole('button', { name: 'Agregar sabor', exact: true }).click();
  await page.getByLabel('Nombre del sabor').fill('Producto agregado por el admin');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Producto agregado por el admin', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await nav(page, 'Configuración');
  await expect(page.getByText('Producto agregado por el admin', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Equipo y accesos', exact: true }).click();
  await expect(page.getByText('Superadmin de prueba', { exact: true })).toHaveCount(0);
});
