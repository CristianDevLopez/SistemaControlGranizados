import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { cashier, cmd, ids } from '../support/fixture.ts';
import { businessDay } from '../../src/domain/dashboard.ts';

async function login(page: Page, email = 'admin@test.invalid') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
}
async function nav(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) <= 900) {
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
    await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  }
  await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
}
async function seedSale(request: APIRequestContext) {
  const headers = {
    authorization: `Bearer ${cashier.id}`,
    'x-device-id': cashier.deviceId,
    'x-device-token': 'test-device-token',
  };
  const snapshot = await (await request.get('http://127.0.0.1:5180/dexter/snapshot', { headers })).json();
  const extra = {
    at: new Date().toISOString(),
    branchId: snapshot.branch.id,
    configVersion: snapshot.state.settings[0].version,
  };
  const created = await request.post('http://127.0.0.1:5180/dexter/commands', {
    headers,
    data: {
      commands: [
        cmd(
          'create_order',
          { lines: [{ flavorId: ids.flavor, sizeId: snapshot.state.sizes[0].id, quantity: 2 }] },
          cashier,
          extra,
        ),
      ],
    },
  });
  const result = (await created.json()).results[0];
  expect(result.status).toBe('accepted');
  const paid = await request.post('http://127.0.0.1:5180/dexter/commands', {
    headers,
    data: { commands: [cmd('pay', { orderId: result.referenceId, deliver: true }, cashier, extra)] },
  });
  expect((await paid.json()).results[0].status).toBe('accepted');
}
test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:5180/reset');
});

test('dashboard muestra ventas reales, filtra por fechas y turno y exporta los mismos resultados', async ({
  page,
  request,
}, testInfo) => {
  await seedSale(request);
  await login(page);
  await nav(page);
  const kpis = page.locator('.dashboard-kpis');
  await expect(kpis.locator('.stat').filter({ hasText: 'Ventas netas' })).toContainText('28.000');
  await expect(kpis.locator('.stat').filter({ hasText: 'Tickets cobrados' }).locator('strong')).toHaveText(
    '1',
  );
  await expect(kpis.locator('.stat').filter({ hasText: 'Unidades vendidas' }).locator('strong')).toHaveText(
    '2',
  );
  await expect(page.locator('.dashboard-product')).toContainText('Sabor de prueba con licor');
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page.getByLabel('Desde', { exact: true })).toHaveValue(businessDay());
  await page.getByLabel('Turno', { exact: true }).selectOption(ids.shift);
  await expect(kpis).toContainText('28.000');
  await page.getByRole('button', { name: 'Ver tabla de datos', exact: true }).click();
  await expect(page.getByRole('table', { name: 'Ventas por día', exact: true })).toContainText('28.000');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar dashboard', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('dexter-dashboard');
  const contents = await readFile((await download.path())!, 'utf8');
  expect(contents).toContain('28000');
  expect(contents).toContain('Sabor de prueba con licor');
  await page.getByLabel('Turno', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'Este mes', exact: true }).click();
  await page.getByRole('button', { name: 'Ocultar tabla', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('Mes', { exact: true }).fill('2025-02');
  await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('2025-02-01');
  await expect(page.getByLabel('Hasta', { exact: true })).toHaveValue('2025-02-28');
  await expect(kpis.locator('.stat').filter({ hasText: 'Ventas netas' }).locator('strong')).toHaveText(
    /\$\s?0/,
  );
  await expect(page.getByRole('status').filter({ hasText: 'No hay ventas cobradas' })).toBeVisible();
  await page.getByLabel('Desde', { exact: true }).fill('2025-03-01');
  await expect(page.getByRole('alert')).toContainText('La fecha inicial');
  await expect(page.getByRole('button', { name: 'Exportar dashboard', exact: true })).toBeDisabled();
});

test('los roles de operación no tienen acceso al dashboard', async ({ page }) => {
  await login(page, 'caja@test.invalid');
  if ((page.viewportSize()?.width ?? 1280) <= 900)
    await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await expect(
    page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }),
  ).toHaveCount(0);
});
