import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library';
import { admin, cashier, support, cmd, ids } from '../support/fixture.ts';
import type { CommandType } from '../../src/domain/types.ts';

const headers = {
  authorization: `Bearer ${admin.id}`,
  'x-device-id': admin.deviceId,
  'x-device-token': 'test-device-token',
};
async function snapshot(request: APIRequestContext) {
  return (await request.get('http://127.0.0.1:5180/dexter/snapshot', { headers })).json();
}
async function execute(request: APIRequestContext, type: CommandType, payload: Record<string, unknown>) {
  const s = await snapshot(request);
  const command = cmd(type, payload, admin, {
    at: new Date().toISOString(),
    branchId: s.branch.id,
    shiftId: s.state.shifts.find((shift: any) => shift.status === 'open')?.id,
    configVersion: s.state.settings[0].version,
  });
  const response = await request.post('http://127.0.0.1:5180/dexter/commands', {
    headers,
    data: { commands: [command] },
  });
  const body = await response.json();
  expect(body.results[0].status, JSON.stringify(body)).toBe('accepted');
  return body.results[0];
}
async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
}
async function nav(page: Page, name: string) {
  await expect(page.getByRole('navigation')).toBeAttached();
  const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
  if ((page.viewportSize()?.width ?? 1280) <= 900) {
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  }
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}
test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:5180/reset');
});

