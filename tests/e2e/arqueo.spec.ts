import { expect, test, type Page } from '@playwright/test';
import { admin, cmd, ids, other } from '../support/fixture.ts';

async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.locator('.sidebar')).toHaveClass(/mobile-open/);
  }
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
}

async function enterCashier(page: Page) {
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
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
}

async function enterAdmin(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Administrador', exact: true }).click();
  await page.getByLabel('Correo electrónico').fill('admin@test.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password-only');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
}

test('el cierre de empleado conserva el recuento y el servidor responde sin cifras', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:5180/reset');
  const snapshot = page.waitForResponse(
    (response) => response.url().endsWith('/dexter/snapshot') && response.ok(),
  );
  const previewRequests: string[] = [];
  page.on('request', (entry) => {
    if (entry.url().includes('/closing-preview')) previewRequests.push(entry.url());
  });
  await enterCashier(page);
  const cashierSnapshot = await (await snapshot).json();
  expect(cashierSnapshot.state.counts).toEqual([]);
  expect(cashierSnapshot.state.payments).toEqual([]);
  expect(cashierSnapshot.state.shifts[0]).not.toHaveProperty('base');
  await nav(page, 'Turno');
  await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Vasos sueltos del paquete abierto');
  await expect(dialog).toContainText('Paquetes cerrados');
  await expect(dialog).toContainText('Bolsas selladas');
  await expect(dialog).toContainText('Coronitas');
  await expect(dialog).not.toContainText(/Esperado|Diferencia|Copitas|Transferencias verificadas/);

  for (const [attempt, message] of [
    [1, 'Algo no coincide. Vuelve a contar todo.'],
    [2, 'Turno enviado a revisión'],
  ] as const) {
    if (attempt === 2) await page.getByRole('button', { name: 'Volver a contar el cierre' }).click();
    const cash = dialog.getByLabel('Efectivo contado *', { exact: true });
    await expect(cash).toHaveValue('');
    await cash.fill('15.000');
    for (const field of await dialog.getByRole('spinbutton').all()) {
      await expect(field).toHaveValue('');
      await field.fill('0');
    }
    const response = page.waitForResponse(
      (entry) =>
        entry.url().endsWith('/dexter/commands') &&
        entry.request().postData()?.includes('submit_blind_count') === true,
    );
    await dialog.getByRole('button', { name: 'Enviar conteo' }).click();
    const result = (await (await response).json()).results[0];
    expect(result).toMatchObject({
      status: 'accepted',
      message,
      code: attempt === 1 ? 'COUNT_RECOUNT' : 'COUNT_REVIEW',
    });
    expect(Object.keys(result).sort()).toEqual(['at', 'code', 'id', 'message', 'revision', 'status']);
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(message, { exact: true })).toBeVisible();
  }
  expect(previewRequests).toEqual([]);
  await expect(page.getByRole('table')).toContainText('En revisión');
  await expect(page.getByRole('table')).not.toContainText(/15\.000|20\.000|5\.000/);

  const response = await request.get('http://127.0.0.1:5180/dexter/snapshot', {
    headers: {
      authorization: `Bearer ${admin.id}`,
      'x-device-id': admin.deviceId,
      'x-device-token': 'test-device-token',
    },
  });
  const full = (await response.json()).state;
  const attempts = full.counts.filter((count: { shiftId?: string }) => count.shiftId === ids.shift);
  expect(attempts).toHaveLength(2);
  for (const count of attempts)
    expect(count).toMatchObject({ cash: 15000, expectedCash: 20000, difference: -5000 });
});

