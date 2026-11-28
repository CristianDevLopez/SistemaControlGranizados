import { expect, it } from 'vitest';
import { closingPreview, countArticles, stockBalances, redactState } from '../src/domain/engine.ts';
import { eligible, quoteOrder } from '../src/domain/pricing.ts';
import { logistics, defaultCandies } from '../src/domain/v4-catalog.ts';
import { fixture, admin, other, cashier, support, ids, NOW, run, order } from './support/fixture.ts';
import type { State } from '../src/domain/types.ts';
const ready = () => {
  const s = fixture();
  s.settings[0].v4Enabled = true;
  s.settings[0].v4 = { candies: structuredClone(defaultCandies) };
  return s;
};
function close(s: State, differences: Record<string, number> = {}, cashDifference = 0) {
  const preview = closingPreview(s, ids.shift);
  return run(s, 'count', {
    kind: 'closing',
    closingCountMode: s.shifts[0].closingCountMode,
    shiftId: ids.shift,
    cash: preview.expectedCash + cashDifference,
    retained: preview.expectedCash + cashDifference,
    items: Object.fromEntries(
      countArticles(s, 'closing', s.shifts[0]).map((a) => [
        a.id,
        (preview.expectedItems[a.id] ?? 0) + (differences[a.id] ?? 0),
      ]),
    ),
    payments: preview.expectedPayments,
    preview,
  }).state;
}
it('una apertura explica 20 vasos y un paquete sin cambiar lo contado; rechazar preserva movimientos posteriores', () => {
  let s = ready();
  const size = s.sizes[0],
    cup = 'cup:' + size.id,
    pack = 'package:' + size.id;
  s.shifts[0].closingCountMode = 'full';
  s.stock = [
    {
      id: crypto.randomUUID(),
      article: cup,
      quantity: 100,
      reason: 'initial',
      referenceId: ids.shift,
      at: NOW,
      by: admin.id,
      eventId: crypto.randomUUID(),
    },
    {
      id: crypto.randomUUID(),
      article: pack,
      quantity: 2,
      reason: 'initial',
      referenceId: ids.shift,
      at: NOW,
      by: admin.id,
      eventId: crypto.randomUUID(),
    },
  ];
  s = close(s, { [cup]: 20, [pack]: -1 });
  const before = stockBalances(s);
  s = run(
    s,
    'v4',
    {
      action: 'closing_proposal',
      shiftId: ids.shift,
      notes: 'Apertura omitida',
      corrections: [{ kind: 'opening_add', article: pack, at: NOW, notes: 'Abrimos el paquete' }],
    },
    admin,
  ).state;
  expect(stockBalances(s)).toMatchObject(before);
  expect(s.shifts[0].v4Reviews?.[0]).toMatchObject({
    status: 'pending',
    count: { differences: { [cup]: 0, [pack]: 0 } },
  });
  s.stock.push({
    id: crypto.randomUUID(),
    article: cup,
    quantity: -1,
    reason: 'delivery',
    referenceId: ids.shift,
    at: NOW,
    by: cashier.id,
    eventId: crypto.randomUUID(),
  });
  s = run(
    s,
    'v4',
    { action: 'closing_resolve', shiftId: ids.shift, approve: false, notes: 'Hace falta verificar' },
    other,
  ).state;
  expect(stockBalances(s)[cup]).toBe(before[cup] - 1);
  expect(s.shifts[0].closingReview?.status).toBe('pending');
  s = run(
    s,
    'v4',
    {
      action: 'closing_proposal',
      shiftId: ids.shift,
      notes: 'Verificado nuevamente',
      corrections: [{ kind: 'opening_add', article: pack, at: NOW, notes: 'Verificado en cámaras' }],
    },
    other,
  ).state;
  s = run(
    s,
    'v4',
    { action: 'closing_resolve', shiftId: ids.shift, approve: true, notes: 'Conforme' },
    admin,
  ).state;
  expect(s.shifts[0].v4Reviews?.map((r) => r.status)).toEqual(['rejected', 'approved']);
  expect(stockBalances(s)[cup]).toBe(before[cup] - 1);
});
it('venta de 24 oz y Todos los dulces descuentan las recetas configuradas', () => {
  let s = ready();
  const created = order(s, 1, ids.flavor, 3);
  s = created.state;
  const id = created.order.id;
  s = run(s, 'update_order', {
    orderId: id,
    lines: s.orders[0].lines,
    additions: [{ id: 'todos', quantity: 1 }],
  }).state;
  s = run(s, 'pay', { orderId: id, deliver: true }).state;
  const b = stockBalances(s);
  expect(b['supply:minichicles']).toBe(-3);
  expect(b['supply:gomas-gusanitos']).toBe(-5);
  expect(b['supply:cintas']).toBe(-2);
  expect(b['supply:bombones']).toBe(-2);
});
it('recibe sin turno, revisa daños y faltantes y permite corregir dañados a buenos', () => {
  let s = ready();
  s.shifts = [];
  s.attachments[0].status = 'uploaded';
  const cup = 'cup:' + s.sizes[1].id;
  const shipment = run(
    s,
    'create_shipment',
    { from: 'Medellín', supplier: 'Proveedor', items: [{ article: cup, quantity: 1000, unitCost: 100 }] },
    admin,
  );
  s = shipment.state;
  s = run(
    s,
    'v4',
    {
      action: 'receive',
      shipmentId: shipment.result.referenceId,
      lines: { [cup]: { good: 980, damaged: 10, photos: [ids.photo], missing: 'lost' } },
      notes: 'Diez vasos no llegaron',
    },
    cashier,
  ).state;
  expect(stockBalances(s)[cup]).toBe(980);
  const receipt = s.receipts[0];
  s = run(
    s,
    'v4',
    {
      action: 'review_receipt',
      receiptId: receipt.id,
      article: cup,
      good: 4,
      notes: 'Cuatro vasos están buenos',
    },
    admin,
  ).state;
  expect(stockBalances(s)[cup]).toBe(984);
  expect(s.requests.find((r) => r.merma)?.merma).toMatchObject({
    type: 'Transporte',
    quantity: 16,
    unitCost: 100,
  });
  expect(() =>
    run(
      s,
      'v4',
      { action: 'review_receipt', receiptId: receipt.id, article: cup, good: 0, notes: 'Repetido' },
      other,
    ),
  ).toThrow(/revisó/);
});
it('el empleado ve cantidades de envíos sin costos y sin turno', () => {
  let s = ready();
  s.shifts = [];
  s = run(
    s,
    'create_shipment',
    {
      from: 'Medellín',
      supplier: 'Proveedor',
      items: [{ article: 'coronita', quantity: 10, unitCost: 5000 }],
    },
    admin,
  ).state;
  const safe = redactState(s, support);
  expect(safe.shipments[0].items).toEqual([{ article: 'coronita', quantity: 10, unitCost: 0 }]);
  expect(safe.stock).toEqual([]);
  expect(safe.expenses).toEqual([]);
});
it('Versus acepta las mezclas del cliente y aplica automáticamente cuando se deja vacía la verificación', () => {
  const s = ready(),
    a = ids.flavor,
    b = ids.plain;
  s.flavors.push({ id: '30000000-0000-4000-8000-000000000003', name: 'Otro', alcohol: false, active: true });
  const promo = {
    id: '70000000-0000-4000-8000-000000000001',
    name: 'Versus',
    effect: 'upgrade' as const,
    steps: 1,
    delivery: 'schedule' as const,
    sizeIds: [],
    flavorIds: [],
    alcohol: 'all' as const,
    versus: { a, b },
    startsAt: '2020-01-01T00:00:00Z',
    endsAt: '2099-01-01T00:00:00Z',
    days: [],
    startTime: '00:00',
    endTime: '23:59',
    maxRedemptions: null,
    redemptions: 0,
    active: true,
    version: 1,
    by: admin.id,
    at: NOW,
    checkoutText: '',
  };
  s.promotions = [promo];
  const line = order(s, 1, ids.flavor, 1).order.lines[0];
  expect(eligible(promo, { ...line, flavorIds: [a, b, s.flavors[2].id] }, s)).toBe(true);
  expect(eligible(promo, { ...line, flavorIds: [a, s.flavors[2].id, ids.photo] }, s)).toBe(false);
  expect(quoteOrder(s, [line], NOW, true).total).toBe(s.sizes[0].alcoholPrice);
});
it('reparte un flete una sola vez en proporción al valor recibido', () => {
  const s = ready();
  s.shipments = ['a', 'b'].map((id) => ({
    id,
    by: admin.id,
    from: 'Medellín',
    supplier: 'Proveedor',
    items: [{ article: 'coronita', quantity: 10, unitCost: 100 }],
    at: NOW,
    status: 'received',
    notes: '',
  }));
  s.receipts = ['a', 'b'].map((id, i) => ({
    id,
    shipmentId: id,
    by: cashier.id,
    at: NOW,
    items: { coronita: i ? 3 : 1 },
    damaged: {},
    evidenceId: '',
    notes: '',
  }));
  s.expenses = [
    {
      id: 'flete',
      by: admin.id,
      at: NOW,
      category: 'Flete',
      amount: 80000,
      source: 'personal',
      supplier: 'Transportador',
      notes: '',
      status: 'approved',
      classification: { name: 'Flete', group: 'Logística', nature: 'Costo', behavior: 'Variable' },
      shipmentIds: ['a', 'b'],
    },
  ];
  expect([...logistics(s).allocations]).toEqual([
    ['a', 20000],
    ['b', 60000],
  ]);
});

