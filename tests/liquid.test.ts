import { it, expect } from 'vitest';
import { liquidFortnight } from '../src/domain/liquid.ts';
import { applyCommand } from '../src/domain/engine.ts';
import {
  inventoryDiscrepancies,
  inventoryDiscrepanciesAt,
  inventoryOpenings,
  liquidBagInventory,
} from '../src/domain/inventory.ts';
import { admin, cashier, cmd, fixture, ids, other, run, order, NOW } from './support/fixture.ts';

it('completa la bolsa anterior al abrir otra del mismo sabor y separa las degustaciones', () => {
  const initial = fixture();
  initial.settings[0].bagOunces = 100;
  let state = run(initial, 'open_bag', { flavorId: ids.flavor, ounces: 200 }).state;
  state = run(state, 'open_bag', { flavorId: ids.plain, ounces: 100 }).state;
  state = run(state, 'taste', { flavorId: ids.flavor }).state;
  const created = order(state);
  state = run(created.state, 'pay', { orderId: created.order.id, deliver: true }).state;
  expect(liquidBagInventory(state)[0]).toMatchObject({ completed: [], remaining: 87 });
  expect(() => run(state, 'exhaust_bag', { bagId: state.bags[0].id })).toThrow(/mismo sabor/);

  const nextAt = '2026-10-23T17:00:00.000Z';
  const next = cmd('open_bag', { flavorId: ids.flavor, ounces: 100 }, cashier, { at: nextAt });
  state = applyCommand(state, next, cashier, nextAt).state;
  state.settings[0].liquidTolerance = 0.1;
  expect(state.bags.map((bag) => bag.exhaustedAt)).toEqual([nextAt, undefined, undefined]);
  expect(inventoryOpenings(state, state.shifts[0]).map((opening) => opening.shiftId)).toEqual([
    ids.shift,
    ids.shift,
    ids.shift,
  ]);
  expect(liquidBagInventory(state)[0]).toMatchObject({
    completed: [{ served: 12, tastings: 1, difference: 87 }],
    remaining: 100,
    aboveTolerance: true,
  });
  expect(state.stock.some((movement) => movement.reason === 'automatic_loss')).toBe(false);
});

it('señala el saldo negativo del sabor al servir más de su bolsa en uso', () => {
  const initial = fixture();
  initial.settings[0].bagOunces = 6;
  const opened = run(initial, 'open_bag', { flavorId: ids.flavor }).state;
  const created = order(opened);
  const state = run(created.state, 'pay', { orderId: created.order.id, deliver: true }).state;
  expect(inventoryDiscrepancies(state)).toContainEqual(
    expect.objectContaining({
      id: `liquid:${ids.flavor}`,
      amount: -6,
      explanation: expect.stringMatching(/consumo supera el líquido registrado/i),
    }),
  );
});

it('acumula solo la ventana configurada y avisa por dos bolsas con poco consumo', () => {
  const state = fixture();
  state.settings[0].liquidTolerance = 0.2;
  for (let day = 1; day <= 7; day++) {
    const date = `2026-11-0${day}`;
    state.bags.push({
      id: date,
      flavorId: ids.flavor,
      openedAt: `${date}T12:00:00Z`,
      ounces: 100,
      by: cashier.id,
    });
    served(state, `${date}T15:00:00Z`, day === 1 ? 0 : day > 4 ? 50 : 100);
  }
  expect(liquidBagInventory(state)[0]).toMatchObject({
    difference: 100,
    consecutiveLow: true,
    aboveTolerance: false,
  });
  expect(liquidBagInventory(state)[0].completed).toHaveLength(5);
  state.settings[0].liquidBagWindow = 2;
  expect(liquidBagInventory(state)[0]).toMatchObject({ difference: 100, aboveTolerance: true });
  state.settings[0].liquidBagWindow = 1;
  expect(liquidBagInventory(state)[0]).toMatchObject({ difference: 50, consecutiveLow: true });
});

it('conserva el saldo de la última bolsa abierta al ordenar el archivo del ensayo', () => {
  const initial = fixture();
  initial.settings[0].bagOunces = 100;
  const state = run(initial, 'open_bag', { flavorId: ids.flavor }).state;
  state.settings[0].rehearsalBaseline = {
    countId: crypto.randomUUID(),
    at: '2026-10-24T05:00:00Z',
    by: ids.admin,
  };
  served(state, NOW, 60);
  served(state, '2026-10-24T07:00:00Z', 46);
  expect(liquidBagInventory(state)[0]).toMatchObject({ completed: [], remaining: -6 });
});

it('calcula las diferencias de ayer con las bolsas y el consumo de ese corte', () => {
  const initial = fixture();
  initial.settings[0].bagOunces = 100;
  const state = run(initial, 'open_bag', { flavorId: ids.flavor }).state;
  served(state, NOW, 106);
  const today = '2026-10-24T07:00:00.000Z';
  const yesterdayEnd = '2026-10-24T04:59:59.999Z';
  const next = cmd('open_bag', { flavorId: ids.flavor, ounces: 100 }, cashier, { at: today });
  const latest = applyCommand(state, next, cashier, today).state;

  expect(inventoryDiscrepanciesAt(latest, yesterdayEnd)).toMatchObject([
    { id: `liquid:${ids.flavor}`, amount: -6 },
  ]);
  expect(inventoryDiscrepancies(latest)).toMatchObject([{ id: `liquid:${ids.flavor}:closed`, amount: -6 }]);
  latest.settings[0].rehearsalBaseline = { countId: crypto.randomUUID(), at: today, by: admin.id };
  expect(inventoryDiscrepanciesAt(latest, yesterdayEnd)).toBeUndefined();
});

it('la apertura corregida solo entra en el turno y en inventario con la aprobación de otro admin', () => {
  const state = fixture();
  const openedAt = '2026-10-23T14:15:00.000Z';
  const payload = {
    correction: true,
    shiftId: ids.shift,
    flavorId: ids.flavor,
    openedAt,
    notes: 'Confirmado en el arqueo',
  };
  expect(() => run(state, 'open_bag', payload, cashier)).toThrow(/administrador/);
  const proposal = run(state, 'open_bag', payload, admin);
  expect(proposal.state.bags).toHaveLength(0);
  expect(proposal.state.stock).toHaveLength(0);
  const approved = run(
    proposal.state,
    'resolve_change',
    { requestId: proposal.result.referenceId, approve: true },
    other,
  ).state;
  expect(approved.bags).toMatchObject([{ shiftId: ids.shift, openedAt, by: ids.other }]);
  expect(approved.stock).toMatchObject([{ at: openedAt }, { at: openedAt }]);
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
