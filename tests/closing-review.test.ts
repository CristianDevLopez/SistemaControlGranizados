import { expect, it } from 'vitest';
import {
  applyCommand,
  closingPreview,
  countArticles,
  cupBalances,
  openingExpectedCash,
  redactState,
  stockBalances,
} from '../src/domain/engine.ts';
import { admin, cashier, cmd, fixture, ids, NOW, order, run, support } from './support/fixture.ts';
import type { State } from '../src/domain/types.ts';
import { suggestedCupCharge } from '../src/domain/reconciliation.ts';

const cup = `cup:${fixture().sizes[0].id}`;
const account = `transfer:${ids.location}`;
function close(state: State, extra: Record<string, unknown> = {}) {
  const preview = closingPreview(state, ids.shift);
  return run(state, 'count', {
    kind: 'closing',
    shiftId: ids.shift,
    cash: preview.expectedCash,
    retained: preview.expectedCash,
    payments: preview.expectedPayments,
    items: Object.fromEntries(
      countArticles(state, 'closing').map((a) => [a.id, Math.max(0, preview.expectedItems[a.id])]),
    ),
    preview,
    ...extra,
  }).state;
}
function approval(state: State, shiftId = ids.shift, extra: Record<string, unknown> = {}) {
  const shift = state.shifts.find((s) => s.id === shiftId)!;
  const original = state.counts.find((c) => c.id === shift.closingCountId)!;
  return {
    shiftId,
    preview: closingPreview(state, shiftId, original),
    cash: original.cash,
    items: original.items,
    payments: original.payments,
    notes: 'Efectivo y comprobantes verificados; reconteo de vasos.',
    verified: true,
    ...extra,
  };
}

it('un cuadre coincidente también espera aprobación y conserva su conteo original', () => {
  const closed = close(fixture());
  expect(closed.shifts[0].closingReview).toEqual({ status: 'pending' });
  const original = structuredClone(closed.counts[0]);
  const approved = run(closed, 'approve_closing', approval(closed), admin).state;
  expect(approved.shifts[0].closingReview?.status).toBe('approved');
  expect(approved.counts[0]).toEqual(original);
  expect(approved.counts[1]).toMatchObject({ revisesId: original.id, by: admin.id, difference: 0 });
  expect(approved.stock).toHaveLength(0);
});

it('sugiere el mayor precio con licor por tamaño solo para vasos faltantes', () => {
  const { sizes } = fixture();
  const variant = { ...sizes[0], id: 'otra-presentacion', alcoholPrice: 15000 };
  expect(suggestedCupCharge([...sizes, variant], { [cup]: 20, 'liquid:sabor': 202 }, { [cup]: 19 })).toBe(
    15000,
  );
  expect(suggestedCupCharge(sizes, { [cup]: 20 }, { [cup]: 21 })).toBe(0);
});

it('ajusta faltantes y sobrantes una vez, con referencia al conteo, y la siguiente apertura usa el saldo corregido', () => {
  let state = run(fixture(), 'open_package', { sizeId: fixture().sizes[0].id }).state;
  const otherCup = `cup:${state.sizes[1].id}`;
  const items = { ...closingPreview(state, ids.shift).expectedItems, [cup]: 16, [otherCup]: 2 };
  state = close(state, { items });
  const approved = run(
    state,
    'approve_closing',
    approval(state, ids.shift, { employeeCharge: 2000 }),
    admin,
  ).state;
  expect(stockBalances(approved)[cup]).toBe(16);
  expect(stockBalances(approved)[otherCup]).toBe(2);
  expect(approved.stock.filter((m) => m.reason === 'closing_adjustment')).toHaveLength(2);
  expect(approved.shifts[0].closingReview?.employeeCharge).toBe(2000);
  expect(() => run(approved, 'approve_closing', approval(approved), admin)).toThrow(/ya fue aprobado/);
  expect(closingPreview(approved, ids.shift).expectedItems[cup]).toBe(16);
});

