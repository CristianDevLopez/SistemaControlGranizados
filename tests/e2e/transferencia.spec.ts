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
  for (const input of await dialog.locator('.payment-counts input').all()) await input.fill('0');
  for (const input of await dialog.locator('input[type="checkbox"][required]').all()) await input.check();
  await dialog.getByRole('button', { name: 'Registrar conteo', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function startCash(page: Page) {
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
}

test('una venta por transferencia no se espera en la caja y se ve aparte en el turno', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:5180/reset', { data: { emptyCash: true } });
  await startCash(page);

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

test('configura Nequi y lo identifica al cobrar, en el ticket y separado del efectivo', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:5180/reset', { data: { emptyCash: true } });
  await startCash(page);
  await nav(page, 'Mostrador');
  const flavor = page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' });
  await flavor.click();
  await expect(
    page
      .getByRole('group', { name: 'Medio de pago', exact: true })
      .getByRole('button', { name: 'Nequi', exact: true }),
  ).toBeDisabled();

  await nav(page, 'Configuración');
  await page.getByRole('button', { name: 'Cuentas y custodia', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar Nequi', exact: true }).click();
  const setup = page.getByRole('dialog');
  const number = setup.getByRole('textbox', { name: 'Número de Nequi *', exact: true });
  await expect(number).toHaveValue('');
  await expect(number).toHaveAttribute('required', '');
  await number.fill('3000000000');
  await setup.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(setup).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar Nequi', exact: true })).toBeVisible();

  // Con una sola cuenta activa debe decir Nequi, sin sustituirlo por «Transferencia».
  await page.getByRole('button', { name: 'Editar Cuenta de prueba', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Destino activo', exact: true }).uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, 'Mostrador');
  const methods = page.getByRole('group', { name: 'Medio de pago', exact: true });
  await expect(methods.getByRole('button', { name: 'Nequi', exact: true })).toBeEnabled();
  await expect(methods.getByRole('button', { name: 'Transferencia', exact: true })).toHaveCount(0);
  await methods.getByRole('button', { name: 'Nequi', exact: true }).click();
  await expect(page.locator('.payment-hint')).toContainText('3000000000');
  await page.getByRole('textbox', { name: 'Comprobante de Nequi', exact: true }).fill('NEQ-4821');
  await page.getByRole('button', { name: 'Cupón, cortesía, vuelto o entregar después', exact: true }).click();
  const checkout = page.getByRole('dialog');
  await expect(checkout.getByRole('button', { name: 'Nequi', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(checkout.getByRole('textbox', { name: 'Comprobante de Nequi', exact: true })).toHaveValue(
    'NEQ-4821',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/nequi-' + test.info().project.name + '.png', fullPage: true });
  await checkout.getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(checkout).toHaveCount(0);
  await expect(page.getByText(/Venta registrada · .* · Nequi/)).toBeVisible();

  await flavor.click();
  await expect(methods.getByRole('button', { name: 'Efectivo', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await methods.getByRole('button', { name: 'Nequi', exact: true }).click();
  await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
  await nav(page, 'Turno y caja');
  await expect(page.locator('.stat').filter({ hasText: 'Efectivo esperado' })).toContainText('12.000');
  const transfers = page.locator('.stat').filter({ hasText: 'Cobrado por transferencia' });
  await expect(transfers).toContainText('28.000');
  await expect(transfers).toContainText('Nequi');
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page
    .locator('tbody tr')
    .filter({ hasText: 'Sabor de prueba con licor' })
    .last()
    .getByRole('button')
    .first()
    .click();
  await expect(page.getByRole('dialog')).toContainText('Transferencia · Nequi');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await nav(page, 'Turno y caja');
  await page.getByRole('button', { name: 'Cerrar y contar caja', exact: true }).click();
  const closing = page.getByRole('dialog');
  await expect(closing.locator('.count-list')).not.toContainText(/Bolsas|Paquetes|Líquido|Coronitas|Copitas/);
  await closing.getByLabel('Transferencias verificadas · Nequi *', { exact: true }).fill('27.000');
  await expect(closing.locator('.money-preview').filter({ hasText: '27.000' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('cierre-nequi.png'), fullPage: true });
  await count(page, 12000, 12000);
  const row = page.getByRole('row').filter({ hasText: 'Cierre' });
  await expect(row).toContainText('27.000');
  await expect(row).toContainText('28.000');
  await expect(row).toContainText('-$');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await nav(page, 'Turno y caja');
  await expect(page.getByRole('row').filter({ hasText: 'Cierre' })).toContainText('27.000');
  await nav(page, 'Control y aprobaciones');
  await expect(page.getByText('Nequi: -$ 1.000', { exact: false })).toBeVisible();
});
