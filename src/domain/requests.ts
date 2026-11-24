import { inRehearsalPeriod, rehearsalRequest, rehearsalShift } from './closing-archive.ts';
import { countHasDifferences, countInventoryAdjustment } from './engine.ts';
import { legacyOpeningNeedsReview, reviewCounts, shiftTransfers } from './turn-review.ts';
import type { Count, Expense, Payment, Request, Shift, State, Transfer } from './types.ts';

export const requestCategories = {
  shifts: 'Caja',
  payments: 'Medios de pago',
  operations: 'Inventario',
  expenses: 'Gastos',
  promotions: 'Promociones',
  sync: 'Sincronización',
  changes: 'Otros admins',
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
  sync: 'sync',
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
  | { source: 'sale_transfer'; item: Payment; shift: Shift }
  | { source: 'inventory_count'; item: Count; shift: Shift }
);

export function shiftRequestLabel(shift: Shift) {
  if (shift.status === 'requested') return 'Solicitud de apertura de turno';
  if (shift.closingReview?.status === 'returned') return 'Cuadre devuelto a caja';
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
        category:
          item.type === 'courtesy_excess' || item.change?.kind === 'save_promotion'
            ? 'promotions'
            : item.change?.kind === 'correct_inventory' ||
                item.change?.kind === 'open_package' ||
                item.change?.kind === 'open_bag'
              ? 'operations'
              : (categories[item.type] ?? 'operations'),
      });
  }
  for (const item of state.shifts) {
    if (item.closingArchive || rehearsalShift(state, item)) continue;
    for (const payment of shiftTransfers(state, item)) {
      queue.push({
        source: 'sale_transfer',
        item: payment,
        shift: item,
        at: payment.at,
        category: 'payments',
        pending:
          !item.operationsReview?.verifiedTransfers?.[payment.id] &&
          item.closingReview?.status !== 'approved',
      });
    }
    for (const count of reviewCounts(state, item)) {
      if (
        count.kind !== 'audit' ||
        item.blindOpening?.auditCountIds?.includes(count.id) ||
        !Object.keys(count.items).length ||
        !countHasDifferences(count)
      )
        continue;
      queue.push({
        source: 'inventory_count',
        item: count,
        shift: item,
        at: count.at,
        category: 'operations',
        pending:
          !item.operationsReview?.countResolutions?.[count.id] && !countInventoryAdjustment(state, count.id),
      });
    }
    const pending =
      item.status === 'requested' ||
      item.closingReview?.status === 'pending' ||
      item.closingReview?.status === 'returned' ||
      legacyOpeningNeedsReview(state, item) ||
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
        category: item.type === 'reimbursement' ? 'expenses' : 'shifts',
      });
  }
  for (const item of state.expenses) {
    if (!inRehearsalPeriod(state, item.at))
      queue.push({
        source: 'expense',
        item,
        at: item.at,
        pending: item.status === 'pending',
        category: 'expenses',
      });
  }
  return queue.sort((a, b) => b.at.localeCompare(a.at));
}
