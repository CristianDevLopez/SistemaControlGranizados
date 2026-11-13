import type { Actor, Order, Shift } from './types.ts';

export function canCorrectTastings(actor: Actor, order: Order, activeShift?: Shift): boolean {
  return actor.role === 'admin' || order.shiftId === activeShift?.id;
}

export function isShiftCashier(actor: Actor, shift: Shift | undefined): boolean {
  return (
    !!shift &&
    shift.cashierId === actor.id &&
    ((actor.primary && shift.deviceId === actor.deviceId) ||
      (actor.role === 'admin' && actor.online && actor.aal === 'aal2'))
  );
}
