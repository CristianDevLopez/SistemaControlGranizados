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
test('la PWA sobrevive una recarga sin internet y sincroniza una venta sin duplicados', async ({
  page,
  context,
}) => {
  await enter(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Sin conexión.', { exact: false }).first()).toBeVisible();
  await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
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
