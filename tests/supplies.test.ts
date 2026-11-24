import { expect, it } from 'vitest';
import {
  applyCommand,
  stockBalances,
  visibleClosingArticles,
  visibleClosingPreview,
} from '../src/domain/engine.ts';
import { supplyDuration } from '../src/domain/inventory.ts';
import { admin, cashier, cmd, fixture, ids, order, run } from './support/fixture.ts';

it('estima la duración en unidades cerradas y no descuenta los insumos al vender', () => {
  const article = 'supply:pitillo-cuchara';
  const monday = '2026-11-16T17:00:00.000Z';
  const thursday = '2026-11-19T17:00:00.000Z';
  let state = run(fixture(), 'save_supply', { article, unit: 'bolsa', initial: 5 }, admin).state;
  expect(() => run(state, 'save_supply', { article, unit: 'bolsa', initial: 6 }, admin)).toThrow(
    /ya se registró/,
  );
  const open = (at: string) =>
    applyCommand(state, cmd('open_supply', { article }, cashier, { at }), cashier, at).state;
  state = open(monday);
  for (let index = 0; index < 3; index++) {
    const sale = order(state, 100);
    state = sale.state;
    const at = '2026-11-17T17:00:00.000Z';
    state = applyCommand(state, cmd('pay', { orderId: sale.order.id }, cashier, { at }), cashier, at).state;
  }
  expect(stockBalances(state)[article]).toBe(4);
  state = open(thursday);
  expect(supplyDuration(state).find((item) => item.id === article)).toMatchObject({
    remaining: 3,
    days: 3,
    cups: 300,
  });
  expect(visibleClosingArticles(state, state.shifts[0]).some((item) => item.id === article)).toBe(false);
  state = run(
    state,
    'review_shift',
    { shiftId: ids.shift, action: 'set_closing_supplies', items: [article] },
    admin,
  ).state;
  expect(visibleClosingArticles(state, state.shifts[0]).some((item) => item.id === article)).toBe(true);
  expect(state.audit.find((item) => item.action === 'save_supply')?.detail).toContain('Saldo inicial: 5');
});

it('cuenta los insumos seleccionados del inventario aunque todavía no tengan saldo inicial', () => {
  let state = fixture();
  const supply = 'supply:bolsa-cierre';
  const flavor = state.flavors[0].id;
  const bag = `sealed_bag:${flavor}`;
  const select = (items: string[]) =>
    run(state, 'review_shift', { shiftId: ids.shift, action: 'set_closing_supplies', items }, admin);

  expect(() => select([`liquid:${flavor}`])).toThrow(/insumos del inventario/);
  expect(() => select(['supply:desconocido'])).toThrow(/insumos del inventario/);
  state = select([supply, bag, supply]).state;
  expect(state.shifts[0].closingSupplies).toEqual([supply, bag]);

  const preview = visibleClosingPreview(state, state.shifts[0]);
  expect(preview.expectedItems[supply]).toBe(0);
  expect(preview.expectedItems[bag]).toBe(stockBalances(state)[bag] ?? 0);
  expect(preview.expectedItems).not.toHaveProperty('coronita');
  const counted = run(state, 'submit_blind_count', {
    shiftId: ids.shift,
    kind: 'closing',
    attempt: 1,
    preview,
    cash: preview.expectedCash,
    payments: preview.expectedPayments,
    items: { ...preview.expectedItems, [supply]: 3 },
    notes: 'Primer conteo de bolsas de cierre.',
  });
  expect(counted.state.counts.at(-1)?.items[supply]).toBe(3);
});
