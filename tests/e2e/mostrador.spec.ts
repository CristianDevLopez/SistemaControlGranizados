import { test, expect, type Page } from '@playwright/test';
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
test('el administrador conserva el botón de inventario inicial y puede agregar cantidades de nuevo', async ({
  page,
}) => {
  await enter(page, true);
  await nav(page, 'Inventario');
  const button = page.getByRole('button', { name: 'Registrar inventario inicial', exact: true });
  const row = page.getByRole('row').filter({ hasText: 'Copitas de degustación' });
  for (const [quantity, balance] of [
    ['10', '10'],
    ['5', '15'],
  ]) {
    await button.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('spinbutton', { name: 'Copitas de degustación', exact: true }).fill(quantity);
    await dialog.getByRole('button', { name: 'Confirmar inventario inicial', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row.getByRole('cell').nth(2)).toHaveText(balance);
    await expect(button).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await nav(page, 'Inventario');
  await expect(button).toBeVisible();
  await expect(row.getByRole('cell').nth(2)).toHaveText('15');
});

test('el encargado no ve el botón de inventario inicial', async ({ page }) => {
  await enter(page);
  await nav(page, 'Inventario');
  await expect(page.getByRole('heading', { name: 'Insumos en movimiento' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar inventario inicial' })).toHaveCount(0);
});

test('venta sencilla en tres acciones, conserva entregas y evita cobros repetidos al recargar', async ({
  page,
}) => {
  await enter(page);
  const started = Date.now();
  await page.getByRole('button', { name: '16 ONZAS' }).click();
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await expect(page.getByRole('button', { name: 'Cobrar y entregar' })).toBeVisible();
  await page.getByRole('button', { name: 'Cobrar y entregar' }).click();
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
  await page.getByRole('button', { name: '16 ONZAS' }).click();
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
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await expect(page.locator('.cart-total')).toContainText('17.000');
  await page.reload();
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await expect(page.locator('.cart-line')).toContainText(
    'Sabor de prueba con licor + Sabor de prueba sin licor',
  );
  await expect(page.locator('.cart-line .flavor-portions')).toContainText('1/2 · 8 oz');
  await page.screenshot({
    path: 'test-results/carrito-combinado-' + test.info().project.name + '.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Aumentar cantidad', exact: true }).click();
  await page.getByRole('button', { name: '0/2 entregados', exact: true }).click();
  await expect(page.getByRole('button', { name: '1/2 entregados', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cobrar y entregar' }).click();
  await expect(page.getByText('Venta registrada ·')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('Sincronizado');
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
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await plain.click();
  await alcohol.click();
  await page.getByRole('button', { name: 'Agregar combinado' }).click();
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '0/2 entregados', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Un sabor', exact: true }).click();
  await alcohol.click();
  await expect(page.locator('.cart-line')).toHaveCount(2);
  await expect(page.locator('.cart-line .flavor-portions')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('elimina una degustación de prueba y deja de mostrar el pedido como pendiente al recargar', async ({
  page,
}) => {
  await enter(page);
  await page.getByRole('button', { name: '+1 degustación', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
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
  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Cancelado');
});

test('cambia y elimina el sabor de una degustación conservando los productos del pedido', async ({
  page,
}) => {
  await enter(page);
  const flavor = page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' });
  await flavor.click();
  await page.getByRole('button', { name: '+1 degustación', exact: true }).click();
  await flavor.click();
  const tasting = page.getByRole('combobox', { name: 'Sabor de la degustación 1', exact: true });
  await tasting.selectOption('30000000-0000-4000-8000-000000000002');
  await expect(tasting).toHaveValue('30000000-0000-4000-8000-000000000002');
  await expect(page.getByText('Sabor de la degustación corregido.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Eliminar degustación 1', exact: true }).click();
  await expect(page.locator('.tasting-list')).toHaveCount(0);
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await expect(page.locator('.cart-total')).toContainText('14.000');
  await page.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
  await expect(page.getByText('Venta registrada ·')).toBeVisible();
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('1/1 entregados');
  await expect(page.locator('tbody')).not.toContainText('degustaciones');
});

test('corrige y elimina una degustación ya cerrada desde el detalle del historial', async ({ page }) => {
  await enter(page);
  await page.getByRole('button', { name: '+1 degustación', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await page.getByRole('button', { name: 'Cerrar solo degustaciones', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
  await nav(page, 'Pedidos');
  await page.getByRole('button', { name: 'Historial', exact: true }).click();
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
  await expect(page.locator('tbody')).toContainText('Cancelado');
  await expect(page.locator('tbody')).not.toContainText('degustaciones');
});

test('cancela un pedido sin cobrar y conserva sus degustaciones fuera de los pendientes', async ({
  page,
}) => {
  await enter(page);
  const flavor = page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' });
  await flavor.click();
  await page.getByRole('button', { name: '+1 degustación', exact: true }).click();
  await flavor.click();
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
  await page.getByRole('button', { name: 'Historial', exact: true }).click();
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
  await page.getByRole('button', { name: 'Historial', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Cancelado');
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
  await expect(page.getByRole('button', { name: 'Cobrar y entregar' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Cobrar y entregar' }).click();
  await expect(page.getByText('Venta registrada ·')).toBeVisible();
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
  await nav(page, 'Turno y caja');
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
  await page.getByRole('button', { name: 'Cobrar y entregar' }).click();
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
