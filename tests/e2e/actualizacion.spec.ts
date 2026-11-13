import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('actualiza con el turno abierto, espera los pendientes y conserva el pedido hasta poder cancelarlo', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  await request.post('http://127.0.0.1:5180/reset');
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill('admin@test.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await expect(page.locator('.shift-strip')).toContainText('Turno abierto');
  const workerPath = resolve('.local/e2e-dist/sw.js');
  const worker = await readFile(workerPath, 'utf8');
  try {
    // Solo cambia el service worker compilado del entorno e2e de loopback.
    await writeFile(workerPath, `${worker}\n// actualizacion-e2e-${crypto.randomUUID()}\n`);
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())!.update();
    });
    await expect(page.getByText('Hay una actualización disponible.', { exact: false })).toBeVisible();
    const update = page.getByRole('button', { name: 'Actualizar app', exact: true });
    await expect(update).toBeVisible();

    await request.post('http://127.0.0.1:5180/test/commands', { data: { paused: true } });
    await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
    await expect(page.locator('.cart-line')).toHaveCount(1);
    const order = await page.locator('.cart-heading h2').textContent();
    await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('pendientes');
    await expect(update).toBeEnabled();
    await update.click();
    await expect(page.getByRole('alert')).toContainText('registros o fotos sin sincronizar');
    await expect(page.locator('.cart-heading h2')).toHaveText(order!);
    expect(
      await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting),
    ).toBe(true);

    await request.post('http://127.0.0.1:5180/test/commands', { data: { paused: false } });
    await expect(update).toBeEnabled();
    await Promise.all([page.waitForEvent('load'), update.click()]);
    await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
    await expect(page.locator('.shift-strip')).toContainText('Turno abierto');
    await expect(page.locator('.cart-heading h2')).toHaveText(order!);
    await expect(page.locator('.cart-line')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText(
      'Sincronizado',
    );
    await page.getByRole('button', { name: 'Disminuir cantidad', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
    await expect(page.locator('.shift-strip')).toContainText('Turno abierto');
  } finally {
    await request.post('http://127.0.0.1:5180/test/commands', { data: { paused: false } });
    await writeFile(workerPath, worker);
  }
});
