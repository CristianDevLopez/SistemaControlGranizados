import { describe, expect, it } from 'vitest';
import { applyCommand, stockBalances } from '../src/domain/engine.ts';
import { eligible, quoteOrder } from '../src/domain/pricing.ts';
import { lineFlavorIds } from '../src/domain/flavors.ts';
import { liquidReconciliation } from '../src/domain/liquid.ts';
import type { Promotion } from '../src/domain/types.ts';
import { admin, cashier, cmd, fixture, ids, NOW, other, run } from './support/fixture.ts';

const third = '30000000-0000-4000-8000-000000000003';
function flavorsFixture() {
  const state = fixture();
  state.flavors.push({ id: third, name: 'Tercer sabor sin licor', alcohol: false, active: true });
  return state;
}
function mixed(state = flavorsFixture(), flavorIds = [ids.flavor, ids.plain], quantity = 1, sizeIndex = 1) {
  const result = run(state, 'create_order', {
    lines: [{ flavorIds, sizeId: state.sizes[sizeIndex].id, quantity }],
  });
  return {
    state: result.state,
    order: result.state.orders.find((order) => order.id === result.result.referenceId)!,
  };
}
const promotion = (extra: Partial<Promotion> = {}): Promotion => ({
  id: crypto.randomUUID(),
  name: 'Descuento',
  effect: 'fixed',
  fixedPrice: 5000,
  delivery: 'schedule',
  sizeIds: [],
  flavorIds: [],
  alcohol: 'all',
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2027-01-01T00:00:00.000Z',
  days: [],
  startTime: '00:00',
  endTime: '23:59',
  maxRedemptions: null,
  redemptions: 0,
  active: true,
  version: 1,
  by: ids.admin,
  at: NOW,
  ...extra,
});

