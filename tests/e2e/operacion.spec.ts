import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { decodeGeneratedQr } from '../support/qr.ts';
import { admin, cashier, support, cmd, ids } from '../support/fixture.ts';
import type { CommandType } from '../../src/domain/types.ts';
import type { OutboxEntry } from '../../src/lib/db.ts';

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
async function seedOutbox(page: Page, entries: OutboxEntry[]) {
  await page.evaluate(async (entries) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('dexter-v1');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(['outbox', 'meta'], 'readwrite');
        for (const entry of entries) tx.objectStore('outbox').add(entry);
        tx.objectStore('meta').put({ key: 'sequence', value: entries[entries.length - 1].sequence });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      database.close();
    }
  }, entries);
}
function pending(command: OutboxEntry['command']): OutboxEntry {
  return {
    id: command.id,
    actorId: command.actorId,
    branchId: command.branchId,
    sequence: command.sequence,
    command,
    optimistic: false,
    status: 'pending',
  };
}
test.beforeEach(async ({ request }) => {
  await request.post('http://127.0.0.1:5180/reset');
});

test('recupera una cortesía rechazada en la versión anterior y envía la operación siguiente una sola vez', async ({
  page,
  request,
}) => {
  await execute(request, 'configure', { courtesyQuota: 0 });
  await login(page, 'admin@test.invalid');
  const s = await snapshot(request);
  const at = new Date().toISOString();
  const options = { at, branchId: s.branch.id, configVersion: s.state.settings[0].version };
  const coupon = cmd(
    'issue_coupon',
    {
      courtesySpec: { sizeId: s.state.sizes[0].id, alcohol: 'all' },
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    },
    admin,
    { ...options, sequence: 166 },
  );
  const next = cmd('configure', { businessName: 'Configuración pendiente' }, admin, {
    ...options,
    sequence: 167,
  });
  const response = await request.post('http://127.0.0.1:5180/dexter/commands', {
    headers,
    data: { commands: [coupon] },
  });
  const { message, code, status } = (await response.json()).results[0];
  expect({ status, code, message }).toEqual({
    status: 'conflict',
    code: 'VALIDATION',
    message: 'La cuota se agotó. Otro admin debe aprobar una cortesía adicional.',
  });
  // El teléfono antiguo solo persistía estos campos de la respuesta.
  await seedOutbox(page, [
    { ...pending(coupon), status: 'conflict', message, result: { id: coupon.id, message, code, status } },
    pending(next),
  ]);
  // Si el teléfono reintentara la 166 ahora, el servidor sí podría emitirla.
  await execute(request, 'configure', { courtesyQuota: 10 });
  await page.reload();
  await page.getByRole('button', { name: 'Estado de sincronización' }).click();
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect
    .poll(async () => (await snapshot(request)).state.settings[0].businessName)
    .toBe('Configuración pendiente');
  await expect(page.getByText('No quedan operaciones pendientes.')).toBeVisible();
  await page.getByText('Operaciones no aplicadas (1)').click();
  await expect(page.getByText(coupon.id, { exact: false })).toBeVisible();
  await expect(page.getByText(message, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  const { state } = await snapshot(request);
  expect(state.coupons).toHaveLength(0);
  expect(state.audit.filter((a: { eventId: string }) => a.eventId === next.id)).toHaveLength(1);
});

test('al agotar la cuota muestra el rechazo y permite solicitar una cortesía adicional', async ({
  page,
  request,
}) => {
  await execute(request, 'configure', { courtesyQuota: 0 });
  await login(page, 'admin@test.invalid');
  await nav(page, 'Promociones');
  await page.getByRole('button', { name: 'Generar cortesía', exact: true }).click();
  const form = page.getByRole('dialog');
  await form
    .getByRole('combobox', { name: 'Tamaño del vaso *', exact: true })
    .selectOption('00000000-0000-4000-8000-000000000016');
  await form.getByRole('button', { name: 'Generar código de cortesía' }).click();
  await expect(form.getByRole('alert')).toContainText('La cuota se agotó.');
  await form.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('button', { name: 'Solicitar cortesía adicional' }).click();
  await form.getByLabel('Motivo').fill('Cortesía especial del turno');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(form).toHaveCount(0);
  const { state } = await snapshot(request);
  expect(state.coupons).toHaveLength(0);
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0]).toMatchObject({ type: 'courtesy_excess', status: 'pending', by: admin.id });
});

