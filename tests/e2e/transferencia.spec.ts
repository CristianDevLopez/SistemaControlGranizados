import { expect, test, type Page } from '@playwright/test';

// Venta pagada por transferencia: el pedido queda pagado, la caja no espera ese dinero
// y el turno muestra lo cobrado por transferencia aparte.

async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  }
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

const pesos = (value: number) => value.toLocaleString('es-CO');
async function count(page: Page, cash: number, retained?: number) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Efectivo contado *', { exact: true }).fill(pesos(cash));
  if (retained !== undefined)
    await dialog
      .getByLabel('Efectivo reservado para la siguiente apertura', { exact: false })
      .fill(pesos(retained));
  for (const input of await dialog.locator('.count-list input').all()) await input.fill('0');
  for (const input of await dialog.locator('input[type="checkbox"][required]').all()) await input.check();
  await dialog.getByRole('button', { name: 'Registrar conteo', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('una venta por transferencia no se espera en la caja y se ve aparte en el turno', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:5180/reset', { data: { emptyCash: true } });
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill('admin@test.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();

  await nav(page, 'Turno y caja');
  await page.getByRole('button', { name: 'Iniciar caja', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Base inicial', { exact: false }).fill('12.000');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conteo de apertura', exact: true })).toBeVisible();
  await count(page, 12000);

  await nav(page, 'Mostrador');
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  const methods = page.getByRole('group', { name: 'Medio de pago' });
  await expect(methods.getByRole('button', { name: 'Efectivo', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await methods.getByRole('button', { name: 'Transferencia', exact: true }).click();
  await page.getByLabel('Comprobante de la transferencia').fill('4821');
  await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
  await expect(page.getByText(/Venta registrada · .* · transferencia/)).toBeVisible();
  // El siguiente pedido vuelve a efectivo.
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await expect(methods.getByRole('button', { name: 'Efectivo', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await nav(page, 'Turno y caja');
  await expect(page.locator('.stat').filter({ hasText: 'Efectivo esperado' })).toContainText(/12\.000/);
  const transfers = page.locator('.stat').filter({ hasText: 'Cobrado por transferencia' });
  await expect(transfers).toContainText(/14\.000/);
  await expect(transfers).toContainText('Cuenta de prueba');

  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await page.locator('table .text-button.strong').first().click();
  await expect(page.getByRole('dialog')).toContainText('Transferencia · Cuenta de prueba · ref 4821');
});
