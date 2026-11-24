import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { admin, cmd } from '../support/fixture.ts';
import type { OutboxEntry } from '../../src/lib/db.ts';

test('detecta la actualización al volver a la app e instala con operaciones pendientes', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  await request.post('http://127.0.0.1:5180/reset');
  await page.addInitScript(() => {
    const register = ServiceWorkerContainer.prototype.register;
    ServiceWorkerContainer.prototype.register = function (...args) {
      if (!sessionStorage.getItem('first-registration-failed')) {
        sessionStorage.setItem('first-registration-failed', 'true');
        return Promise.reject(new TypeError('Fallo temporal de registro'));
      }
      return register.apply(this, args);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill('admin@test.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('first-registration-failed')))
    .toBe('true');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await expect(page.locator('.shift-strip')).toContainText('Turno abierto');
  const workerPath = resolve('.local/e2e-dist/sw.js');
  const worker = await readFile(workerPath, 'utf8');
  try {
    // Solo cambia el service worker compilado del entorno e2e de loopback.
    await writeFile(workerPath, `${worker}\n// actualizacion-e2e-${crypto.randomUUID()}\n`);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Hay una actualización disponible.', { exact: false })).toBeVisible();
    const update = page.getByRole('button', { name: 'Actualizar app', exact: true });
    await expect(update).toBeVisible();

    await request.post('http://127.0.0.1:5180/test/commands', { data: { paused: true } });
    await page.getByRole('button').filter({ hasText: 'Sabor de prueba con licor' }).click();
    await expect(page.locator('.cart-line:has(.cart-line-head)')).toHaveCount(1);
    const order = await page.locator('.cart-heading h2').textContent();
    await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('pendientes');
    const saved = await request.get('http://127.0.0.1:5180/dexter/snapshot', {
      headers: {
        authorization: `Bearer ${admin.id}`,
        'x-device-id': admin.deviceId,
        'x-device-token': 'test-device-token',
      },
    });
    const snapshot = await saved.json();
    expect(snapshot.state.orders).toHaveLength(0);
    const conflict = cmd('pay', { orderId: crypto.randomUUID() }, admin, {
      branchId: snapshot.branch.id,
      shiftId: snapshot.state.shifts[0].id,
      configVersion: snapshot.state.settings[0].version,
      at: new Date().toISOString(),
      sequence: 100,
    });
    const entry: OutboxEntry = {
      id: conflict.id,
      actorId: conflict.actorId,
      branchId: conflict.branchId,
      sequence: conflict.sequence,
      command: conflict,
      optimistic: false,
      status: 'pending',
    };
    await page.evaluate(async (entry) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('dexter-v1');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['outbox', 'meta'], 'readwrite');
          tx.objectStore('outbox').add(entry);
          tx.objectStore('meta').put({ key: 'sequence', value: entry.sequence });
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    }, entry);
    await expect(update).toBeEnabled();
    await Promise.all([page.waitForEvent('load'), update.click()]);
    await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
    await expect(page.locator('.shift-strip')).toContainText('Turno abierto');
    await expect(page.locator('.cart-heading h2')).toHaveText(order!);
    await expect(page.locator('.cart-line:has(.cart-line-head)')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('pendientes');
    await expect(update).toHaveCount(0);

    await request.post('http://127.0.0.1:5180/test/commands', { data: { paused: false } });
    await page.getByRole('button', { name: 'Estado de sincronización' }).click();
    await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
    await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText(
      '1 por revisar',
    );
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.getByRole('button', { name: 'Disminuir cantidad', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Nuevo pedido', exact: true })).toBeVisible();
    await expect(page.locator('.shift-strip')).toContainText('Turno abierto');
    await page.getByRole('button', { name: 'Estado de sincronización' }).click();
    await page.getByRole('button', { name: 'Ir a Revisiones' }).click();
    await expect(page.getByRole('button', { name: 'Sincronización · 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('Operación 100')).toBeVisible();
  } finally {
    await request.post('http://127.0.0.1:5180/test/commands', { data: { paused: false } });
    await writeFile(workerPath, worker);
  }
});
