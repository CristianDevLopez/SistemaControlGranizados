import { inRehearsalPeriod, rehearsalRequest, rehearsalShift } from './closing-archive.ts';
import { countHasDifferences } from './engine.ts';
import { legacyOpeningNeedsReview, reviewCounts, reviewIsPending } from './turn-review.ts';
import type { Expense, Request, Shift, State, Transfer } from './types.ts';

export const requestCategories = {
  payments: 'Cambios de pago',
  changes: 'Promociones y otros cambios',
  shifts: 'Turnos y cuadres',
  money: 'Efectivo, reembolsos y gastos',
  operations: 'Otras solicitudes',
};

export const requestLabels: Record<Request['type'], string> = {
  payment_change: 'Cambio de medio de pago',
  shift_explanation: 'Solicitud de explicación del turno',
  difference: 'Explicación de diferencia',
  change: 'Propuesta de cambio',
  void: 'Anulación',
  damage: 'Daño o desperdicio',
  unpaid: 'Pedido sin pagar',
  courtesy_excess: 'Cortesía adicional',
  sync: 'Conflicto de sincronización',
};

const categories: Partial<Record<Request['type'], keyof typeof requestCategories>> = {
  payment_change: 'payments',
  change: 'changes',
  shift_explanation: 'shifts',
  difference: 'shifts',
};

type InboxEntry = {
  at: string;
  pending: boolean;
  category: keyof typeof requestCategories;
} & (
  | { source: 'request'; item: Request }
  | { source: 'shift'; item: Shift }
  | { source: 'transfer'; item: Transfer }
  | { source: 'expense'; item: Expense }
);

export function shiftRequestLabel(shift: Shift) {
  if (shift.status === 'requested') return 'Solicitud de apertura de turno';
  if (shift.closingReview?.status === 'returned') return 'Cuadre devuelto a caja';
  if (
    shift.closingReview?.status === 'approved' &&
    shift.closingFlow?.responseDueAt &&
    !shift.closingFlow.response
  )
    return 'Cuadre pendiente de respuesta';
  if (shift.closingReview?.status === 'approved') return 'Cuadre aprobado';
  if (shift.closingCountId || shift.closingReview?.status === 'pending') return 'Revisión de cuadre';
  if (shift.blindOpening?.status === 'audit') return 'Arqueo de apertura solicitado';
  return 'Revisión de apertura o arqueo';
}

export function adminRequests(state: State) {
  const queue: InboxEntry[] = [];
  for (const item of state.requests) {
    if (!rehearsalRequest(state, item))
      queue.push({
        source: 'request',
        item,
        at: item.at,
        pending: item.status === 'pending',
        category: categories[item.type] ?? 'operations',
      });
  }
  for (const item of state.shifts) {
    if (item.closingArchive || rehearsalShift(state, item)) continue;
    const pending =
      item.status === 'requested' ||
      item.closingReview?.status === 'pending' ||
      (item.status !== 'open' && reviewIsPending(state, item)) ||
      legacyOpeningNeedsReview(state, item) ||
      reviewCounts(state, item).some(
        (count) =>
          count.kind === 'audit' &&
          countHasDifferences(count) &&
          !item.operationsReview?.countResolutions?.[count.id],
      ) ||
      ['review', 'audit', 'authorized'].includes(item.blindOpening?.status ?? '');
    if (pending || item.closingReview?.status === 'approved' || item.authorizedBy)
      queue.push({
        source: 'shift',
        item,
        at: item.closedAt ?? item.openedAt ?? item.requestedAt,
        pending,
        category: 'shifts',
      });
  }
  for (const item of state.transfers) {
    if (!inRehearsalPeriod(state, item.at))
      queue.push({
        source: 'transfer',
        item,
        at: item.at,
        pending: item.status === 'requested' || item.status === 'in_transit',
        category: 'money',
      });
  }
  for (const item of state.expenses) {
    if (!inRehearsalPeriod(state, item.at))
      queue.push({
        source: 'expense',
        item,
        at: item.at,
        pending: item.status === 'pending',
        category: 'money',
      });
  }
  return queue.sort((a, b) => b.at.localeCompare(a.at));
}