it('la revisión solo corresponde a un administrador conectado', () => {
  const state = close(fixture());
  for (const actor of [cashier, support, { ...admin, online: false }])
    expect(() => run(state, 'approve_closing', approval(state), actor)).toThrow();
  expect(() => run(state, 'approve_closing', approval(state, ids.shift, { verified: false }), admin)).toThrow(
    /verificación/,
  );
  expect(() => run(state, 'approve_closing', approval(state, ids.shift, { notes: '' }), admin)).toThrow(
    /obligatorio/,
  );
  expect(() =>
    run(state, 'approve_closing', approval(state, ids.shift, { employeeCharge: 1 }), admin),
  ).toThrow(/No hay faltantes/);
});

it('un cierre anterior conserva su diferencia sin duplicar el ajuste de un arqueo posterior', () => {
  const initial = run(fixture(), 'open_package', { sizeId: fixture().sizes[0].id }).state;
  const requested = run(initial, 'start_audit', { shiftId: ids.shift, items: [cup] }, admin).state;
  const audited = run(requested, 'finish_audit', {
    shiftId: ids.shift,
    auditId: requested.settings[0].auditId,
    items: { [cup]: 16 },
  }).state;
  const closed = close(audited, {
    items: { ...closingPreview(audited, ids.shift).expectedItems, [cup]: 16 },
  });
  const adjusted = run(
    closed,
    'adjust_count_inventory',
    {
      countId: audited.counts[0].id,
      items: { [cup]: 16 },
      expectedItems: { [cup]: 20 },
      notes: 'Conteo físico verificado para el siguiente turno.',
      confirmed: true,
    },
    admin,
  ).state;
  const approved = run(adjusted, 'approve_closing', approval(adjusted), admin).state;
  expect(stockBalances(approved)[cup]).toBe(16);
  expect(approved.counts.at(-1)?.differences?.[cup]).toBe(-4);
});

it('permite corregir un conteo y una reserva sobrestimados sin borrar el original ni generar nómina', () => {
  const state = close(fixture());
  const approved = run(
    state,
    'approve_closing',
    approval(state, ids.shift, {
      cash: 15000,
      retained: 15000,
      employeeCharge: 5000,
    }),
    admin,
  ).state;
  expect(approved.counts[0]).toMatchObject({ cash: 20000, retained: 20000 });
  expect(approved.counts[1]).toMatchObject({ cash: 15000, retained: 15000, difference: -5000 });
  expect(approved.shifts[0]).toMatchObject({ retained: 15000, remittance: 0 });
  expect(approved.settings[0].lastRetainedCash).toBe(15000);
  expect(openingExpectedCash(approved)).toBe(15000);
  expect(approved.payments).toHaveLength(0);
});

it('un nuevo cobro invalida la comparación y no cierra el turno con un esperado desactualizado', () => {
  const created = order(fixture());
  const preview = closingPreview(created.state, ids.shift);
  const paid = run(created.state, 'pay', { orderId: created.order.id, deliver: true }).state;
  expect(() => close(paid, { preview })).toThrow(/sistema cambió/);
  expect(paid.shifts[0].status).toBe('open');
});

it('reconfirma valores corregidos, preserva el original y cancela el remanente solicitado si ya no existe', () => {
  const state = close(fixture(), { cash: 25000, retained: 20000, locationId: ids.location });
  const approved = run(state, 'approve_closing', approval(state, ids.shift, { cash: 20000 }), admin).state;
  expect(approved.counts[0].cash).toBe(25000);
  expect(approved.counts[1].cash).toBe(20000);
  expect(approved.transfers[0]).toMatchObject({ status: 'cancelled', amount: 5000 });
  expect(openingExpectedCash(approved)).toBe(20000);
});

