import { test, expect, type Page } from '@playwright/test';
test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:5180/reset');
});
async function enter(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
}
async function nav(page: Page) {
  const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Locales y mensualidades', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: /locales y mensualidades/i }).first()).toBeVisible();
}
test('el propietario solicita otro local y lo consulta sin habilitar ventas', async ({ page }, testInfo) => {
  await enter(page, 'admin@test.invalid');
  await nav(page);
  await page.getByRole('button', { name: 'Solicitar local', exact: true }).click();
  await page.getByLabel('Nombre del local').fill('Sede Medellín');
  await page.getByLabel('Ciudad o municipio').fill('Medellín');
  await page.getByLabel('Dirección', { exact: true }).fill('Calle 10 # 20-30');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const card = page.locator('.branch-card').filter({ hasText: 'Sede Medellín' });
  await expect(card).toContainText('Pendiente de activación');
  await expect(page.getByRole('button', { name: 'Configurar y activar', exact: true })).toHaveCount(0);
  const queuedId = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const open = indexedDB.open('dexter-v1');
      open.onsuccess = () => resolve(open.result);
    });
    const id = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['meta', 'outbox'], 'readwrite');
      const read = tx.objectStore('meta').get('snapshot');
      read.onsuccess = () => {
        const actor = read.result.value.actor;
        tx.objectStore('outbox').add({
          id,
          actorId: actor.id,
          branchId: actor.branchId,
          sequence: 999,
          optimistic: false,
          status: 'conflict',
          command: {},
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return id;
  });
  await card.getByRole('button', { name: 'Abrir local', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Sincroniza y resuelve' })).toBeVisible();
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const open = indexedDB.open('dexter-v1');
      open.onsuccess = () => resolve(open.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').delete(id);
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, queuedId);
  await card.getByRole('button', { name: 'Abrir local', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Local seleccionado', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'La operación está deshabilitada' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('propietario-locales.png'), fullPage: true });
  await page.reload();
  await expect(page.getByLabel('Local de trabajo')).toContainText('Sede Medellín');
  await expect(page.getByRole('status').filter({ hasText: 'La operación está deshabilitada' })).toBeVisible();
});
test('el desarrollador activa un local y registra mensualidad y abono', async ({ page }, testInfo) => {
  await enter(page, 'owner@test.invalid');
  await nav(page);
  await page.getByRole('button', { name: 'Solicitar local', exact: true }).click();
  await page.getByLabel('Nombre del local').fill('Segunda sede');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const card = page.locator('.branch-card').filter({ hasText: 'Segunda sede' });
  await card.getByRole('button', { name: 'Configurar y activar' }).click();
  await page.getByLabel('Estado del local').selectOption('active');
  await page.getByLabel('Mensualidad por este local (COP)').fill('80000');
  await page.getByLabel('Inicio de cobro').fill('2026-10-01');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card).toContainText('80.000');
  await card.getByRole('button', { name: 'Registrar mensualidad', exact: true }).click();
  await page.getByLabel('Mes a cobrar').fill('2026-10');
  await page.getByLabel('Fecha límite de pago').fill('2026-10-31');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  await page.getByLabel('Valor recibido (COP)').fill('30000');
  await page.getByLabel('Referencia o comprobante').fill('Transferencia 123');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '2026-10' }).first()).toContainText('50.000');
  await expect(page.getByText('Transferencia 123', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Abrir local', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Local seleccionado', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('desarrollador-mensualidades.png'), fullPage: true });
  const selected = await page.getByLabel('Local de trabajo').inputValue();
  const anotherTab = await page.context().newPage();
  await anotherTab.goto('/');
  await expect(anotherTab.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  const menu = anotherTab.getByRole('button', { name: 'Abrir menú', exact: true });
  if (await menu.isVisible()) await menu.click();
  const principal = await anotherTab
    .getByLabel('Local de trabajo')
    .locator('option')
    .filter({ hasText: 'Local principal' })
    .getAttribute('value');
  await anotherTab.getByLabel('Local de trabajo').selectOption(principal!);
  await expect(anotherTab.getByLabel('Local de trabajo')).toHaveValue(principal!);
  await page.waitForResponse(
    (r) => r.url().includes('/snapshot?since=') && r.request().headers()['x-branch-id'] === selected,
  );
  await expect(page.getByLabel('Local de trabajo')).toHaveValue(selected);
  await anotherTab.close();
});
