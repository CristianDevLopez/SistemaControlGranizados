import type { Actor, Shift } from './types.ts';

export function isShiftCashier(actor: Actor, shift: Shift | undefined): boolean {
  return (
    !!shift &&
    shift.cashierId === actor.id &&
    ((actor.primary && shift.deviceId === actor.deviceId) ||
      (actor.role === 'admin' && actor.online && actor.aal === 'aal2'))
  );
}
