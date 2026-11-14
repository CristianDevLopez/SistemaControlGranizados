import { describe, expect, it } from 'vitest';
import { applyCommand, cashExpected, quotePayment, stockBalances } from '../src/domain/engine.ts';
import type { State } from '../src/domain/types.ts';
import { admin, cashier, cmd, fixture, ids, NOW, run, support } from './support/fixture.ts';

const CODE = 'ABCDEFGHJKLMNPQRSTUV';
const SECOND = 'BCDEFGHJKLMNPQRSTUVW';
const EXPIRES = '2026-11-01T00:00:00.000Z';
function spec(state: State, extra: Record<string, unknown> = {}) {
  return {
    name: 'Cortesía del local',
    sizeId: state.sizes[1].id,
    alcohol: 'yes',
    flavorIds: [],
    allowMixed: true,
    ...extra,
  };
}
function issue(state = fixture(), extra: Record<string, unknown> = {}, code = CODE) {
  return run(state, 'issue_coupon', { courtesySpec: spec(state, extra), expiresAt: EXPIRES, code }, admin)
    .state;
}
function create(state: State, quantity = 1, extra: Record<string, unknown> = {}) {
  const result = run(state, 'create_order', {
    lines: [{ sizeId: state.sizes[1].id, flavorId: ids.flavor, quantity, ...extra }],
  });
  return {
    state: result.state,
    orderId: result.result.referenceId!,
    order: result.state.orders.find((order) => order.id === result.result.referenceId)!,
  };
}

