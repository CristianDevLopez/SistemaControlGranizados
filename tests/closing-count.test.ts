import { expect, it } from 'vitest';
import {
  closingPaymentMethods,
  countArticles,
  countHasDifferences,
  redactState,
  shiftCountArticles,
  stockBalances,
} from '../src/domain/engine.ts';
import { fixture, ids, run, order, cashier, admin, NOW } from './support/fixture.ts';
import type { State } from '../src/domain/types.ts';

const key = `transfer:${ids.location}`;
function closing(state: State, payments: Record<string, number> = { [key]: 0 }) {
  return {
    kind: 'closing',
    shiftId: ids.shift,
    cash: 20000,
    retained: 20000,
    items: Object.fromEntries(countArticles(state, 'closing').map((a) => [a.id, 0])),
    payments,
  };
}
function transferSale() {
  const created = order(fixture());
  return run(created.state, 'pay', {
    orderId: created.order.id,
    method: 'transfer',
    accountId: ids.location,
    deliver: true,
  }).state;
}

it('valida en servidor el tipo de cuadre vigente y conserva el conteo original después del envío', () => {
  let state = fixture();
  state.shifts[0].blindOpening = { status: 'matched', depth: 'simple' };
  const choose = { shiftId: ids.shift, action: 'set_closing_count_mode', mode: 'full' };
  expect(() => run(state, 'review_shift', choose, cashier)).toThrow();
  state = run(state, 'review_shift', choose, admin).state;
  const shift = redactState(state, cashier).shifts[0];
  expect(shift.closingCountMode).toBe('full');
  expect(shiftCountArticles(state, shift, 'closing').some((item) => item.id.startsWith('sealed_bag:'))).toBe(
    true,
  );
  const payload = { kind: 'closing', shiftId: ids.shift, attempt: 1, cash: 20000, items: {} };
  expect(() => run(state, 'submit_blind_count', { ...payload, closingCountMode: 'full' })).toThrow();
  state = run(state, 'review_shift', { ...choose, mode: 'cash' }, admin).state;
  expect(() => run(state, 'submit_blind_count', { ...payload, closingCountMode: 'full' })).toThrow(
    /tipo de cuadre cambió/,
  );
  const counted = run(state, 'submit_blind_count', { ...payload, closingCountMode: 'cash' }).state;
  expect(counted.counts.at(-1)).toMatchObject({ items: {}, cash: 20000 });
  expect(() => run(counted, 'review_shift', choose, admin)).toThrow(/conteo de cierre ya comenzó/);
});

it('cierra contando vasos del paquete abierto sin contar bolsas, líquidos, paquetes ni otros insumos', () => {
  let state = fixture();
  const size = state.sizes[0].id;
  state = run(state, 'open_package', { sizeId: size, units: 50 }).state;
  const initialStock = stockBalances(state);
  const payload = closing(state);
  payload.items[`cup:${size}`] = 17;
  const closed = run(state, 'count', payload).state;
  const count = closed.counts[0];
  expect(count.items).toEqual(payload.items);
  expect(Object.keys(count.items).every((a) => a.startsWith('cup:'))).toBe(true);
  expect(count.expectedItems?.[`cup:${size}`]).toBe(state.settings[0].cupPackageUnits);
  expect(count.differences?.[`cup:${size}`]).toBe(-3);
  expect(stockBalances(closed)).toEqual(initialStock);
  expect(closed.shifts[0].status).toBe('closed');
});

it('requiere verificar los medios configurados y rechaza importes inválidos', () => {
  const state = transferSale();
  expect(() => run(state, 'count', closing(state, {}))).toThrow(/Falta verificar/);
  for (const value of [NaN, Infinity, 0.5, 1_000_000_001])
    expect(() => run(state, 'count', closing(state, { [key]: value }))).toThrow(/pesos válido/);
});

it('guarda diferencias por cuenta sin alterar la base ni sumar transferencias al efectivo', () => {
  const state = transferSale();
  const closed = run(state, 'count', closing(state, { [key]: 13000 })).state;
  expect(closed.counts[0]).toMatchObject({
    cash: 20000,
    expectedCash: 20000,
    difference: 0,
    payments: { [key]: 13000 },
    expectedPayments: { [key]: 14000 },
    paymentDifferences: { [key]: -1000 },
  });
  expect(closed.shifts[0]).toMatchObject({ retained: 20000, remittance: 0 });
  expect(countHasDifferences(closed.counts[0])).toBe(true);
  expect(closed.notifications.some((n) => n.channel === 'mermas')).toBe(true);
  const snapshot = structuredClone(closed.counts);
  const explanation = { countId: snapshot[0].id, notes: 'Revisar comprobante' };
  expect(() => run(closed, 'explain_difference', explanation)).toThrow(/Turno cerrado/);
  const later = run(closed, 'explain_difference', explanation, admin).state;
  expect(later.counts).toEqual(snapshot);
});

it('incluye cuentas nuevas y cuentas usadas que luego se desactivaron, sin revelar esperados a caja', () => {
  const state = transferSale();
  state.locations[0].active = false;
  state.locations[0].receivesSales = false;
  const second = crypto.randomUUID();
  state.locations.push({
    ...state.locations[0],
    id: second,
    name: 'Otro método',
    active: true,
    receivesSales: true,
  });
  const view = redactState(state, cashier);
  expect(closingPaymentMethods(view, ids.shift).map((x) => x.id)).toEqual([`transfer:${second}`]);
  expect(view.payments).toEqual([]);
  expect(view.transferSummary).toEqual([{ name: state.locations[0].name, amount: 14000 }]);
  const closed = run(state, 'count', closing(state, { [key]: 14000, [`transfer:${second}`]: 0 })).state;
  expect(redactState(closed, cashier).counts).toEqual([]);
  expect(redactState(closed, admin).counts[0].expectedPayments?.[key]).toBe(14000);
});

it('permite verificar un neto negativo por devolución de una venta de otro turno', () => {
  const state = fixture();
  state.payments.push({
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    orderId: crypto.randomUUID(),
    shiftId: ids.shift,
    cashierId: cashier.id,
    amount: -5000,
    type: 'refund',
    method: 'transfer',
    accountId: ids.location,
    at: NOW,
  });
  const count = run(state, 'count', closing(state, { [key]: -5000 })).state.counts[0];
  expect(count.paymentDifferences?.[key]).toBe(0);
  expect(count.expectedCash).toBe(20000);
});
