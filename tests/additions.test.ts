import { expect, it } from 'vitest';
import { candyAdditions, priceAdditions } from '../src/domain/additions.ts';
import { summarizeSales } from '../src/domain/dashboard.ts';
import { fixture, order, run } from './support/fixture.ts';

it('cobra cada dulce a $500 y todos los dulces a $2.000 con precios del catálogo', () => {
  expect(candyAdditions.map((item) => item.unitPrice)).toEqual([500, 500, 500, 500, 2000]);
  const draft = order(fixture());
  const { id, lines, version } = draft.order;
  const edited = run(draft.state, 'update_order', {
    orderId: id,
    expectedVersion: version,
    lines,
    additions: [
      { id: 'gomitas', quantity: 2, unitPrice: 1 },
      { id: 'todos', quantity: 1 },
    ],
  }).state;
  expect(edited.orders[0].total).toBe(17000);
  expect(edited.orders[0].additions?.[0]).toMatchObject({
    name: 'Par de gomitas',
    unitPrice: 500,
    quantity: 2,
  });
  const reedited = run(edited, 'update_order', { orderId: id, lines }).state;
  const paid = run(reedited, 'pay', { orderId: id, expectedTotal: 17000 }).state;
  expect(paid.orders[0].additions).toEqual(edited.orders[0].additions);
  expect(paid.payments[0].amount).toBe(17000);
  expect(summarizeSales(paid.orders)).toMatchObject({ amount: 17000, discounts: 0 });
});

it('acepta quitar las adiciones y rechaza identificadores desconocidos y cantidades inválidas', () => {
  const draft = order(fixture());
  const update = { orderId: draft.order.id, lines: draft.order.lines };
  const edited = run(draft.state, 'update_order', {
    ...update,
    additions: [{ id: 'cintas', quantity: 1 }],
  }).state;
  const cleared = run(edited, 'update_order', { ...update, additions: [] }).state;
  expect(cleared.orders[0].total).toBe(draft.order.total);
  expect(cleared.orders[0].additions).toBeUndefined();
  expect(() => priceAdditions([{ id: 'otro', quantity: 1 }])).toThrow(/inválida/);
  expect(() => priceAdditions([{ id: 'cintas', quantity: 1.5 }])).toThrow(/inválida/);
});
