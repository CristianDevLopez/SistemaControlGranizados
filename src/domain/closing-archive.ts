import type { Count, Request, Shift, State } from './types.ts';

export function inRehearsalPeriod(state: State, at: string): boolean {
  const cutoff = state.settings[0].rehearsalBaseline;
  return !!cutoff && at < cutoff.at;
}

export function rehearsalShift(state: State, shift: Shift): boolean {
  return (
    shift.status !== 'open' && inRehearsalPeriod(state, shift.closedAt ?? shift.openedAt ?? shift.requestedAt)
  );
}

export function rehearsalRequest(state: State, request: Request): boolean {
  const order = state.orders.find((item) => item.id === request.referenceId);
  const count = state.counts.find((item) => item.id === request.referenceId);
  const shift = state.shifts.find(
    (item) =>
      item.id ===
      (order?.shiftId ?? count?.shiftId ?? request.referenceId ?? request.originalCommand?.shiftId),
  );
  return (!!shift && rehearsalShift(state, shift)) || inRehearsalPeriod(state, request.at);
}

export function closingArchive(state: State, count: Count) {
  return count.kind === 'closing'
    ? state.shifts.find((shift) => shift.id === count.shiftId)?.closingArchive
    : undefined;
}

export function visibleCounts(state: State, includeArchived = false): Count[] {
  return state.counts.filter(
    (count) =>
      includeArchived ||
      (!closingArchive(state, count) && (count.kind === 'receipt' || !inRehearsalPeriod(state, count.at))),
  );
}
