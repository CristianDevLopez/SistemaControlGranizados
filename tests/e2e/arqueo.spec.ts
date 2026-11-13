import { expect, test, type Page } from '@playwright/test';

async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  }
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

async function enterCashier(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Usuario', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:5180/dexter/test-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'caja@test.invalid' }),
    });
    const data = await response.json();
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open('dexter-v1');
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result,
          tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key: 'device', value: data.device });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.getByLabel('Usuario', { exact: true }).fill('caja');
  await page.getByLabel('PIN', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
}

test('el admin selecciona ítems, el cajero cuenta a ciegas y el admin revisa el corte original', async ({
  page,
  context,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(60000);
  await request.post('http://127.0.0.1:5180/reset');
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill('admin@test.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await nav(page, 'Turno y caja');
  await page.getByRole('button', { name: 'Iniciar arqueo sorpresa', exact: true }).click();
  const setup = page.getByRole('dialog');
  await setup.getByRole('checkbox', { name: 'Vasos · 12 oz (unidades)', exact: true }).check();
  await setup.getByRole('checkbox', { name: 'Transferencias · Cuenta de prueba', exact: true }).check();
  await setup.getByRole('button', { name: 'Solicitar conteo', exact: true }).click();
  await expect(setup).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Presentar arqueo y reanudar', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('El responsable del turno debe presentar el conteo solicitado.', { exact: false }),
  ).toBeVisible();

  // Otro contexto conserva separadas la identidad y la sesión de caja.
  const cashierContext = await browser.newContext({
    viewport: context.pages()[0].viewportSize() ?? undefined,
  });
  try {
    const cash = await cashierContext.newPage();
    await enterCashier(cash);
    await nav(cash, 'Turno y caja');
    await expect(cash.getByRole('button', { name: 'Iniciar arqueo sorpresa', exact: true })).toHaveCount(0);
    await cash.getByRole('button', { name: 'Presentar arqueo y reanudar', exact: true }).click();
    const form = cash.getByRole('dialog');
    await expect(form.locator('.count-list input')).toHaveCount(1);
    await expect(form.locator('.count-list')).not.toContainText(/Bolsas|Paquetes|Líquido|Coronitas|Copitas/);
    await expect(form).not.toContainText('Esperado');
    await form.getByLabel('Efectivo contado *', { exact: true }).fill('21.000');
    await form.getByLabel('Transferencias verificadas · Cuenta de prueba *', { exact: true }).fill('0');
    await form.getByRole('spinbutton', { name: 'Vasos · 12 oz', exact: true }).fill('3');
    expect(await cash.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await cash.screenshot({ path: testInfo.outputPath('arqueo-cajero.png'), fullPage: true });
    await form.getByRole('button', { name: 'Registrar conteo', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(cash.getByRole('button', { name: 'Revisar conteo', exact: true })).toHaveCount(0);
    await expect(cash.getByRole('button', { name: 'Presentar arqueo y reanudar', exact: true })).toHaveCount(
      0,
    );

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
    await nav(page, 'Turno y caja');
    await page
      .getByRole('row')
      .filter({ hasText: 'Arqueo' })
      .getByRole('button', { name: 'Revisar conteo', exact: true })
      .click();
    const review = page.getByRole('dialog');
    await expect(review).toContainText('Contado por Caja de prueba');
    await expect(review).toContainText('Solicitado por Administrador de prueba');
    const cashRow = review
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: 'Efectivo', exact: true }) });
    await expect(cashRow).toContainText('21.000');
    await expect(cashRow).toContainText('20.000');
    await expect(cashRow.getByRole('cell').last()).toContainText('1.000');
    const cups = review.getByRole('row').filter({ hasText: 'Vasos · 12 oz' });
    await expect(cups).toContainText('3 unidades');
    await expect(cups).toContainText('0 unidades');
    await expect(review.locator('tbody tr')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath('arqueo-admin.png'), fullPage: true });
  } finally {
    await cashierContext.close();
  }
});
