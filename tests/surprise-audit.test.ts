import { expect, it } from 'vitest';
import { countArticles, countPaymentMethods, redactState } from '../src/domain/engine.ts';
import { fixture, ids, run, admin, cashier, support, other, order, NOW } from './support/fixture.ts';
import type { Actor, State } from '../src/domain/types.ts';

function start(state = fixture(), extra = {}) {
  return run(state, 'start_audit', { shiftId: ids.shift, cash: true, items: [], ...extra }, admin).state;
}
function submit(state: State, extra = {}, actor: Actor = cashier) {
  return run(
    state,
    'finish_audit',
    {
      shiftId: ids.shift,
      auditId: state.settings[0].auditId,
      cash: 20000,
      items: {},
      ...extra,
    },
    actor,
  ).state;
}

it('solo un administrador con conexión y doble factor puede solicitar el arqueo', () => {
  for (const actor of [cashier, support, { ...admin, online: false }, { ...admin, aal: 'aal1' as const }])
    expect(() => run(fixture(), 'start_audit', { shiftId: ids.shift, cash: true }, actor)).toThrow(
      /administrador|factor/,
    );
});

it('exige turno abierto, selección válida y al menos un ítem', () => {
  expect(() => start(fixture(), { cash: false })).toThrow(/al menos un ítem/);
  expect(() => start(fixture(), { shiftId: ids.other })).toThrow(/Turno abierto/);
  const closed = fixture();
  closed.shifts[0].status = 'closed';
  expect(() => start(closed)).toThrow(/Turno abierto/);
  for (const selection of [
    { items: ['inventado'] },
    { items: ['copita', 'copita'] },
    { payments: ['tarjeta'] },
    { cash: 'sí' },
  ])
    expect(() => start(fixture(), selection)).toThrow(/inválid|No repitas/);
  const state = start();
  expect(() => start(state)).toThrow(/Ya existe/);
  expect(() => order(state)).toThrow(/arqueo/);
});

it('solo el responsable del turno puede ingresar el conteo; ser admin no permite sustituirlo', () => {
  const state = start();
  for (const actor of [admin, other, support, { ...cashier, deviceId: ids.remote }])
    expect(() => submit(state, {}, actor)).toThrow(/encargado y equipo/);
  expect(() => submit(state, {}, { ...cashier, online: false })).toThrow(/conexión/);
  expect(submit(state).counts[0].by).toBe(cashier.id);
});

it('un admin responsable del turno sí puede responder su propio arqueo', () => {
  const state = fixture();
  state.shifts[0].cashierId = admin.id;
  state.shifts[0].deviceId = admin.deviceId;
  expect(submit(start(state), {}, admin).counts[0].by).toBe(admin.id);
});

it('impide responder otro turno, un arqueo anterior o el comando alternativo de conteo', () => {
  const state = start();
  expect(() => submit(state, { auditId: ids.other })).toThrow(/arqueo cambió/);
  const alternate = structuredClone(state);
  alternate.shifts[0].id = ids.other;
  expect(() => submit(alternate, { shiftId: ids.other })).toThrow(/otro turno/);
  expect(() => run(state, 'count', { kind: 'audit', shiftId: ids.shift })).toThrow(/arqueo solicitado/);
  const finished = submit(state);
  expect(() => submit(finished)).toThrow(/No hay arqueo/);
});

it('presenta solo los ítems seleccionados sin exigir efectivo ni el resto del inventario', () => {
  const initial = fixture(),
    cup = `cup:${initial.sizes[0].id}`;
  const state = start(initial, { cash: false, items: [cup] });
  expect(countArticles(redactState(state, cashier), 'audit').map((x) => x.id)).toEqual([cup]);
  expect(() => submit(state)).toThrow(/Falta contar/);
  const finished = submit(state, { cash: undefined, items: { [cup]: 3, copita: 999 } });
  expect(finished.counts[0]).toMatchObject({
    items: { [cup]: 3 },
    differences: { [cup]: 3 },
    requestedBy: admin.id,
    requestedAt: NOW,
    auditId: state.settings[0].auditId,
  });
  expect(finished.counts[0].cash).toBeUndefined();
  expect(finished.counts[0].expectedCash).toBeUndefined();
  expect(finished.settings[0].auditId).toBeUndefined();
  expect(finished.settings[0].auditRequest).toBeUndefined();
  expect(finished.shifts[0].status).toBe('open');
  expect(order(finished).order.status).toBe('open');
});

it('permite seleccionar líquidos con decimales y conserva unidades enteras para vasos', () => {
  const initial = fixture(),
    liquid = `liquid:${ids.flavor}`,
    cup = `cup:${initial.sizes[0].id}`;
  const state = start(initial, { cash: false, items: [liquid, cup] });
  expect(() => submit(state, { items: { [liquid]: 12.5, [cup]: 1.5 } })).toThrow(/enteros/);
  expect(submit(state, { items: { [liquid]: 12.5, [cup]: 1 } }).counts[0].items[liquid]).toBe(12.5);
});

it('guarda el corte solicitado y oculta todos los esperados al cajero', () => {
  const initial = fixture();
  const created = order(initial);
  const paid = run(created.state, 'pay', {
    orderId: created.order.id,
    method: 'transfer',
    accountId: ids.location,
  }).state;
  const key = `transfer:${ids.location}`;
  const state = start(paid, { items: ['copita'], payments: [key] });
  const view = redactState(state, cashier);
  expect(view.settings[0].auditRequest).toMatchObject({ cash: true, items: ['copita'], payments: [key] });
  for (const name of ['expectedCash', 'expectedItems', 'expectedPayments'])
    expect(view.settings[0].auditRequest).not.toHaveProperty(name);
  state.locations[0].active = false;
  expect(countPaymentMethods(redactState(state, cashier), ids.shift, 'audit').map((x) => x.id)).toEqual([
    key,
  ]);
  state.stock.push({
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    article: 'copita',
    quantity: 100,
    reason: 'receipt',
    referenceId: crypto.randomUUID(),
    by: admin.id,
    at: NOW,
  });
  expect(() => submit(state, { items: { copita: 2 } })).toThrow(/Falta verificar/);
  const finished = submit(state, { cash: 21000, items: { copita: 2 }, payments: { [key]: 13000 } });
  expect(finished.counts[0]).toMatchObject({
    expectedCash: 20000,
    difference: 1000,
    expectedItems: { copita: 0 },
    differences: { copita: 2 },
    expectedPayments: { [key]: 14000 },
    paymentDifferences: { [key]: -1000 },
  });
  const counted = redactState(finished, cashier).counts[0];
  expect(counted.expectedCash).toBeUndefined();
  expect(counted.expectedItems).toBeUndefined();
  expect(counted.expectedPayments).toBeUndefined();
  expect(counted.paymentDifferences).toBeUndefined();
  expect(counted.by).toBe(cashier.id);
  const original = structuredClone(finished.counts);
  const explained = run(finished, 'explain_difference', {
    countId: original[0].id,
    notes: 'Revisión del comprobante',
  }).state;
  expect(explained.counts).toEqual(original);
});

it('permite completar un arqueo anterior sin selección guardada desde la caja responsable', () => {
  const state = fixture();
  state.settings[0].auditId = ids.other;
  const items = Object.fromEntries(countArticles(state, 'audit').map((a) => [a.id, 0]));
  expect(submit(state, { items }).counts[0].auditId).toBe(ids.other);
});
