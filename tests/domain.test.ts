import { describe, it, expect } from 'vitest';
import {
  applyCommand,
  cashExpected,
  openingExpectedCash,
  stockBalances,
  redactState,
} from '../src/domain/engine.ts';
import { quoteOrder } from '../src/domain/pricing.ts';
import { initialState } from '../src/domain/initial.ts';
import type { Promotion } from '../src/domain/types.ts';
import {
  NOW,
  ids,
  fixture,
  cashier,
  admin,
  other,
  support,
  cmd,
  run,
  order,
  countedItems,
} from './support/fixture.ts';
const promo = (extra: Partial<Promotion> = {}): Promotion => ({
  id: crypto.randomUUID(),
  name: 'Prueba',
  effect: 'nxm',
  delivery: 'schedule',
  take: 3,
  pay: 2,
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
describe('Operación del mostrador', () => {
  it('permite agregar inventario inicial varias veces sin reemplazar saldos ni duplicar reintentos', () => {
    let s = run(fixture(), 'initialize_stock', { items: { copita: 10, coronita: 4 } }, admin).state;
    expect(s.settings[0].inventoryInitialized).toBe(true);
    const previousStock = structuredClone(s.stock);
    const command = cmd('initialize_stock', { items: { copita: 5, coronita: 0 } }, admin);
    s = applyCommand(s, command, admin, NOW).state;
    expect(stockBalances(s)).toMatchObject({ copita: 15, coronita: 4 });
    expect(s.stock).toHaveLength(previousStock.length + 1);
    expect(s.stock.slice(0, previousStock.length)).toEqual(previousStock);
    expect(applyCommand(s, command, admin, NOW).state.stock).toEqual(s.stock);
    for (const actor of [cashier, support, { ...admin, online: false }, { ...admin, aal: 'aal1' as const }])
      expect(() => run(s, 'initialize_stock', { items: { copita: 1 } }, actor)).toThrow(/doble factor/);
  });
  it('retira efectivo al ejecutarse y lo conserva en tránsito hasta la confirmación', () => {
    let s = run(fixture(), 'request_transfer', {
      from: `cash:${ids.shift}`,
      to: ids.location,
      amount: 5000,
      shiftId: ids.shift,
      notes: 'Consignación',
    }).state;
    expect(cashExpected(s, ids.shift)).toBe(20000);
    s = run(s, 'execute_transfer', { transferId: s.transfers[0].id, evidenceId: ids.photo }).state;
    expect(cashExpected(s, ids.shift)).toBe(15000);
    expect(s.transfers[0].status).toBe('in_transit');
    s = run(s, 'confirm_transfer', { transferId: s.transfers[0].id, receivedAmount: 4000 }, admin).state;
    expect(s.transfers[0].status).toBe('disputed');
    expect(cashExpected(s, ids.shift)).toBe(15000);
  });
  it('exige tres aprobaciones distintas antes de ejecutar un reembolso', () => {
    let s = run(
      fixture(),
      'expense',
      {
        source: 'personal',
        amount: 10000,
        category: 'Insumos',
        supplier: 'Prueba',
        notes: 'Pago personal',
        evidenceId: ids.photo,
      },
      admin,
    ).state;
    s = run(s, 'approve_expense', { expenseId: s.expenses[0].id, approve: true }, other).state;
    const transferId = s.transfers[0].id;
    for (const actor of [admin, other])
      s = run(s, 'approve_payout', { transferId, evidenceId: ids.photo }, actor).state;
    expect(() =>
      run(s, 'execute_transfer', { transferId, evidenceId: ids.photo, from: ids.location }, other),
    ).toThrow(/tres/);
    expect(() => run(s, 'approve_payout', { transferId, evidenceId: ids.photo }, other)).toThrow(/Ya/);
    s = run(s, 'approve_payout', { transferId, evidenceId: ids.photo }, { ...admin, id: ids.third }).state;
    s = run(s, 'execute_transfer', { transferId, evidenceId: ids.photo, from: ids.location }, other).state;
    expect(s.transfers[0].status).toBe('in_transit');
  });
  it('inicia sin sabores, personas ni ventas ficticias y con los precios confirmados', () => {
    const s = initialState();
    expect(s.flavors).toHaveLength(0);
    expect(s.orders).toHaveLength(0);
    expect(s.sizes.slice(0, 4).map((s) => s.alcoholPrice)).toEqual([14000, 17000, 19500, 23000]);
    expect(s.sizes[4].active).toBe(false);
  });
  it('registra entregas parciales separadas del dinero, sin duplicar al reintentar', () => {
    let { state: s, order: o } = order(fixture(), 2);
    const c = cmd('deliver', { orderId: o.id, quantities: { [o.lines[0].id]: 1 } }, support);
    s = applyCommand(s, c, support, NOW).state;
    expect(s.payments).toHaveLength(0);
    expect(stockBalances(s)[`liquid:${ids.flavor}`]).toBe(-12);
    expect(s.orders[0].lines[0].delivered).toBe(1);
    expect(applyCommand(s, c, support, NOW).state.stock).toHaveLength(s.stock.length);
    s = run(s, 'pay', { orderId: o.id, deliver: true }).state;
    expect(s.payments[0].amount).toBe(28000);
    expect(stockBalances(s)[`liquid:${ids.flavor}`]).toBe(-24);
  });
  it('rechaza cobrar desde apoyo, admin remoto u otro equipo', () => {
    const { state, order: o } = order(fixture());
    for (const actor of [support, admin, { ...cashier, deviceId: ids.remote }])
      expect(() => run(state, 'pay', { orderId: o.id }, actor)).toThrow(/encargado/);
  });
  it('conserva degustaciones sin venta y descuenta una copita y una onza', () => {
    let s = run(fixture(), 'taste', { flavorId: ids.flavor }).state;
    const oid = s.orders[0].id;
    s = run(s, 'close_tastings', { orderId: oid }).state;
    expect(s.orders[0].status).toBe('tasting_only');
    expect(stockBalances(s)).toMatchObject({ copita: -1, [`liquid:${ids.flavor}`]: -1 });
    expect(s.payments).toHaveLength(0);
  });
  it('permite cancelar un pedido sin entrega conservando trazabilidad', () => {
    let { state, order: o } = order(fixture());
    state = run(state, 'cancel_order', { orderId: o.id }).state;
    expect(state.orders[0].status).toBe('cancelled');
    expect(state.stock).toHaveLength(0);
  });
  it('solo el equipo principal continúa offline; cupones y admin requieren conexión', () => {
    expect(() => run(fixture(), 'taste', { flavorId: ids.flavor }, { ...support, online: false })).toThrow(
      /conexión/,
    );
    expect(
      run(fixture(), 'taste', { flavorId: ids.flavor }, { ...cashier, online: false }).state.orders,
    ).toHaveLength(1);
    expect(() => run(fixture(), 'save_flavor', { name: 'X' }, { ...admin, online: false })).toThrow(
      /conexión/,
    );
  });
  it('conserva la receta original aunque un admin cambie la composición antes de entregar', () => {
    let { state, order: o } = order(fixture());
    state.sizes[0].ounces = 99;
    state = run(state, 'deliver', { orderId: o.id }).state;
    expect(stockBalances(state)[`liquid:${ids.flavor}`]).toBe(-12);
  });
  it('pausa ventas durante un arqueo y concilia papel sin modificar el conteo', () => {
    let s = run(fixture(), 'start_audit', {}, admin).state;
    expect(() => order(s)).toThrow(/arqueo/);
    s = run(s, 'finish_audit', { shiftId: ids.shift, cash: 20000, items: countedItems(s) }, admin).state;
    const original = structuredClone(s.counts);
    s = run(
      s,
      'record_paper',
      {
        shiftId: ids.shift,
        paperFolio: 'A-1',
        evidenceId: ids.photo,
        originalAt: '2026-10-23T15:30:00.000Z',
        delivered: true,
        lines: [{ flavorId: ids.flavor, sizeId: s.sizes[0].id, quantity: 1, unitPrice: 14000 }],
      },
      admin,
    ).state;
    expect(s.counts).toEqual(original);
    expect(s.payments[0].at).toBe('2026-10-23T15:30:00.000Z');
    expect(() =>
      run(s, 'record_paper', { shiftId: ids.shift, paperFolio: 'A-1', originalAt: NOW }, admin),
    ).toThrow(/folio/);
  });
  it('cierra con base retenida y remanente solicitado sin descontarlo todavía', () => {
    let s = run(fixture(), 'count', {
      kind: 'closing',
      shiftId: ids.shift,
      cash: 21000,
      retained: 5000,
      locationId: ids.location,
      items: countedItems(fixture()),
    }).state;
    expect(s.counts[0].difference).toBe(1000);
    expect(s.transfers[0].amount).toBe(16000);
    expect(openingExpectedCash(s)).toBe(21000);
    s = run(s, 'execute_transfer', { transferId: s.transfers[0].id, evidenceId: ids.photo }).state;
    expect(openingExpectedCash(s)).toBe(5000);
    s = run(s, 'confirm_transfer', { transferId: s.transfers[0].id, receivedAmount: 16000 }, admin).state;
    expect(s.transfers[0].status).toBe('confirmed');
    expect(s.counts[0].cash).toBe(21000);
  });
  it('no revela valores esperados ni contenido del envío antes del conteo', () => {
    const s = fixture();
    s.counts.push({
      id: crypto.randomUUID(),
      kind: 'opening',
      shiftId: ids.shift,
      by: ids.cashier,
      at: NOW,
      cash: 20000,
      items: {},
      expectedCash: 20000,
      expectedItems: {},
      difference: 0,
      differences: {},
      notes: '',
    });
    const view = redactState(s, cashier);
    expect(view.counts[0].expectedCash).toBeUndefined();
    expect(view.payments).toHaveLength(0);
    expect(view.stock).toHaveLength(0);
  });
  it('no permite autoanulación y corrige sin doble cobro ni doble entrega', () => {
    let { state: s, order: o } = order(fixture());
    s = run(s, 'pay', { orderId: o.id, deliver: true }).state;
    s = run(s, 'request_void', { orderId: o.id, notes: 'Error de registro', evidenceId: ids.photo }).state;
    const rid = s.requests[0].id;
    expect(() =>
      run(s, 'resolve_request', { requestId: rid, approve: true }, { ...admin, id: ids.cashier }),
    ).toThrow(/propia/);
    s = run(s, 'resolve_request', { requestId: rid, approve: true }, admin).state;
    s = run(s, 'replace_order', {
      orderId: o.id,
      sameDelivery: true,
      lines: [{ flavorId: ids.flavor, sizeId: s.sizes[0].id, quantity: 1 }],
    }).state;
    const replacement = s.orders.find((o) => o.replacesId)!;
    s = run(s, 'pay', { orderId: replacement.id, deliver: true }).state;
    expect(s.payments.reduce((n, p) => n + p.amount, 0)).toBe(14000);
    expect(stockBalances(s)[`liquid:${ids.flavor}`]).toBe(-12);
    expect(s.deliveries).toHaveLength(1);
  });
  it('rechaza precios cero en catálogo y conserva negativos de inventario', () => {
    expect(() => run(fixture(), 'save_size', { id: fixture().sizes[0].id, alcoholPrice: 0 }, admin)).toThrow(
      /Precio/,
    );
    const { state: s, order: o } = order(fixture());
    expect(stockBalances(run(s, 'deliver', { orderId: o.id }).state)[`cup:${s.sizes[0].id}`]).toBe(-1);
  });
  it('recepciona parcialmente sin incluir dañados como mercancía utilizable', () => {
    let s = run(
      fixture(),
      'create_shipment',
      { from: 'Medellín', supplier: 'Prueba', items: [{ article: 'copita', quantity: 10, unitCost: 20 }] },
      admin,
    ).state;
    s = run(s, 'receive_shipment', {
      shipmentId: s.shipments[0].id,
      items: { copita: 5 },
      damaged: { copita: 1 },
      evidenceId: ids.photo,
    }).state;
    expect(stockBalances(s).copita).toBe(4);
    expect(s.shipments[0].status).toBe('partial');
    expect(s.receipts[0].differences!.copita).toBe(-5);
  });
  it('no justifica ni descuenta daño pendiente; solo al aprobarlo', () => {
    let s = run(fixture(), 'report_damage', {
      article: 'copita',
      quantity: 2,
      notes: 'Daño visible',
      evidenceId: ids.photo,
    }).state;
    expect(s.stock).toHaveLength(0);
    s = run(s, 'resolve_request', { requestId: s.requests[0].id, approve: true }, admin).state;
    expect(stockBalances(s).copita).toBe(-2);
  });
  it('mantiene cierre offline provisional hasta la validación del servidor', () => {
    const s = run(
      fixture(),
      'count',
      { kind: 'closing', shiftId: ids.shift, cash: 20000, retained: 20000, items: countedItems(fixture()) },
      { ...cashier, online: false },
    ).state;
    expect(s.shifts[0].status).toBe('provisional');
  });
});
describe('Promociones y cupones', () => {
  it('consulta la vigencia actual de cupones aunque el dispositivo conserve una configuración anterior', () => {
    let s = fixture();
    s.promotions = [promo({ effect: 'free', delivery: 'coupon' })];
    (s.parameters[0].after as any).promotions = structuredClone(s.promotions);
    s = run(
      s,
      'issue_coupon',
      {
        promotionId: s.promotions[0].id,
        code: 'ABCDEFGHJKLMNPQRSTUV',
        expiresAt: '2026-11-01T00:00:00.000Z',
      },
      admin,
    ).state;
    const a = order(s);
    s = run(a.state, 'save_promotion', { ...s.promotions[0], active: false }, admin).state;
    expect(() =>
      applyCommand(
        s,
        cmd('pay', { orderId: a.order.id, codes: ['ABCDEFGHJKLMNPQRSTUV'] }, cashier, { configVersion: 1 }),
        cashier,
        NOW,
      ),
    ).toThrow(/no está vigente/);
  });
  it('una corrección conserva el cupón consumido sin liberarlo ni repetir su canje', () => {
    let s = fixture();
    s.promotions = [promo({ effect: 'free', delivery: 'coupon' })];
    s = run(
      s,
      'issue_coupon',
      {
        promotionId: s.promotions[0].id,
        code: 'ABCDEFGHJKLMNPQRSTUV',
        expiresAt: '2026-11-01T00:00:00.000Z',
      },
      admin,
    ).state;
    const a = order(s);
    s = run(a.state, 'pay', { orderId: a.order.id, codes: ['ABCDEFGHJKLMNPQRSTUV'], deliver: true }).state;
    s = run(s, 'request_void', {
      orderId: a.order.id,
      notes: 'Corrección del ticket',
      evidenceId: ids.photo,
    }).state;
    s = run(s, 'resolve_request', { requestId: s.requests[0].id, approve: true }, admin).state;
    s = run(s, 'replace_order', {
      orderId: a.order.id,
      sameDelivery: true,
      lines: [{ flavorId: ids.flavor, sizeId: s.sizes[0].id, quantity: 1 }],
    }).state;
    const replacement = s.orders.find((o) => o.replacesId)!;
    expect(replacement.total).toBe(0);
    s = run(s, 'pay', { orderId: replacement.id, deliver: true }).state;
    expect(s.coupons[0].orderId).toBe(a.order.id);
    expect(s.coupons[0].status).toBe('redeemed');
    expect(s.payments).toHaveLength(0);
    expect(s.deliveries).toHaveLength(1);
    expect(s.promotions[0].redemptions).toBe(1);
  });
  it('aplica un cupo global al beneficio más favorable y respeta dos cupones del mismo límite', () => {
    const s = fixture();
    s.promotions = [promo({ effect: 'fixed', fixedPrice: 8000, maxRedemptions: 1 })];
    const a = order(s, 1, ids.flavor, 0),
      b = order(s, 1, ids.flavor, 3);
    const q = quoteOrder(s, [...a.order.lines, ...b.order.lines], NOW, true);
    expect(q.total).toBe(22000);
    expect(Object.values(q.promotionUses)).toEqual([1]);
  });
  it('permite dos grupos N×M con dos cupones sin apilar beneficios', () => {
    let s = fixture();
    s.promotions = [promo({ effect: 'nxm', delivery: 'coupon' })];
    for (const code of ['ABCDEFGHJKLMNPQRSTUV', 'BCDEFGHJKLMNPQRSTUVW'])
      s = run(
        s,
        'issue_coupon',
        { promotionId: s.promotions[0].id, code, expiresAt: '2026-11-01T00:00:00.000Z' },
        admin,
      ).state;
    const a = order(s, 6);
    const q = quoteOrder(
      s,
      a.order.lines,
      NOW,
      true,
      s.coupons.map((c) => c.code),
    );
    expect(q.total).toBe(56000);
    expect(q.coupons).toHaveLength(2);
  });
  it('limita el canje concurrente de beneficios del mismo cupo dentro de una cotización', () => {
    let s = fixture();
    s.promotions = [promo({ effect: 'free', delivery: 'coupon', maxRedemptions: 1 })];
    for (const code of ['ABCDEFGHJKLMNPQRSTUV', 'BCDEFGHJKLMNPQRSTUVW'])
      s = run(
        s,
        'issue_coupon',
        { promotionId: s.promotions[0].id, code, expiresAt: '2026-11-01T00:00:00.000Z' },
        admin,
      ).state;
    const a = order(s, 2),
      q = quoteOrder(
        s,
        a.order.lines,
        NOW,
        true,
        s.coupons.map((c) => c.code),
      );
    expect(q.total).toBe(14000);
    expect(q.coupons).toHaveLength(1);
  });
  it('calcula un carrito grande con varios cupones sin bloquear el mostrador', () => {
    let s = fixture();
    s.promotions = [promo({ effect: 'free', delivery: 'coupon' })];
    for (let i = 0; i < 10; i++)
      s = run(
        s,
        'issue_coupon',
        {
          promotionId: s.promotions[0].id,
          code: `ABCDEFGHJKLMNPQRS${'ABCDEFGHJK'[i]}`,
          expiresAt: '2026-11-01T00:00:00.000Z',
        },
        admin,
      ).state;
    const a = order(s, 100),
      start = performance.now(),
      q = quoteOrder(
        s,
        a.order.lines,
        NOW,
        true,
        s.coupons.map((c) => c.code),
      );
    expect(q.total).toBe(90 * 14000);
    expect(performance.now() - start).toBeLessThan(2000);
  });
  it('agrupa N×M de mayor a menor precio y hace gratis lo más barato de cada grupo', () => {
    const s = fixture();
    s.promotions = [promo()];
    const lines = [0, 1, 2, 3, 0, 1].map((sizeIndex, i) => ({
      ...order(s, 1, ids.flavor, sizeIndex).order.lines[0],
      id: crypto.randomUUID(),
    }));
    const q = quoteOrder(s, lines, NOW, true);
    expect(q.total).toBe(104500 - 17000 - 14000);
  });
  it('elige el mejor beneficio sin acumular promociones en la misma unidad', () => {
    const s = fixture();
    s.promotions = [promo({ effect: 'fixed', fixedPrice: 8000 }), promo({ effect: 'upgrade', steps: 1 })];
    const o = order(s, 1, ids.flavor, 1).order;
    const q = quoteOrder(s, o.lines, NOW, true);
    expect(q.total).toBe(8000);
    expect(q.lines[0].discount).toBe(9000);
  });
  it('un upgrade cobra el tamaño menor y consume el tamaño entregado', () => {
    let s = fixture();
    s.promotions = [promo({ effect: 'upgrade', steps: 1 })];
    let a = order(s, 1, ids.flavor, 1);
    s = run(a.state, 'pay', { orderId: a.order.id, deliver: true }).state;
    expect(s.payments[0].amount).toBe(14000);
    expect(stockBalances(s)[`liquid:${ids.flavor}`]).toBe(-16);
  });
  it('un cupón gratuito es online, se redime una sola vez y autoriza total cero', () => {
    let s = fixture();
    s.promotions = [promo({ effect: 'free', delivery: 'coupon' })];
    s = run(
      s,
      'issue_coupon',
      {
        promotionId: s.promotions[0].id,
        code: 'ABCDEFGHJKLMNPQRSTUV',
        expiresAt: '2026-11-01T00:00:00.000Z',
      },
      admin,
    ).state;
    let a = order(s);
    expect(() =>
      run(
        a.state,
        'pay',
        { orderId: a.order.id, codes: ['ABCDEFGHJKLMNPQRSTUV'] },
        { ...cashier, online: false },
      ),
    ).toThrow();
    s = run(a.state, 'pay', { orderId: a.order.id, codes: ['ABCDEFGHJKLMNPQRSTUV'], deliver: true }).state;
    expect(s.orders[0].total).toBe(0);
    expect(s.coupons[0].status).toBe('redeemed');
    a = order(s);
    expect(() => run(a.state, 'pay', { orderId: a.order.id, codes: ['ABCDEFGHJKLMNPQRSTUV'] })).toThrow();
  });
  it('los límites globales requieren conexión y un horario Colombia respeta la medianoche', () => {
    const s = fixture();
    s.promotions = [
      promo({ effect: 'fixed', fixedPrice: 5000, maxRedemptions: 1, startTime: '22:00', endTime: '02:00' }),
    ];
    const a = order(s);
    expect(quoteOrder(s, a.order.lines, '2026-10-24T04:00:00.000Z', true).total).toBe(5000);
    expect(quoteOrder(s, a.order.lines, '2026-10-24T04:00:00.000Z', false).total).toBe(14000);
    expect(quoteOrder(s, a.order.lines, NOW, true).total).toBe(14000);
  });
});

it('exige el checklist configurado y conserva las tareas que se presentaron', () => {
  const state = fixture();
  state.settings[0].closingChecklist = ['Verifiqué el procedimiento del punto'];
  const payload = {
    kind: 'closing',
    shiftId: ids.shift,
    cash: 20000,
    retained: 20000,
    items: countedItems(state),
  };
  expect(() => run(state, 'count', payload)).toThrow(/checklist/);
  const result = run(state, 'count', { ...payload, checklist: { 0: true } }).state;
  expect(result.counts[0].checklist).toEqual([{ task: 'Verifiqué el procedimiento del punto', done: true }]);
});
