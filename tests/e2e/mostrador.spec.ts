import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { CommandType, Snapshot } from '../../src/domain/types.ts';
import { cashier, cmd, ids } from '../support/fixture.ts';
test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:5180/reset');
});
async function enter(page: Page, admin = false) {
  await page.goto('/');
  if (admin) {
    await page.getByRole('button', { name: 'Administrador', exact: true }).click();
    await page.getByLabel('Correo electrónico').fill('admin@test.invalid');
    await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  } else {
    await expect(page.getByLabel('Usuario', { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const response = await fetch('http://127.0.0.1:5180/dexter/test-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'caja@test.invalid' }),
        }),
        data = await response.json();
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
  }
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
async function cashierCommands(request: APIRequestContext) {
  const gateway = 'http://127.0.0.1:5180/dexter';
  const headers = {
    authorization: `Bearer ${cashier.id}`,
    'x-device-id': cashier.deviceId,
    'x-device-token': 'test-device-token',
  };
  const response = await request.get(`${gateway}/snapshot`, { headers });
  const snapshot: Snapshot = await response.json();
  const send = async (type: CommandType, payload: Record<string, unknown>) => {
    const response = await request.post(`${gateway}/commands`, {
      headers,
      data: {
        commands: [
          cmd(type, payload, cashier, {
            at: new Date().toISOString(),
            branchId: snapshot.branch?.id,
            configVersion: snapshot.state.settings[0].version,
          }),
        ],
      },
    });
    const result = (await response.json()).results[0];
    expect(result).toMatchObject({ status: 'accepted', referenceId: expect.any(String) });
    return result.referenceId;
  };
  return { state: snapshot.state, send };
}
async function seedTasting(request: APIRequestContext, withProduct = false) {
  const { state, send } = await cashierCommands(request);
  const orderId = withProduct
    ? await send('create_order', {
        lines: [{ flavorId: ids.flavor, sizeId: state.sizes[0].id, quantity: 1 }],
      })
    : undefined;
  await send('taste', { orderId, flavorId: ids.flavor });
}
async function openSeededOrder(page: Page) {
  await page.getByRole('button', { name: 'Ver pedidos abiertos', exact: true }).click();
  await page.locator('.open-order-picker').getByRole('button', { name: /#/ }).click();
}
test('el administrador ve primero las diferencias de inventario y puede desplegar el historial', async ({
  page,
  request,
}) => {
  const { state, send } = await cashierCommands(request);
  await send('open_bag', { flavorId: ids.flavor, ounces: 6 });
  const orderId = await send('create_order', {
    lines: [{ flavorId: ids.flavor, sizeId: state.sizes[0].id, quantity: 1 }],
  });
  await send('pay', { orderId, deliver: true });
  await enter(page, true);
  await nav(page, 'Inventario');
  await expect(page.getByRole('heading', { name: 'Lo que no cuadra', exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole('navigation', { includeHidden: true })
      .getByRole('button', { name: 'Revisiones', includeHidden: true }),
  ).toBeAttached();
  await expect(page.getByRole('button', { name: 'Registrar inventario inicial' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Marcar agotada' })).toHaveCount(0);
  await page.locator('summary').filter({ hasText: 'Historial de aperturas' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Bolsa · Sabor de prueba con licor' })).toBeVisible();

  await nav(page, 'Hoy');
  await expect(page.getByRole('heading', { name: 'Turno de hoy' })).toBeVisible();
  await expect(page.getByText('1 pedido pagado', { exact: true })).toBeVisible();
  await expect(page.getByText('Bolsa · Sabor de prueba con licor')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Ayer al cierre' })).toHaveCount(0);
  await nav(page, 'Revisar turnos');
  await expect(page.getByRole('columnheader', { name: 'Ayer al cierre' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Vasos sueltos · 12 oz' })).toContainText('-1');
});

test('el encargado registra aperturas y solo ve las del turno, sin saldos ni diferencias', async ({
  page,
}) => {
  await enter(page);
  await nav(page, 'Inventario');
  await expect(page.getByRole('heading', { name: 'Aperturas del turno' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar paquetes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reportar daño' })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir bolsa de líquido' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Sabor').selectOption(ids.flavor);
  await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
  await expect(page.getByText('Bolsa · Sabor de prueba con licor')).toBeVisible();
  await expect(page.getByText('Lo que no cuadra')).toHaveCount(0);
  await expect(page.getByText('Saldo teórico')).toHaveCount(0);
});

test('muestra los diez círculos del catálogo sobre el color de cada tarjeta', async ({ page }, testInfo) => {
  const names = [
    'Manzana Verde',
    'Fresa Boom',
    'Mango Biche',
    'Maracumango',
    'Santorini',
    'Perla Negra',
    'Ojo de Diablo',
    'Cool Blue',
    'Smirnoff',
    'Red Fantasy',
  ];
  await page.route('**/dexter/snapshot*', async (route) => {
    const response = await route.fetch();
    if (!response.ok() || response.status() === 204) return route.fulfill({ response });
    const snapshot = (await response.json()) as Snapshot;
    if (snapshot.state)
      snapshot.state.flavors = names.map((name, index) => ({
        id: `flavor-${index}`,
        name,
        active: true,
        alcohol: index > 2,
      }));
    await route.fulfill({ response, json: snapshot });
  });
  await enter(page);
  const grid = page.locator('.flavor-grid');
  const badges = grid.locator('.flavor-photo-badge');
  await expect(badges).toHaveCount(names.length);
  for (const badge of await badges.all()) {
    await badge.scrollIntoViewIfNeeded();
    await expect
      .poll(async () =>
        badge.evaluate((element) => {
          const image = element.querySelector('img')!;
          const diameter = element.getBoundingClientRect();
          const art = element.parentElement!.getBoundingClientRect();
          return (
            image.complete &&
            image.naturalWidth > 0 &&
            Math.abs(diameter.width - diameter.height) < 1 &&
            Math.abs(diameter.left + diameter.width / 2 - art.left - art.width / 2) < 1 &&
            diameter.height >= art.height * 0.75 &&
            getComputedStyle(element).borderRadius === '50%'
          );
        }),
      )
      .toBe(true);
  }
  await grid.screenshot({
    path: testInfo.outputPath('circulos-sabores.png'),
    style: 'header { visibility: hidden; }',
  });
});

test('venta sencilla en tres acciones, conserva entregas y evita cobros repetidos al recargar', async ({
  page,
}) => {
  await enter(page);
  await expect(page.getByRole('button', { name: /degustación/i })).toHaveCount(0);
  await expect(page.getByText(/Las degustaciones descuentan/)).toHaveCount(0);
  const started = Date.now();
  await page.getByRole('button', { name: 'Medio 16 onzas' }).click();
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await expect(page.getByRole('button', { name: 'Cobrar y entregar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
  await expect(page.getByText('Venta registrada ·')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(10000);
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await expect(page.getByText('1/1 entregados')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
});
test('un combinado conserva sus sabores al recargar y descuenta solo su porción al entregar y cobrar', async ({
  page,
  request,
}) => {
  await enter(page);
  await page.getByRole('button', { name: 'Medio 16 onzas' }).click();
  await page.getByRole('button', { name: 'Combinado / bomba', exact: true }).click();
  const add = page.getByRole('button', { name: 'Agregar combinado' });
  await expect(add).toBeDisabled();
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba sin licor' }).click();
  await expect(add).toBeDisabled();
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await expect(page.locator('.mix-portion')).toHaveCount(2);
  await expect(page.locator('.mix-portion').nth(0)).toContainText('1/2 · 8 oz');
  await expect(page.locator('.mix-portion').nth(1)).toContainText('1/2 · 8 oz');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/seleccion-combinado-' + test.info().project.name + '.png',
    fullPage: true,
  });
  await add.click();
  await expect(page.locator('.cart-line:has(.cart-line-head)')).toHaveCount(1);
  await expect(page.locator('.cart-total')).toContainText('17.000');
  const sync = page.getByRole('button', { name: 'Estado de sincronización' });
  await expect(sync).toContainText('Sincronizado');
  await page.reload();
  await expect(page.locator('.cart-line:has(.cart-line-head)')).toHaveCount(1);
  await expect(page.locator('.cart-line:has(.cart-line-head)')).toContainText(
    'Sabor de prueba con licor + Sabor de prueba sin licor',
  );
  await expect(page.locator('.cart-line-head .flavor-portions')).toContainText('1/2 · 8 oz');
  await page.screenshot({
    path: 'test-results/carrito-combinado-' + test.info().project.name + '.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Aumentar cantidad', exact: true }).click();
  await page.getByRole('button', { name: '0/2 entregados', exact: true }).click();
  await expect(page.getByRole('button', { name: '1/2 entregados', exact: true })).toBeVisible();
  await expect(sync).toContainText('Sincronizado');
  await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
  await expect(sync).toContainText('Sincronizado');
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('Sabor de prueba con licor + Sabor de prueba sin licor');
  await expect(page.locator('tbody')).toContainText('2/2 entregados');
  await page.locator('tbody').getByRole('button').first().click();
  await expect(page.getByRole('dialog').locator('.flavor-portions')).toContainText('1/2 · 8 oz');
  const response = await request.get('http://127.0.0.1:5180/dexter/snapshot', {
    headers: {
      authorization: 'Bearer 10000000-0000-4000-8000-000000000001',
      'x-device-id': '20000000-0000-4000-8000-000000000002',
      'x-device-token': 'test-device-token',
    },
  });
  expect(response.ok()).toBe(true);
  const { state } = await response.json();
  const liquids = state.stock.filter((movement: any) => movement.article.startsWith('liquid:'));
  expect(liquids.reduce((sum: number, movement: any) => sum + movement.quantity, 0)).toBe(-32);
  for (const flavor of state.flavors)
    expect(
      liquids
        .filter((movement: any) => movement.article === `liquid:${flavor.id}`)
        .reduce((sum: number, movement: any) => sum + movement.quantity, 0),
    ).toBe(-16);
  expect(state.payments).toHaveLength(1);
  expect(state.payments[0].amount).toBe(34000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/combinado-' + test.info().project.name + '.png',
    fullPage: true,
  });
});

test('agrupa la misma mezcla elegida en distinto orden y conserva separado un vaso de un solo sabor', async ({
  page,
}) => {
  await enter(page);
  await page.getByRole('button', { name: 'Combinado / bomba', exact: true }).click();
  const alcohol = page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' });
  const plain = page.getByRole('button').filter({ hasText: 'Sabor de prueba sin licor' });
  await alcohol.click();
  await plain.click();
  await page.getByRole('button', { name: 'Agregar combinado' }).click();
  await expect(page.locator('.cart-line:has(.cart-line-head)')).toHaveCount(1);
  await plain.click();
  await alcohol.click();
  await page.getByRole('button', { name: 'Agregar combinado' }).click();
  await expect(page.locator('.cart-line:has(.cart-line-head)')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '0/2 entregados', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Un sabor', exact: true }).click();
  await alcohol.click();
  await expect(page.locator('.cart-line:has(.cart-line-head)')).toHaveCount(2);
  await expect(page.locator('.cart-line-head .flavor-portions')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('elimina una degustación existente y deja de mostrar el pedido como pendiente al recargar', async ({
  page,
  request,
}) => {
  await seedTasting(request);
  await enter(page);
  await openSeededOrder(page);
  await expect(page.locator('.tasting-list')).toContainText('1 degustación');
  await expect(page.getByRole('combobox', { name: 'Sabor de la degustación 1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/degustacion-' + test.info().project.name + '.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Eliminar degustación 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
  await expect(page.locator('.tasting-list')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('Sincronizado');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
  await nav(page, 'Pedidos');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Todos del turno', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('cambia y elimina el sabor de una degustación conservando los productos del pedido', async ({
  page,
  request,
}) => {
  await seedTasting(request, true);
  await enter(page);
  await openSeededOrder(page);
  const tasting = page.getByRole('combobox', { name: 'Sabor de la degustación 1', exact: true });
  await tasting.selectOption('30000000-0000-4000-8000-000000000002');
  await expect(tasting).toHaveValue('30000000-0000-4000-8000-000000000002');
  await expect(tasting).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('Sincronizado');
  const order = await page.locator('.cart-heading h2').textContent();
  // La corrección debe persistir en el servidor, aunque su aviso temporal ya haya desaparecido.
  await page.reload();
  await expect(page.locator('.cart-heading h2')).toHaveText(order!);
  await expect(tasting).toHaveValue('30000000-0000-4000-8000-000000000002');
  await expect(page.locator('.cart-line:has(.cart-line-head)')).toHaveCount(1);
  await expect(page.locator('.cart-total')).toContainText('14.000');
  await page.getByRole('button', { name: 'Eliminar degustación 1', exact: true }).click();
  await expect(page.locator('.tasting-list')).toHaveCount(0);
  await expect(page.locator('.cart-line:has(.cart-line-head)')).toHaveCount(1);
  await expect(page.locator('.cart-total')).toContainText('14.000');
  await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
  await expect(page.getByText('Venta registrada ·')).toBeVisible();
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('1/1 entregados');
  await expect(page.locator('tbody')).not.toContainText('degustaciones');
});

test('un aviso nuevo conserva su duración aunque exista un aviso anterior', async ({ page, request }) => {
  await seedTasting(request);
  await page.clock.install();
  await enter(page);
  await openSeededOrder(page);
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('Sincronizado');
  await page.clock.pauseAt(new Date(Date.now() + 5000));
  const tasting = page.getByRole('combobox', { name: 'Sabor de la degustación 1', exact: true });
  await tasting.selectOption('30000000-0000-4000-8000-000000000002');
  await expect(page.getByRole('status')).toHaveText('Sabor de la degustación corregido.');
  await expect(tasting).toBeEnabled();
  await page.clock.runFor(3000);
  await page.getByRole('button', { name: 'Eliminar degustación 1', exact: true }).click();
  const notice = page.getByRole('status');
  await expect(notice).toHaveText('Degustación eliminada. Se restituyó 1 oz.');
  await page.clock.runFor(1500);
  await expect(notice).toHaveText('Degustación eliminada. Se restituyó 1 oz.');
  await page.clock.runFor(2999);
  await expect(notice).toBeVisible();
  await page.clock.runFor(1);
  await expect(notice).toHaveCount(0);
});

test('corrige y elimina una degustación ya cerrada desde el detalle de pedidos del turno', async ({
  page,
  request,
}) => {
  await seedTasting(request);
  await enter(page);
  await openSeededOrder(page);
  await page.getByRole('button', { name: 'Cerrar solo degustaciones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Todos del turno', exact: true }).click();
  await page.locator('tbody tr').getByRole('button').first().click();
  const dialog = page.getByRole('dialog');
  const tasting = dialog.getByRole('combobox', { name: 'Sabor de la degustación 1', exact: true });
  await tasting.selectOption('30000000-0000-4000-8000-000000000002');
  await expect(tasting).toHaveValue('30000000-0000-4000-8000-000000000002');
  await expect(dialog).toContainText('Solo degustaciones');
  await dialog.getByRole('button', { name: 'Eliminar degustación 1', exact: true }).click();
  await expect(dialog.locator('.tasting-list')).toHaveCount(0);
  await expect(dialog).toContainText('Cancelado');
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('cancela un pedido sin cobrar y conserva sus degustaciones fuera de los pendientes', async ({
  page,
  request,
}) => {
  await seedTasting(request, true);
  await enter(page);
  await openSeededOrder(page);
  await expect(page.locator('.tasting-list')).toContainText('1 degustación');
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
  await expect(page.getByText('Pedido cancelado. Las degustaciones registradas se conservan.')).toBeVisible();
  await page.getByRole('button', { name: 'Ver pedidos abiertos', exact: true }).click();
  await expect(page.getByText('No hay pedidos abiertos.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
  await nav(page, 'Pedidos');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Todos del turno', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Solo degustaciones');
  await expect(page.locator('tbody')).toContainText('1 degustaciones');
  await expect(page.getByRole('button', { name: 'Entregar pendientes', exact: true })).toHaveCount(0);
});

test('quitar la última unidad cancela el pedido sin registrar una venta', async ({ page }) => {
  await enter(page);
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await page.getByRole('button', { name: 'Disminuir cantidad', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
  await nav(page, 'Pedidos');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Todos del turno', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('un pedido con productos entregados no permite cancelarse ni quitar su última unidad', async ({
  page,
}) => {
  await enter(page);
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await page.getByRole('button', { name: '0/1 entregados', exact: true }).click();
  await expect(page.getByRole('button', { name: '1/1 entregados', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar pedido', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Disminuir cantidad', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cobrar y entregar', exact: true })).toBeVisible();
});

test('la PWA sobrevive una recarga sin internet y sincroniza un combinado sin duplicados', async ({
  page,
  context,
}) => {
  await enter(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Sin conexión.', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Combinado / bomba', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba sin licor' }).click();
  await page.getByRole('button', { name: 'Agregar combinado' }).click();
  await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
  await expect(page.getByText('Venta guardada en este equipo, pendiente de sincronizar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('pendientes');
  await page.reload();
  await page.getByRole('button', { name: 'Entrar sin conexión', exact: true }).click();
  await page.getByLabel('PIN de este equipo').fill('123456');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('pendientes');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Estado de sincronización' }).click();
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(page.getByText('Todas tus operaciones están sincronizadas.')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Sabor de prueba con licor + Sabor de prueba sin licor');
  await expect(page.locator('tbody .flavor-portions')).toContainText('1/2 · 6 oz');
});

test('la planilla permite registrar los sabores de un combinado y sus porciones', async ({ page }) => {
  await enter(page, true);
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Ingresar desde papel', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Turno al que pertenece *', exact: true })
    .selectOption('40000000-0000-4000-8000-000000000001');
  await dialog.getByRole('textbox', { name: 'Folio único del pedido *', exact: true }).fill('COMBINADO-1');
  await dialog.locator('input[type=file]').setInputFiles('public/dexter.jpg');
  await dialog.getByRole('combobox', { name: 'Sabor', exact: true }).selectOption('__mix__');
  await dialog.getByRole('checkbox', { name: 'Sabor de prueba con licor' }).check();
  await dialog.getByRole('checkbox', { name: 'Sabor de prueba sin licor' }).check();
  await dialog
    .getByRole('combobox', { name: 'Tamaño', exact: true })
    .selectOption('00000000-0000-4000-8000-000000000016');
  await dialog.getByLabel('Precio unitario cobrado', { exact: true }).fill('17000');
  await expect(dialog.locator('.mix-editor')).toContainText('1/2 · 8 oz');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/planilla-combinado-' + test.info().project.name + '.png',
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Registrar pedido desde papel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Sabor de prueba con licor + Sabor de prueba sin licor');
  await expect(page.locator('tbody .flavor-portions')).toContainText('1/2 · 8 oz');
});
test('menú adaptable y configuración administrable sin desbordamiento horizontal', async ({ page }) => {
  await enter(page, true);
  await nav(page, 'Configuración');
  await expect(page.getByRole('heading', { name: 'Sabores reales', exact: true })).toBeVisible();
  await nav(page, 'Turno y caja');
  await expect(page.getByRole('heading', { name: 'Turno y caja', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/admin-' + test.info().project.name + '.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('el encargado presenta un conteo sin conocer el valor esperado', async ({ page }) => {
  await enter(page);
  await nav(page, 'Mi turno');
  await page.getByRole('button', { name: 'Contar apertura', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Efectivo contado *', { exact: true })).toHaveValue('');
  await expect(dialog.getByText('Efectivo esperado', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/conteo-' + test.info().project.name + '.png', fullPage: true });
});

test('sube una evidencia desde la cámara o archivo y la vincula a una anulación', async ({
  page,
  request,
}) => {
  await enter(page);
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
  await expect(page.getByText('Venta registrada ·')).toBeVisible();
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await page.getByRole('button', { name: 'Solicitar anulación', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Motivo *', exact: true })
    .fill('Corrección de prueba con fotografía de soporte');
  await dialog.locator('input[type=file]').setInputFiles('public/dexter.jpg');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const response = await request.get('http://127.0.0.1:5180/dexter/snapshot', {
          headers: {
            authorization: 'Bearer 10000000-0000-4000-8000-000000000004',
            'x-device-id': '20000000-0000-4000-8000-000000000001',
            'x-device-token': 'test-device-token',
          },
        });
        const payload = await response.json();
        return payload.state.attachments.filter(
          (a: any) => a.name === 'dexter.jpg' && a.status === 'uploaded',
        ).length;
      },
      { timeout: 15000 },
    )
    .toBe(1);
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('Sincronizado');
});