describe('vasos de uno o varios sabores', () => {
  it('reparte 16 oz entre dos sabores y cobra una sola tarifa con licor, sin importar el orden', () => {
    const { state, order } = mixed(flavorsFixture(), [ids.plain, ids.flavor]);
    expect(order.total).toBe(17000);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0].flavorIds).toEqual([ids.flavor, ids.plain]);
    expect(state.stock).toHaveLength(0);
    const paid = run(state, 'pay', { orderId: order.id, deliver: true }).state;
    expect(paid.payments).toHaveLength(1);
    expect(stockBalances(paid)).toMatchObject({
      [`cup:${state.sizes[1].id}`]: -1,
      [`liquid:${ids.flavor}`]: -8,
      [`liquid:${ids.plain}`]: -8,
    });
    expect(paid.deliveries).toHaveLength(1);
    expect(
      liquidReconciliation(paid)
        .filter((flavor) => [ids.flavor, ids.plain].includes(flavor.flavorId))
        .map((flavor) => flavor.served),
    ).toEqual([8, 8]);
  });

  it('cobra la tarifa sin licor cuando todos los sabores son sin licor y admite un solo sabor', () => {
    expect(mixed(flavorsFixture(), [ids.plain, third]).order.total).toBe(12000);
    const { state, order } = mixed(flavorsFixture(), [ids.plain]);
    expect(order.total).toBe(12000);
    expect(lineFlavorIds(order.lines[0])).toEqual([ids.plain]);
    const paid = run(state, 'pay', { orderId: order.id, deliver: true }).state;
    expect(stockBalances(paid)[`liquid:${ids.plain}`]).toBe(-16);
  });

  it.each([0, 1, 2, 3])(
    'reparte el tamaño %i entre tres sabores sin redondear los tercios en inventario',
    (sizeIndex) => {
      const { state, order } = mixed(flavorsFixture(), [third, ids.flavor, ids.plain], 1, sizeIndex);
      const paid = run(state, 'pay', { orderId: order.id, deliver: true }).state;
      const movements = paid.stock.filter((movement) => movement.article.startsWith('liquid:'));
      expect(movements).toHaveLength(3);
      const ounces = state.sizes[sizeIndex].ounces;
      movements.forEach((movement) => expect(movement.quantity).toBeCloseTo(-ounces / 3, 12));
      expect(movements.reduce((sum, movement) => sum + movement.quantity, 0)).toBe(-ounces);
    },
  );

  it('conserva la mezcla al aumentar cantidad, entregar por partes y cobrar sin duplicar el consumo', () => {
    let { state, order } = mixed(flavorsFixture(), [ids.flavor, ids.plain], 2);
    state = run(state, 'deliver', { orderId: order.id, quantities: { [order.lines[0].id]: 1 } }).state;
    const current = state.orders[0];
    state = run(state, 'update_order', {
      orderId: order.id,
      lines: [{ ...current.lines[0], flavorIds: [ids.plain, ids.flavor], quantity: 3 }],
    }).state;
    const payment = cmd('pay', { orderId: order.id, deliver: true });
    state = applyCommand(state, payment, cashier, NOW).state;
    state = applyCommand(state, payment, cashier, NOW).state;
    expect(state.orders[0].lines[0].delivered).toBe(3);
    expect(state.payments).toHaveLength(1);
    expect(stockBalances(state)).toMatchObject({
      [`liquid:${ids.flavor}`]: -24,
      [`liquid:${ids.plain}`]: -24,
      [`cup:${state.sizes[1].id}`]: -3,
    });
    expect(() =>
      run(state, 'deliver', { orderId: order.id, quantities: { [order.lines[0].id]: 1 } }),
    ).toThrow(/más/);
  });

  it('conserva las onzas originales al cambiar después la receta del tamaño', () => {
    const { state, order } = mixed();
    state.sizes[1].ounces = 99;
    const delivered = run(state, 'deliver', { orderId: order.id }).state;
    expect(stockBalances(delivered)[`liquid:${ids.flavor}`]).toBe(-8);
    expect(stockBalances(delivered)[`liquid:${ids.plain}`]).toBe(-8);
  });

  it.each([[], [ids.flavor, ids.flavor], [ids.flavor, ids.other], ['no-es-uuid'], 'inválido', null])(
    'rechaza una selección inválida: %j',
    (flavorIds) => {
      const state = flavorsFixture();
      expect(() =>
        run(state, 'create_order', { lines: [{ flavorIds, sizeId: state.sizes[1].id, quantity: 1 }] }),
      ).toThrow();
      expect(state.orders).toHaveLength(0);
    },
  );

  it('rechaza sabores inactivos, un sabor principal ajeno y una tarifa no configurada', () => {
    let state = flavorsFixture();
    state.flavors[1].active = false;
    expect(() => mixed(state)).toThrow(/Sabor activo/);
    state = flavorsFixture();
    expect(() =>
      run(state, 'create_order', {
        lines: [
          { flavorId: third, flavorIds: [ids.flavor, ids.plain], sizeId: state.sizes[1].id, quantity: 1 },
        ],
      }),
    ).toThrow(/pertenecer/);
    state.sizes[1].alcoholPrice = null;
    expect(() => mixed(state)).toThrow(/precio/);
  });

  it('no permite cambiar una mezcla ya entregada aunque conserve su primer sabor', () => {
    const { state, order } = mixed();
    const delivered = run(state, 'deliver', { orderId: order.id }).state;
    expect(() =>
      run(delivered, 'update_order', {
        orderId: order.id,
        lines: [{ ...delivered.orders[0].lines[0], flavorIds: [ids.flavor, third] }],
      }),
    ).toThrow(/entregado/);
  });

  it('aplica promociones con licor por vaso completo y exige que todos los sabores estén incluidos si se restringen', () => {
    const { state, order } = mixed();
    const line = order.lines[0];
    expect(eligible(promotion({ flavorIds: [ids.flavor] }), line, state)).toBe(false);
    expect(eligible(promotion({ flavorIds: [ids.flavor, ids.plain] }), line, state)).toBe(true);
    expect(eligible(promotion({ alcohol: 'no' }), line, state)).toBe(false);
    state.promotions = [promotion({ alcohol: 'yes' })];
    expect(quoteOrder(state, [line], NOW, true).total).toBe(5000);
    state.promotions = [promotion({ effect: 'upgrade', steps: 1, alcohol: 'yes' })];
    expect(quoteOrder(state, [line], NOW, true).total).toBe(14000);
  });

  it('corrige la mezcla entregada devolviendo cada porción anterior y descontando las nuevas, sin duplicar vasos', () => {
    let { state, order } = mixed(flavorsFixture(), [ids.flavor, ids.plain], 1, 0);
    state = run(state, 'pay', { orderId: order.id, deliver: true }).state;
    state = run(
      state,
      'request_void',
      { orderId: order.id, notes: 'Corrección de mezcla', evidenceId: ids.photo },
      admin,
    ).state;
    state = run(state, 'resolve_request', { requestId: state.requests[0].id, approve: true }, other).state;
    state = run(state, 'replace_order', {
      orderId: order.id,
      sameDelivery: true,
      lines: [{ flavorIds: [ids.flavor, third], sizeId: state.sizes[0].id, quantity: 1 }],
    }).state;
    const replacement = state.orders.find((order) => order.replacesId)!;
    state = run(state, 'pay', { orderId: replacement.id, deliver: true }).state;
    expect(stockBalances(state)).toMatchObject({
      [`liquid:${ids.flavor}`]: -6,
      [`liquid:${ids.plain}`]: 0,
      [`liquid:${third}`]: -6,
      [`cup:${state.sizes[0].id}`]: -1,
    });
    expect(state.deliveries).toHaveLength(1);
    expect(state.payments.reduce((sum, payment) => sum + payment.amount, 0)).toBe(14000);
  });

  it('registra una mezcla desde papel y descuenta cada sabor al indicar que fue entregada', () => {
    const initial = flavorsFixture();
    const state = run(
      initial,
      'record_paper',
      {
        shiftId: ids.shift,
        paperFolio: 'MIX-1',
        evidenceId: ids.photo,
        originalAt: NOW,
        delivered: true,
        lines: [
          { flavorIds: [ids.flavor, ids.plain], sizeId: initial.sizes[0].id, quantity: 1, unitPrice: 14000 },
        ],
      },
      admin,
    ).state;
    expect(state.orders[0].lines[0].flavorIds).toEqual([ids.flavor, ids.plain]);
    expect(stockBalances(state)).toMatchObject({ [`liquid:${ids.flavor}`]: -6, [`liquid:${ids.plain}`]: -6 });
  });

  it('una mezcla puede crearse y cobrarse sin conexión desde la caja principal', () => {
    const state = flavorsFixture(),
      offline = { ...cashier, online: false };
    const created = run(
      state,
      'create_order',
      { lines: [{ flavorIds: [ids.flavor, ids.plain], sizeId: state.sizes[0].id, quantity: 1 }] },
      offline,
    );
    const paid = run(
      created.state,
      'pay',
      { orderId: created.result.referenceId, deliver: true },
      offline,
    ).state;
    expect(stockBalances(paid)).toMatchObject({ [`liquid:${ids.flavor}`]: -6, [`liquid:${ids.plain}`]: -6 });
  });
});
