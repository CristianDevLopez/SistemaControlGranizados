import { enterVisibleClosing, submitCashDistribution } from '../support/visible-closing.ts';
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

test('muestra la foto de compra y reserva la aprobación a otro administrador', async ({
  page,
  browser,
  request,
}) => {
  await login(page, 'admin@test.invalid');
  await nav(page, 'Compras y gastos');
  await page.getByRole('button', { name: 'Compra y envío' }).click();
  const form = page.getByRole('dialog', { name: 'Registrar compra y envío' });
  await expect(form.getByRole('option', { name: /Bolsillo/ })).toHaveCount(0);
  await form.getByLabel('Proveedor').fill('Proveedor con soporte');
  await form.getByLabel('Pagado con (opcional)').selectOption('treasury');
  await form.getByLabel('Caja o cuenta que pagó').selectOption(ids.location);
  await form.getByRole('combobox', { name: 'Artículo', exact: true }).selectOption('coronita');
  await form.getByRole('textbox', { name: 'Costo unitario' }).fill('3.000');
  await form.locator('input[type=file]').setInputFiles('public/dexter.jpg');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(form).toHaveCount(0);
  const ownExpense = page.getByRole('row', { name: /Insumos · Proveedor con soporte/ });
  await expect(ownExpense.getByText(/distinto del custodio/)).toBeVisible();
  await expect(ownExpense.getByRole('button', { name: 'Aprobar', exact: true })).toHaveCount(0);
  const [{ id, evidenceId }] = (await snapshot(request)).state.expenses;
  const current = await snapshot(request);
  const response = await request.post('http://127.0.0.1:5180/dexter/commands', {
    headers,
    data: {
      commands: [
        cmd('approve_expense', { expenseId: id, approve: true }, admin, {
          at: new Date().toISOString(),
          branchId: current.branch.id,
          configVersion: current.state.settings[0].version,
        }),
      ],
    },
  });
  expect((await response.json()).results[0]).toMatchObject({ status: 'conflict', code: 'FORBIDDEN' });
  await expect
    .poll(
      async () =>
        (await snapshot(request)).state.attachments.find((photo: { id: string }) => photo.id === evidenceId)
          ?.status,
    )
    .toBe('uploaded');

  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const reviewer = await context.newPage();
    await login(reviewer, 'other@test.invalid');
    await nav(reviewer, 'Compras y gastos');
    await reviewer.route('**/test-files/**', (route) => route.abort(), { times: 1 });
    const expense = reviewer.getByRole('row', { name: /Insumos · Proveedor con soporte/ });
    await expense.getByRole('button', { name: 'Ver foto' }).click();
    const preview = reviewer.getByRole('dialog', { name: 'Foto de soporte' });
    await expect(preview.getByRole('alert')).toContainText('No se pudo mostrar la foto');
    await preview.getByRole('button', { name: 'Reintentar' }).click();
    await expect(preview.getByRole('img', { name: 'Foto de soporte' })).toBeVisible();
    await preview.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expense.getByRole('button', { name: 'Aprobar', exact: true }).click();
    await expect(expense.getByText('Aprobado', { exact: true })).toBeVisible();
    expect((await snapshot(request)).state.expenses).toEqual([
      expect.objectContaining({ id, status: 'approved', approvedBy: other.id }),
    ]);
  } finally {
    await context.close();
  }
});

