import type { Actor, Expense, Order, CommandType, Permission, Profile, Shift, State } from './types.ts';
import { operatingShift } from './employee-view.ts';

export function canCorrectTastings(actor: Actor, order: Order, activeShift?: Shift): boolean {
  return actor.role === 'admin' || order.shiftId === activeShift?.id;
}

export const expenseCustodianMessage =
  'El costo debe revisarlo un administrador distinto del custodio del pago.';

export function expenseCustodianId(state: State, expense: Expense): string {
  if (expense.source === 'treasury')
    return state.locations.find((account) => account.id === expense.locationId)?.custodianId ?? expense.by;
  if (expense.source === 'cash')
    return state.shifts.find((shift) => shift.id === expense.shiftId)?.cashierId ?? expense.by;
  return expense.by;
}

export const permissionLabels: Record<Permission, string> = {
  orders: 'Crear y editar pedidos',
  deliveries: 'Registrar entregas y degustaciones',
  payments: 'Cobrar y tramitar correcciones de ventas (solo caja)',
  expenses: 'Registrar gastos (solo caja)',
  inventory: 'Registrar aperturas y reportar daños',
  transfers: 'Mover dinero (solo caja)',
  shifts: 'Abrir y cerrar su caja',
};
export const roleGuide = {
  admin:
    'Administra catálogo, usuarios y cortesías. Revisa turnos y propone cambios de precios, permisos e inventario.',
  encargado:
    'En su turno y equipo principal, cobra y cuadra la caja. Fuera de esa caja, toma y envía pedidos.',
  apoyo:
    'Toma, edita y envía pedidos y registra entregas desde celular, tablet u otro dispositivo conectado. Nunca cobra ni mueve dinero.',
};
export function hasPermission(actor: Profile, permission: Permission): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role === 'apoyo' && ['payments', 'expenses', 'transfers', 'shifts'].includes(permission))
    return false;
  return actor.permissions?.[permission] ?? true;
}
export function canWork(actor: Profile, state: State, permission: Permission, shiftId?: string): boolean {
  const shift = operatingShift(state);
  if (
    shift &&
    shiftBlocksSales(shift) &&
    !(
      state.settings[0].v4Enabled &&
      (shift.blindClosing || shift.v4ClosingStarted) &&
      ['inventory', 'expenses'].includes(permission)
    )
  )
    return false;
  return (
    hasPermission(actor, permission) &&
    (actor.role === 'admin' || (!!shift && (!shiftId || shift.id === shiftId)))
  );
}
export function commandPermission(type: CommandType): Permission | undefined {
  if (['create_order', 'send_order', 'update_order', 'cancel_order', 'close_tastings'].includes(type))
    return 'orders';
  if (['deliver', 'taste'].includes(type)) return 'deliveries';
  if (['pay', 'redeem_coupon', 'request_void', 'replace_order', 'refund_order', 'unpaid'].includes(type))
    return 'payments';
  if (type === 'expense') return 'expenses';
  if (
    ['open_supply', 'open_package', 'open_bag', 'exhaust_bag', 'receive_shipment', 'report_damage'].includes(
      type,
    )
  )
    return 'inventory';
  if (['request_transfer', 'execute_transfer', 'confirm_transfer'].includes(type)) return 'transfers';
  if (
    ['request_shift', 'count', 'finish_audit', 'submit_blind_count', 'submit_blind_opening_audit'].includes(
      type,
    )
  )
    return 'shifts';
}

export function shiftBlocksSales(shift: Shift | undefined): boolean {
  const opening = shift?.blindOpening?.status;
  return (
    shift?.v4ClosingStarted === true ||
    opening === 'pending' ||
    opening === 'recount' ||
    opening === 'review' ||
    opening === 'audit' ||
    shift?.blindClosing?.status === 'ready' ||
    shift?.blindClosing?.status === 'recount'
  );
}

export function isShiftCashier(actor: Actor, shift: Shift | undefined): boolean {
  return (
    !!shift &&
    actor.role !== 'apoyo' &&
    shift.cashierId === actor.id &&
    ((actor.primary && shift.deviceId === actor.deviceId) || (actor.role === 'admin' && actor.online))
  );
}

export function isOrderAssistant(actor: Actor, state: State): boolean {
  if (actor.role !== 'encargado') return false;
  const shift = operatingShift(state);
  return !actor.primary || (!!shift && !isShiftCashier(actor, shift));
}

export function isCustomerOrderCommand(type: CommandType): boolean {
  return ['create_order', 'send_order', 'update_order', 'cancel_order'].includes(type);
}
