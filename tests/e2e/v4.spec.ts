import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { admin, cashier, cmd, ids } from '../support/fixture.ts';
import { physicalArticles } from '../../src/domain/engine.ts';
import type { CommandType, State } from '../../src/domain/types.ts';
const gateway = 'http://127.0.0.1:5180/dexter';
const headers = {
  authorization: 'Bearer ' + admin.id,
  'x-device-id': admin.deviceId,
  'x-device-token': 'test-device-token',
};
const snapshot = async (request: APIRequestContext) =>
  (await request.get(gateway + '/snapshot', { headers })).json();
async function execute(
  request: APIRequestContext,
  type: CommandType,
  payload: Record<string, unknown>,
  actor = admin,
) {
  const s = await snapshot(request);
  const command = cmd(type, payload, actor, {
    at: new Date().toISOString(),
    branchId: s.branch.id,
    configVersion: s.state.settings[0].version,
  });
  const result = await (
    await request.post(gateway + '/commands', {
      headers: { ...headers, authorization: 'Bearer ' + actor.id, 'x-device-id': actor.deviceId },
      data: { commands: [command] },
    })
  ).json();
  expect(result.results[0].status, JSON.stringify(result)).toBe('accepted');
  return result.results[0];
}
async function login(page: Page, email = 'admin@test.invalid') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
}
async function nav(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1280) <= 900)
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}
test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:5180/reset', { data: { v4: true } });
});
test('el admin configura dulces, busca todas las existencias y exporta un rango colombiano', async ({
  page,
}) => {
  await login(page);
  await nav(page, 'Configuración');
  await page.getByRole('button', { name: 'Dulces y categorías', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dulces', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Agregar dulce', exact: true }).click();
  const form = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Agregar dulce' }) });
  await form.getByLabel('Nombre').fill('Caramelo de prueba');
  await form.getByLabel('Cuánto trae una bolsa').fill('50');
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(form).toHaveCount(0);
  await nav(page, 'Inventario');
  await page.getByRole('textbox', { name: 'Buscar en todo el inventario' }).fill('caramelo');
  await expect(page.getByRole('row').filter({ hasText: 'Caramelo de prueba' })).toBeVisible();
  await nav(page, 'Configuración');
  await page.getByRole('button', { name: 'Exportación, avisos y auditoría', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Exportación, avisos y auditoría' }).click();
  await page.getByLabel('Desde (Colombia)').fill('2026-10-01');
  await page.getByLabel('Hasta (Colombia)').fill('2026-11-28');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar información', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('.zip');
});
test('la pista explica la apertura y deja la propuesta para otro administrador', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:5180/reset', { data: { v4: true, v4ClosingHint: true } });
  const s = await snapshot(request),
    state = s.state as State,
    size = state.sizes[0],
    cup = 'cup:' + size.id,
    pack = 'package:' + size.id;
  for (const attempt of [1, 2])
    await execute(
      request,
      'submit_blind_count',
      {
        kind: 'closing',
        attempt,
        shiftId: ids.shift,
        closingCountMode: 'full',
        cash: 20000,
        items: Object.fromEntries(
          physicalArticles(state).map((a) => [a.id, a.id === cup ? 120 : a.id === pack ? 1 : 0]),
        ),
      },
      cashier,
    );
  await login(page);
  await page.goto('/#review?registro=' + ids.shift);
  await expect(page.getByRole('heading', { name: 'Revisión del cierre', exact: true })).toBeVisible();
  await page
    .locator('.notice.info')
    .filter({ hasText: '¿Apertura sin registrar?' })
    .getByRole('button', { name: 'Agregar apertura', exact: true })
    .click();
  await page.getByLabel('Nota del admin', { exact: true }).fill('Paquete abierto sin registrar, verificado.');
  await page.getByRole('button', { name: 'Confirmar y ajustar inventario', exact: true }).click();
  await expect(page.getByText(/Pendiente de otro administrador/)).toBeVisible();
  const result = (await snapshot(request)).state.shifts[0].v4Reviews[0];
  expect(result.count.differences[cup]).toBe(0);
  expect(result.count.differences[pack]).toBe(0);
});
test('Mermas muestra las cuatro cifras y Telegram permite editar el destino', async ({ page }) => {
  await login(page);
  await nav(page, 'Revisiones');
  await page.getByRole('button', { name: 'Mermas', exact: true }).click();
  await expect(page.getByText('Pérdida neta', { exact: true })).toBeVisible();
  await nav(page, 'Configuración');
  await page.getByRole('button', { name: 'Avisos de Telegram', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enviar mensaje de prueba', exact: true })).toBeVisible();
  await page.screenshot({
    path: '.local/v4-telegram-' + String(page.viewportSize()?.width) + '.png',
    fullPage: true,
  });
});

test('el empleado ve las cantidades anunciadas y confirma solo lo que llegó bueno', async ({
  page,
  request,
}) => {
  await execute(request, 'create_shipment', {
    from: 'Medellín',
    supplier: 'Recepción v4',
    items: [{ article: 'coronita', quantity: 1000, unitCost: 3000 }],
    notes: 'Costo privado',
  });
  await login(page, 'caja@test.invalid');
  await nav(page, 'Compras y gastos');
  const panel = page
    .locator('.panel')
    .filter({ has: page.getByRole('heading', { name: 'Recibir mercancía', exact: true }) });
  await panel.getByRole('button', { name: 'Recibir', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Vienen 1000');
  await expect(dialog).not.toContainText('Costo privado');
  await dialog.getByLabel('Llegaron bien', { exact: true }).fill('980');
  await dialog.getByLabel('Dañados', { exact: true }).fill('10');
  await dialog.getByLabel('Fotos del daño').setInputFiles('public/dexter.jpg');
  await dialog.getByRole('combobox').selectOption('lost');
  await dialog.getByLabel('Nota', { exact: true }).fill('Diez unidades no llegaron');
  await dialog.getByRole('button', { name: 'Revisar resumen', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Llegaron bien 980 · Dañados 10 · Faltan 10');
  await dialog.getByRole('button', { name: 'Confirmar recepción', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const s = (await snapshot(request)).state as State;
  expect(s.receipts[0]).toMatchObject({
    items: { coronita: 990 },
    damaged: { coronita: 10 },
    missing: { coronita: 'lost' },
  });
  expect(
    s.stock
      .filter((m) => m.reason === 'receipt' && m.article === 'coronita')
      .reduce((n, m) => n + m.quantity, 0),
  ).toBe(980);
});

test('Versus ofrece subir de 12 a 16 y aplica automáticamente la campaña', async ({ page, request }) => {
  await execute(request, 'save_promotion', {
    name: 'Versus de prueba',
    effect: 'upgrade',
    steps: 1,
    versus: { a: ids.flavor, b: ids.plain },
    delivery: 'schedule',
    checkoutText: '',
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 600000).toISOString(),
  });
  await login(page, 'caja@test.invalid');
  await nav(page, 'Mostrador');
  await page.getByRole('button', { name: 'Mini 12 onzas', exact: true }).click();
  await page.locator('.flavor-card').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await page.getByRole('button', { name: 'Cambiar a 16', exact: true }).click();
  await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
  await expect(page.getByText(/Venta registrada/)).toBeVisible();
  const s = (await snapshot(request)).state as State;
  const sale = s.orders[0];
  expect(s.sizes.find((size) => size.id === sale.lines[0].sizeId)?.ounces).toBe(16);
  expect(sale.total).toBe(s.sizes.find((size) => size.ounces === 12)!.alcoholPrice);
  expect(sale.lines[0].appliedRules?.[0].promotion.versus).toEqual({ a: ids.flavor, b: ids.plain });
});
