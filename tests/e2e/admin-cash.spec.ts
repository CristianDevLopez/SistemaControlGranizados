import { enterVisibleClosing, submitCashDistribution } from '../support/visible-closing.ts';
import { expect, test, type Page } from '@playwright/test';

async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  }
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

// Los montos se escriben como en Colombia, con punto de miles ("12.000").
const pesos = (value: number) => value.toLocaleString('es-CO');
async function count(page: Page, cash: number) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Efectivo contado *', { exact: true }).fill(pesos(cash));
  for (const input of await dialog.locator('.count-list input').all()) await input.fill('0');
  await dialog.getByRole('button', { name: 'Enviar conteo', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

for (const account of [
  { email: 'admin@test.invalid', name: 'Administrador de prueba' },
  { email: 'owner@test.invalid', name: 'Superadmin de prueba' },
]) {
  test(`${account.name} inicia caja, cobra y presenta el cierre para otra persona`, async ({
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
    await page.getByRole('dialog').getByLabel('Base inicial', { exact: false }).fill('12.000');
    await expect(page.getByRole('dialog').locator('.money-preview')).toHaveText(/12\.000/);
    await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Conteo de apertura', exact: true })).toBeVisible();
    await count(page, 12000);
    await expect(page.getByRole('button', { name: 'Autorizar apertura', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cerrar y contar caja', exact: true })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('caja-admin-iniciada.png'), fullPage: true });
    await nav(page, 'Mostrador');
    await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
    const received = page.getByLabel('Efectivo recibido', { exact: false });
    await received.fill('20.000');
    await expect(page.getByText(/Vuelto: .*6.000/)).toBeVisible();
    await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
    await expect(page.getByText('Venta registrada ·', { exact: false })).toBeVisible();
    await nav(page, 'Turno y caja');
    const chooseSupplies = page.getByRole('button', { name: 'Elegir insumos para el cierre' });
    const supplies = page.getByRole('dialog', { name: 'Insumos para contar al cierre' });
    const pitillos = supplies.getByRole('checkbox', { name: 'Pitillo cuchara (bolsa)' });
    const coronitas = supplies.getByRole('checkbox', { name: 'Coronitas (unidades)' });
    await chooseSupplies.click();
    await expect(supplies.getByRole('checkbox', { name: /Bolsas ·/ }).first()).toBeVisible();
    await expect(supplies.getByRole('checkbox', { name: /Líquido|Vasos|Paquetes/ })).toHaveCount(0);
    await pitillos.check();
    await coronitas.check();
    await supplies.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(supplies).toHaveCount(0);
    await chooseSupplies.click();
    await expect(pitillos).toBeChecked();
    await expect(coronitas).toBeChecked();
    await coronitas.uncheck();
    await supplies.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(supplies).toHaveCount(0);

    let previewRequests = 0;
    await page.route('**/dexter/closing-preview', async (route) => {
      previewRequests++;
      if (previewRequests === 1) {
        await route.fulfill({ status: 503, json: { error: 'El servidor tardó en responder.' } });
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Cerrar y contar caja', exact: true }).click();
    const closing = page.getByRole('dialog', { name: 'Cierre de caja' });
    await expect(closing.getByText('El servidor tardó en responder.')).toBeVisible();
    await closing.getByRole('button', { name: 'Reintentar consulta' }).click();
    await expect(closing).toContainText('Paquetes cerrados');
    const refreshed = page.waitForResponse('**/dexter/snapshot?since=*');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    expect((await refreshed).ok()).toBe(true);
    expect(previewRequests).toBe(2);
    await expect(closing).not.toContainText(/Bolsas selladas|Coronitas/);
    await expect(closing.getByRole('spinbutton', { name: 'Pitillo cuchara' })).toBeVisible();
    await enterVisibleClosing(page, '26.000', { 'Cuenta de prueba': '0' }, { 'Pitillo cuchara': '3' });
    await submitCashDistribution(page, '26.000');
    await nav(page, 'Revisiones');
    await page.getByRole('button', { name: 'Revisar turno', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Confirmar y ajustar inventario', exact: true }),
    ).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
    await nav(page, 'Turno y caja');
    await expect(page.getByRole('button', { name: 'Iniciar caja', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
    await nav(page, 'Turno y caja');
    await expect(page.getByRole('button', { name: 'Iniciar caja', exact: true })).toBeVisible();
  });
}
