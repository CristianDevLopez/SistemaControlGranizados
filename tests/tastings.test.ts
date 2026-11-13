import { describe, expect, it } from 'vitest';
import { applyCommand, stockBalances } from '../src/domain/engine.ts';
import { liquidReconciliation } from '../src/domain/liquid.ts';
import { admin, cashier, cmd, fixture, ids, NOW, order, run, support } from './support/fixture.ts';

function tasting() {
  const { state, result } = run(fixture(), 'taste', { flavorId: ids.flavor });
  return { state, orderId: result.referenceId!, tastingId: state.orders[0].tastings[0].id };
}

describe('correcciones de degustaciones', () => {
  it('elimina una degustación de prueba, restituye sus insumos y cancela el pedido vacío', () => {
    const { state, orderId, tastingId } = tasting();
    const corrected = run(state, 'remove_tasting', { orderId, tastingId, expectedVersion: 2 }).state;
    expect(corrected.orders[0]).toMatchObject({ status: 'cancelled', tastings: [], total: 0 });
    expect(stockBalances(corrected)).toMatchObject({ copita: 0, [`liquid:${ids.flavor}`]: 0 });
    expect(corrected.stock.slice(0, state.stock.length)).toEqual(state.stock);
    expect(corrected.audit.slice(0, state.audit.length)).toEqual(state.audit);
    expect(corrected.audit.at(-1)?.detail).toContain(tastingId);
    expect(corrected.payments).toHaveLength(0);
    expect(liquidReconciliation(corrected)[0]).toMatchObject({ tastings: 0, remaining: 0 });
  });

  it('cambia el sabor sin duplicar la copita y permite eliminar luego el consumo corregido', () => {
    const { state, orderId, tastingId } = tasting();
    const corrected = run(state, 'update_tasting', {
      orderId,
      tastingId,
      flavorId: ids.plain,
      expectedVersion: 2,
    }).state;
    expect(corrected.orders[0].tastings[0]).toEqual({ ...state.orders[0].tastings[0], flavorId: ids.plain });
    expect(stockBalances(corrected)).toMatchObject({
      copita: -1,
      [`liquid:${ids.flavor}`]: 0,
      [`liquid:${ids.plain}`]: -1,
    });
    expect(liquidReconciliation(corrected).map((flavor) => flavor.tastings)).toEqual([0, 1]);
    const removed = run(corrected, 'remove_tasting', { orderId, tastingId, expectedVersion: 3 }).state;
    expect(stockBalances(removed)).toMatchObject({
      copita: 0,
      [`liquid:${ids.flavor}`]: 0,
      [`liquid:${ids.plain}`]: 0,
    });
  });

  it('elimina solo la degustación indicada aunque haya varias del mismo sabor', () => {
    const { state, orderId, tastingId } = tasting();
    const second = run(state, 'taste', { orderId, flavorId: ids.flavor }).state;
    const corrected = run(second, 'remove_tasting', { orderId, tastingId }).state;
    expect(corrected.orders[0].tastings).toEqual([second.orders[0].tastings[1]]);
    expect(corrected.orders[0].status).toBe('open');
    expect(stockBalances(corrected)).toMatchObject({ copita: -1, [`liquid:${ids.flavor}`]: -1 });
  });

  it('conserva el pedido abierto y sus productos cuando se elimina su última degustación', () => {
    const created = order(fixture());
    const tasted = run(created.state, 'taste', { orderId: created.order.id, flavorId: ids.plain }).state;
    const corrected = run(tasted, 'remove_tasting', {
      orderId: created.order.id,
      tastingId: tasted.orders[0].tastings[0].id,
    }).state;
    expect(corrected.orders[0]).toMatchObject({
      status: 'open',
      total: 14000,
      lines: created.order.lines,
      tastings: [],
    });
    expect(stockBalances(corrected)).toMatchObject({ copita: 0, [`liquid:${ids.plain}`]: 0 });
  });

  it('corrige degustaciones en un ticket pagado sin cambiar pagos, productos ni entregas', () => {
    const created = order(fixture());
    const tasted = run(created.state, 'taste', { orderId: created.order.id, flavorId: ids.plain }).state;
    const paid = run(tasted, 'pay', { orderId: created.order.id, deliver: true }).state;
    const corrected = run(paid, 'remove_tasting', {
      orderId: created.order.id,
      tastingId: paid.orders[0].tastings[0].id,
    }).state;
    expect(corrected.orders[0]).toEqual({
      ...paid.orders[0],
      tastings: [],
      version: paid.orders[0].version + 1,
    });
    expect(corrected.payments).toEqual(paid.payments);
    expect(corrected.deliveries).toEqual(paid.deliveries);
    expect(stockBalances(corrected)).toMatchObject({
      copita: 0,
      [`liquid:${ids.plain}`]: 0,
      [`liquid:${ids.flavor}`]: -12,
    });
  });

  it.each(['close_tastings', 'cancel_order'] as const)(
    'permite corregir y eliminar una degustación cerrada mediante %s',
    (close) => {
      const { state, orderId, tastingId } = tasting();
      const closed = run(state, close, { orderId }).state;
      expect(closed.orders[0].status).toBe('tasting_only');
      const changed = run(closed, 'update_tasting', { orderId, tastingId, flavorId: ids.plain }).state;
      expect(changed.orders[0].status).toBe('tasting_only');
      const corrected = run(changed, 'remove_tasting', { orderId, tastingId }).state;
      expect(corrected.orders[0].status).toBe('cancelled');
      expect(stockBalances(corrected)).toMatchObject({
        copita: 0,
        [`liquid:${ids.flavor}`]: 0,
        [`liquid:${ids.plain}`]: 0,
      });
    },
  );

  it('no restituye dos veces al reintentar el mismo evento ni al intentar eliminar de nuevo', () => {
    const { state, orderId, tastingId } = tasting();
    const command = cmd('remove_tasting', { orderId, tastingId, expectedVersion: 2 });
    const corrected = applyCommand(state, command, cashier, NOW).state;
    expect(applyCommand(corrected, command, cashier, NOW).state).toEqual(corrected);
    expect(() => run(corrected, 'remove_tasting', { orderId, tastingId })).toThrow(/Degustación/);
    expect(corrected.stock).toHaveLength(4);
  });

  it.each(['update_tasting', 'remove_tasting', 'close_tastings'] as const)(
    'rechaza %s con una versión anterior',
    (type) => {
      const { state, orderId, tastingId } = tasting();
      expect(() => run(state, type, { orderId, tastingId, flavorId: ids.plain, expectedVersion: 1 })).toThrow(
        /cambió/,
      );
      expect(state.orders[0].tastings).toHaveLength(1);
      expect(state.stock).toHaveLength(2);
    },
  );

  it('rechaza sabores inexistentes o inactivos y degustaciones de otro pedido', () => {
    const { state, orderId, tastingId } = tasting();
    state.flavors[1].active = false;
    for (const flavorId of [ids.plain, ids.other])
      expect(() => run(state, 'update_tasting', { orderId, tastingId, flavorId })).toThrow(/Sabor activo/);
    expect(() => run(state, 'remove_tasting', { orderId, tastingId: ids.other })).toThrow(/Degustación/);
    const another = run(state, 'taste', { flavorId: ids.flavor }).state.orders[1];
    expect(() => run(state, 'remove_tasting', { orderId, tastingId: another.tastings[0].id })).toThrow(
      /Degustación/,
    );
  });

  it('permite eliminar un sabor que ya fue desactivado', () => {
    const { state, orderId, tastingId } = tasting();
    state.flavors[0].active = false;
    expect(run(state, 'remove_tasting', { orderId, tastingId }).state.orders[0].tastings).toHaveLength(0);
  });

  it('la caja principal corrige sin conexión y reproduce los mismos ajustes al sincronizar', () => {
    const { state, orderId, tastingId } = tasting();
    const offline = { ...cashier, online: false };
    const change = cmd('update_tasting', { orderId, tastingId, flavorId: ids.plain, expectedVersion: 2 });
    const remove = cmd('remove_tasting', { orderId, tastingId, expectedVersion: 3 });
    const local = applyCommand(applyCommand(state, change, offline, NOW).state, remove, offline, NOW).state;
    const server = applyCommand(applyCommand(state, change, cashier, NOW).state, remove, cashier, NOW).state;
    expect(local).toEqual(server);
    expect(stockBalances(server)).toMatchObject({
      copita: 0,
      [`liquid:${ids.flavor}`]: 0,
      [`liquid:${ids.plain}`]: 0,
    });
    expect(() => run(state, 'remove_tasting', { orderId, tastingId }, { ...support, online: false })).toThrow(
      /conexión/,
    );
  });

  it('el apoyo corrige degustaciones del turno activo y un administrador corrige las de un turno anterior', () => {
    const { state, orderId, tastingId } = tasting();
    expect(
      run(state, 'remove_tasting', { orderId, tastingId }, support).state.orders[0].tastings,
    ).toHaveLength(0);
    state.shifts[0].status = 'closed';
    expect(() => run(state, 'remove_tasting', { orderId, tastingId })).toThrow(/administrador/);
    expect(run(state, 'remove_tasting', { orderId, tastingId }, admin).state.orders[0].status).toBe(
      'cancelled',
    );
  });

  it('bloquea las correcciones durante un arqueo', () => {
    const { state, orderId, tastingId } = tasting();
    state.settings[0].auditId = ids.other;
    expect(() => run(state, 'remove_tasting', { orderId, tastingId })).toThrow(/arqueo/);
  });
});
