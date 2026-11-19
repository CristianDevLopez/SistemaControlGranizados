import { describe, expect, it } from 'vitest';
import { addDays, businessDay, dashboardData, periodRange, rangeError } from '../src/domain/dashboard.ts';
import type { Order, Payment } from '../src/domain/types.ts';
import { fixture, ids, order, run } from './support/fixture.ts';

const filter = { from: '2026-10-23', to: '2026-10-23', shiftId: '' };
function sale(extra: Partial<Order> = {}): Order {
  const { order: o } = order(fixture());
  return { ...o, status: 'paid', paidAt: '2026-10-23T16:00:00Z', ...extra };
}
function payment(extra: Partial<Payment> = {}): Payment {
  return {
    id: crypto.randomUUID(),
    orderId: 'order',
    shiftId: ids.shift,
    cashierId: ids.cashier,
    amount: 14000,
    type: 'cash',
    at: '2026-10-23T16:00:00Z',
    eventId: crypto.randomUUID(),
    ...extra,
  };
}
describe('dashboard administrativo', () => {
  it('calcula ventas reales y respeta el modelo de descuentos por línea', () => {
    let { state, order: o } = order(fixture(), 3);
    state = run(state, 'pay', { orderId: o.id }).state;
    // Un descuento de 14.000 se aplica a la línea completa, no a cada unidad.
    state.orders[0].lines[0].discount = 14000;
    state.orders[0].total = 28000;
    const data = dashboardData(state, filter);
    expect(data).toMatchObject({ amount: 28000, tickets: 1, units: 3, average: 28000, discounts: 14000 });
    expect(data.products[0]).toMatchObject({ amount: 28000, units: 3 });
    expect(data.series[0].amount).toBe(28000);
  });
  it('incluye anulaciones pendientes y excluye anulados, impagos y pedidos abiertos', () => {
    const state = fixture();
    state.orders = [
      'paid',
      'void_requested',
      'voided',
      'open',
      'unpaid_incident',
      'cancelled',
      'tasting_only',
    ].map((status) => sale({ status: status as Order['status'] }));
    expect(dashboardData(state, filter)).toMatchObject({
      amount: 28000,
      tickets: 2,
      voided: 1,
      unpaid: 14000,
      open: 1,
      pendingVoids: 1,
    });
  });
  it('cuenta una sustitución una sola vez y separa el crédito de los movimientos de pago', () => {
    const state = fixture(),
      original = sale({ id: 'old', status: 'voided', total: 14000 });
    state.orders = [
      original,
      sale({ id: 'new', replacesId: original.id, paymentCredit: 14000, total: 10000 }),
    ];
    state.payments = [payment(), payment({ orderId: 'new', type: 'refund', amount: -4000 })];
    expect(dashboardData(state, filter)).toMatchObject({
      amount: 10000,
      tickets: 1,
      receipts: 10000,
      refunds: 4000,
    });
  });
  it('incluye el día completo de Colombia sin arrastrar ventas del día siguiente', () => {
    const state = fixture();
    state.orders = [
      '2026-10-23T04:59:59.999Z',
      '2026-10-23T05:00:00.000Z',
      '2026-10-24T04:59:59.999Z',
      '2026-10-24T05:00:00.000Z',
    ].map((paidAt) => sale({ paidAt }));
    const data = dashboardData(state, filter);
    expect(data.tickets).toBe(2);
    expect(data.hours[0].tickets).toBe(1);
    expect(data.hours[23].tickets).toBe(1);
    expect(businessDay('2026-11-01T04:59:59Z')).toBe('2026-10-31');
  });
  it('registra un reembolso por su fecha efectiva, aunque la venta sea de otro periodo', () => {
    const state = fixture();
    state.orders = [sale({ status: 'voided', paidAt: '2026-10-22T16:00:00Z' })];
    state.payments = [payment({ at: '2026-10-22T16:00:00Z' }), payment({ type: 'refund', amount: -14000 })];
    expect(dashboardData(state, filter)).toMatchObject({
      amount: 0,
      tickets: 0,
      receipts: -14000,
      refunds: 14000,
    });
  });
  it('filtra ventas, pagos y gastos por turno y conserva turnos vacíos', () => {
    const state = fixture();
    state.shifts.push({
      ...state.shifts[0],
      id: 'other-shift',
      status: 'closed',
      closedAt: '2026-10-24T06:00:00Z',
    });
    state.orders = [sale(), sale({ shiftId: 'other-shift' })];
    state.payments = [
      payment(),
      payment({ shiftId: 'other-shift', method: 'transfer', accountId: ids.location }),
    ];
    state.expenses = ['approved', 'pending', 'rejected']
      .map(
        (status) =>
          ({
            id: crypto.randomUUID(),
            by: ids.admin,
            at: '2026-10-23T16:00:00Z',
            category: 'Transporte',
            amount: 5000,
            source: 'cash',
            supplier: '',
            notes: '',
            evidenceId: ids.photo,
            shiftId: ids.shift,
            status,
          }) as const,
      )
      .map((e) => ({ ...e, status: e.status as 'approved' | 'pending' | 'rejected' }));
    expect(dashboardData(state, { ...filter, shiftId: ids.shift })).toMatchObject({
      tickets: 1,
      receipts: 14000,
      expenses: 5000,
    });
    expect(dashboardData(state, filter).methods.map((m) => m.amount)).toEqual([14000, 14000]);
    state.orders = [];
    expect(dashboardData(state, filter).shifts).toHaveLength(2);
  });
  it('conserva mezclas como un producto y agrega su importe después del descuento', () => {
    const state = fixture(),
      o = sale();
    o.lines[0].flavorIds = [ids.flavor, ids.plain];
    const reversed = structuredClone(o);
    reversed.lines[0].flavorIds!.reverse();
    state.orders = [o, reversed];
    const data = dashboardData(state, filter);
    expect(data.products).toHaveLength(1);
    expect(data.products[0]).toMatchObject({ units: 2, amount: 28000 });
    expect(data.units).toBe(2);
  });
  it('rellena días sin ventas y compara con un intervalo anterior de igual duración', () => {
    const state = fixture();
    state.orders = [sale({ paidAt: '2026-10-20T16:00:00Z' }), sale()];
    const data = dashboardData(state, { ...filter, from: '2026-10-22', to: '2026-10-24' });
    expect(data.series.map((p) => p.tickets)).toEqual([0, 1, 0]);
    expect(data).toMatchObject({
      previousFrom: '2026-10-19',
      previousTo: '2026-10-21',
      previous: { tickets: 1, amount: 14000 },
    });
  });
  it('agrupa rangos largos por mes y maneja años bisiestos', () => {
    const data = dashboardData(fixture(), { ...filter, from: '2024-01-01', to: '2024-12-31' });
    expect(data.monthly).toBe(true);
    expect(data.series).toHaveLength(12);
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(periodRange('week', '2026-11-15')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(periodRange('month', '2026-11-15')).toEqual({ from: '2026-11-01', to: '2026-11-15' });
  });
  it('muestra metas por su periodo completo y las oculta al seleccionar un turno', () => {
    const state = fixture();
    state.goals = [
      {
        id: 'goal',
        period: 'month',
        startsAt: '2026-10-01T05:00:00Z',
        endsAt: '2026-11-01T05:00:00Z',
        amount: 100000,
        cups: 10,
        by: ids.admin,
        at: '2026-10-01T05:00:00Z',
      },
    ];
    state.orders = [sale(), sale({ paidAt: '2026-10-22T16:00:00Z' })];
    expect(dashboardData(state, filter).goals[0].actual.amount).toBe(28000);
    expect(dashboardData(state, { ...filter, shiftId: ids.shift }).goals).toEqual([]);
  });
  it('rechaza rangos incompletos, invertidos o inexistentes y entrega ceros sin datos', () => {
    for (const range of [
      { from: '', to: filter.to },
      { from: filter.to, to: '2026-10-22' },
      { from: '2026-02-30', to: filter.to },
    ])
      expect(rangeError(range)).not.toBe('');
    expect(() => dashboardData(fixture(), { ...filter, from: '' })).toThrow();
    expect(dashboardData(fixture(), filter)).toMatchObject({
      amount: 0,
      average: 0,
      units: 0,
      refunds: 0,
      expenses: 0,
    });
  });
});
