import {
  cashExpected,
  closingPaymentMethods,
  currentPayments,
  paymentMethod,
  salesByMethod,
} from './engine.ts';
import { shiftSales } from './turn-review.ts';
import { rehearsalShift } from './closing-archive.ts';
import { initialState } from './initial.ts';
import { rehearsalRequest } from './closing-archive.ts';
import { orderPaymentLabels } from './payment-methods.ts';
import { isOrderAssistant } from './access.ts';
import type { Actor, Order, Promotion, Shift, State } from './types.ts';

export function operatingShift(state: State): Shift | undefined {
  const own = state.shifts.find((shift) => shift.status === 'open');
  if (own || !state.sharedShift) return own;
  return {
    id: state.sharedShift.id,
    status: 'open',
    cashierId: '',
    deviceId: '',
    requestedAt: '',
    base: 0,
    openingSkipped: false,
    ...(state.sharedShift.blocked ? { blindOpening: { status: 'pending' } } : {}),
  };
}

function publicPromotion(promotion: Promotion): Promotion {
  // Caja necesita saber si queda un canje disponible sin exponer el cupo ni su contador.
  const maxRedemptions =
    promotion.delivery === 'schedule' && promotion.maxRedemptions !== null
      ? Number(promotion.redemptions < promotion.maxRedemptions)
      : null;
  return { ...promotion, by: '', maxRedemptions, redemptions: 0 };
}

function publicOrder(order: Order): Order {
  const { couponCode, carriedCouponFromId, ...sale } = order;
  return {
    ...sale,
    lines: order.lines.map(({ couponId, appliedRules, ...line }) => ({
      ...line,
      appliedRules: appliedRules
        ?.filter((rule) => !rule.couponId && rule.promotion.delivery === 'schedule')
        .map(({ promotion, quantity, unitAmount }) => ({
          promotion: publicPromotion(promotion),
          quantity,
          unitAmount,
        })),
    })),
  };
}