test('una vigencia inválida se puede corregir en el formulario y solo emite el código corregido', async ({
  page,
  request,
}) => {
  await login(page, 'admin@test.invalid');
  await nav(page, 'Promociones');
  await page.getByRole('button', { name: 'Generar cortesía', exact: true }).click();
  const form = page.getByRole('dialog');
  await form
    .getByRole('combobox', { name: 'Tamaño del vaso *', exact: true })
    .selectOption('00000000-0000-4000-8000-000000000016');
  const expiry = form.getByLabel('Vence (hora de Colombia)');
  const submit = form.getByRole('button', { name: 'Generar código de cortesía' });
  await expiry.fill('2020-01-01T09:00');
  await submit.click();
  await expect(form.getByRole('alert')).toContainText('Vencimiento inválido.');
  expect((await snapshot(request)).state.coupons).toHaveLength(0);
  const future = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 16);
  await expiry.fill(future);
  await submit.click();
  await expect(form.getByRole('heading', { name: 'Cortesía Dexter’s' })).toBeVisible();
  const { state } = await snapshot(request);
  expect(state.coupons).toHaveLength(1);
  expect(state.coupons[0].expiresAt).toBe(new Date(future + ':00-05:00').toISOString());
});

test('un conflicto de cobro conserva la cola hasta que un administrador lo concilie', async ({
  page,
  request,
}) => {
  await login(page, 'admin@test.invalid');
  const s = await snapshot(request);
  const options = {
    at: new Date().toISOString(),
    branchId: s.branch.id,
    configVersion: s.state.settings[0].version,
  };
  const payment = cmd('pay', { orderId: crypto.randomUUID(), codes: ['CUPON-NO-VALIDO'] }, admin, {
    ...options,
    sequence: 20,
  });
  const next = cmd('request_courtesy_excess', { notes: 'Solicitud siguiente' }, admin, {
    ...options,
    sequence: 21,
  });
  await seedOutbox(page, [pending(payment), pending(next)]);
  await page.getByRole('button', { name: 'Estado de sincronización' }).click();
  const synchronize = page.getByRole('button', { name: 'Sincronizar ahora' });
  await synchronize.click();
  await expect(page.getByText('Por conciliar', { exact: true })).toBeVisible();
  await expect(page.getByText(/Espera la conciliación de la operación 20/)).toBeVisible();
  const before = (await snapshot(request)).state;
  expect(before.requests).toHaveLength(1);
  expect(before.requests[0]).toMatchObject({ type: 'sync', id: payment.id, status: 'pending' });
  expect(before.payments).toHaveLength(0);
  await execute(request, 'resolve_request', {
    requestId: payment.id,
    approve: false,
    resolutionNotes: 'Pedido inexistente, no se recibió dinero.',
  });
  await synchronize.click();
  await expect(page.getByText('Todas tus operaciones están sincronizadas.')).toBeVisible();
  const after = (await snapshot(request)).state;
  expect(after.payments).toHaveLength(0);
  expect(after.audit.filter((a: { eventId: string }) => a.eventId === next.id)).toHaveLength(1);
});

