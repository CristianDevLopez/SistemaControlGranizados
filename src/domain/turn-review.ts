import { inRehearsalPeriod, rehearsalShift } from './closing-archive.ts';
import {
  cashExpected,
  closingPreview,
  countHasDifferences,
  currentPayments,
  paymentMethod,
  stockBalances,
} from './engine.ts';
import { liquidPortions } from './flavors.ts';
import type { Count, Shift, Size, State } from './types.ts';

export function shiftTransfers(state: State, shift: Shift) {
  return currentPayments(state.payments).filter(
    (payment) => payment.shiftId === shift.id && paymentMethod(payment) === 'transfer' && payment.amount > 0,
  );
}

export function reviewCounts(state: State, shift: Shift, archived = false) {
  return state.counts
    .filter(
      (count) =>
        count.shiftId === shift.id &&
        (count.kind === 'audit' ||
          count.kind === 'opening' ||
          count.kind === 'closing' ||
          shift.blindOpening?.auditCountIds?.includes(count.id)) &&
        (archived || !inRehearsalPeriod(state, count.at)),
    )
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function reviewIsPending(state: State, shift: Shift) {
  if (shift.closingArchive || rehearsalShift(state, shift)) return false;
  if (
    shift.closingFlow &&
    (shift.closingReview?.status !== 'approved' ||
      (shift.closingFlow.responseDueAt && !shift.closingFlow.response))
  )
    return true;
  if (['review', 'audit', 'authorized'].includes(shift.blindOpening?.status ?? '')) return true;
  if (legacyOpeningNeedsReview(state, shift) || closingNeedsReview(state, shift)) return true;
  const counts = reviewCounts(state, shift);
  if (
    counts.some(
      (count) =>
        count.kind === 'audit' &&
        countHasDifferences(count) &&
        !shift.operationsReview?.countResolutions?.[count.id],
    )
  )
    return true;
  if (
    state.requests.some(
      (request) =>
        request.type === 'difference' &&
        request.status === 'pending' &&
        !inRehearsalPeriod(state, request.at) &&
        counts.some((count) => count.id === request.referenceId),
    )
  )
    return true;
  return (
    shiftTransfers(state, shift).some(
      (payment) => !shift.operationsReview?.verifiedTransfers?.[payment.id],
    ) ||
    state.requests.some(
      (request) =>
        request.type === 'payment_change' &&
        request.status === 'pending' &&
        state.orders.some((order) => order.id === request.referenceId && order.shiftId === shift.id),
    )
  );
}

export function legacyOpeningNeedsReview(state: State, shift: Shift) {
  if (shift.blindOpening || shift.operationsReview?.openingResolution) return false;
  const count = reviewCounts(state, shift).find(
    (item) => item.id === shift.openingCountId && item.kind === 'opening',
  );
  return !!count && countHasDifferences(count);
}

export function closingNeedsReview(state: State, shift: Shift) {
  if (shift.closingReview?.status === 'approved' || shift.operationsReview?.resolution) return false;
  const count = reviewCounts(state, shift).find(
    (item) => item.id === shift.closingCountId && item.kind === 'closing',
  );
  return !!count && (countHasDifferences(count) || countHasDifferences(reconciledCount(state, shift, count)));
}

export function reconciledCount(state: State, shift: Shift, count: Count) {
  if (shift.blindOpening?.depth || count.kind !== 'closing' || inRehearsalPeriod(state, count.at))
    return count;
  const at = count.cutoffAt ?? count.at;
  const balances = stockBalances(state, at);
  const expected = count.blindAttempt
    ? cashExpected(state, shift.id, at)
    : closingPreview(state, shift.id, count).expectedCash;
  const expectedItems = Object.fromEntries(Object.keys(count.items).map((key) => [key, balances[key] ?? 0]));
  return {
    ...count,
    expectedCash: expected,
    difference: count.cash === undefined ? undefined : count.cash - expected,
    expectedItems,
    differences: Object.fromEntries(
      Object.entries(count.items).map(([key, value]) => [key, value - expectedItems[key]]),
    ),
  };
}

function prices(size: Size) {
  return [size.alcoholPrice, size.plainPrice].filter((price): price is number => price !== null && price > 0);
}

export function saleExplanations(state: State, count: Count): string[] {
  const cash = count.difference ?? 0;
  const cups = state.sizes
    .map((size) => ({ size, delta: count.differences?.[`cup:${size.id}`] ?? 0 }))
    .filter(({ delta }) => delta !== 0);
  if (cups.length === 1) {
    const [{ size, delta }] = cups;
    if (delta === -1 && prices(size).includes(cash)) return [`Posible venta sin registrar · ${size.name}.`];
    if (delta === 1 && prices(size).includes(-cash))
      return [`Posible venta registrada de más · ${size.name}.`];
  }
  if (cups.length === 2) {
    const served = cups.find(({ delta }) => delta === -1)?.size;
    const recorded = cups.find(({ delta }) => delta === 1)?.size;
    if (
      served &&
      recorded &&
      prices(served).some((price) =>
        prices(recorded).some((charged) => Math.abs(price - charged) === Math.abs(cash)),
      )
    ) {
      return [`Posible cambio de tamaño · se registró ${recorded.name} y se sirvió ${served.name}.`];
    }
  }
  return [];
}

export function shiftSales(state: State, shift: Shift) {
  const orders = state.orders.filter(
    (order) => order.shiftId === shift.id && ['paid', 'void_requested'].includes(order.status),
  );
  const ouncesByFlavor = new Map<string, number>();
  const cupsBySize = new Map<string, number>();
  const unitsBySize = new Map<string, number>();
  for (const line of orders.flatMap((order) => order.lines)) {
    const size = state.sizes.find((item) => item.id === line.sizeId);
    const ounces = (line.recipe?.ounces ?? size?.ounces ?? 0) * line.quantity;
    for (const part of liquidPortions(line, ounces)) {
      ouncesByFlavor.set(part.flavorId, (ouncesByFlavor.get(part.flavorId) ?? 0) + part.ounces);
    }
    unitsBySize.set(line.sizeId, (unitsBySize.get(line.sizeId) ?? 0) + line.quantity);
    cupsBySize.set(
      line.sizeId,
      (cupsBySize.get(line.sizeId) ?? 0) + (line.recipe?.cups ?? size?.cups ?? 0) * line.quantity,
    );
  }
  return { orders, ouncesByFlavor, cupsBySize, unitsBySize };
}
