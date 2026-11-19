import { it, expect } from 'vitest';
import { liquidFortnight, liquidReconciliation } from '../src/domain/liquid.ts';
import { fixture, ids, run, order } from './support/fixture.ts';
it('separa degustaciones de desperdicio y espera agotar bolsas para medir residual', () => {
  let s = run(fixture(), 'open_bag', { flavorId: ids.flavor, ounces: 100 }).state;
  s = run(s, 'taste', { flavorId: ids.flavor }).state;
  const a = order(s);
  s = run(a.state, 'pay', { orderId: a.order.id, deliver: true }).state;
  expect(liquidReconciliation(s)[0].ratio).toBeNull();
  s = run(s, 'exhaust_bag', { bagId: s.bags[0].id }).state;
  s.settings[0].liquidTolerance = 0.1;
  const r = liquidReconciliation(s)[0];
  expect(r.served).toBe(12);
  expect(r.tastings).toBe(1);
  expect(r.unexplained).toBe(87);
  expect(r.alert).toBe(true);
  expect(s.stock.some((m) => m.reason === 'automatic_loss')).toBe(false);
});

function served(state: ReturnType<typeof fixture>, date: string, ounces: number, flavorId = ids.flavor) {
  state.stock.push({
    id: crypto.randomUUID(),
    article: `liquid:${flavorId}`,
    quantity: -ounces,
    reason: 'delivery',
    referenceId: crypto.randomUUID(),
    by: ids.cashier,
    eventId: crypto.randomUUID(),
    at: date,
  });
}

it('alerta por pérdida de una bolsa o consumo sin apertura en la quincena de Colombia', () => {
  const state = fixture();
  state.bags.push({
    id: 'bag1',
    by: ids.cashier,
    flavorId: ids.flavor,
    ounces: 202.884136,
    openedAt: '2026-10-16T05:00:00Z',
    exhaustedAt: '2026-10-20T12:00:00Z',
  });
  served(state, '2026-10-16T04:59:59Z', 12);
  served(state, '2026-10-20T12:00:00Z', 202, ids.plain);
  const [lost, missingOpening] = liquidFortnight(state, '2026-10-31', new Date('2026-11-02'));
  expect(lost).toMatchObject({ bagsOpened: 1, opened: 202.884136, nearBag: true, served: 0 });
  expect(missingOpening).toMatchObject({ bagsOpened: 0, served: 202, unexplained: -202, nearBag: true });
});

it('presenta como estimado el saldo que cruza el corte sin inventar una merma', () => {
  const state = fixture();
  state.bags.push({
    id: 'bag1',
    by: ids.cashier,
    flavorId: ids.flavor,
    ounces: 200,
    openedAt: '2026-10-15T05:00:00Z',
    exhaustedAt: '2026-10-20T12:00:00Z',
  });
  served(state, '2026-10-15T12:00:00Z', 50);
  served(state, '2026-10-18T12:00:00Z', 100);
  const [row] = liquidFortnight(state, '2026-10-28', new Date('2026-11-02'));
  expect(row).toMatchObject({
    opening: { measured: false, ounces: 150 },
    closing: { measured: true, ounces: 0 },
    served: 100,
    unexplained: null,
    ratio: null,
    nearBag: false,
  });
});

it('estima la referencia con quincenas anteriores medibles y omite anomalías de una bolsa', () => {
  const state = fixture();
  for (const [day, amount] of [
    ['2026-09-20', 180],
    ['2026-10-03', 190],
    ['2026-10-20', 0],
    ['2026-11-04', 170],
  ] as const) {
    state.bags.push({
      id: day,
      by: ids.cashier,
      flavorId: ids.flavor,
      ounces: 200,
      openedAt: `${day}T10:00:00Z`,
      exhaustedAt: `${day}T18:00:00Z`,
    });
    served(state, `${day}T12:00:00Z`, amount);
  }
  const report = () => liquidFortnight(state, '2026-11-15', new Date('2026-11-17'))[0];
  expect(report()).toMatchObject({ tolerance: 0.075, ratio: 0.15, aboveTolerance: true });
  state.settings[0].liquidTolerance = 0.2;
  expect(report()).toMatchObject({ tolerance: 0.2, aboveTolerance: false });
});