test('el admin selecciona ítems, el cajero cuenta a ciegas y el admin revisa el corte original', async ({
  page,
  context,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(60000);
  await request.post('http://127.0.0.1:5180/reset');
  await enterAdmin(page);
  await nav(page, 'Turno y caja');
  await page.getByRole('button', { name: 'Iniciar arqueo sorpresa', exact: true }).click();
  const setup = page.getByRole('dialog');
  await setup.getByRole('checkbox', { name: 'Vasos · 12 oz (unidades)', exact: true }).check();
  await expect(setup.getByRole('checkbox', { name: /Transferencias/ })).toHaveCount(0);
  await setup.getByRole('button', { name: 'Solicitar conteo', exact: true }).click();
  await expect(setup).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Presentar arqueo y reanudar', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('El responsable del turno debe presentar el conteo solicitado.', { exact: false }),
  ).toBeVisible();

  // Otro contexto conserva separadas la identidad y la sesión de caja.
  const cashierContext = await browser.newContext({
    viewport: context.pages()[0].viewportSize() ?? undefined,
  });
  try {
    const cash = await cashierContext.newPage();
    await enterCashier(cash);
    await nav(cash, 'Turno');
    await expect(cash.getByRole('button', { name: 'Iniciar arqueo sorpresa', exact: true })).toHaveCount(0);
    await cash.getByRole('button', { name: 'Presentar arqueo', exact: true }).click();
    const form = cash.getByRole('dialog');
    await expect(form.locator('.count-list input')).toHaveCount(1);
    await expect(form.locator('.count-list')).not.toContainText(/Bolsas|Paquetes|Líquido|Coronitas|Copitas/);
    await expect(form).not.toContainText('Esperado');
    await form.getByLabel('Efectivo contado *', { exact: true }).fill('21.000');
    await expect(
      form.getByLabel('Transferencias verificadas · Cuenta de prueba *', { exact: true }),
    ).toHaveCount(0);
    await form.getByRole('spinbutton', { name: 'Vasos · 12 oz', exact: true }).fill('3');
    expect(await cash.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await cash.screenshot({ path: testInfo.outputPath('arqueo-cajero.png'), fullPage: true });
    await form.getByRole('button', { name: 'Enviar conteo', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(cash.getByRole('button', { name: 'Revisar conteo', exact: true })).toHaveCount(0);
    await expect(cash.getByRole('button', { name: 'Presentar arqueo', exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
    await nav(page, 'Turno y caja');
    await page
      .getByRole('row')
      .filter({ hasText: 'Arqueo' })
      .getByRole('button', { name: 'Revisar conteo', exact: true })
      .click();
    const review = page.getByRole('dialog');
    await expect(review).toContainText('Contado por Caja de prueba');
    await expect(review).toContainText('Solicitado por Administrador de prueba');
    const cashRow = review
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: 'Efectivo', exact: true }) });
    await expect(cashRow).toContainText('21.000');
    await expect(cashRow).toContainText('20.000');
    await expect(cashRow.getByRole('cell').last()).toContainText('1.000');
    const cups = review.getByRole('row').filter({ hasText: 'Vasos · 12 oz' });
    await expect(cups).toContainText('3 unidades');
    await expect(cups).toContainText('0 unidades');
    await expect(review.locator('tbody tr')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('arqueo-admin.png'), fullPage: true });
  } finally {
    await cashierContext.close();
  }
});

test('programa una apertura completa y permite proponer un ajuste de inventario desde el conteo', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:5180/reset', { data: { emptyCash: true } });
  await enterAdmin(page);
  await nav(page, 'Turno y caja');
  await page.getByRole('button', { name: 'Programar arqueo de apertura' }).click();
  const dialog = page.getByRole('dialog');
  const mode = dialog.getByLabel('Tipo de arqueo');
  await mode.selectOption('custom');
  await expect(dialog.getByRole('checkbox', { name: /Bolsas ·/ }).first()).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Líquido ·/ })).toHaveCount(0);
  await mode.selectOption('full');
  await dialog.getByRole('button', { name: 'Guardar programación' }).click();
  await expect(page.getByText('Próxima apertura · Arqueo completo')).toBeVisible();

  await page.getByRole('button', { name: 'Iniciar caja', exact: true }).click();
  await dialog.getByLabel('Base inicial', { exact: false }).fill('12.000');
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Arqueo de apertura' })).toBeVisible();
  await expect(dialog.getByRole('spinbutton', { name: /Líquido ·/ })).toHaveCount(0);
  await dialog.getByLabel('Efectivo contado *', { exact: true }).fill('12.000');
  await expect(dialog.getByLabel('Saldo de apertura · Cuenta de prueba *', { exact: true })).toHaveCount(0);
  for (const field of await dialog.getByRole('spinbutton').all()) await field.fill('0');
  await dialog.getByRole('spinbutton', { name: 'Coronitas' }).fill('3');
  await dialog.getByRole('button', { name: 'Registrar conteo' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Programar arqueo de apertura' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar y contar caja' })).toBeVisible();

  await page.getByRole('button', { name: 'Revisar conteo' }).click();
  await dialog.getByRole('button', { name: 'Ajustar inventario al conteo' }).click();
  await expect(dialog.getByRole('spinbutton', { name: /Coronitas/ })).toHaveValue('3');
  await dialog.getByLabel('Motivo del ajuste').fill('Inventario de entrega verificado por los socios.');
  await dialog.getByLabel('Verifiqué las cantidades físicas actuales').check();
  const proposalResponse = page.waitForResponse(
    (entry) =>
      entry.url().endsWith('/dexter/commands') &&
      entry.request().postData()?.includes('adjust_count_inventory') === true,
  );
  await dialog.getByRole('button', { name: 'Proponer ajuste de inventario' }).click();
  const proposal = (await (await proposalResponse).json()).results[0];
  expect(proposal.approvalPending).toBe(true);
  await expect(dialog).not.toContainText('Inventario ajustado por');
  const approver = { ...other, deviceId: admin.deviceId };
  const response = await request.post('http://127.0.0.1:5180/dexter/commands', {
    headers: {
      authorization: `Bearer ${approver.id}`,
      'x-device-id': approver.deviceId,
      'x-device-token': 'test-device-token',
    },
    data: {
      commands: [
        cmd('resolve_change', { requestId: proposal.referenceId, approve: true }, approver, {
          at: new Date().toISOString(),
          shiftId: undefined,
        }),
      ],
    },
  });
  expect((await response.json()).results[0].status).toBe('accepted');
  await page.reload();
  await nav(page, 'Turno y caja');
  await page.getByRole('button', { name: 'Revisar conteo' }).click();
  await expect(dialog).toContainText('Inventario ajustado por');
  await expect(dialog.getByRole('row').filter({ hasText: 'Coronitas' })).toContainText('0 unidades');
  await expect(dialog.getByRole('button', { name: 'Ajustar inventario al conteo' })).toHaveCount(0);
});
