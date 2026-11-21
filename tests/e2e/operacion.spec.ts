import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { decodeGeneratedQr } from '../support/qr.ts';
import { admin, cashier, other, support, cmd, ids } from '../support/fixture.ts';
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
    shiftId: s.state.shifts.find((shift: any) => shift.status === 'open')?.id,
    configVersion: s.state.settings[0].version,
  });
  const response = await request.post('http://127.0.0.1:5180/dexter/commands', {
    headers: { ...headers, authorization: `Bearer ${actor.id}`, 'x-device-id': actor.deviceId },
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

test('resuelve los cambios de pago de dos ventas desde Solicitudes', async ({ page, request, browser }) => {
  for (const notes of ['Se pagó a la cuenta', 'Segundo pago por transferencia']) {
    const created = await execute(
      request,
      'create_order',
      {
        lines: [{ sizeId: '00000000-0000-4000-8000-000000000012', flavorId: ids.flavor, quantity: 1 }],
      },
      cashier,
    );
    await execute(request, 'pay', { orderId: created.referenceId, deliver: true }, cashier);
    await execute(request, 'request_payment_change', { orderId: created.referenceId, notes }, cashier);
  }
  await login(page, 'admin@test.invalid');
  await nav(page, 'Solicitudes');
  await page.getByLabel('Tipo de solicitud').selectOption('payments');
  const cards = page.locator('.request-card');
  await expect(cards).toHaveCount(2);
  for (let remaining = 2; remaining > 0; remaining--) {
    const card = cards.first();
    await expect(card).toContainText('Pago actual · Efectivo');
    await card.getByRole('button', { name: 'Aplicar cambio' }).click();
    const form = page.getByRole('dialog', { name: 'Aplicar cambio de medio de pago' });
    await form.getByLabel('Medio de pago correcto').selectOption(`transfer:${ids.location}`);
    await form.getByLabel('Motivo').fill('Se verificó el comprobante.');
    await form.getByRole('button', { name: 'Guardar' }).click();
    await expect(cards).toHaveCount(remaining - 1);
  }
  await expect(page.getByText('Sin solicitudes pendientes', { exact: true })).toBeVisible();
  await page.getByLabel('Estado de la solicitud').selectOption('all');
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    await expect(card).toContainText('Aprobado');
    await expect(card).toContainText('Pago actual · Cuenta de prueba');
  }
  const counter = await browser.newPage({ viewport: page.viewportSize() });
  try {
    await login(counter, 'caja@test.invalid');
    await nav(counter, 'Solicitudes');
    const sent = counter.locator('.request-card');
    await expect(sent).toHaveCount(2);
    for (const card of await sent.all()) {
      await expect(card).toContainText('Aprobado');
      await expect(card).toContainText(/Pedido #/);
    }
  } finally {
    await counter.close();
  }
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

test('el empleado registra paquetes desde Inventario sin recibir avisos de saldo', async ({
  page,
  request,
}) => {
  await login(page, 'caja@test.invalid');
  const openPackage = async () => {
    await nav(page, 'Inventario');
    await page.getByRole('button', { name: 'Abrir paquete de vasos', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Unidades del paquete', { exact: false })).toHaveCount(0);
    await dialog.getByRole('combobox').selectOption({ label: '12 oz' });
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  await openPackage();
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
  await expect(page.getByRole('button', { name: 'Registrar apertura de paquete', exact: true })).toHaveCount(
    0,
  );
  await openPackage();
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

test('admin aprueba permisos y revisa diferencias ciegas y transferencias', async ({
  page,
  request,
  browser,
}, testInfo) => {
  test.setTimeout(75_000);
  await login(page, 'admin@test.invalid');
  await nav(page, 'Configuración');
  await page.getByRole('button', { name: 'Equipo y accesos', exact: true }).click();
  await expect(page.getByText('Guía de perfiles y permisos', { exact: true })).toBeVisible();
  await page
    .getByRole('row')
    .filter({ hasText: support.name })
    .getByRole('button', { name: 'Proponer permisos', exact: true })
    .click();
  await page.getByRole('dialog').getByLabel('Crear y editar pedidos', { exact: true }).uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Enviar propuesta', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const waiting = await snapshot(request);
  expect(waiting.profiles.find((p: any) => p.id === support.id).permissions.orders).toBeUndefined();
  const permission = waiting.state.requests.find(
    (r: any) => r.type === 'change' && r.change.access === 'user',
  );
  await execute(request, 'resolve_change', { requestId: permission.id, approve: true }, other);
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
    await nav(cash, 'Inventario');
    await cash.getByRole('button', { name: 'Abrir paquete de vasos', exact: true }).click();
    const inventory = cash.getByRole('dialog');
    await inventory.getByRole('combobox').selectOption({ label: '16 oz' });
    await inventory.getByRole('checkbox').check();
    await inventory.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(inventory).toHaveCount(0);
    await nav(cash, 'Mi turno');
    await cash.getByRole('button', { name: 'Cerrar turno', exact: true }).click();
    for (const attempt of [1, 2]) {
      if (attempt === 2) await cash.getByRole('button', { name: 'Volver a contar el cierre' }).click();
      const dialog = cash.getByRole('dialog');
      await dialog.getByLabel('Efectivo contado *', { exact: true }).fill('37.000');
      for (const input of await dialog.getByRole('spinbutton').all()) await input.fill('0');
      await dialog.getByRole('spinbutton', { name: 'Vasos · 16 oz', exact: true }).fill('19');
      await expect(dialog).not.toContainText(/Esperado|Transferencias verificadas/);
      await dialog.getByRole('button', { name: 'Enviar conteo', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    await expect(cash.getByRole('table')).toContainText('En revisión');
    await expect(cash.getByRole('navigation').getByRole('button', { name: 'Compras y gastos' })).toHaveCount(
      0,
    );
  } finally {
    await context.close();
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await nav(page, 'Revisar turnos');
  await page.getByRole('button', { name: /^Ver turno/ }).click();
  const review = page.getByRole('dialog');
  await expect(review.getByText('Posible venta sin registrar · 16 oz.', { exact: true })).toBeVisible();
  await expect(review.locator('summary').filter({ hasText: 'Cierre' })).toHaveCount(2);
  await expect(review).toContainText('Cuenta de prueba');
  await review.getByRole('button', { name: /^Marcar verificada/ }).click();
  await expect(review).toContainText('Verificada por');
  await page.screenshot({ path: testInfo.outputPath('revision-cierre.png'), fullPage: true });
  await review.getByRole('button', { name: /^Cerrar diferencia/ }).click();
  const resolution = page.getByRole('dialog', { name: 'Cerrar diferencia', exact: true });
  await resolution.getByRole('combobox').selectOption('surplus');
  await resolution.getByRole('textbox').fill('Revisamos los dos conteos y los comprobantes.');
  await resolution.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(resolution).toHaveCount(0);
  const final = (await snapshot(request)).state;
  expect(final.shifts[0].operationsReview.resolution.outcome).toBe('surplus');
  expect(final.counts).toHaveLength(2);
  expect(final.counts[1].difference).toBe(17000);
});

test('confirma manualmente el 3x2 desde el cobro de mostrador', async ({ page, request }) => {
  const proposed = await execute(request, 'save_promotion', {
    name: 'Promoción 3x2',
    effect: 'nxm',
    delivery: 'schedule',
    take: 3,
    pay: 2,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 600000).toISOString(),
  });
  await execute(request, 'resolve_change', { requestId: proposed.referenceId, approve: true }, other);
  await login(page, 'caja@test.invalid');
  await nav(page, 'Mostrador');
  await expect(page.getByText('Hay promoción de 3x2.', { exact: true })).toBeVisible();
  await page.locator('.flavor-card').filter({ hasText: 'Sabor de prueba con licor' }).click();
  const add = page.getByRole('button', { name: 'Aumentar cantidad', exact: true });
  await add.click();
  await add.click();
  await page.getByRole('button', { name: 'Revisar cobro', exact: true }).click();
  const dialog = page.getByRole('dialog'),
    checkbox = dialog.getByRole('checkbox', { name: 'Aplicar descuento 3x2' }),
    total = dialog.locator('.checkout-amount strong'),
    fullPrice = await total.textContent();
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(total).not.toHaveText(fullPrice!);
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(total).toHaveText(fullPrice!);
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(total).not.toHaveText(fullPrice!);
  await dialog.getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const { state } = await snapshot(request);
  expect(state.payments[0].amount).toBe(28000);
  expect(state.promotions[0].redemptions).toBe(1);
});

test('comparte un QR legible y canjea dos de tres cortesías sin consumir la sobrante', async ({
  page,
  browser,
  request,
}) => {
  await request.post('http://127.0.0.1:5180/reset');
  const s = await snapshot(request);
  const proposed = await execute(request, 'save_promotion', {
    name: 'Granizado de cortesía',
    effect: 'free',
    delivery: 'coupon',
    sizeIds: [s.state.sizes[0].id],
    flavorIds: [ids.flavor],
    stackable: true,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2027-12-01T00:00:00Z',
  });
  const promotion = await execute(
    request,
    'resolve_change',
    { requestId: proposed.referenceId, approve: true },
    other,
  );
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
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  const cash = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  try {
    await login(cash, 'caja@test.invalid');
    await nav(cash, 'Mostrador');
    await cash.locator('.flavor-card').filter({ hasText: 'Sabor de prueba con licor' }).click();
    await cash.getByRole('button', { name: 'Aumentar cantidad', exact: true }).click();
    await cash.getByRole('button', { name: 'Redimir cupón, cortesía o promoción', exact: true }).click();
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
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
    await nav(page, 'Pedidos');
    await page.getByRole('button', { name: 'Cobrados', exact: true }).click();
    await page.locator('table .text-button.strong').first().click();
    for (const coupon of final.coupons.filter((c: any) => c.status === 'redeemed'))
      await expect(page.getByRole('dialog')).toContainText(coupon.code);
  } finally {
    await cash.close();
  }
});
