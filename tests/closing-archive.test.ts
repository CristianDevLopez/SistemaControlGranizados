import { expect, it } from 'vitest';
import { closingArchive, visibleCounts } from '../src/domain/closing-archive.ts';
import { closingPreview, openingExpectedCash, stockBalances } from '../src/domain/engine.ts';
import { admin, fixture, ids, NOW, run } from './support/fixture.ts';

function archivedState() {
  let state = fixture();
  const preview = closingPreview(state, ids.shift);
  state = run(state, 'count', {
    kind: 'closing',
    shiftId: ids.shift,
    cash: preview.expectedCash,
    retained: preview.expectedCash,
    items: preview.expectedItems,
    payments: preview.expectedPayments,
    preview,
  }).state;
  state.shifts[0].closingArchive = {
    at: NOW,
    by: admin.id,
    notes: 'Cierre histórico archivado por solicitud del propietario.',
    replacementCountId: 'cierre-posterior',
  };
  return state;
}

it('oculta cierres archivados y sus revisiones; conserva aperturas, arqueos y el historial completo', () => {
  const state = archivedState();
  const original = state.counts[0];
  state.counts.push(
    { ...original, id: 'revision', revisesId: original.id },
    { ...original, id: 'apertura', kind: 'opening' },
    { ...original, id: 'arqueo', kind: 'audit' },
    { ...original, id: 'vigente', shiftId: 'otro-turno' },
  );
  const before = structuredClone(state);
  expect(visibleCounts(state).map((c) => c.id)).toEqual(['apertura', 'arqueo', 'vigente']);
  expect(visibleCounts(state, true)).toEqual(state.counts);
  expect(closingArchive(state, original)?.by).toBe(admin.id);
  expect(state).toEqual(before);
});

it('impide aprobar un cierre archivado y conserva inventario, efectivo y conteos', () => {
  const state = archivedState();
  const before = structuredClone(state);
  const original = state.counts[0];
  expect(() =>
    run(
      state,
      'approve_closing',
      {
        shiftId: ids.shift,
        preview: closingPreview(state, ids.shift, original),
        cash: original.cash,
        retained: original.retained,
        items: original.items,
        payments: original.payments,
        notes: 'Intento de aprobación tardía',
        verified: true,
      },
      admin,
    ),
  ).toThrow(/archivado/);
  expect(stockBalances(state)).toEqual(stockBalances(before));
  expect(openingExpectedCash(state)).toBe(openingExpectedCash(before));
  expect(state).toEqual(before);
});
