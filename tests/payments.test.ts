import { describe, it, expect } from 'vitest';
import { cashExpected, locationBalance, salesByMethod } from '../src/domain/engine.ts';
import type { Actor, State } from '../src/domain/types.ts';
import { ids, fixture, cashier, admin, other, run, order, countedItems } from './support/fixture.ts';

// Cobro en efectivo o por transferencia (Nequi, Daviplata, Bre-B). La caja solo espera el efectivo.
const offline: Actor = { ...cashier, online: false };
const BASE = 20000; // base del turno de prueba

function transferSale(s: State = fixture(), extra: Record<string, unknown> = {}, actor: Actor = cashier) {
  const created = order(s);
  const state = run(
    created.state,
    'pay',
    { orderId: created.order.id, method: 'transfer', accountId: ids.location, deliver: true, ...extra },
    actor,
  ).state;
  return {
    state,
    orderId: created.order.id,
    total: state.orders.find((o) => o.id === created.order.id)!.total,
  };
}
function voidApproved(s: State, orderId: string) {
  s = run(s, 'request_void', { orderId, notes: 'Error de sabor', evidenceId: ids.photo }, admin).state;
  const request = s.requests.find((r) => r.type === 'void' && r.referenceId === orderId)!;
  return run(s, 'resolve_request', { requestId: request.id, approve: true }, other).state;
}

describe('pagos por transferencia', () => {
  it('registra el medio, la cuenta y la referencia del pago', () => {
    const { state, orderId, total } = transferSale(fixture(), { reference: '  4821  ' });
    expect(state.payments.find((p) => p.orderId === orderId)).toMatchObject({
      amount: total,
      type: 'cash',
      method: 'transfer',
      accountId: ids.location,
      reference: '4821',
    });
    expect(state.orders.find((o) => o.id === orderId)!.status).toBe('paid');
  });

  it('la caja no espera el dinero de una transferencia; la cuenta sí lo recibe', () => {
    const { state, total } = transferSale();
    expect(cashExpected(state, ids.shift)).toBe(BASE);
    expect(locationBalance(state, ids.location)).toBe(total);
    expect(salesByMethod(state, ids.shift)).toEqual({
      cash: 0,
      transfer: total,
      transferCount: 1,
      byAccount: { [ids.location]: total },
    });
  });

  it('el cierre cuadra contando solo el efectivo', () => {
    let { state } = transferSale();
    const cash = order(state);
    state = run(cash.state, 'pay', { orderId: cash.order.id, deliver: true }).state;
    const cashTotal = state.orders.find((o) => o.id === cash.order.id)!.total;
    expect(state.payments.find((p) => p.orderId === cash.order.id)!.method).toBe('cash');
    state = run(state, 'count', {
      kind: 'closing',
      shiftId: ids.shift,
      cash: BASE + cashTotal,
      retained: BASE + cashTotal,
      items: countedItems(state),
    }).state;
    expect(state.counts.find((c) => c.kind === 'closing')!.difference).toBe(0);
  });

  it('el reembolso usa por defecto el mismo medio y la misma cuenta de la venta', () => {
    const sale = transferSale();
    let state = voidApproved(sale.state, sale.orderId);
    state = run(state, 'refund_order', { orderId: sale.orderId, evidenceId: ids.photo }).state;
    expect(state.payments.find((p) => p.orderId === sale.orderId && p.amount < 0)).toMatchObject({
      type: 'refund',
      method: 'transfer',
      accountId: ids.location,
      amount: -sale.total,
    });
    expect(locationBalance(state, ids.location)).toBe(0);
    expect(cashExpected(state, ids.shift)).toBe(BASE);
  });

  it('el reembolso de una transferencia se puede devolver en efectivo', () => {
    const sale = transferSale();
    let state = voidApproved(sale.state, sale.orderId);
    state = run(state, 'refund_order', {
      orderId: sale.orderId,
      evidenceId: ids.photo,
      method: 'cash',
    }).state;
    expect(cashExpected(state, ids.shift)).toBe(BASE - sale.total);
    expect(locationBalance(state, ids.location)).toBe(sale.total);
  });

  it('rechaza cuentas que no reciben ventas, inactivas o inexistentes', () => {
    const notReceiving = fixture();
    notReceiving.locations[0].receivesSales = false;
    expect(() => transferSale(notReceiving)).toThrow('Cuenta que recibe la transferencia no existe.');
    const inactive = fixture();
    inactive.locations[0].active = false;
    expect(() => transferSale(inactive)).toThrow('Cuenta que recibe la transferencia no existe.');
    expect(() => transferSale(fixture(), { accountId: ids.flavor })).toThrow(
      'Cuenta que recibe la transferencia no existe.',
    );
    expect(() => transferSale(fixture(), { method: 'tarjeta' })).toThrow('Medio de pago inválido.');
  });

  it('acepta una venta por transferencia registrada sin conexión', () => {
    const { state, orderId } = transferSale(fixture(), {}, offline);
    expect(state.payments.find((p) => p.orderId === orderId)!.method).toBe('transfer');
  });

  it('un pago anterior a las transferencias, sin medio, cuenta como efectivo', () => {
    const state = fixture();
    state.payments.push({
      id: '80000000-0000-4000-8000-000000000001',
      orderId: '80000000-0000-4000-8000-000000000002',
      shiftId: ids.shift,
      cashierId: cashier.id,
      amount: 5000,
      type: 'cash',
      at: '2026-10-23T15:00:00.000Z',
      eventId: '80000000-0000-4000-8000-000000000003',
    });
    expect(cashExpected(state, ids.shift)).toBe(BASE + 5000);
    expect(salesByMethod(state, ids.shift).cash).toBe(5000);
  });

  it('solo las cuentas bancarias pueden recibir ventas', () => {
    const state = run(
      fixture(),
      'save_location',
      { name: 'Caja fuerte', type: 'treasury', custodianId: admin.id, receivesSales: true },
      admin,
    ).state;
    expect(state.locations.find((l) => l.name === 'Caja fuerte')!.receivesSales).toBe(false);
    const nequi = run(
      fixture(),
      'save_location',
      {
        name: 'Nequi del negocio',
        type: 'bank',
        custodianId: admin.id,
        bank: 'Nequi',
        account: '3000000000',
        receivesSales: true,
      },
      admin,
    ).state;
    expect(nequi.locations.find((l) => l.name === 'Nequi del negocio')!.receivesSales).toBe(true);
  });
});
