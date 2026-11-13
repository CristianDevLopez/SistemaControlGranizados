import { describe, expect, it } from 'vitest';
import { applyCommand, quotePayment, closingPaymentMethods, redactState } from '../src/domain/engine.ts';
import { hasPermission } from '../src/domain/access.ts';
import { quoteOrder } from '../src/domain/pricing.ts';
import type { Actor, CommandType, Promotion, State } from '../src/domain/types.ts';
import {
  admin,
  cashier,
  support,
  ids,
  NOW,
  fixture,
  run,
  order,
  cmd,
  countedItems,
} from './support/fixture.ts';

const line = (s: State, quantity = 1) => ({ flavorId: ids.flavor, sizeId: s.sizes[0].id, quantity });
function benefits(quantity = 3, stackable = true) {
  let s = fixture();
  s = run(
    s,
    'save_promotion',
    {
      name: 'Un granizado de 12 oz con licor',
      effect: 'free',
      delivery: 'coupon',
      sizeIds: [s.sizes[0].id],
      flavorIds: [ids.flavor],
      alcohol: 'yes',
      stackable,
      startsAt: '2026-01-01T00:00:00Z',
      endsAt: '2027-01-01T00:00:00Z',
    },
    admin,
  ).state;
  for (let i = 0; i < quantity; i++)
    s = run(
      s,
      'issue_coupon',
      {
        promotionId: s.promotions[0].id,
        code: `ABCDEFGHJKLMNPQ${i + 2}`,
        courtesy: true,
        expiresAt: '2026-12-01T00:00:00Z',
      },
      admin,
    ).state;
  return s;
}
function close(s = fixture()) {
  return run(s, 'count', {
    kind: 'closing',
    shiftId: ids.shift,
    cash: 20000,
    retained: 10000,
    locationId: ids.location,
    items: countedItems(s),
    payments: { [`transfer:${ids.location}`]: 0 },
  }).state;
}

describe('perfiles y permisos individuales', () => {
  it('conserva permisos existentes y permite restringir pedidos sin cambiar el rol', () => {
    expect(hasPermission(support, 'orders')).toBe(true);
    expect(() =>
      run(
        fixture(),
        'create_order',
        { lines: [line(fixture())] },
        { ...support, permissions: { orders: false } },
      ),
    ).toThrow(/permiso/);
    const created = run(fixture(), 'create_order', { lines: [line(fixture())] }, support);
    expect(created.state.orders[0].sellerId).toBe(support.id);
    const edited = run(created.state, 'update_order', {
      orderId: created.result.referenceId,
      expectedVersion: 1,
      lines: [{ ...line(created.state), quantity: 2 }],
    });
    const paid = run(edited.state, 'pay', { orderId: created.result.referenceId }).state;
    expect(paid.orders[0]).toMatchObject({ sellerId: support.id, cashierId: cashier.id, status: 'paid' });
  });
  it('el apoyo nunca cobra aunque se habilite el permiso o se le asigne el equipo principal', () => {
    const s = order(fixture());
    s.state.shifts[0].cashierId = support.id;
    s.state.shifts[0].deviceId = support.deviceId;
    const actor = { ...support, primary: true, permissions: { payments: true } };
    for (const type of ['pay', 'redeem_coupon', 'refund_order', 'request_transfer'] as CommandType[])
      expect(() => run(s.state, type, { orderId: s.order.id }, actor)).toThrow(/permiso/);
  });
  it('restringe cobros, gastos, entregas, inventario, movimientos y turnos en servidor', () => {
    for (const [permission, type] of [
      ['payments', 'pay'],
      ['expenses', 'expense'],
      ['deliveries', 'deliver'],
      ['inventory', 'open_bag'],
      ['transfers', 'request_transfer'],
      ['shifts', 'count'],
    ] as const)
      expect(() => run(fixture(), type, {}, { ...cashier, permissions: { [permission]: false } })).toThrow(
        /permiso/,
      );
  });
});

