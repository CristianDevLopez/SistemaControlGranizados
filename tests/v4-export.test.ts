import { expect, it } from 'vitest';
import { salesDetail, colombiaDate } from '../src/lib/v4-export.ts';
import { fixture, order, run, ids } from './support/fixture.ts';
it('exporta un vaso por fila, reparte adiciones y conserva el total exacto del pedido', () => {
  let s = fixture();
  s.settings[0].v4Enabled = true;
  const created = order(s, 3);
  s = created.state;
  s = run(s, 'update_order', {
    orderId: created.order.id,
    lines: s.orders[0].lines,
    additions: [{ id: 'cintas', quantity: 1 }],
  }).state;
  s = run(s, 'pay', { orderId: created.order.id, deliver: true }).state;
  const rows = salesDetail(s);
  expect(rows).toHaveLength(3);
  expect(rows.reduce((n, r) => n + r.precio_cobrado, 0)).toBe(s.orders[0].total);
  expect(rows.map((r) => r.adiciones_asignadas)).toEqual([167, 167, 166]);
  expect(rows[0].costos_historicos_faltantes).toBe(true);
});
it('el rango se decide por el día colombiano, incluyendo el límite de medianoche', () => {
  let s = fixture();
  const created = order(s);
  s = run(created.state, 'pay', { orderId: created.order.id, deliver: true }).state;
  s.orders[0].paidAt = '2026-11-28T04:59:59.000Z';
  expect(salesDetail(s, { from: '2026-11-27', to: '2026-11-27' })).toHaveLength(1);
  expect(salesDetail(s, { from: '2026-11-28', to: '2026-11-28' })).toHaveLength(0);
  expect(colombiaDate(s.orders[0].paidAt)).toBe('2026-11-27T23:59:59-05:00');
});