it('la venta Bomba explica el vaso y el efectivo y su rechazo revierte también los dulces', () => {
  let s = ready();
  const cup = 'cup:' + s.sizes[0].id;
  s.stock.push({
    id: crypto.randomUUID(),
    article: cup,
    quantity: 100,
    reason: 'initial',
    referenceId: ids.shift,
    at: NOW,
    by: admin.id,
    eventId: crypto.randomUUID(),
  });
  s = close(s, { [cup]: -1 }, 14000);
  const baseline = stockBalances(s);
  s = run(
    s,
    'v4',
    {
      action: 'closing_proposal',
      shiftId: ids.shift,
      notes: 'Venta sin registrar',
      corrections: [
        {
          kind: 'sale_add',
          sizeId: s.sizes[0].id,
          alcohol: true,
          flavorId: 'bomba',
          method: 'cash',
          notes: 'Vaso entregado',
        },
      ],
    },
    admin,
  ).state;
  expect(s.shifts[0].v4Reviews?.at(-1)?.count).toMatchObject({ difference: 0, differences: { [cup]: 0 } });
  expect(s.orders.at(-1)).toMatchObject({ addedAtClosing: true, lines: [{ bomba: true }] });
  expect(stockBalances(s)['supply:minichicles']).toBe(-1);
  s = run(
    s,
    'v4',
    { action: 'closing_resolve', shiftId: ids.shift, approve: false, notes: 'La venta no ocurrió' },
    other,
  ).state;
  expect(stockBalances(s)[cup]).toBe(baseline[cup]);
  expect(stockBalances(s)['supply:minichicles']).toBe(0);
});
it('recupera un vaso ya contado sin sumar inventario dos veces y devuelve sus componentes', () => {
  let s = ready();
  const cup = 'cup:' + s.sizes[1].id;
  s.stock.push({
    id: crypto.randomUUID(),
    article: cup,
    quantity: 100,
    reason: 'initial',
    referenceId: ids.shift,
    at: NOW,
    by: admin.id,
    eventId: crypto.randomUUID(),
  });
  s = close(s, { [cup]: -1 });
  s = run(
    s,
    'v4',
    { action: 'closing_proposal', shiftId: ids.shift, notes: 'Conteo verificado sin correcciones' },
    admin,
  ).state;
  const merma = s.requests.find((r) => r.merma?.article === cup)!;
  expect(stockBalances(s)['liquid:' + ids.flavor]).toBe(-8);
  const countId = crypto.randomUUID();
  s.counts.push({
    id: countId,
    kind: 'audit',
    by: admin.id,
    at: NOW,
    items: { [cup]: 100 },
    differences: { [cup]: 1 },
    notes: 'Vaso encontrado',
  });
  s.stock.push({
    id: crypto.randomUUID(),
    article: cup,
    quantity: 1,
    reason: 'audit_adjustment',
    referenceId: countId,
    at: NOW,
    by: admin.id,
    eventId: crypto.randomUUID(),
  });
  s = run(
    s,
    'v4',
    {
      action: 'reconcile',
      mermaId: merma.id,
      kind: 'product',
      quantity: 1,
      from: 'Se encontró en el local',
      surplusCountId: countId,
      notes: 'Vaso vacío contado',
    },
    admin,
  ).state;
  expect(stockBalances(s)[cup]).toBe(100);
  expect(stockBalances(s)['liquid:' + ids.flavor]).toBe(0);
  expect(s.requests.find((r) => r.id === merma.id)?.merma?.state).toBe('reconciled');
});

