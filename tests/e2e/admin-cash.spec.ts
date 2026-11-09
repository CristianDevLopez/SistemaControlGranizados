import { expect, test, type Page } from '@playwright/test';

async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  }
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

async function count(page: Page, cash: number, retained?: number) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Efectivo contado *', { exact: true }).fill(String(cash));
  if (retained !== undefined)
    await dialog
      .getByLabel('Efectivo reservado para la siguiente apertura', { exact: false })
      .fill(String(retained));
  for (const input of await dialog.locator('.count-list input').all()) await input.fill('0');
  for (const input of await dialog.locator('input[type="checkbox"][required]').all()) await input.check();
  await dialog.getByRole('button', { name: 'Registrar conteo', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

for (const account of [
  { email: 'admin@test.invalid', name: 'Administrador de prueba' },
  { email: 'owner@test.invalid', name: 'Superadmin de prueba' },
]) {
  test(`${account.name} inicia caja, cuenta, cobra y cierra sin autorización ajena`, async ({
    page,
    request,
  }, testInfo) => {
    await request.post('http://127.0.0.1:5180/reset', { data: { emptyCash: true } });
    await page.goto('/');
    await page.getByRole('button', { name: 'Administrador', exact: true }).click();
    await page.getByLabel('Correo electrónico').fill(account.email);
    await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
    if (account.email.startsWith('owner'))
      await page.getByLabel('Vista de la aplicación').selectOption('admin');
    await nav(page, 'Turno y caja');
    await page.getByRole('button', { name: 'Iniciar caja', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Base inicial', { exact: false }).fill('12000');
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Conteo de apertura', exact: true })).toBeVisible();
    await count(page, 12000);
    await expect(page.getByRole('button', { name: 'Autorizar apertura', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cerrar y contar caja', exact: true })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Apertura' })).toContainText(account.name);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('caja-admin-iniciada.png'), fullPage: true });
    await nav(page, 'Mostrador');
    await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
    await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
    await expect(page.getByText('Venta registrada ·', { exact: false })).toBeVisible();
    await nav(page, 'Turno y caja');
    await page.getByRole('button', { name: 'Cerrar y contar caja', exact: true }).click();
    await count(page, 26000, 26000);
    await expect(page.getByRole('button', { name: 'Iniciar caja', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
    await nav(page, 'Turno y caja');
    await expect(page.getByRole('button', { name: 'Iniciar caja', exact: true })).toBeVisible();
  });
}
