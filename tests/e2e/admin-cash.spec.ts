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

test('el tipo de cuadre se puede cambiar en el turno y caja solo cuenta el alcance elegido', async ({
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
  await count(page, 12000);
  const choose = async (mode: string) => {
    await page.getByRole('button', { name: 'Elegir tipo de cuadre' }).click();
    const form = page.getByRole('dialog', { name: 'Tipo de cuadre de este turno' });
    await form.getByLabel('Conteo físico al cerrar').selectOption(mode);
    await form.getByRole('button', { name: 'Guardar' }).click();
    await expect(form).toHaveCount(0);
    await page.getByRole('button', { name: 'Cerrar y contar caja' }).click();
    return page.getByRole('dialog', { name: 'Conteo de cierre' });
  };
  const full = await choose('full');
  await expect(full.locator('.count-list')).toContainText('Bolsas selladas');
  await full.getByRole('button', { name: 'Cancelar' }).click();
  const quick = await choose('cash');
  await expect(quick.locator('.count-list input')).toHaveCount(0);
  await count(page, 12000);
  await expect(page.getByRole('button', { name: 'Elegir tipo de cuadre' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmar pagos y repartir efectivo' }).click();
  const closing = page.getByRole('dialog');
  await closing.getByLabel('Confirmo ambos medios', { exact: false }).check();
  await closing.getByLabel('Efectivo que dejas', { exact: false }).fill('12.000');
  await closing.getByRole('button', { name: 'Enviar cierre' }).click();
  await expect(closing).toHaveCount(0);
  await nav(page, 'Solicitudes');
  const card = page.locator('.request-card').filter({ hasText: 'Revisión de cuadre' });
  await card.getByRole('button', { name: 'Revisar turno' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Aprobar cierre/ })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(card).toHaveCount(0);

  await nav(page, 'Turno y caja');
  await page.getByRole('button', { name: 'Iniciar caja', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
  await count(page, 12000);
  await expect(page.getByText('Cuadre de cierre · Sencillo · Efectivo y vasos sueltos')).toBeVisible();
});

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
    await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
    await expect(page.getByText('Venta registrada ·', { exact: false })).toBeVisible();
    await nav(page, 'Turno y caja');
    await page.getByRole('button', { name: 'Cerrar y contar caja', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.count-list')).not.toContainText(
      /Bolsas|Paquetes|Líquido|Coronitas|Copitas/,
    );
    await expect(page.getByRole('dialog').locator('.count-list')).toContainText(
      'Vasos sueltos del paquete abierto',
    );
    await count(page, 26000);
    await page.getByRole('button', { name: 'Confirmar pagos y repartir efectivo' }).click();
    const closing = page.getByRole('dialog');
    await closing.getByLabel('Confirmo ambos medios', { exact: false }).check();
    await closing.getByLabel('Efectivo que dejas', { exact: false }).fill('16.000');
    await closing.getByRole('button', { name: 'Enviar cierre' }).click();
    await expect(closing.getByRole('alert')).toContainText('igual al efectivo contado');
    await closing.getByLabel('Efectivo que dejas', { exact: false }).fill('26.000');
    await closing.getByRole('button', { name: 'Enviar cierre' }).click();
    await expect(closing).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Iniciar caja', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
    await nav(page, 'Turno y caja');
    await expect(page.getByRole('button', { name: 'Iniciar caja', exact: true })).toBeVisible();
  });
}