it('no devuelve dulces que nunca se descontaron en una venta anterior a v4', () => {
  let s = fixture();
  const created = order(s);
  s = run(created.state, 'pay', { orderId: created.order.id, deliver: true }).state;
  s.settings[0].v4Enabled = true;
  const baseline = stockBalances(s);
  s = run(s, 'request_void', {
    orderId: created.order.id,
    notes: 'Error de venta',
    evidenceId: ids.photo,
  }).state;
  expect(stockBalances(s)['supply:minichicles'] ?? 0).toBe(baseline['supply:minichicles'] ?? 0);
});
it('una recuperación de efectivo parcial conserva el saldo por conciliar', () => {
  let s = close(ready(), {}, -10000);
  s = run(
    s,
    'v4',
    { action: 'closing_proposal', shiftId: ids.shift, notes: 'Faltante confirmado' },
    admin,
  ).state;
  const loss = s.requests.find((r) => r.merma?.article === 'cash')!;
  s = run(
    s,
    'v4',
    {
      action: 'reconcile',
      mermaId: loss.id,
      kind: 'money',
      quantity: 10000,
      amount: 4000,
      destination: ids.location,
      from: 'Cliente',
      notes: 'Abono parcial',
    },
    admin,
  ).state;
  expect(s.requests.find((r) => r.id === loss.id)?.merma).toMatchObject({
    state: 'partial',
    recoveries: [{ quantity: 4000, amount: 4000 }],
  });
});

