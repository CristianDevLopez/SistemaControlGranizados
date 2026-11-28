import { expect, it } from 'vitest';
import { stockBalances } from '../src/domain/engine.ts';
import { admin, approveChange, fixture, run } from './support/fixture.ts';

it('propone un saldo definitivo, conserva el saldo mientras se aprueba y permite dejarlo en cero', () => {
  let state = fixture();
  state = approveChange(
    run(state, 'correct_inventory', { article: 'coronita', quantity: 20, notes: 'Carga anterior' }, admin),
  ).state;
  for (const finalQuantity of [15, 25, 0]) {
    const before = stockBalances(state).coronita;
    const proposed = run(
      state,
      'correct_inventory',
      { article: 'coronita', finalQuantity, notes: 'Conteo físico definitivo' },
      admin,
    );
    expect(stockBalances(proposed.state).coronita).toBe(before);
    expect(proposed.state.requests.at(-1)?.change?.after).toMatchObject({ coronita: finalQuantity });
    state = approveChange(proposed).state;
    expect(stockBalances(state).coronita).toBe(finalQuantity);
  }
  expect(() =>
    run(state, 'correct_inventory', { article: 'coronita', finalQuantity: -1, notes: 'Inválido' }, admin),
  ).toThrow();
});