describe('cortesías con código y vaso completo a cero', () => {
  it('genera el beneficio y el código de forma atómica con las condiciones del administrador', () => {
    const state = issue(fixture(), { flavorIds: [ids.flavor], allowMixed: false });
    expect(state.promotions).toHaveLength(1);
    expect(state.promotions[0]).toMatchObject({
      effect: 'free',
      courtesyOnly: true,
      delivery: 'coupon',
      sizeIds: [state.sizes[1].id],
      flavorIds: [ids.flavor],
      alcohol: 'yes',
      allowMixed: false,
      maxRedemptions: 1,
    });
    expect(state.coupons).toHaveLength(1);
    expect(state.coupons[0]).toMatchObject({
      code: CODE,
      courtesy: true,
      issuedBy: admin.id,
      promotionId: state.promotions[0].id,
      status: 'issued',
      expiresAt: EXPIRES,
    });
    expect(state.stock).toHaveLength(0);
    expect(state.payments).toHaveLength(0);
  });

  it('deja a cero todo el vaso combinado e incluye vasos, todos los sabores y los demás insumos de su receta', () => {
    const initial = fixture();
    initial.sizes[1].beers = 2;
    const { state, orderId } = create(issue(initial), 1, { flavorIds: [ids.flavor, ids.plain] });
    const quoted = quotePayment(state, state.orders[0], NOW, true, [CODE]);
    expect(quoted.total).toBe(0);
    expect(state.coupons[0].status).toBe('issued');
    expect(state.stock).toHaveLength(0);
    const paid = run(state, 'redeem_coupon', {
      orderId,
      codes: [CODE],
      expectedTotal: 0,
      deliver: true,
    }).state;
    expect(paid.orders[0]).toMatchObject({ status: 'paid', total: 0, cashierId: cashier.id });
    expect(paid.orders[0].lines[0].discount).toBe(17000);
    expect(paid.payments).toHaveLength(0);
    expect(cashExpected(paid, ids.shift)).toBe(20000);
    expect(stockBalances(paid)).toMatchObject({
      [`cup:${state.sizes[1].id}`]: -1,
      coronita: -2,
      [`liquid:${ids.flavor}`]: -8,
      [`liquid:${ids.plain}`]: -8,
    });
    expect(paid.coupons[0]).toMatchObject({ status: 'redeemed', orderId });
  });

  it('un código cubre un vaso y los adicionales conservan su precio y consumo', () => {
    const { state, orderId } = create(issue(), 2);
    const paid = run(state, 'pay', { orderId, codes: [CODE], expectedTotal: 17000, deliver: true }).state;
    expect(paid.orders[0].total).toBe(17000);
    expect(paid.payments[0].amount).toBe(17000);
    expect(stockBalances(paid)).toMatchObject({
      [`cup:${state.sizes[1].id}`]: -2,
      [`liquid:${ids.flavor}`]: -32,
    });
    expect(paid.promotions[0].redemptions).toBe(1);
  });

  it('permite una cortesía sin licor y conserva los productos de otro tamaño a su precio normal', () => {
    const initial = issue(fixture(), { alcohol: 'no' });
    const created = run(initial, 'create_order', {
      lines: [
        { sizeId: initial.sizes[1].id, flavorId: ids.plain, quantity: 1 },
        { sizeId: initial.sizes[0].id, flavorId: ids.flavor, quantity: 1 },
      ],
    });
    const paid = run(created.state, 'redeem_coupon', {
      orderId: created.result.referenceId,
      codes: [CODE],
      deliver: true,
    }).state;
    expect(paid.orders[0].total).toBe(14000);
    expect(paid.orders[0].lines.map((line) => line.discount)).toEqual([12000, 0]);
    expect(paid.payments[0].amount).toBe(14000);
  });

  it.each([
    { product: { sizeId: fixture().sizes[0].id }, conditions: {} },
    { product: { flavorId: ids.plain }, conditions: {} },
    { product: { flavorIds: [ids.flavor, ids.plain] }, conditions: { allowMixed: false } },
    { product: { flavorIds: [ids.flavor, ids.plain] }, conditions: { flavorIds: [ids.flavor] } },
  ])(
    'rechaza un producto que incumple las condiciones sin consumir el código: %j',
    ({ product, conditions }) => {
      const { state, orderId, order } = create(issue(fixture(), conditions), 1, product);
      expect(() => quotePayment(state, order, NOW, true, [CODE])).toThrow(/no corresponde/);
      expect(() => run(state, 'pay', { orderId, codes: [CODE], deliver: true })).toThrow(/no corresponde/);
      expect(state.coupons[0].status).toBe('issued');
      expect(state.stock).toHaveLength(0);
    },
  );

  it('canjea dos códigos en dos vasos distintos y rechaza usar dos códigos sobre uno solo', () => {
    const initial = issue(issue(), {}, SECOND);
    const { state, orderId } = create(initial, 2);
    const paid = run(state, 'redeem_coupon', { orderId, codes: [CODE, SECOND], deliver: true }).state;
    expect(paid.orders[0].total).toBe(0);
    expect(paid.coupons.map((coupon) => coupon.status)).toEqual(['redeemed', 'redeemed']);
    const one = create(initial);
    expect(() => quotePayment(one.state, one.order, NOW, true, [CODE, SECOND])).toThrow(
      /vaso elegible distinto/,
    );
  });

  it('permite registrar sin cobro y entregar después, descontando la receta solo una vez', () => {
    const { state, orderId } = create(issue());
    const paid = run(state, 'redeem_coupon', { orderId, codes: [CODE], deliver: false }).state;
    expect(paid.orders[0].total).toBe(0);
    expect(paid.stock).toHaveLength(0);
    expect(paid.coupons[0].status).toBe('redeemed');
    const command = cmd('deliver', { orderId });
    const delivered = applyCommand(paid, command, cashier, NOW).state;
    expect(applyCommand(delivered, command, cashier, NOW).state).toEqual(delivered);
    expect(stockBalances(delivered)[`liquid:${ids.flavor}`]).toBe(-16);
  });

  it('rechaza códigos reutilizados, vencidos y canjes sin conexión', () => {
    const { state, orderId, order } = create(issue());
    const paid = run(state, 'pay', { orderId, codes: [CODE] }).state;
    const next = create(paid);
    expect(() => run(next.state, 'pay', { orderId: next.orderId, codes: [CODE] })).toThrow(/redimido/);
    expect(() => quotePayment(state, order, NOW, false, [CODE])).toThrow(/conexión/);
    state.coupons[0].expiresAt = NOW;
    expect(() => quotePayment(state, order, NOW, true, [CODE])).toThrow(/vencido/);
  });

  it('solo un administrador conectado con doble factor puede emitir la cortesía', () => {
    const state = fixture();
    for (const actor of [cashier, support, { ...admin, online: false }, { ...admin, aal: 'aal1' as const }])
      expect(() =>
        run(state, 'issue_coupon', { courtesySpec: spec(state), code: CODE, expiresAt: EXPIRES }, actor),
      ).toThrow(/administrador|doble factor/);
  });

  it('respeta la cuota aunque se envíe courtesy false y no deja beneficios parciales al rechazar la emisión', () => {
    const state = fixture();
    state.settings[0].courtesyQuota = 0;
    expect(() =>
      run(
        state,
        'issue_coupon',
        { courtesy: false, courtesySpec: spec(state), code: CODE, expiresAt: EXPIRES },
        admin,
      ),
    ).toThrow(/cuota/);
    expect(state.promotions).toHaveLength(0);
    expect(state.coupons).toHaveLength(0);
  });

  it('conserva las condiciones emitidas y no permite crear otro código sobre el mismo beneficio', () => {
    const state = issue();
    expect(() => run(state, 'save_promotion', { ...state.promotions[0], alcohol: 'all' }, admin)).toThrow(
      /conserva sus condiciones/,
    );
    expect(() =>
      run(
        state,
        'issue_coupon',
        { promotionId: state.promotions[0].id, code: SECOND, expiresAt: EXPIRES },
        admin,
      ),
    ).toThrow(/ya tiene su código/);
    const initial = fixture(),
      command = cmd('issue_coupon', { courtesySpec: spec(initial), code: CODE, expiresAt: EXPIRES }, admin);
    const issued = applyCommand(initial, command, admin, NOW).state;
    expect(applyCommand(issued, command, admin, NOW).state).toEqual(issued);
  });

  it.each([
    { sizeId: ids.other },
    { alcohol: 'inválido' },
    { alcohol: 'no', flavorIds: [ids.flavor] },
    { flavorIds: [ids.other] },
    { flavorIds: [ids.flavor, ids.flavor] },
    { allowMixed: 'false' },
  ])('valida las condiciones antes de emitir: %j', (conditions) => {
    expect(() => issue(fixture(), conditions)).toThrow();
  });
});

it('conserva la acumulación configurada al generar cortesías directas', () => {
  const exclusive = issue(fixture(), { stackable: false });
  const exclusiveOrder = create(issue(exclusive, { stackable: false }, SECOND), 2);
  const quote = quotePayment(exclusiveOrder.state, exclusiveOrder.order, NOW, true, [CODE, SECOND]);
  expect(exclusiveOrder.state.coupons.every((c) => c.benefit?.stackable === false)).toBe(true);
  expect(quote.coupons).toHaveLength(1);
  expect(quote.unusedCodes).toHaveLength(1);
  expect(quote.total).toBe(exclusiveOrder.order.lines[0].listPrice);
  const stackableOrder = create(issue(issue(fixture()), {}, SECOND), 2);
  expect(quotePayment(stackableOrder.state, stackableOrder.order, NOW, true, [CODE, SECOND]).total).toBe(0);
});
