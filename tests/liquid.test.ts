import { it, expect } from 'vitest';
import { liquidReconciliation } from '../src/domain/liquid.ts';
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
