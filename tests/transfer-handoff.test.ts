import { expect, it } from 'vitest';
import { cashExpected } from '../src/domain/engine.ts';
import { admin, cashier, cmd, fixture, ids, NOW, other, run } from './support/fixture.ts';
import { applyCommand } from '../src/domain/engine.ts';

it('separa la entrega de caja de la confirmación del administrador receptor', () => {
  const pending = run(fixture(), 'request_transfer', {
    shiftId: ids.shift,
    to: ids.location,
    amount: 4000,
    notes: 'Entrega',
  });
  const transferId = pending.result.referenceId;
  expect(cashExpected(pending.state, ids.shift)).toBe(20000);
  expect(() => run(pending.state, 'execute_transfer', { transferId, evidenceId: ids.photo }, admin)).toThrow(
    /distinta/,
  );
  const sent = run(pending.state, 'execute_transfer', { transferId, evidenceId: ids.photo }).state;
  expect(sent.transfers[0].executedBy).toBe(cashier.id);
  expect(() => run(sent, 'confirm_transfer', { transferId, receivedAmount: 4000 })).toThrow(/administrador/);
  expect(() => run(sent, 'confirm_transfer', { transferId, receivedAmount: 4000 }, other)).toThrow(
    /receptor/,
  );
  expect(
    run(sent, 'confirm_transfer', { transferId, receivedAmount: 4000 }, admin).state.transfers[0].status,
  ).toBe('confirmed');
});

it('anula un duplicado sin afectar el otro traslado ni el cálculo histórico', () => {
  let state = fixture();
  for (const notes of ['Duplicado', 'Válido']) {
    const pending = run(state, 'request_transfer', {
      shiftId: ids.shift,
      to: ids.location,
      amount: 4000,
      notes,
    });
    state = run(pending.state, 'execute_transfer', {
      transferId: pending.result.referenceId,
      evidenceId: ids.photo,
    }).state;
  }
  const transferId = state.transfers[0].id;
  expect(() => run(state, 'cancel_transfer', { transferId, notes: 'Duplicado' }, admin)).toThrow(/Confirma/);
  const later = '2026-10-23T16:01:00.000Z';
  const result = applyCommand(
    state,
    cmd('cancel_transfer', { transferId, cashRestored: true, notes: 'Duplicado' }, admin, { at: later }),
    admin,
    later,
  );
  expect(result.state.transfers[0]).toMatchObject({
    status: 'cancelled',
    cancellation: { originalExecutedAt: NOW },
  });
  expect(result.state.transfers[1].status).toBe('in_transit');
  expect(cashExpected(result.state, ids.shift, NOW)).toBe(12000);
  expect(cashExpected(result.state, ids.shift)).toBe(16000);
});
