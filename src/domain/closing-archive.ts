import type { Count, State } from './types.ts';

export function closingArchive(state: State, count: Count) {
  return count.kind === 'closing'
    ? state.shifts.find((shift) => shift.id === count.shiftId)?.closingArchive
    : undefined;
}

export function visibleCounts(state: State, includeArchived = false): Count[] {
  return state.counts.filter((count) => includeArchived || !closingArchive(state, count));
}