test('el apoyo envía un pedido, caja identifica al vendedor y lo edita y cobra', async ({
  page,
  browser,
}) => {
  await login(page, 'support@test.invalid');
  await nav(page, 'Mostrador');
  const filter = page.getByRole('group', { name: 'Filtrar sabores por licor' });
  await filter.getByRole('button', { name: 'Sin licor', exact: true }).click();
  await expect(page.locator('.flavor-card')).toHaveCount(1);
  await expect(page.locator('.flavor-card')).toContainText('sin licor');
  await filter.getByRole('button', { name: 'Con licor', exact: true }).click();
  await page.locator('.flavor-card').click();
  await expect(page.getByRole('button', { name: 'Cobrar y entregar', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dejar en caja', exact: true }).click();
  await expect(page.getByText('Pedido disponible en el equipo de caja.', { exact: true })).toBeVisible();
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const cash = await context.newPage();
    await login(cash, 'caja@test.invalid');
    await nav(cash, 'Mostrador');
    await cash.getByRole('button', { name: 'Ver pedidos abiertos', exact: true }).click();
    await cash.locator('.open-order-picker button').filter({ hasText: support.name }).click();
    await expect(cash.locator('.cart-meta')).toContainText(support.name);
    await cash.getByRole('button', { name: 'Aumentar cantidad', exact: true }).click();
    await expect(cash.locator('.cart-total')).toContainText('28.000');
    await cash.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
    await expect(cash.getByText(/Venta registrada/)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('admin edita permisos e imagen; el cierre presenta cuentas y conserva diferencias', async ({
  page,
  request,
  browser,
}, testInfo) => {
  await login(page, 'admin@test.invalid');
  await nav(page, 'Configuración');
  await page.getByRole('button', { name: 'Equipo y accesos', exact: true }).click();
  await expect(page.getByText('Guía de perfiles y permisos', { exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: support.name })
    .getByRole('button', { name: 'Editar permisos', exact: true })
    .click();
  await page.getByRole('dialog').getByLabel('Crear y editar pedidos', { exact: true }).uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await snapshot(request)).profiles.find((p: any) => p.id === support.id).permissions.orders).toBe(
    false,
  );
  await page.getByRole('button', { name: 'Catálogo', exact: true }).click();
  await page
    .getByRole('row')
    .filter({ hasText: 'Sabor de prueba con licor' })
    .getByRole('button', { name: 'Editar', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByLabel('Reemplazar imagen (opcional)')
    .setInputFiles('public/dexter.jpg');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, 'Mostrador');
  await expect(page.locator('.flavor-card img')).toHaveCount(1);
  await expect
    .poll(() => page.locator('.flavor-card img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.locator('.flavor-card:has(img) .cup-shape')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('sabores.png'), fullPage: true });
  // La caja es otra sesión; se conserva la restricción por responsable del turno.
  const s = await snapshot(request);
  const order = await execute(request, 'create_order', {
    lines: [{ flavorId: ids.flavor, sizeId: s.state.sizes[0].id, quantity: 1 }],
  });
  const command = cmd(
    'pay',
    { orderId: order.referenceId, method: 'transfer', accountId: ids.location },
    cashier,
    { at: new Date().toISOString(), branchId: s.branch.id, configVersion: s.state.settings[0].version },
  );
  const paid = await request.post('http://127.0.0.1:5180/dexter/commands', {
    headers: { ...headers, authorization: `Bearer ${cashier.id}`, 'x-device-id': cashier.deviceId },
    data: { commands: [command] },
  });
  expect((await paid.json()).results[0].status).toBe('accepted');
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const cash = await context.newPage();
    await login(cash, 'caja@test.invalid');
    await nav(cash, 'Turno y caja');
    await cash.getByRole('button', { name: 'Cerrar y contar caja', exact: true }).click();
    const dialog = cash.getByRole('dialog');
    await dialog.getByLabel('Efectivo contado *', { exact: true }).fill('20.000');
    await dialog
      .getByLabel('Transferencias verificadas · Cuenta de prueba *', { exact: true })
      .fill('13.000');
    await dialog.getByLabel('Efectivo reservado para la siguiente apertura', { exact: false }).fill('20.000');
    for (const input of await dialog.locator('.count-list input').all()) await input.fill('0');
    for (const input of await dialog.locator('input[type="checkbox"][required]').all()) await input.check();
    await dialog.getByRole('button', { name: 'Registrar conteo', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await nav(cash, 'Compras y gastos');
    await expect(cash.getByRole('button', { name: 'Registrar gasto', exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await nav(page, 'Turno y caja');
  await expect(page.getByRole('row').filter({ hasText: 'Cuenta de prueba:' })).toContainText(/-\$\s*1\.000/);
  await page.screenshot({ path: testInfo.outputPath('cuadre.png'), fullPage: true });
});

test('comparte un QR legible y canjea dos de tres cortesías sin consumir la sobrante', async ({
  page,
  request,
  browser,
}) => {
  const s = await snapshot(request);
  const promotion = await execute(request, 'save_promotion', {
    name: 'Granizado de cortesía',
    effect: 'free',
    delivery: 'coupon',
    sizeIds: [s.state.sizes[0].id],
    flavorIds: [ids.flavor],
    stackable: true,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2027-12-01T00:00:00Z',
  });
  for (let i = 0; i < 3; i++)
    await execute(request, 'issue_coupon', {
      promotionId: promotion.referenceId,
      courtesy: true,
      expiresAt: '2027-01-01T00:00:00Z',
    });
  const coupons = (await snapshot(request)).state.coupons;
  await login(page, 'admin@test.invalid');
  await nav(page, 'Promociones');
  await page
    .getByRole('row')
    .filter({ hasText: coupons[0].code })
    .getByRole('button', { name: 'Ver QR y compartir', exact: true })
    .click();
  const image = page.getByRole('dialog').getByRole('img');
  await expect(image).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compartir código', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compartir QR', exact: true })).toBeVisible();
  const pixels = await image.evaluate((img: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      width: canvas.width,
      height: canvas.height,
      values: Array.from({ length: canvas.width * canvas.height }, (_, i) => data[i * 4]),
    };
  });
  const decoded = new QRCodeReader().decode(
    new BinaryBitmap(
      new HybridBinarizer(
        new RGBLuminanceSource(Uint8ClampedArray.from(pixels.values), pixels.width, pixels.height),
      ),
    ),
  );
  expect(decoded.getText()).toBe(coupons[0].code);
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const cash = await context.newPage();
    await login(cash, 'caja@test.invalid');
    await nav(cash, 'Mostrador');
    await cash.locator('.flavor-card').filter({ hasText: 'Sabor de prueba con licor' }).click();
    await cash.getByRole('button', { name: 'Aumentar cantidad', exact: true }).click();
    await cash
      .getByRole('button', { name: 'Cupón, cortesía, vuelto o entregar después', exact: true })
      .click();
    for (const coupon of coupons) {
      await cash.getByPlaceholder('Escribir código', { exact: true }).fill(coupon.code);
      await cash.getByRole('button', { name: 'Validar', exact: true }).click();
      await expect(cash.getByPlaceholder('Escribir código', { exact: true })).toHaveValue('');
    }
    await expect(cash.getByRole('dialog')).toContainText('Sin canjear:');
    await expect(cash.locator('.checkout-amount')).toContainText(/\$\s*0/);
    await expect(cash.getByLabel('Efectivo recibido', { exact: false })).toHaveCount(0);
    await cash.getByRole('button', { name: 'Registrar cortesía y entregar', exact: true }).click();
    await expect(cash.getByRole('dialog')).toHaveCount(0);
    const final = (await snapshot(request)).state;
    expect(final.coupons.filter((c: any) => c.status === 'redeemed')).toHaveLength(2);
    expect(final.coupons.filter((c: any) => c.status === 'issued')).toHaveLength(1);
    expect(final.payments).toHaveLength(0);
    await nav(cash, 'Pedidos');
    await cash.getByRole('button', { name: 'Cobrados', exact: true }).click();
    await cash.locator('table .text-button.strong').first().click();
    for (const coupon of final.coupons.filter((c: any) => c.status === 'redeemed'))
      await expect(cash.getByRole('dialog')).toContainText(coupon.code);
  } finally {
    await context.close();
  }
});