it('un cambio a transferencia requiere verificar el ingreso y conserva el conteo físico', () => {
  const seeded = ready();
  seeded.stock = countArticles(seeded, 'closing', seeded.shifts[0]).map((a) => ({
    id: crypto.randomUUID(),
    article: a.id,
    quantity: 10000,
    reason: 'initial',
    at: NOW,
    by: admin.id,
    referenceId: ids.shift,
    eventId: crypto.randomUUID(),
  }));
  const created = order(seeded);
  const s = close(run(created.state, 'pay', { orderId: created.order.id, deliver: true }).state);
  const payload = {
    action: 'closing_proposal',
    shiftId: ids.shift,
    notes: 'Medio corregido',
    corrections: [
      {
        kind: 'payment',
        orderId: created.order.id,
        method: 'transfer',
        accountId: ids.location,
        notes: 'Ingreso en cuenta',
      },
    ],
  };
  expect(() => run(s, 'v4', payload, admin)).toThrow('Verifica el ingreso');
  const corrected = run(
    s,
    'v4',
    { ...payload, corrections: [{ ...payload.corrections[0], verified: true }] },
    admin,
  ).state;
  expect(corrected.payments[0].method).toBe('transfer');
  expect(corrected.shifts[0].v4Reviews?.[0].count.cash).toBe(
    s.counts.find((c) => c.id === s.shifts[0].closingCountId)?.cash,
  );
});
