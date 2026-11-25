import { expect, it } from 'vitest';
import { cashExpected } from '../src/domain/engine.ts';
import { admin, cashier, cmd, fixture, ids, NOW, other, run } from './support/fixture.ts';
import { applyCommand } from '../src/domain/engine.ts';

it('separa la entrega de caja de la confirmación del administrador receptor', () => {
  const payload = {
    shiftId: ids.shift,
    from: `cash:${ids.shift}`,
    to: ids.location,
    amount: 4000,
    notes: 'Entrega',
    evidenceId: ids.photo,
  };
  const state = fixture();
  expect(() => run(state, 'execute_transfer', payload, admin)).toThrow(/responsable del turno activo/);
  const { state: sent, result } = run(state, 'execute_transfer', payload);
  const transferId = result.referenceId;
  expect(cashExpected(sent, ids.shift)).toBe(16000);
  expect(sent.transfers).toMatchObject([{ status: 'in_transit', executedBy: cashier.id, executedAt: NOW }]);
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