test('registra un gasto administrativo fuera del turno que está abierto', async ({ page, request }) => {
  await login(page, 'admin@test.invalid');
  await nav(page, 'Compras y gastos');
  await page.getByRole('button', { name: 'Registrar gasto', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Registrar gasto pagado' });
  await expect(form.getByLabel('Pagado con')).toHaveValue('treasury');
  await expect(form.getByRole('option', { name: /Bolsillo/ })).toHaveCount(0);
  await expect(form.getByLabel('Turno a corregir')).toHaveCount(0);
  await form.getByLabel('Caja o cuenta que pagó').selectOption(ids.location);
  await form.getByLabel('Categoría').selectOption('Arriendo');
  await form.getByLabel('Monto pagado').fill('30.000');
  await form.getByLabel('Proveedor').fill('Arriendo de prueba');
  await form.getByLabel('Nota (obligatoria si no hay foto)', { exact: true }).fill('Pagado desde la cuenta');
  await form.getByRole('button', { name: 'Guardar' }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(async () => (await snapshot(request)).state.expenses.length).toBe(1);
  const { state } = await snapshot(request);
  expect(state.shifts[0].status).toBe('open');
  expect(state.expenses[0]).toMatchObject({ source: 'treasury', amount: 30000, locationId: ids.location });
  expect(state.expenses[0]).not.toHaveProperty('shiftId');
});

test('el encargado recibe un envío a ciegas y registra un traslado de caja en un paso', async ({
  page,
  request,
}) => {
  const shipment = await execute(request, 'create_shipment', {
    from: 'Medellín',
    supplier: 'Envío de Medellín',
    items: [{ article: 'coronita', quantity: 12, unitCost: 3000 }],
    notes: 'Detalle privado de compra',
  });
  await login(page, 'caja@test.invalid');
  await nav(page, 'Compras y gastos');
  const row = page.getByRole('row', { name: /Envío de Medellín/ });
  await expect(row).toContainText('Se cuenta antes de ver lo enviado');
  await expect(row).not.toContainText('Detalle privado de compra');
  await row.getByRole('button', { name: 'Recibir a ciegas' }).click();
  const receiving = page.getByRole('dialog');
  await receiving.getByLabel('Recibido Coronitas', { exact: true }).fill('5');
  await receiving.getByLabel('Dañado Coronitas', { exact: true }).fill('1');
  await receiving.locator('input[type=file]').setInputFiles('public/dexter.jpg');
  await receiving.getByRole('button', { name: 'Confirmar lo recibido' }).click();
  await expect(receiving).toHaveCount(0);
  let { state } = await snapshot(request);
  expect(state.shipments[0]).toMatchObject({ id: shipment.referenceId, status: 'partial' });
  expect(state.receipts[0]).toMatchObject({ differences: { coronita: -7 }, damaged: { coronita: 1 } });
  expect(state.stock.find((item: { reason: string }) => item.reason === 'receipt')?.quantity).toBe(4);

  await nav(page, 'Mi turno');
  await page.getByRole('button', { name: 'Registrar traslado' }).click();
  const movement = page.getByRole('dialog');
  await movement.getByLabel('Destino').selectOption(ids.location);
  await movement.getByLabel('Monto').fill('5.000');
  await movement.getByLabel('Concepto').fill('Consignación de prueba');
  await movement.getByLabel('Confirmo que entregué el efectivo').check();
  await movement.locator('input[type=file]').setInputFiles('public/dexter.jpg');
  await movement.getByRole('button', { name: 'Registrar entrega' }).click();
  await expect(movement).toHaveCount(0);
  await expect(page.getByText(/5\.000.*Ejecutado · pendiente de recepción/)).toBeVisible();
  ({ state } = await snapshot(request));
  expect(state.transfers).toMatchObject([{ executedBy: cashier.id, status: 'in_transit' }]);
  await execute(request, 'confirm_transfer', { transferId: state.transfers[0].id, receivedAmount: 5000 });
  ({ state } = await snapshot(request));
  expect(state.transfers).toMatchObject([{ amount: 5000, receivedAmount: 5000, status: 'confirmed' }]);
});

test('Mi turno muestra solo los cierres del día de Colombia', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-22T03:00:00Z'));
  await page.route('**/dexter/snapshot', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = await response.json();
    const current = body.state.shifts[0];
    for (const [key, closedAt, difference] of [
      ['anterior', '2026-11-21T04:59:00.000Z', -11000],
      ['hoy', '2026-11-22T02:00:00.000Z', -2000],
    ] as const) {
      const id = `turno-${key}`;
      const countId = `conteo-${key}`;
      body.state.shifts.push({
        ...current,
        id,
        closedAt,
        visibleClosing: true,
        status: 'closed',
        blindClosing: { status: 'review', countIds: [countId] },
        closingReview: { status: 'pending' },
      });
      body.state.counts.push({
        id: countId,
        shiftId: id,
        kind: 'closing',
        at: closedAt,
        items: {},
        difference,
      });
    }
    await route.fulfill({ response, json: body });
  });

  await login(page, 'caja@test.invalid');
  await nav(page, 'Mi turno');
  await expect(page.getByRole('heading', { name: /^Cierre ·/ })).toHaveCount(1);
  await expect(page.getByText(/Faltan .*2\.000 en efectivo/)).toBeVisible();
  await expect(page.getByText(/Faltan .*11\.000 en efectivo/)).toHaveCount(0);
  const turns = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Mis turnos de hoy' }) });
  await expect(turns.getByRole('row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Cerrar turno', exact: true })).toBeVisible();
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
  await nav(page, 'Revisiones');
  await page.getByRole('button', { name: /^Medios de pago ·/ }).click();
  const cards = page.locator('.request-card').filter({ hasText: 'Cambio de medio de pago' });
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
  await expect(page.getByRole('button', { name: /^Medios de pago · 2$/ })).toBeVisible();
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

test('recupera el timeout que bloqueaba la cola y registra la venta una sola vez', async ({
  page,
  request,
}) => {
  await login(page, 'caja@test.invalid');
  const { branch, state } = await snapshot(request);
  const orderId = crypto.randomUUID();
  const options = {
    at: new Date().toISOString(),
    branchId: branch.id,
    shiftId: state.shifts.find((shift: { status: string }) => shift.status === 'open').id,
    configVersion: state.settings[0].version,
  };
  const outage = cmd('outage', {}, cashier, { ...options, sequence: 11 });
  const order = cmd(
    'create_order',
    { orderId, lines: [{ flavorId: ids.flavor, sizeId: state.sizes[0].id, quantity: 1 }] },
    cashier,
    { ...options, sequence: 12 },
  );
  const pay = cmd('pay', { orderId, deliver: true }, cashier, { ...options, sequence: 13 });
  const commandControl = 'http://127.0.0.1:5180/test/commands';
  await request.post(commandControl, { data: { paused: true } });
  await page.clock.setFixedTime(new Date());
  await seedOutbox(page, [
    {
      ...pending(outage),
      status: 'conflict',
      result: {
        id: outage.id,
        status: 'conflict',
        code: '57014',
        message: 'canceling statement due to statement timeout',
      },
    },
    pending(order),
    pending(pay),
  ]);

  try {
    await page.reload();
    await page.getByRole('button', { name: 'Estado de sincronización' }).click();
    await expect(page.getByText('Operación 11')).toBeVisible();
    await expect(page.getByText('Por conciliar', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Reintentando la conexión con el servidor.', { exact: false })).toBeVisible();
    expect((await snapshot(request)).state.payments).toHaveLength(0);

    const prematureRetry = page.waitForRequest('**/dexter/commands', { timeout: 700 }).then(
      () => true,
      () => false,
    );
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect(await prematureRetry).toBe(false);
    expect(await (await request.get(commandControl)).json()).toEqual({ pausedCommandAttempts: 1 });
  } finally {
    await request.post(commandControl, { data: { paused: false } });
  }
  await page.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect(page.getByText('Todas tus operaciones están sincronizadas.')).toBeVisible();
  const synced = (await snapshot(request)).state;
  expect(synced.payments).toHaveLength(1);
  expect(synced.payments[0].eventId).toBe(pay.id);
  expect(synced.deliveries).toHaveLength(1);
  expect(synced.requests).toHaveLength(0);
});

test('se recupera de un fallo de red al volver a la app sin mostrar una desconexión', async ({ page }) => {
  await login(page, 'admin@test.invalid');
  let attempts = 0;
  await page.route('**/dexter/snapshot?since=*', async (route) => {
    attempts++;
    if (attempts === 1) await route.abort('failed');
    else await route.continue();
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const badge = page.getByRole('button', { name: 'Estado de sincronización' });
  await expect(badge).toContainText('Reconectando');
  await expect(page.getByText(/Sin conexión|No se puede sincronizar con el servidor/)).toHaveCount(0);
  await expect(badge).toContainText('Sincronizado');
  expect(attempts).toBeGreaterThanOrEqual(2);
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
  await expect(page.getByText('En revisión', { exact: true })).toBeVisible();
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

test('envía el conflicto y sus operaciones dependientes a revisión sin bloquear otro pedido', async ({
  page,
  request,
}) => {
  await login(page, 'caja@test.invalid');
  const s = await snapshot(request);
  const lines = [{ sizeId: s.state.sizes[0].id, flavorId: ids.flavor, quantity: 1 }];
  const first = await execute(request, 'create_order', { lines }, support);
  const order = (await snapshot(request)).state.orders[0];
  await execute(
    request,
    'update_order',
    { orderId: order.id, expectedVersion: 1, lines: [{ ...order.lines[0], quantity: 2 }] },
    support,
  );
  const second = await execute(request, 'create_order', { lines }, cashier);
  const opts = {
    at: new Date().toISOString(),
    branchId: s.branch.id,
    configVersion: s.state.settings[0].version,
  };
  const stale = cmd('update_order', { orderId: first.referenceId, expectedVersion: 1, lines }, cashier, {
    ...opts,
    sequence: 1119,
  });
  // This expected version matches the other device's edit, but the intended edit never landed.
  const dependent = cmd('pay', { orderId: first.referenceId, expectedVersion: 2 }, cashier, {
    ...opts,
    sequence: 1120,
  });
  const independent = cmd('pay', { orderId: second.referenceId, expectedVersion: 1 }, cashier, {
    ...opts,
    sequence: 1121,
  });
  const legacyConflict = await request.post('http://127.0.0.1:5180/dexter/commands', {
    headers: { ...headers, authorization: `Bearer ${cashier.id}`, 'x-device-id': cashier.deviceId },
    data: { commands: [stale] },
  });
  const { results } = await legacyConflict.json();
  expect(results[0]).toMatchObject({ code: 'ORDER_VERSION_CONFLICT', syncReview: true });
  const { syncReview: _syncReview, ...savedResult } = results[0];
  await seedOutbox(page, [
    { ...pending(stale), status: 'conflict', result: savedResult, message: savedResult.message },
    pending(dependent),
    pending(independent),
  ]);
  await page.getByRole('button', { name: 'Estado de sincronización' }).click();
  const synchronize = page.getByRole('button', { name: 'Sincronizar ahora' });
  await synchronize.click();
  await expect(page.getByText('En revisión', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('dialog').getByText(/después de un cambio que no se aplicó/)).toBeVisible();
  await expect(page.getByText('Operación 1121', { exact: true })).toHaveCount(0);
  await synchronize.click();
  const { state } = await snapshot(request);
  expect(state.requests).toHaveLength(2);
  for (const id of [stale.id, dependent.id])
    expect(state.requests).toContainEqual(expect.objectContaining({ id, type: 'sync', status: 'pending' }));
  expect(state.payments).toEqual([
    expect.objectContaining({ orderId: second.referenceId, eventId: independent.id }),
  ]);
  expect(state.orders.find((o: { id: string }) => o.id === first.referenceId)).toMatchObject({
    status: 'open',
    version: 2,
  });
  await execute(request, 'resolve_request', {
    requestId: stale.id,
    approve: false,
    resolutionNotes: 'Conservar la edición que ya figura en el pedido de apoyo.',
  });
  await synchronize.click();
  await expect(page.getByText('En revisión', { exact: true })).toHaveCount(1);
  expect((await snapshot(request)).state.payments).toHaveLength(1);
});

test('registra un gasto desde mostrador, conserva el borrador y permite aprobarlo', async ({
  page,
  browser,
  request,
}) => {
  const initial = (await snapshot(request)).state;
  const size = initial.sizes.find((item: { name: string }) => item.name === '16 oz');
  for (const [article, quantity] of [
    [`cup:${size.id}`, 5],
    [`package:${size.id}`, 4],
  ]) {
    const correction = await execute(request, 'correct_inventory', {
      article,
      quantity,
      notes: 'Inventario del ensayo',
    });
    await execute(request, 'resolve_change', { requestId: correction.referenceId, approve: true }, other);
  }
  await login(page, 'caja@test.invalid');
  await nav(page, 'Inventario');
  await page.getByRole('button', { name: 'Agregar paquetes', exact: true }).click();
  const packages = page.getByRole('dialog', { name: 'Agregar paquetes' });
  await packages.getByLabel('16 oz', { exact: true }).fill('3');
  await expect(packages.getByRole('checkbox')).toHaveCount(0);
  await packages.getByRole('button', { name: 'Agregar paquetes', exact: true }).click();
  await expect(packages).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Estado de sincronización' })).toContainText('Sincronizado');
  await nav(page, 'Mi turno');
  await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click();
  const closing = page.getByRole('dialog', { name: 'Cierre de caja', exact: true });
  await expect(closing.getByLabel('Efectivo', { exact: true })).toBeVisible();
  await expect(closing.getByRole('columnheader', { name: 'Debería haber' })).toHaveCount(0);
  await expect(closing.getByText('¿Se abrió un paquete sin registrar?')).toHaveCount(0);
  await closing.getByLabel('Vasos sueltos · 16 oz', { exact: true }).fill('65');
  await closing.getByLabel('Efectivo', { exact: true }).fill('10.000');
  await closing.getByRole('button', { name: 'Guardar borrador y salir' }).click();
  await expect(page.getByRole('button', { name: 'Registrar gasto', exact: true })).toBeVisible();
  await nav(page, 'Mostrador');
  await page.getByRole('button', { name: 'Registrar gasto', exact: true }).click();
  const expense = page.getByRole('dialog', { name: 'Registrar gasto' });
  await expense.getByLabel('Categoría').selectOption('Insumos');
  await expense.getByLabel('Monto pagado').fill('10.000');
  await expense.getByLabel('Proveedor').fill('Proveedor de prueba');
  await expense.getByLabel('Nota (obligatoria si no hay foto)', { exact: true }).fill('Insumos del turno');
  await expense.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(expense).toHaveCount(0);
  await expect(page.getByText('Gasto enviado a aprobación.')).toBeVisible();
  const [registered] = (await snapshot(request)).state.expenses;
  expect(registered).toMatchObject({ by: cashier.id, amount: 10000, source: 'cash', status: 'pending' });
  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const reviewer = await context.newPage();
    await login(reviewer, 'admin@test.invalid');
    await nav(reviewer, 'Revisiones');
    await reviewer.getByRole('button', { name: 'Gastos · 1', exact: true }).click();
    await reviewer.getByRole('button', { name: 'Aprobar', exact: true }).click();
    await expect(reviewer.getByRole('button', { name: 'Gastos · 0', exact: true })).toBeVisible();
    expect((await snapshot(request)).state.expenses).toEqual([
      expect.objectContaining({ id: registered.id, status: 'approved', approvedBy: admin.id }),
    ]);
  } finally {
    await context.close();
  }
  await nav(page, 'Mi turno');
  await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click();
  await expect(closing.getByLabel('Vasos sueltos · 16 oz', { exact: true })).toHaveValue('65');
  await expect(closing.getByLabel('Efectivo', { exact: true })).toHaveValue('10.000');
  for (const input of await closing.getByRole('spinbutton').all()) {
    const name = await input.getAttribute('aria-label');
    await input.fill(
      name === 'Vasos sueltos · 16 oz' ? '85' : name === 'Paquetes cerrados · 16 oz' ? '1' : '0',
    );
  }
  await closing.getByRole('button', { name: 'Enviar primer conteo' }).click();
  const recount = page.getByRole('dialog', { name: 'Cierre de caja · Segundo conteo' });
  const cups = recount.getByRole('row').filter({ hasText: 'Vasos sueltos · 16 oz' });
  const cash = recount.getByRole('row', { name: /^Efectivo/ });
  await expect(cups.getByRole('cell').last()).toHaveText('65');
  await expect(cash.getByRole('cell').last()).toContainText('10.000');
  await expect(recount.getByText('¿Se abrió un paquete sin registrar?')).toBeVisible();
  await recount.getByRole('button', { name: 'Agregar paquetes', exact: true }).click();
  await expect(packages.getByLabel('16 oz', { exact: true })).toHaveValue('1');
  await packages.getByRole('button', { name: 'Agregar paquetes', exact: true }).click();
  await expect(packages).toHaveCount(0);
  await expect(cups.getByRole('cell').last()).toHaveText('85');
  await expect(recount.getByText('¿Se abrió un paquete sin registrar?')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const seller of [support, admin])
  test(`${seller.role} prepara, envía a caja y el pedido se cobra una sola vez`, async ({
    page,
    browser,
    request,
  }) => {
    await login(page, seller.role === 'apoyo' ? 'support@test.invalid' : 'admin@test.invalid');
    await nav(page, 'Mostrador');
    const filter = page.getByRole('group', { name: 'Filtrar sabores por licor' });
    await filter.getByRole('button', { name: 'Sin licor', exact: true }).click();
    await expect(page.locator('.flavor-card')).toHaveCount(1);
    await expect(page.locator('.flavor-card')).toContainText('sin licor');
    await filter.getByRole('button', { name: 'Con licor', exact: true }).click();
    await page.getByLabel('Nombre del pedido (opcional)').fill('  María  ');
    await page.locator('.flavor-card').click();
    await expect(page.getByRole('heading', { name: /^Pedido #.* · María$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cobrar y entregar', exact: true })).toHaveCount(0);
    const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    try {
      const cash = await context.newPage();
      await login(cash, 'caja@test.invalid');
      await nav(cash, 'Mostrador');
      await cash.getByRole('button', { name: 'Ver pedidos abiertos', exact: true }).click();
      const incoming = cash.locator('.open-order-picker button').filter({ hasText: seller.name });
      await expect(cash.getByText('No hay pedidos abiertos.', { exact: true })).toBeVisible();
      await expect(incoming).toHaveCount(0);
      await page.getByRole('button', { name: 'Enviar a caja', exact: true }).click();
      await expect(page.getByText('Pedido disponible en el equipo de caja.', { exact: true })).toBeVisible();
      await expect(incoming).toContainText('María');
      await incoming.click();
      await expect(cash.locator('.cart-meta')).toContainText(seller.name);
      const name = cash.getByLabel('Nombre del pedido (opcional)');
      await name.fill('');
      await cash.getByRole('button', { name: 'Guardar nombre', exact: true }).click();
      await expect(cash.getByRole('heading', { name: /^Pedido #[A-Z0-9]+$/ })).toBeVisible();
      await name.fill('María González');
      await cash.getByRole('button', { name: 'Guardar nombre', exact: true }).click();
      await expect(cash.getByRole('heading', { name: /^Pedido #.* · María González$/ })).toBeVisible();
      await cash.getByRole('button', { name: 'Aumentar cantidad', exact: true }).click();
      await expect(cash.locator('.cart-total')).toContainText('28.000');
      await cash.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
      await expect(cash.getByText(/Venta registrada/)).toBeVisible();
      const { state } = await snapshot(request);
      expect(state.payments).toEqual([expect.objectContaining({ amount: 28000 })]);
      expect(state.orders).toEqual([
        expect.objectContaining({ customerName: 'María González', total: 28000, status: 'paid' }),
      ]);
      await nav(cash, 'Pedidos');
      await cash.getByRole('button', { name: 'Cobrados', exact: true }).click();
      await cash.getByLabel('Buscar pedido').fill('gonzález');
      await expect(cash.getByRole('button', { name: /^#.* · María González$/ })).toBeVisible();
    } finally {
      await context.close();
    }
  });

test('un encargado en equipo secundario toma pedidos y la caja principal los cobra', async ({
  page,
  request,
  browser,
}) => {
  const change = await execute(request, 'change_access', {
    kind: 'user',
    targetId: support.id,
    role: 'encargado',
  });
  await execute(request, 'resolve_change', { requestId: change.referenceId, approve: true }, other);

  await login(page, 'support@test.invalid');
  await nav(page, 'Mostrador');
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Inventario' })).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Mi turno' })).toHaveCount(0);
  await page.locator('.flavor-card').filter({ hasText: 'Sabor de prueba con licor' }).click();
  await page.getByRole('button', { name: 'Aumentar cantidad', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cobrar y entregar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /entregados/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Enviar a caja', exact: true }).click();
  await expect(page.getByText('Pedido disponible en el equipo de caja.', { exact: true })).toBeVisible();

  const sent = await snapshot(request);
  const [order] = sent.state.orders;
  expect(order).toMatchObject({ status: 'open', sellerId: support.id, total: 28000 });
  expect(sent.state.payments).toHaveLength(0);
  for (const type of ['pay', 'expense', 'open_package', 'deliver'] as const) {
    const command = cmd(type, { orderId: order.id }, support, {
      at: new Date().toISOString(),
      branchId: sent.branch.id,
      shiftId: order.shiftId,
      configVersion: sent.state.settings[0].version,
    });
    const response = await request.post('http://127.0.0.1:5180/dexter/commands', {
      headers: { ...headers, authorization: `Bearer ${support.id}`, 'x-device-id': support.deviceId },
      data: { commands: [command] },
    });
    expect((await response.json()).results[0]).toMatchObject({ status: 'conflict', code: 'FORBIDDEN' });
  }

  const context = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const cash = await context.newPage();
    await login(cash, 'caja@test.invalid');
    await nav(cash, 'Mostrador');
    await cash.getByRole('button', { name: 'Ver pedidos abiertos', exact: true }).click();
    await cash.locator('.open-order-picker button').filter({ hasText: support.name }).click();
    await cash.getByRole('button', { name: 'Cobrar y entregar', exact: true }).click();
    await expect(cash.getByText(/Venta registrada/)).toBeVisible();
    await expect.poll(async () => (await snapshot(request)).state.payments[0]?.amount).toBe(28000);
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
    await cash.getByRole('button', { name: 'Agregar paquetes', exact: true }).click();
    const inventory = cash.getByRole('dialog');
    await inventory.getByLabel('16 oz', { exact: true }).fill('1');
    await inventory.getByRole('button', { name: 'Agregar paquetes', exact: true }).click();
    await expect(inventory).toHaveCount(0);
    await nav(cash, 'Mi turno');
    await cash.getByRole('button', { name: 'Cerrar turno', exact: true }).click();
    await enterVisibleClosing(
      cash,
      '20.000',
      { 'Cuenta de prueba': '14.000' },
      { 'Vasos sueltos · 16 oz': '19' },
    );
    await submitCashDistribution(cash, '20.000');
    await expect(cash.getByRole('navigation').getByRole('button', { name: 'Compras y gastos' })).toHaveCount(
      0,
    );
  } finally {
    await context.close();
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hagamos un gran día.' })).toBeVisible();
  await nav(page, 'Revisiones');
  await page.getByRole('button', { name: /^Medios de pago · 1$/ }).click();
  await page.getByRole('button', { name: 'Confirmar transferencia', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Medios de pago · 0$/ })).toBeVisible();
  await page.getByRole('button', { name: /^Caja ·/ }).click();
  await page.getByRole('button', { name: 'Revisar turno', exact: true }).click();
  const review = page.getByRole('dialog');
  await expect(review).toContainText('Verificada por');
  await expect(review.getByRole('columnheader', { name: 'Corrección del admin' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('revision-cierre.png'), fullPage: true });
  await review.getByRole('button', { name: 'Confirmar sin ajustar inventario', exact: true }).click();
  await expect(review).toContainText('Inventario por verificar');
  const final = (await snapshot(request)).state;
  expect(final.shifts[0].closingReview.inventoryVerification.status).toBe('pending');
});

test('ofrece dos promociones excluyentes y guarda el descuento en Pedidos', async ({ page, request }) => {
  for (const config of [
    { name: 'Promoción 3x2', effect: 'nxm', take: 3, pay: 2, checkoutText: 'Verifica que sigue a Dexter’s.' },
    {
      name: 'Subir un tamaño',
      effect: 'upgrade',
      steps: 1,
      checkoutText: 'Confirma el tamaño con el cliente.',
    },
  ]) {
    const proposed = await execute(request, 'save_promotion', {
      ...config,
      delivery: 'schedule',
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 600000).toISOString(),
    });
    await execute(request, 'resolve_change', { requestId: proposed.referenceId, approve: true }, other);
  }
  await login(page, 'caja@test.invalid');
  await nav(page, 'Mostrador');
  await page.getByRole('button', { name: 'Medio 16 onzas', exact: true }).click();
  await page.locator('.flavor-card').filter({ hasText: 'Sabor de prueba con licor' }).click();
  const add = page.getByRole('button', { name: 'Aumentar cantidad', exact: true });
  await add.click();
  await add.click();
  await page.getByRole('button', { name: 'Revisar cobro', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const three = dialog.getByRole('checkbox', { name: /Promoción 3x2/ });
  const upgrade = dialog.getByRole('checkbox', { name: /Subir un tamaño/ });
  const total = dialog.locator('.checkout-amount strong');
  await expect(three).not.toBeChecked();
  await expect(upgrade).not.toBeChecked();
  await expect(total).toContainText('51.000');
  await three.click();
  await expect(total).toContainText('34.000');
  await upgrade.click();
  await expect(total).toContainText('42.000');
  await expect(three).not.toBeChecked();
  await expect(upgrade).toBeChecked();
  await dialog.getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await nav(page, 'Pedidos');
  await page.getByLabel('Filtrar por promoción').selectOption({ label: 'Con promoción' });
  await expect(page.getByRole('row').filter({ hasText: 'Descuento' })).toContainText('9.000');
});

test('cobra 43.000 por cuatro vasos cuando el tercero más caro es el regalo del 3x2', async ({
  page,
  request,
}) => {
  const proposed = await execute(request, 'save_promotion', {
    name: 'Promoción 3x2',
    effect: 'nxm',
    take: 3,
    pay: 2,
    delivery: 'schedule',
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 600000).toISOString(),
  });
  await execute(request, 'resolve_change', { requestId: proposed.referenceId, approve: true }, other);

  await login(page, 'caja@test.invalid');
  await nav(page, 'Mostrador');
  const withAlcohol = page.locator('.flavor-card').filter({ hasText: 'Sabor de prueba con licor' });
  await page.getByRole('button', { name: 'Mini 12 onzas', exact: true }).click();
  await withAlcohol.click();
  await page.getByRole('button', { name: 'Aumentar cantidad', exact: true }).click();
  await page.getByRole('button', { name: 'Medio 16 onzas', exact: true }).click();
  await page.locator('.flavor-card').filter({ hasText: 'Sabor de prueba sin licor' }).click();
  await withAlcohol.click();

  await page.getByRole('button', { name: 'Revisar cobro', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const total = dialog.locator('.checkout-amount strong');
  await expect(total).toContainText('57.000');
  await dialog.getByRole('checkbox', { name: 'Promoción 3x2' }).click();
  await expect(total).toContainText('43.000');
  await dialog.getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const { state } = await snapshot(request);
  expect(state.payments[0].amount).toBe(43000);
  expect(state.orders[0].lines).toMatchObject([
    { listPrice: 14000, quantity: 2, discount: 14000 },
    { listPrice: 12000, quantity: 1, discount: 0 },
    { listPrice: 17000, quantity: 1, discount: 0 },
  ]);
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
    await expect(cash.getByRole('button', { name: 'Estado de sincronización' })).toContainText(
      'Sincronizado',
    );
    await cash.getByRole('button', { name: 'Redimir cupón, cortesía o promoción', exact: true }).click();
    const checkout = cash.getByRole('dialog', { name: /^Cobrar pedido/ });
    for (const coupon of coupons) {
      const input = checkout.getByPlaceholder('Escribir código', { exact: true });
      await input.fill(coupon.code);
      await checkout.getByRole('button', { name: 'Validar', exact: true }).click();
      await expect(checkout.locator('.coupon-tags')).toContainText(coupon.code);
      await expect(input).toHaveValue('');
    }
    await expect(checkout).toContainText('Sin canjear:');
    await expect(checkout.locator('.checkout-amount')).toContainText(/\$\s*0/);
    await expect(checkout.getByLabel('Efectivo recibido', { exact: false })).toHaveCount(0);
    await checkout.getByRole('button', { name: 'Registrar cortesía y entregar', exact: true }).click();
    await expect(checkout).toHaveCount(0);
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