/** Allowlist the operational data sent to a cashier or assistant, including the offline copy. */
export function employeeView(full: State, actor: Actor): State {
  const safe = initialState();
  const settings = full.settings[0];
  const active = full.shifts.find((shift) => shift.status === 'open') ?? operatingShift(full);
  const orderAssistant = isOrderAssistant(actor, full);
  const isCashier = active?.cashierId === actor.id && !orderAssistant;
  const onShift = (record: { shiftId?: string; openedAt: string }) =>
    !!active &&
    (record.shiftId ? record.shiftId === active.id : !!active.openedAt && record.openedAt >= active.openedAt);
  const audit = settings.auditRequest;
  safe.settings = [
    {
      id: settings.id,
      version: settings.version,
      businessName: settings.businessName,
      cupPackageUnits: settings.cupPackageUnits,
      bagOunces: settings.bagOunces,
      supplies: settings.supplies,
      candyPrices: settings.candyPrices,
      expenseLimit: settings.expenseLimit,
      expenseCategories: settings.expenseCategories,
      maxClosingBase: settings.maxClosingBase ?? settings.cashLimit,
      auditId: settings.auditId,
      openingChecklist:
        isCashier && (active.blindOpening?.depth || (audit?.opening && !active.openingCountId))
          ? settings.openingChecklist
          : undefined,
      closingChecklist: isCashier && active.blindOpening?.depth ? settings.closingChecklist : undefined,
      auditRequest:
        audit && audit.shiftId === active?.id && isCashier
          ? {
              id: audit.id,
              shiftId: audit.shiftId,
              cash: audit.cash,
              items: audit.items,
              payments: [],
              opening: audit.opening,
              at: audit.at,
              by: '',
            }
          : undefined,
      // The domain expects the full settings shape for admin commands. Employees only use these fields.
    } as State['settings'][number],
  ];
  safe.flavors = full.flavors;
  safe.sizes = full.sizes;
  safe.orders = full.orders
    .filter(
      (order) =>
        order.shiftId === active?.id &&
        ((!orderAssistant && order.cashHandoff !== 'draft') || order.sellerId === actor.id),
    )
    .map(publicOrder);
  if (!orderAssistant) safe.orderPaymentMethods = orderPaymentLabels(full, safe.orders);
  safe.shifts = full.shifts
    .filter((shift) => shift.cashierId === actor.id)
    .map(
      (shift) =>
        ({
          id: shift.id,
          cashierId: actor.id,
          deviceId: shift.deviceId,
          requestedAt: shift.requestedAt,
          openedAt: shift.openedAt,
          closedAt: shift.closedAt,
          status: shift.status,
          openingSkipped: shift.openingSkipped,
          openingCountId: shift.openingCountId,
          closingCountMode: shift.closingCountMode,
          reconcileClosingId: shift.reconcileClosingId,
          closingSupplies: shift.closingSupplies,
          visibleClosing: shift.visibleClosing,
          closingCountId:
            shift.blindOpening?.depth || shift.visibleClosing ? shift.closingCountId : undefined,
          closingFlow: shift.closingFlow,
          closingReview: shift.closingReview && {
            status: shift.closingReview.status,
            ...(shift.blindOpening?.depth || shift.visibleClosing
              ? { countId: shift.closingReview.countId }
              : {}),
          },
          blindOpening: shift.operationsReview?.openingResolution
            ? { status: 'reviewed', depth: shift.blindOpening?.depth }
            : shift.blindOpening && {
                status: shift.blindOpening.status,
                depth: shift.blindOpening.depth,
                ...(shift.id === active?.id && shift.blindOpening.audit
                  ? {
                      audit: {
                        id: shift.blindOpening.audit.id,
                        cash: shift.blindOpening.audit.cash,
                        items: shift.blindOpening.audit.items,
                      },
                    }
                  : {}),
              },
          blindClosing:
            shift.blindClosing &&
            (shift.blindOpening?.depth || shift.visibleClosing
              ? shift.blindClosing
              : { status: shift.blindClosing.status }),
        }) as Shift,
    );
  if (active && !isCashier)
    safe.sharedShift = {
      id: active.id,
      blocked:
        full.sharedShift?.blocked ||
        ['recount', 'ready'].includes(active.blindClosing?.status ?? '') ||
        (!!active.blindOpening &&
          !['authorized', 'matched', 'reviewed'].includes(active.blindOpening.status)),
    };
  const syncReviews = full.requests.filter((request) => request.type === 'sync' && request.by === actor.id);
  safe.resolvedSyncIds =
    full.resolvedSyncIds ??
    syncReviews
      .filter((request) => request.status !== 'pending' || rehearsalRequest(full, request))
      .map((request) => request.id);
  safe.pendingSyncReviewIds =
    full.pendingSyncReviewIds ??
    syncReviews
      .filter((request) => request.status === 'pending' && !rehearsalRequest(full, request))
      .map((request) => request.id);
  if (orderAssistant) {
    safe.shifts = [];
    return safe;
  }
  safe.locations = full.locations
    .filter(
      (location) =>
        actor.role !== 'apoyo' && location.active && location.type === 'bank' && location.receivesSales,
    )
    .map(
      ({ id, name, type, bank, account, active, receivesSales }) =>
        ({
          id,
          name,
          type,
          bank,
          account,
          active,
          receivesSales,
        }) as State['locations'][number],
    );
  if (isCashier) {
    if (actor.role === 'encargado') {
      safe.transferDestinations = full.transferDestinations;
      safe.cashHandoffs =
        full.cashHandoffs ??
        full.transfers
          .filter(
            (item) => item.type === 'transfer' && item.from === `cash:${active.id}` && item.by === actor.id,
          )
          .map(({ id, to, amount, status, notes }) => ({ id, to, amount, status, notes }));
    }
    const totals = new Map((full.transferSummary ?? []).map(({ name, amount }) => [name, amount]));
    for (const payment of full.payments) {
      if (payment.shiftId !== active.id || payment.method !== 'transfer' || !payment.accountId) continue;
      const name =
        full.locations.find((location) => location.id === payment.accountId)?.name ?? 'Transferencia';
      totals.set(name, (totals.get(name) ?? 0) + payment.amount);
    }
    safe.transferSummary = [...totals].map(([name, amount]) => ({ name, amount }));
  }
  safe.promotions = full.promotions
    .filter((promotion) => promotion.delivery === 'schedule')
    .map(publicPromotion);
  safe.packages = full.packages
    .filter((item) => !item.voidedAt && onShift(item))
    .map(
      ({ id, sizeId, openedAt, shiftId }) =>
        ({ id, sizeId, openedAt, shiftId: shiftId ?? active?.id }) as State['packages'][number],
    );
  safe.bags = full.bags
    .filter((item) => !item.voidedAt && onShift(item))
    .map(
      ({ id, flavorId, openedAt, shiftId }) =>
        ({ id, flavorId, openedAt, shiftId: shiftId ?? active?.id }) as State['bags'][number],
    );
  safe.attachments = full.attachments
    .filter((item) => item.by === actor.id)
    .map(({ path, sha256, ...item }) => item);
  safe.paymentChangeOrderIds =
    full.paymentChangeOrderIds ??
    full.requests
      .filter(
        (request) =>
          request.by === actor.id && request.type === 'payment_change' && request.status === 'pending',
      )
      .flatMap((request) =>
        request.referenceId && safe.orders.some((order) => order.id === request.referenceId)
          ? [request.referenceId]
          : [],
      );
  const ownShifts = new Set(safe.shifts.map((shift) => shift.id));
  const visibleShifts = full.shifts.filter(
    (shift) => ownShifts.has(shift.id) && !rehearsalShift(full, shift) && !shift.closingArchive,
  );
  safe.shifts = safe.shifts.filter((shift) => visibleShifts.some((item) => item.id === shift.id));
  const closingCounts = new Set(
    visibleShifts
      .filter((shift) => shift.blindOpening?.depth || shift.visibleClosing)
      .flatMap((shift) => [
        ...(shift.blindClosing?.countIds ?? []),
        shift.closingReview?.countId,
        ...(shift.closingFlow?.versions.map((version) => version.countId) ?? []),
      ]),
  );
  safe.counts = full.counts.filter((count) => closingCounts.has(count.id));
  safe.ownTurnSummary =
    full.ownTurnSummary ??
    visibleShifts
      .filter((shift) => shift.status === 'open' || shift.closingFlow)
      .map((shift) => {
        const totals = salesByMethod(full, shift.id);
        const payments = currentPayments(full.payments).filter(
          (item) => item.shiftId === shift.id && item.amount > 0,
        );
        const expenses = full.expenses.filter(
          (item) => item.shiftId === shift.id && item.status !== 'rejected',
        );
        const handoffs = full.transfers.filter(
          (item) => item.from === `cash:${shift.id}` && item.status !== 'cancelled',
        );
        const cashPayments = payments.filter((item) => paymentMethod(item) === 'cash').length;
        const cards = [
          { id: 'cash', name: 'Efectivo', amount: totals.cash, count: cashPayments, confirmed: cashPayments },
          ...closingPaymentMethods(full, shift.id).map(({ id, account }) => {
            const items = payments.filter(
              (item) => paymentMethod(item) === 'transfer' && item.accountId === account.id,
            );
            const confirmed = items.filter((item) => {
              const mark = shift.operationsReview?.verifiedTransfers?.[item.id];
              return mark && !mark.missing;
            }).length;
            return {
              id,
              name: account.name,
              amount: totals.byAccount[account.id] ?? 0,
              count: items.length,
              confirmed,
            };
          }),
          {
            id: 'expenses',
            name: 'Gastos',
            amount: expenses.reduce((sum, item) => sum + item.amount, 0),
            count: expenses.length,
            confirmed: expenses.filter((item) => item.status === 'approved').length,
          },
          {
            id: 'handoffs',
            name: 'Traslados',
            amount: handoffs.reduce((sum, item) => sum + item.amount, 0),
            count: handoffs.length,
            confirmed: handoffs.filter((item) => item.status === 'confirmed').length,
          },
        ];
        return {
          shiftId: shift.id,
          cards,
          sizes: [...shiftSales(full, shift).unitsBySize].map(([id, quantity]) => ({
            name: full.sizes.find((item) => item.id === id)?.name ?? id,
            quantity,
          })),
          payments: [
            { name: 'Efectivo', amount: totals.cash },
            { name: 'Transferencias', amount: totals.transfer },
          ],
          transferAccounts: Object.entries(totals.byAccount).map(([id, amount]) => ({
            name: full.locations.find((item) => item.id === id)?.name ?? 'Cuenta archivada',
            amount,
          })),
          expectedCash:
            !shift.blindOpening || ['matched', 'authorized', 'reviewed'].includes(shift.blindOpening.status)
              ? cashExpected(full, shift.id)
              : undefined,
          expenses: full.expenses
            .filter((expense) => expense.shiftId === shift.id && expense.status !== 'rejected')
            .reduce((total, expense) => total + expense.amount, 0),
          handoffs: full.transfers
            .filter((transfer) => transfer.from === `cash:${shift.id}`)
            .map((transfer) => ({
              id: transfer.id,
              locationId: transfer.to,
              destination:
                full.locations.find((location) => location.id === transfer.to)?.name ?? 'Destino archivado',
              amount: transfer.amount,
              status: transfer.status,
            })),
        };
      });
  safe.ownPaymentChanges =
    full.ownPaymentChanges ??
    full.requests
      .filter(
        (request) =>
          request.by === actor.id && request.type === 'payment_change' && !rehearsalRequest(full, request),
      )
      .map(({ id, at, status, notes, resolutionNotes, referenceId }) => ({
        id,
        at,
        status,
        notes,
        resolutionNotes,
        orderNumber: full.orders.find((order) => order.id === referenceId)?.number,
      }));
  safe.ownRequests =
    full.ownRequests ??
    full.requests
      .filter(
        (request) =>
          request.by === actor.id &&
          !['payment_change', 'shift_explanation', 'sync', 'change'].includes(request.type) &&
          !rehearsalRequest(full, request),
      )
      .map(({ id, type, at, status, notes, resolutionNotes }) => ({
        id,
        type,
        at,
        status,
        notes,
        resolutionNotes,
      }));
  safe.shiftReviewPrompt =
    full.shiftReviewPrompt ??
    full.requests
      .filter(
        (request) =>
          request.type === 'shift_explanation' &&
          request.status === 'pending' &&
          !!request.referenceId &&
          ownShifts.has(request.referenceId) &&
          !rehearsalRequest(full, request),
      )
      .map(({ id, notes, at }) => ({ id, notes, at }));
  return safe;
}