it('la entrega posterior del remanente no se convierte en faltante ni se descuenta dos veces en la apertura', () => {
  const state = close(fixture(), { cash: 25000, retained: 20000, locationId: ids.location });
  state.transfers[0].status = 'in_transit';
  state.transfers[0].executedAt = '2026-10-23T16:01:00.000Z';
  const command = cmd('approve_closing', approval(state), admin, { at: '2026-10-23T16:02:00.000Z' });
  const approved = applyCommand(state, command, admin, '2026-10-23T16:02:00.000Z').state;
  expect(approved.counts[1].expectedCash).toBe(20000);
  expect(approved.transfers).toHaveLength(1);
  expect(approved.transfers[0].amount).toBe(5000);
  expect(openingExpectedCash(approved)).toBe(20000);
});

it('una salida ejecutada antes del corte sigue descontada aunque el receptor la confirme después', () => {
  const initial = fixture();
  initial.transfers.push({
    id: crypto.randomUUID(),
    by: cashier.id,
    recipientId: admin.id,
    from: `cash:${ids.shift}`,
    to: ids.location,
    amount: 5000,
    status: 'in_transit',
    at: '2026-10-23T15:58:00.000Z',
    executedAt: '2026-10-23T15:59:00.000Z',
    shiftId: ids.shift,
    notes: 'Entrega anterior al cierre',
    type: 'transfer',
    votes: [],
  });
  const state = close(initial);
  state.transfers[0].status = 'confirmed';
  state.transfers[0].confirmedAt = '2026-10-23T16:01:00.000Z';
  expect(state.counts[0].expectedCash).toBe(15000);
  expect(closingPreview(state, ids.shift, state.counts[0]).expectedCash).toBe(15000);
});

it('aprobar un cierre anterior después de otro conteo no repite el mismo faltante', () => {
  let state = run(fixture(), 'open_package', { sizeId: fixture().sizes[0].id }).state;
  state = close(state, { items: { ...closingPreview(state, ids.shift).expectedItems, [cup]: 16 } });
  const later = crypto.randomUUID();
  state.shifts.push({
    ...state.shifts[0],
    id: later,
    status: 'closed',
    closingReview: { status: 'pending' },
    openedAt: '2026-10-23T17:00:00.000Z',
    requestedAt: '2026-10-23T17:00:00.000Z',
    closingCountId: crypto.randomUUID(),
  });
  state.counts.push({
    ...structuredClone(state.counts[0]),
    id: state.shifts[1].closingCountId!,
    shiftId: later,
    at: '2026-10-23T18:00:00.000Z',
  });
  state = run(state, 'approve_closing', approval(state), admin).state;
  expect(closingPreview(state, later, state.counts[1]).expectedItems[cup]).toBe(16);
  const approved = run(state, 'approve_closing', approval(state, later), admin).state;
  expect(stockBalances(approved)[cup]).toBe(16);
  expect(approved.stock.filter((m) => m.reason === 'closing_adjustment')).toHaveLength(1);
});

it('una corrección de recetas en un turno anterior se considera junto con su ajuste, sin tocar ventas posteriores', () => {
  const created = order(run(fixture(), 'open_package', { sizeId: fixture().sizes[0].id }).state);
  let state = run(created.state, 'pay', { orderId: created.order.id, deliver: true }).state;
  state = close(state, { items: { ...closingPreview(state, ids.shift).expectedItems, [cup]: 15 } });
  const later = crypto.randomUUID();
  state.shifts.push({ ...state.shifts[0], id: later, openedAt: '2026-10-23T17:00:00Z' });
  state.counts.push({
    ...structuredClone(state.counts[0]),
    id: crypto.randomUUID(),
    shiftId: later,
    at: '2026-10-23T18:00:00Z',
  });
  state.shifts[1].closingCountId = state.counts[1].id;
  state.stock.push({
    ...state.stock.find((m) => m.article === cup)!,
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    quantity: 1,
    reason: 'recipe_correction',
    referenceId: created.order.id,
  });
  state = run(state, 'approve_closing', approval(state), admin).state;
  expect(closingPreview(state, later, state.counts[1]).expectedItems[cup]).toBe(15);
  state = run(state, 'approve_closing', approval(state, later), admin).state;
  expect(stockBalances(state)[cup]).toBe(15);
});

