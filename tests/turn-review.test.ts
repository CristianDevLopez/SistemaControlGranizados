import { expect, it } from 'vitest';
import { rehearsalShift, visibleCounts } from '../src/domain/closing-archive.ts';
import { blindCountArticles, currentPayments, stockBalances } from '../src/domain/engine.ts';
import { reconciledCount, reviewIsPending, saleExplanations } from '../src/domain/turn-review.ts';
import { admin, cashier, fixture, ids, NOW, order, run } from './support/fixture.ts';

it('sugiere una venta sin registrar cuando sobran $17.000 y falta un vaso de 16 oz', () => {
  const state = fixture();
  const size = state.sizes.find((item) => item.ounces === 16)!;
  expect(
    saleExplanations(state, {
      id: crypto.randomUUID(),
      kind: 'closing',
      at: NOW,
      by: cashier.id,
      items: {},
      notes: '',
      difference: 17000,
      differences: { [`cup:${size.id}`]: -1 },
    }),
  ).toEqual(['Posible venta sin registrar · 16 oz.']);
});

it('incluye en revisión las diferencias de apertura registradas por el flujo anterior', () => {
  const state = fixture();
  const count = {
    id: crypto.randomUUID(),
    kind: 'opening' as const,
    shiftId: ids.shift,
    at: NOW,
    by: cashier.id,
    items: {},
    notes: '',
    difference: -5000,
  };
  state.counts.push(count);
  state.shifts[0].openingCountId = count.id;
  expect(reviewIsPending(state, state.shifts[0])).toBe(true);
  const reviewed = run(
    state,
    'review_shift',
    { shiftId: ids.shift, action: 'resolve_opening', notes: 'Se comprobó la base de apertura.' },
    admin,
  ).state;
  expect(reviewIsPending(reviewed, reviewed.shifts[0])).toBe(false);
  expect(reviewed.counts).toEqual([count]);
});

it('corrige el medio con movimientos compensatorios y recalcula el cuadre sin alterar el conteo', () => {
  const draft = order(fixture());
  const paid = run(draft.state, 'pay', {
    orderId: draft.order.id,
    method: 'transfer',
    accountId: ids.location,
  });
  const request = run(paid.state, 'request_payment_change', {
    orderId: draft.order.id,
    notes: 'Fue en efectivo.',
  });
  const payload = {
    shiftId: ids.shift,
    kind: 'closing',
    cash: 34000,
    items: Object.fromEntries(blindCountArticles(request.state).map(({ id }) => [id, 0])),
  };
  const first = run(request.state, 'submit_blind_count', { ...payload, attempt: 1 });
  const closed = run(first.state, 'submit_blind_count', { ...payload, attempt: 2 });
  const original = structuredClone(closed.state.counts);
  const corrected = run(
    closed.state,
    'review_shift',
    {
      shiftId: ids.shift,
      action: 'correct_payment',
      requestId: request.result.referenceId,
      method: 'cash',
      notes: 'Se verificó el comprobante.',
    },
    admin,
  ).state;
  expect(corrected.payments).toHaveLength(3);
  expect(corrected.payments[0]).toEqual(paid.state.payments[0]);
  expect(currentPayments(corrected.payments)).toEqual([
    expect.objectContaining({ method: 'cash', amount: 14000 }),
  ]);
  expect(corrected.counts).toEqual(original);
  expect(reconciledCount(corrected, corrected.shifts[0], original[1]).difference).toBe(0);
  expect(reviewIsPending(corrected, corrected.shifts[0])).toBe(true);
});

it('el arqueo del 18 conserva ventas y conteos históricos y fija el inventario de referencia', () => {
  const state = order(fixture()).state;
  const cut = '2026-11-18T18:00:00.000Z';
  const cup = `cup:${state.sizes[0].id}`;
  const baseline = {
    id: crypto.randomUUID(),
    by: admin.id,
    kind: 'audit' as const,
    at: cut,
    items: { [cup]: 10 },
    notes: '',
  };
  state.shifts[0].status = 'closed';
  state.shifts[0].closedAt = NOW;
  state.counts = [{ ...baseline, id: crypto.randomUUID(), kind: 'closing', at: NOW }, baseline];
  state.stock = [
    {
      id: crypto.randomUUID(),
      by: admin.id,
      eventId: crypto.randomUUID(),
      article: cup,
      quantity: 20,
      reason: 'initial',
      referenceId: baseline.id,
      at: NOW,
    },
    {
      id: crypto.randomUUID(),
      by: admin.id,
      eventId: crypto.randomUUID(),
      article: cup,
      quantity: -1,
      reason: 'delivery',
      referenceId: state.orders[0].id,
      at: '2026-11-19T14:00:00Z',
    },
  ];
  const archived = run(state, 'archive_rehearsal', { countId: baseline.id }, admin).state;
  expect(visibleCounts(archived)).toEqual([baseline]);
  expect(visibleCounts(archived, true)).toHaveLength(2);
  expect(rehearsalShift(archived, archived.shifts[0])).toBe(true);
  expect(stockBalances(archived)[cup]).toBe(9);
  expect(archived.orders).toEqual(state.orders);
});