test('al agotar veinte vasos recuerda registrar otro paquete desde Mostrador', async ({ page, request }) => {
  await login(page, 'caja@test.invalid');
  await nav(page, 'Mostrador');
  await page.getByRole('button', { name: 'Registrar apertura de paquete', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Unidades del paquete', { exact: false })).toHaveValue('20');
  await dialog.getByRole('button', { name: 'Registrar apertura', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registrar apertura de paquete', exact: true })).toHaveCount(
    0,
  );
  const s = await snapshot(request);
  const created = await execute(request, 'create_order', {
    lines: [{ sizeId: s.state.sizes[0].id, flavorId: ids.flavor, quantity: 20 }],
  });
  const command = cmd('pay', { orderId: created.referenceId, deliver: true }, cashier, {
    at: new Date().toISOString(),
    branchId: s.branch.id,
    configVersion: s.state.settings[0].version,
  });
  const response = await request.post('http://127.0.0.1:5180/dexter/commands', {
    headers: { ...headers, authorization: `Bearer ${cashier.id}`, 'x-device-id': cashier.deviceId },
    data: { commands: [command] },
  });
  expect((await response.json()).results[0].status).toBe('accepted');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await nav(page, 'Mostrador');
  await page.getByRole('button', { name: 'Registrar apertura de paquete', exact: true }).click();
  await dialog.getByLabel('Confirmo que el paquete anterior está vacío', { exact: false }).check();
  await dialog.getByRole('button', { name: 'Registrar apertura', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registrar apertura de paquete', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('Sincronizado');
  const final = (await snapshot(request)).state;
  expect(final.packages).toHaveLength(2);
  expect(
    final.stock
      .filter((m: any) => m.article === `cup:${s.state.sizes[0].id}`)
      .reduce((n: number, m: any) => n + m.quantity, 0),
  ).toBe(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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
    await nav(cash, 'Mostrador');
    await cash.getByRole('button', { name: 'Registrar apertura de paquete', exact: true }).click();
    await expect(cash.getByRole('dialog').getByLabel('Unidades del paquete', { exact: false })).toHaveValue(
      '20',
    );
    await cash.getByRole('dialog').getByRole('button', { name: 'Registrar apertura', exact: true }).click();
    await expect(cash.getByRole('dialog')).toHaveCount(0);
    await nav(cash, 'Turno y caja');
    await cash.getByRole('button', { name: 'Cerrar y contar caja', exact: true }).click();
    const dialog = cash.getByRole('dialog');
    await dialog.getByLabel('Efectivo contado *', { exact: true }).fill('20.000');
    await dialog
      .getByLabel('Transferencias verificadas · Cuenta de prueba *', { exact: true })
      .fill('13.000');
    await dialog.getByLabel('Efectivo reservado para la siguiente apertura', { exact: false }).fill('20.000');
    for (const input of await dialog.locator('.count-list input').all()) await input.fill('0');
    await dialog.getByRole('spinbutton', { name: 'Vasos · 12 oz', exact: true }).fill('16');
    for (const input of await dialog.locator('input[type="checkbox"][required]').all()) await input.check();
    await dialog.getByRole('button', { name: 'Revisar cuadre', exact: true }).click();
    await expect(dialog.locator('.closing-comparison')).toContainText('Faltan 4 vasos');
    await expect(dialog.locator('.closing-comparison')).toContainText('1.000');
    // Cambiar un dato invalida la comparación y exige revisarla de nuevo.
    await dialog.getByRole('spinbutton', { name: 'Vasos · 12 oz', exact: true }).fill('15');
    await expect(dialog.locator('.closing-comparison')).toHaveCount(0);
    await dialog.getByRole('spinbutton', { name: 'Vasos · 12 oz', exact: true }).fill('16');
    await dialog.getByRole('button', { name: 'Revisar cuadre', exact: true }).click();
    await dialog
      .getByLabel('Revisé el conteo y deseo enviarlo provisionalmente al administrador', { exact: true })
      .check();
    await cash.screenshot({ path: testInfo.outputPath('revision-previa.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Enviar provisional a revisión', exact: true }).click();
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
  await page.getByRole('button', { name: 'Revisar y aprobar cierre', exact: true }).click();
  const review = page.getByRole('dialog');
  await expect(review.locator('.closing-comparison')).toContainText('Faltan 4 vasos');
  const charge = review.getByLabel('Valor del faltante a reportar al empleado', { exact: false });
  await expect(charge).toHaveValue('56.000');
  await review.getByRole('spinbutton', { name: 'Vasos · 12 oz', exact: false }).fill('17');
  await expect(charge).toHaveValue('42.000');
  await review.getByRole('spinbutton', { name: 'Vasos · 12 oz', exact: false }).fill('16');
  await charge.fill('10.000');
  await review.getByLabel('Reconfirmado · Cuenta de prueba', { exact: false }).fill('14.000');
  await review
    .getByLabel('Resultado de la revisión y motivo de las correcciones', { exact: false })
    .fill('Comprobantes verificados: total 14.000; cuatro vasos usados en exhibición.');
  await review
    .getByLabel('Verifiqué el efectivo entregado o reservado y los comprobantes de cada cuenta', {
      exact: false,
    })
    .check();
  await expect(
    review.locator('.closing-comparison').getByRole('row').filter({ hasText: 'Cuenta de prueba' }),
  ).toContainText('Coincide');
  await page.screenshot({ path: testInfo.outputPath('aprobacion-cierre.png'), fullPage: true });
  await review.getByRole('button', { name: 'Aprobar cierre y ajustar inventario', exact: true }).click();
  await expect(review).toHaveCount(0);
  const final = (await snapshot(request)).state;
  expect(final.shifts[0].closingReview.status).toBe('approved');
  expect(final.shifts[0].closingReview.employeeCharge).toBe(10000);
  expect(final.counts[0].payments[`transfer:${ids.location}`]).toBe(13000);
  expect(final.counts[1].payments[`transfer:${ids.location}`]).toBe(14000);
  expect(
    final.stock
      .filter((m: any) => m.article === `cup:${s.state.sizes[0].id}`)
      .reduce((n: number, m: any) => n + m.quantity, 0),
  ).toBe(16);
  await page.getByRole('button', { name: 'Registrar descuento', exact: true }).click();
  const deduction = page.getByRole('dialog', { name: 'Confirmar descuento de quincena' });
  await deduction.getByLabel('Valor descontado', { exact: false }).fill('4.000');
  await deduction.getByLabel('Confirmo que apliqué este descuento', { exact: false }).check();
  await deduction.getByRole('button', { name: 'Registrar descuento aplicado', exact: true }).click();
  await expect(deduction).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Ventas por mermas de empleado/ })).toContainText('4.000');
  await expect(page.getByRole('heading', { name: /Saldo pendiente actual/ })).toContainText('6.000');
  const afterRecovery = (await snapshot(request)).state;
  expect(afterRecovery.shifts[0].closingReview.recoveries[0].amount).toBe(4000);
  expect(afterRecovery.payments).toEqual(final.payments);
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
  expect(decodeGeneratedQr(Uint8ClampedArray.from(pixels.values), pixels.width, pixels.height)).toBe(
    coupons[0].code,
  );
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