describe('cierre definitivo y provisional', () => {
  for (const status of ['closed', 'provisional'] as const)
    it(`bloquea operaciones de trabajadores en turno ${status}`, () => {
      const created = order(fixture());
      const s = close(created.state);
      s.shifts[0].status = status;
      const transferId = s.transfers[0].id;
      for (const [type, payload] of [
        [
          'expense',
          {
            source: 'cash',
            amount: 1000,
            category: s.settings[0].expenseCategories[0],
            supplier: 'Tienda',
            notes: 'Nota',
          },
        ],
        ['create_order', { lines: [line(s)] }],
        ['update_order', { orderId: created.order.id, lines: [line(s)] }],
        ['deliver', { orderId: created.order.id }],
        ['request_transfer', { shiftId: ids.shift }],
        ['execute_transfer', { transferId }],
        ['explain_difference', { countId: s.counts[0].id, notes: 'Corrección' }],
        ['open_bag', { flavorId: ids.flavor }],
      ] as [CommandType, Record<string, unknown>][]) {
        expect(() => run(s, type, payload)).toThrow(/cerrado/);
      }
      const modified = run(
        s,
        'expense',
        {
          shiftId: ids.shift,
          source: 'cash',
          amount: 1000,
          category: s.settings[0].expenseCategories[0],
          supplier: 'Tienda',
          notes: 'Corrección administrativa',
        },
        admin,
      ).state;
      expect(modified.expenses[0].shiftId).toBe(ids.shift);
      expect(modified.counts).toEqual(s.counts);
      expect(() => run(s, 'execute_transfer', { transferId }, { ...admin, online: false })).toThrow(
        /conexión/,
      );
      expect(
        run(s, 'execute_transfer', { transferId, evidenceId: ids.photo }, admin).state.transfers[0].status,
      ).toBe('in_transit');
    });
  it('un turno abierto nuevo no permite modificar el anterior con identificadores manipulados', () => {
    const created = order(fixture());
    const s = close(created.state);
    const newShift = { ...s.shifts[0], id: crypto.randomUUID(), status: 'open' as const };
    s.shifts.push(newShift);
    for (const type of ['update_order', 'deliver', 'cancel_order'] as CommandType[]) {
      expect(() =>
        applyCommand(
          s,
          cmd(type, { orderId: created.order.id, lines: [line(s)] }, cashier, { shiftId: newShift.id }),
          cashier,
          NOW,
        ),
      ).toThrow(/cerrado/);
    }
    expect(() =>
      applyCommand(
        s,
        cmd('execute_transfer', { transferId: s.transfers[0].id }, cashier, { shiftId: undefined }),
        cashier,
        NOW,
      ),
    ).toThrow(/cerrado/);
  });
});

describe('cuadre dinámico por cuentas', () => {
  it('conserva cada cuenta, efectivo físico y diferencias originales sin mezclarlos', () => {
    let s = fixture();
    const nequi = { ...s.locations[0], id: crypto.randomUUID(), name: 'Nequi' };
    s.locations.push(nequi);
    for (const [method, accountId] of [
      ['cash', undefined],
      ['transfer', ids.location],
      ['transfer', nequi.id],
    ]) {
      const created = order(s);
      s = run(created.state, 'pay', { orderId: created.order.id, method, accountId }).state;
    }
    s.locations[0].active = false;
    const expected = closingPaymentMethods(s, ids.shift);
    expect(expected.map((x) => x.account.id)).toEqual([ids.location, nequi.id]);
    const result = run(s, 'count', {
      kind: 'closing',
      shiftId: ids.shift,
      cash: 34000,
      retained: 34000,
      items: countedItems(s),
      payments: { [`transfer:${ids.location}`]: 13000, [`transfer:${nequi.id}`]: 15000 },
    }).state;
    expect(result.counts[0].difference).toBe(0);
    expect(result.counts[0].paymentDifferences).toEqual({
      [`transfer:${ids.location}`]: -1000,
      [`transfer:${nequi.id}`]: 1000,
    });
    const blind = redactState(s, cashier);
    expect(blind.payments).toEqual([]);
    expect(closingPaymentMethods(blind, ids.shift).map((m) => m.account.id)).toContain(ids.location);
    expect(() =>
      run(s, 'count', {
        kind: 'closing',
        shiftId: ids.shift,
        cash: 34000,
        retained: 34000,
        items: countedItems(s),
        payments: { [`transfer:${nequi.id}`]: 14000 },
      }),
    ).toThrow(/Falta verificar/);
  });
});

