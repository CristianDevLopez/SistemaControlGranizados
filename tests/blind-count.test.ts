import { expect, it } from 'vitest';
import { shiftBlocksSales } from '../src/domain/access.ts';
import { applyCommand, blindCountArticles, stockBalances } from '../src/domain/engine.ts';
import type { State } from '../src/domain/types.ts';
import { admin, cashier, cmd, fixture, ids, NOW, order, run } from './support/fixture.ts';

function items(state: State) {
  const balances = stockBalances(state);
  return Object.fromEntries(blindCountArticles(state).map(({ id }) => [id, balances[id] ?? 0]));
}

it('no envía cifras al cerrar con $5.000 de menos y conserva ambos intentos', () => {
  let state = fixture();
  const payload = { kind: 'closing', shiftId: ids.shift, cash: 15000, items: items(state), attempt: 1 };
  const command = cmd('submit_blind_count', payload);
  const first = applyCommand(state, command, cashier, NOW);
  expect(first.result).toEqual({
    id: command.id,
    at: NOW,
    status: 'accepted',
    code: 'COUNT_RECOUNT',
    message: 'Algo no coincide. Vuelve a contar todo.',
  });
  state = first.state;
  expect(state.shifts[0].blindClosing?.status).toBe('recount');
  expect(shiftBlocksSales(state.shifts[0])).toBe(true);
  expect(() => order(state)).toThrow(/ventas están en pausa/);
  expect(() => run(state, 'submit_blind_count', payload)).toThrow(/conteo cambió/);
  expect(applyCommand(state, command, cashier, NOW).result.code).toBe('COUNT_RECOUNT');

  const original = structuredClone(state.counts[0]);
  const second = run(state, 'submit_blind_count', { ...payload, attempt: 2 });
  state = second.state;
  expect(second.result.message).toBe('Turno enviado a revisión');
  expect(second.result.referenceId).toBeUndefined();
  expect(state.shifts[0]).toMatchObject({
    blindClosing: { status: 'review', countIds: state.counts.map((count) => count.id) },
    closingReview: { status: 'pending' },
    status: 'closed',
  });
  expect(state.counts[0]).toEqual(original);
  expect(state.counts).toHaveLength(2);
  expect(state.counts[1]).toMatchObject({
    cash: 15000,
    expectedCash: 20000,
    difference: -5000,
    blindAttempt: 2,
  });
  expect(state.counts[1].payments).toBeUndefined();
  expect(() => run(state, 'submit_blind_count', { ...payload, attempt: 2 })).toThrow(/Turno cerrado/);
});

it('compara efectivo y todos los artículos exactos, sin copitas ni líquido abierto', () => {
  const state = fixture();
  const itemCounts = items(state);
  expect(Object.keys(itemCounts)).toEqual(
    expect.arrayContaining([
      `cup:${state.sizes[0].id}`,
      `package:${state.sizes[0].id}`,
      `sealed_bag:${ids.flavor}`,
      'coronita',
    ]),
  );
  expect(Object.keys(itemCounts)).not.toContain('copita');
  expect(Object.keys(itemCounts).some((key) => key.startsWith('liquid:'))).toBe(false);
  const payload = { kind: 'closing', shiftId: ids.shift, cash: 20000, items: itemCounts, attempt: 1 };
  const mismatched = run(state, 'submit_blind_count', { ...payload, items: { ...itemCounts, coronita: 1 } });
  expect(mismatched.result.code).toBe('COUNT_RECOUNT');
  const matched = run(mismatched.state, 'submit_blind_count', { ...payload, attempt: 2 });
  expect(matched.result.message).toBe('Todo coincide. ¡Buen turno!');
  expect(matched.state.shifts[0].blindClosing?.status).toBe('matched');
  expect(matched.state.shifts[0].closingReview).toBeUndefined();
});

it('pausa la apertura tras el recuento y notifica, hasta que un admin autoriza o solicita arqueo', () => {
  const initial = fixture();
  initial.shifts[0].blindOpening = { status: 'pending' };
  const payload = { kind: 'opening', shiftId: ids.shift, cash: 19500, items: items(initial), attempt: 1 };
  expect(() => order(initial)).toThrow(/ventas están en pausa/);
  const first = run(initial, 'submit_blind_count', payload);
  expect(first.result.code).toBe('COUNT_RECOUNT');
  expect(first.state.notifications).toHaveLength(0);
  const second = run(first.state, 'submit_blind_count', { ...payload, attempt: 2 });
  expect(second.result.code).toBe('COUNT_REVIEW');
  expect(second.state.notifications).toMatchObject([{ channel: 'mermas', status: 'pending' }]);
  expect(() => order(second.state)).toThrow(/ventas están en pausa/);

  const authorized = run(
    second.state,
    'review_blind_opening',
    { shiftId: ids.shift, action: 'authorize' },
    admin,
  );
  expect(authorized.state.shifts[0].blindOpening?.status).toBe('authorized');
  expect(order(authorized.state).order.id).toBeTruthy();
  expect(authorized.state.counts).toEqual(second.state.counts);

  const requested = run(
    second.state,
    'review_blind_opening',
    { shiftId: ids.shift, action: 'request_audit', items: ['coronita'] },
    admin,
  ).state;
  expect(() => order(requested)).toThrow(/ventas están en pausa/);
  const auditId = requested.shifts[0].blindOpening?.audit?.id;
  const done = run(requested, 'submit_blind_opening_audit', {
    shiftId: ids.shift,
    auditId,
    items: { coronita: 0 },
  });
  expect(done.result.code).toBe('COUNT_MATCHED');
  expect(done.state.shifts[0].blindOpening?.status).toBe('reviewed');
  expect(done.state.counts.slice(0, 2)).toEqual(second.state.counts);
  expect(done.state.counts[2].items).toEqual({ coronita: 0 });
  expect(done.state.counts[2].cash).toBeUndefined();
  expect(order(done.state).order.id).toBeTruthy();
});
