import { expect, test, type Page } from '@playwright/test';

async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  }
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

async function loginCashier(page: Page) {
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
          transaction = db.transaction('meta', 'readwrite');
        transaction.objectStore('meta').put({ key: 'device', value: data.device });
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });
  await page.getByLabel('Usuario', { exact: true }).fill('caja');
  await page.getByLabel('PIN', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
}

test('el administrador emite la cortesía y caja registra un vaso combinado completo a cero con su consumo', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(60000);
  await request.post('http://127.0.0.1:5180/reset');
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill('admin@test.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await nav(page, 'Promociones');
  await page.getByRole('button', { name: 'Generar cortesía', exact: true }).click();
  const form = page.getByRole('dialog');
  await form
    .getByRole('textbox', { name: 'Nombre de la cortesía *', exact: true })
    .fill('Cortesía completa 16 oz');
  await form
    .getByRole('combobox', { name: 'Tamaño del vaso *', exact: true })
    .selectOption('00000000-0000-4000-8000-000000000016');
  await form.getByRole('combobox', { name: 'Tipo de cortesía *', exact: true }).selectOption('yes');
  await form.getByRole('button', { name: 'Generar código de cortesía', exact: true }).click();
  const generated = page.getByRole('dialog');
  await expect(generated.getByRole('heading', { name: 'Cortesía Dexter’s', exact: true })).toBeVisible();
  await expect(generated).toContainText('1 vaso de 16 oz sin cobro');
  await expect(generated).toContainText('Con licor');
  const code = (await generated.locator('.coupon-preview > strong').textContent())!.trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9-]{16,60}$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/cortesia-generada-' + test.info().project.name + '.png',
    fullPage: true,
  });

  const cashierContext = await browser.newContext({
    viewport: page.viewportSize(),
    baseURL: 'http://127.0.0.1:5174',
  });
  try {
    const register = await cashierContext.newPage();
    await loginCashier(register);
    await register.getByRole('button', { name: '16 ONZAS', exact: true }).click();
    await register.getByRole('button', { name: 'Combinado / bomba', exact: true }).click();
    await register.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
    await register.getByRole('button').filter({ hasText: 'Sabor de prueba sin licor' }).click();
    await register.getByRole('button', { name: 'Agregar combinado' }).click();
    await expect(register.locator('.cart-total')).toContainText('17.000');
    await register
      .getByRole('button', { name: 'Cupón, cortesía, vuelto o entregar después', exact: true })
      .click();
    const checkout = register.getByRole('dialog');
    await checkout.getByRole('textbox', { name: 'Código de cupón o cortesía', exact: true }).fill(code);
    await checkout.getByRole('button', { name: 'Validar', exact: true }).click();
    await expect(checkout.locator('.checkout-amount > strong')).toHaveText(/\$\s*0/);
    await expect(checkout).toContainText('vaso completo sin cobro, con todos sus sabores y componentes');
    await expect(checkout.getByRole('group', { name: 'Medio de pago', exact: true })).toHaveCount(0);
    await expect(checkout.getByText('Efectivo recibido')).toHaveCount(0);
    expect(await register.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await register.screenshot({
      path: 'test-results/cortesia-caja-' + test.info().project.name + '.png',
      fullPage: true,
    });
    await checkout.getByRole('button', { name: 'Registrar cortesía y entregar', exact: true }).click();
    await expect(checkout).toHaveCount(0);
    await expect(register.getByText('Cortesía registrada · $0', { exact: true })).toBeVisible();
    await expect(register.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();

    const response = await request.get('http://127.0.0.1:5180/dexter/snapshot', {
      headers: {
        authorization: 'Bearer 10000000-0000-4000-8000-000000000001',
        'x-device-id': '20000000-0000-4000-8000-000000000002',
        'x-device-token': 'test-device-token',
      },
    });
    expect(response.ok()).toBe(true);
    const { state } = await response.json();
    expect(state.orders).toHaveLength(1);
    expect(state.orders[0].total).toBe(0);
    expect(state.orders[0].lines[0]).toMatchObject({ quantity: 1, delivered: 1, discount: 17000 });
    expect(state.payments).toHaveLength(0);
    expect(state.coupons[0]).toMatchObject({
      code,
      status: 'redeemed',
      issuedBy: '10000000-0000-4000-8000-000000000001',
    });
    const liquids = state.stock.filter((movement: any) => movement.article.startsWith('liquid:'));
    expect(liquids.map((movement: any) => movement.quantity)).toEqual([-8, -8]);
    expect(state.stock.find((movement: any) => movement.article.startsWith('cup:')).quantity).toBe(-1);

    await nav(register, 'Pedidos');
    await register.getByRole('button', { name: 'Cobrados', exact: true }).click();
    await expect(register.locator('tbody')).toContainText('Cortesía aplicada al vaso completo');
    await expect(register.locator('tbody')).toContainText('1/1 entregados');
    await nav(register, 'Mostrador');
    await register.getByRole('button', { name: '16 ONZAS', exact: true }).click();
    await register.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
    await register
      .getByRole('button', { name: 'Cupón, cortesía, vuelto o entregar después', exact: true })
      .click();
    const reused = register.getByRole('dialog');
    await reused.getByRole('textbox', { name: 'Código de cupón o cortesía', exact: true }).fill(code);
    await reused.getByRole('button', { name: 'Validar', exact: true }).click();
    await expect(reused.getByRole('alert')).toContainText(/redimido/);
    await expect(reused.getByRole('button', { name: 'Confirmar cobro', exact: true })).toBeDisabled();
  } finally {
    await cashierContext.close();
  }
});
