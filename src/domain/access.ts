import type { Actor, Order, CommandType, Permission, Profile, Shift, State } from './types.ts';

export function canCorrectTastings(actor: Actor, order: Order, activeShift?: Shift): boolean {
  return actor.role === 'admin' || order.shiftId === activeShift?.id;
}

export const permissionLabels: Record<Permission, string> = {
  orders: 'Crear y editar pedidos',
  deliveries: 'Registrar entregas y degustaciones',
  payments: 'Cobrar y tramitar correcciones de ventas (solo caja)',
  expenses: 'Registrar gastos (solo caja)',
  inventory: 'Registrar inventario y recepciones',
  transfers: 'Mover dinero (solo caja)',
  shifts: 'Abrir y cerrar su caja',
};
export const roleGuide = {
  admin:
    'Administra catálogo, usuarios, permisos y cortesías; autoriza turnos y corrige registros cerrados. Requiere conexión y doble factor.',
  encargado:
    'La caja principal crea y edita pedidos, cobra y realiza el cuadre de su turno. Recibe los pedidos del apoyo con el nombre de quien los tomó.',
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
  return (
    hasPermission(actor, permission) &&
    (actor.role === 'admin' ||
      state.shifts.some((s) => s.status === 'open' && (!shiftId || s.id === shiftId)))
  );
}
export function commandPermission(type: CommandType): Permission | undefined {
  if (['create_order', 'update_order', 'cancel_order', 'close_tastings'].includes(type)) return 'orders';
  if (['deliver', 'taste'].includes(type)) return 'deliveries';
  if (['pay', 'redeem_coupon', 'request_void', 'replace_order', 'refund_order', 'unpaid'].includes(type))
    return 'payments';
  if (type === 'expense') return 'expenses';
  if (['open_package', 'open_bag', 'exhaust_bag', 'receive_shipment', 'report_damage'].includes(type))
    return 'inventory';
  if (['request_transfer', 'execute_transfer', 'confirm_transfer'].includes(type)) return 'transfers';
  if (['request_shift', 'count', 'finish_audit'].includes(type)) return 'shifts';
}

export function isShiftCashier(actor: Actor, shift: Shift | undefined): boolean {
  return (
    !!shift &&
    actor.role !== 'apoyo' &&
    shift.cashierId === actor.id &&
    ((actor.primary && shift.deviceId === actor.deviceId) ||
      (actor.role === 'admin' && actor.online && actor.aal === 'aal2'))
  );
}
