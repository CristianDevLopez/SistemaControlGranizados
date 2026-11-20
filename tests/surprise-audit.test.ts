import { expect, it } from 'vitest';
import { countArticles, countInventoryAdjustment, redactState, stockBalances } from '../src/domain/engine.ts';
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

it('solo un administrador con conexión puede solicitar el arqueo', () => {
  for (const actor of [cashier, support, { ...admin, online: false }])
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
    { items: ['coronita', 'coronita'] },
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
  for (const actor of [admin, other, { ...cashier, deviceId: ids.remote }])
    expect(() => submit(state, {}, actor)).toThrow(/encargado y equipo/);
  expect(() => submit(state, {}, support)).toThrow(/permiso/);
  expect(() => submit(state, {}, { ...cashier, permissions: { shifts: false } })).toThrow(/permiso/);
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

it('excluye líquidos del arqueo completo y permite terminar un arqueo antiguo que los incluía', () => {
  const initial = fixture(),
    liquid = `liquid:${ids.flavor}`,
    cup = `cup:${initial.sizes[0].id}`;
  expect(() => start(initial, { cash: false, items: [liquid] })).toThrow(/Artículos inválidos/);
  expect(start(initial, { mode: 'full' }).settings[0].auditRequest!.items).not.toContain(liquid);
  const state = start(initial, { cash: false, items: [cup] });
  state.settings[0].auditRequest!.items.push(liquid);
  expect(() => submit(state, { items: { [liquid]: 12.5, [cup]: 1.5 } })).toThrow(/enteros/);
  expect(submit(state, { items: { [cup]: 1 } }).counts[0].items).toEqual({ [cup]: 1 });
});

it('programa, reemplaza y cancela el arqueo del próximo turno sin pausar el actual', () => {
  const when = 'next_opening';
  const scheduled = run(fixture(), 'start_audit', { when, mode: 'cash' }, admin).state;
  expect(scheduled.settings[0].nextOpeningAudit).toMatchObject({
    mode: 'cash',
    cash: true,
    items: [],
    payments: [],
  });
  expect(scheduled.settings[0].auditId).toBeUndefined();
  expect(order(scheduled).order.status).toBe('open');
  const changed = run(scheduled, 'start_audit', { when, mode: 'custom', items: ['coronita'] }, admin).state;
  expect(changed.settings[0].nextOpeningAudit).toMatchObject({
    mode: 'custom',
    cash: false,
    items: ['coronita'],
  });
  const cleared = run(changed, 'start_audit', { when, cancel: true }, admin).state;
  expect(cleared.settings[0].nextOpeningAudit).toBeUndefined();
});

it('ajusta el inventario tras aprobación de otro administrador y conserva el conteo original', () => {
  const initial = fixture();
  const state = submit(start(initial, { items: ['coronita'] }), { items: { coronita: 3 } });
  const original = structuredClone(state.counts[0]);
  const payload = {
    countId: original.id,
    items: { coronita: 3, [`liquid:${ids.flavor}`]: 15 },
    expectedItems: { coronita: 0 },
    notes: 'Inventario verificado por los socios.',
    confirmed: true,
  };
  expect(() => run(state, 'adjust_count_inventory', payload, cashier)).toThrow(/administrador/);
  expect(() =>
    run(state, 'adjust_count_inventory', { ...payload, expectedItems: { coronita: 1 } }, admin),
  ).toThrow(/inventario cambió/);
  const proposal = run(state, 'adjust_count_inventory', payload, admin);
  expect(proposal.result.approvalPending).toBe(true);
  expect(proposal.state.stock).toEqual(state.stock);
  const adjusted = run(
    proposal.state,
    'resolve_change',
    { requestId: proposal.result.referenceId, approve: true },
    other,
  ).state;
  expect(adjusted.counts[0]).toEqual(original);
  expect(countInventoryAdjustment(adjusted, original.id)).toMatchObject({
    inventoryAdjustment: { items: { coronita: 3 } },
  });
  expect(adjusted.stock).toMatchObject([{ article: 'coronita', quantity: 3, referenceId: original.id }]);
  expect(stockBalances(adjusted)).toEqual({ coronita: 3 });
  expect(adjusted.shifts).toEqual(state.shifts);
  expect(() => run(adjusted, 'adjust_count_inventory', payload, admin)).toThrow(/ya se usó/);
});

it('guarda el corte solicitado sin mostrar esperados ni exigir transferencias al cajero', () => {
  const initial = fixture();
  const created = order(initial);
  const paid = run(created.state, 'pay', {
    orderId: created.order.id,
    method: 'transfer',
    accountId: ids.location,
  }).state;
  const key = `transfer:${ids.location}`;
  const state = start(paid, { items: ['coronita'] });
  state.settings[0].auditRequest!.payments = [key];
  const view = redactState(state, cashier);
  expect(view.settings[0].auditRequest).toMatchObject({ cash: true, items: ['coronita'], payments: [] });
  for (const name of ['expectedCash', 'expectedItems', 'expectedPayments'])
    expect(view.settings[0].auditRequest).not.toHaveProperty(name);
  state.locations[0].active = false;
  state.stock.push({
    id: crypto.randomUUID(),
    eventId: crypto.randomUUID(),
    article: 'coronita',
    quantity: 100,
    reason: 'receipt',
    referenceId: crypto.randomUUID(),
    by: admin.id,
    at: NOW,
  });
  const finished = submit(state, { cash: 21000, items: { coronita: 2 } });
  expect(finished.counts[0]).toMatchObject({
    expectedCash: 20000,
    difference: 1000,
    expectedItems: { coronita: 0 },
    differences: { coronita: 2 },
  });
  expect(finished.counts[0].payments).toBeUndefined();
  expect(redactState(finished, cashier).counts).toEqual([]);
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