describe('cortesías por producto', () => {
  it('canjea tres cortesías en una factura y registra el producto cubierto por cada una', () => {
    const s = order(benefits(), 3);
    const codes = s.state.coupons.map((c) => c.code);
    const quote = quotePayment(s.state, s.order, NOW, true, codes);
    expect(quote.total).toBe(0);
    expect(quote.applications).toHaveLength(3);
    expect(quote.unusedCodes).toEqual([]);
    const command = cmd('redeem_coupon', { orderId: s.order.id, codes, expectedTotal: 0, deliver: true });
    const paid = applyCommand(s.state, command, cashier, NOW).state;
    expect(paid.coupons.every((c) => c.status === 'redeemed')).toBe(true);
    expect(paid.payments).toHaveLength(0);
    expect(
      redactState(paid, cashier)
        .orders[0].lines[0].appliedRules?.map((r) => r.couponCode)
        .sort(),
    ).toEqual([...codes].sort());
    expect(paid.orders[0].lines[0].appliedRules?.every((r) => r.quantity === 1 && r.unitAmount === 0)).toBe(
      true,
    );
    expect(applyCommand(paid, command, cashier, NOW).state).toEqual(paid);
    const next = order(paid);
    expect(() => run(next.state, 'redeem_coupon', { orderId: next.order.id, codes })).toThrow(/redimido/);
  });
  for (const method of ['cash', 'transfer'])
    it(`cubre uno de dos productos y cobra el otro por ${method}`, () => {
      const s = order(benefits(1), 2);
      const paid = run(s.state, 'redeem_coupon', {
        orderId: s.order.id,
        codes: [s.state.coupons[0].code],
        method,
        accountId: ids.location,
      }).state;
      expect(paid.orders[0].total).toBe(14000);
      expect(paid.payments[0]).toMatchObject({ amount: 14000, method });
    });
  it('presentar tres y canjear dos deja una sin usar sin producir saldo, dinero ni devolución', () => {
    const s = order(benefits(), 2);
    const codes = s.state.coupons.map((c) => c.code);
    const quote = quotePayment(s.state, s.order, NOW, true, codes);
    expect(quote.total).toBe(0);
    expect(quote.coupons).toHaveLength(2);
    expect(quote.unusedCodes).toHaveLength(1);
    const paid = run(s.state, 'redeem_coupon', { orderId: s.order.id, codes }).state;
    expect(paid.coupons.filter((c) => c.status === 'issued')).toHaveLength(1);
    expect(paid.payments).toHaveLength(0);
    const again = order(paid);
    expect(
      run(again.state, 'redeem_coupon', { orderId: again.order.id, codes: quote.unusedCodes }).state.orders[1]
        .total,
    ).toBe(0);
  });
  it('un beneficio no acumulable solo cubre un producto y deja los demás códigos sin usar', () => {
    const s = order(benefits(3, false), 3);
    const quote = quotePayment(
      s.state,
      s.order,
      NOW,
      true,
      s.state.coupons.map((c) => c.code),
    );
    expect(quote.total).toBe(28000);
    expect(quote.coupons).toHaveLength(1);
    expect(quote.unusedCodes).toHaveLength(2);
  });
  it('exige tamaños y sabores exactos al crear y conserva las condiciones del cupón emitido', () => {
    const s = benefits(1);
    expect(() =>
      run(fixture(), 'save_promotion', { ...s.promotions[0], id: undefined, sizeIds: [] }, admin),
    ).toThrow(/exactos/);
    const original = structuredClone(s.coupons[0].benefit);
    const changed = run(
      s,
      'save_promotion',
      { ...s.promotions[0], sizeIds: [s.sizes[1].id], flavorIds: [ids.plain] },
      admin,
    ).state;
    const created = order(changed);
    expect(quotePayment(created.state, created.order, NOW, true, [s.coupons[0].code]).total).toBe(0);
    expect(changed.coupons[0].benefit).toEqual(original);
    const otherSize = order(s, 1, ids.flavor, 1);
    expect(quotePayment(otherSize.state, otherSize.order, NOW, true, [s.coupons[0].code]).coupons).toEqual(
      [],
    );
    const otherFlavor = order(s, 1, ids.plain);
    expect(
      quotePayment(otherFlavor.state, otherFlavor.order, NOW, true, [s.coupons[0].code]).coupons,
    ).toEqual([]);
    expect(() => quotePayment(created.state, created.order, NOW, false, [s.coupons[0].code])).toThrow(
      /conexión/,
    );
  });
  it('no permite agregar cortesías a correcciones con dinero ya pagado', () => {
    const s = order(benefits(1));
    s.order.paymentCredit = 14000;
    expect(() => quotePayment(s.state, s.order, NOW, true, [s.state.coupons[0].code])).toThrow(
      /no son dinero/,
    );
  });
  it('no acumula una cortesía exclusiva con descuentos de horario ni rebasa límites globales', () => {
    const s = order(benefits(3, false), 3);
    s.state.promotions.push({
      ...s.state.promotions[0],
      id: crypto.randomUUID(),
      delivery: 'schedule',
      effect: 'fixed',
      fixedPrice: 10000,
      stackable: true,
    } satisfies Promotion);
    const quote = quotePayment(
      s.state,
      s.order,
      NOW,
      true,
      s.state.coupons.map((c) => c.code),
    );
    expect(quote.total).toBe(28000);
    s.state.promotions[0].maxRedemptions = 1;
    s.state.coupons.forEach((c) => {
      c.benefit!.stackable = true;
    });
    expect(
      quotePayment(
        s.state,
        s.order,
        NOW,
        true,
        s.state.coupons.map((c) => c.code),
      ).coupons,
    ).toHaveLength(1);
  });
});

it('asigna, conserva, reemplaza y quita imágenes de sabores con referencias autorizadas', () => {
  let s = run(
    fixture(),
    'save_flavor',
    { id: ids.flavor, name: 'Maracuyá', alcohol: true, imageId: ids.photo },
    admin,
  ).state;
  expect(s.flavors[0].imageId).toBe(ids.photo);
  s = run(s, 'save_flavor', { ...s.flavors[0], imageId: undefined, name: 'Mango' }, admin).state;
  expect(s.flavors[0].imageId).toBe(ids.photo);
  expect(() => run(s, 'save_flavor', { ...s.flavors[0], imageId: crypto.randomUUID() }, admin)).toThrow(
    /Foto/,
  );
  s = run(s, 'save_flavor', { ...s.flavors[0], removeImage: true }, admin).state;
  expect(s.flavors[0].imageId).toBeUndefined();
});