it('el recordatorio de vasos funciona en la vista de caja y el replay local, y el arqueo sigue ocultando esperados', () => {
  const state = run(fixture(), 'open_package', { sizeId: fixture().sizes[0].id }).state;
  const view = redactState(state, cashier);
  expect(view.stock).toEqual([]);
  expect(cupBalances(view)[cup]).toBe(20);
  expect(cupBalances(redactState(view, cashier))[cup]).toBe(20);
  const local = run(view, 'open_package', { sizeId: fixture().sizes[0].id, confirmEmpty: true }).state;
  expect(cupBalances(local)[cup]).toBe(40);
  const audited = run(state, 'start_audit', { shiftId: ids.shift, items: [cup] }, admin).state;
  expect(redactState(audited, cashier).cupBalances).toBeUndefined();
});

it('una merma reportada antes del cierre y aprobada después no se descuenta otra vez al aprobar el cuadre', () => {
  let state = run(fixture(), 'open_package', { sizeId: fixture().sizes[0].id }).state;
  const reported = run(state, 'report_damage', {
    article: cup,
    quantity: 4,
    notes: 'Vasos para exhibición',
    evidenceId: ids.photo,
  });
  state = close(reported.state, {
    items: { ...closingPreview(reported.state, ids.shift).expectedItems, [cup]: 16 },
  });
  state = run(
    state,
    'resolve_request',
    { requestId: reported.result.referenceId, approve: true },
    admin,
  ).state;
  expect(closingPreview(state, ids.shift, state.counts[0]).expectedItems[cup]).toBe(16);
  state = run(state, 'approve_closing', approval(state), admin).state;
  expect(stockBalances(state)[cup]).toBe(16);
  expect(state.stock.filter((m) => m.reason === 'closing_adjustment')).toHaveLength(0);
});

it('usa la recepción del servidor como corte y solo guarda los identificadores que comparten ese límite', () => {
  const created = order(run(fixture(), 'open_package', { sizeId: fixture().sizes[0].id }).state);
  const preview = closingPreview(created.state, ids.shift);
  const at = '2026-10-23T16:10:00.000Z';
  const closed = applyCommand(
    created.state,
    cmd(
      'count',
      {
        kind: 'closing',
        shiftId: ids.shift,
        cash: 20000,
        retained: 20000,
        items: preview.expectedItems,
        payments: preview.expectedPayments,
        preview,
      },
      cashier,
      { at },
    ),
    cashier,
    at,
  ).state;
  expect(closed.counts[0].stockEventIds).toEqual([]);
  const event = crypto.randomUUID();
  closed.stock.push({
    ...closed.stock[0],
    id: crypto.randomUUID(),
    eventId: event,
    article: cup,
    quantity: -1,
    referenceId: created.order.id,
    reason: 'recipe_correction',
    at: NOW,
  });
  closed.audit.push({
    ...closed.audit[0],
    id: crypto.randomUUID(),
    eventId: event,
    receivedAt: '2026-10-23T16:11:00.000Z',
  });
  expect(closingPreview(closed, ids.shift, closed.counts[0]).expectedItems[cup]).toBe(19);
});

it('valida todas las cuentas, incluidos netos negativos, y rechaza conteos de vasos fraccionarios', () => {
  const state = close(fixture());
  expect(() => run(state, 'approve_closing', approval(state, ids.shift, { payments: {} }), admin)).toThrow(
    /Falta verificar/,
  );
  expect(() =>
    run(
      state,
      'approve_closing',
      approval(state, ids.shift, { items: { ...state.counts[0].items, [cup]: 1.5 } }),
      admin,
    ),
  ).toThrow(/enteros/);
  const approved = run(
    state,
    'approve_closing',
    approval(state, ids.shift, { payments: { [account]: -1000 } }),
    admin,
  ).state;
  expect(approved.counts[1].paymentDifferences?.[account]).toBe(-1000);
});
