import { initialState } from './initial.ts';
import { isShiftCashier } from './access.ts';
import { lineTotal, quoteOrder } from './pricing.ts';
import {
  DomainError,
  type Actor,
  type Audit,
  type Command,
  type Count,
  type Expense,
  type Flavor,
  type ID,
  type Order,
  type OrderLine,
  type Payment,
  type PaymentMethod,
  type Promotion,
  type Request,
  type Result,
  type ShipmentLine,
  type Size,
  type State,
  type Transfer,
} from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function assert(ok: unknown, message: string, code = 'VALIDATION'): asserts ok {
  if (!ok) throw new DomainError(message, code);
}
export function id(value: unknown, label = 'Identificador'): ID {
  assert(typeof value === 'string' && UUID.test(value), `${label} inválido.`);
  return value;
}
export function money(value: unknown, label = 'Monto', allowZero = false): number {
  assert(
    typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= (allowZero ? 0 : 1) &&
      value <= 1_000_000_000,
    `${label} debe ser un número entero de pesos válido.`,
  );
  return value;
}
export function quantity(value: unknown, label = 'Cantidad', max = 100000, zero = false): number {
  assert(
    typeof value === 'number' && Number.isFinite(value) && value >= (zero ? 0 : 0.000001) && value <= max,
    `${label} inválida.`,
  );
  return value;
}
function text(value: unknown, label: string, max = 500): string {
  assert(
    typeof value === 'string' && value.trim().length > 0 && value.length <= max,
    `${label} es obligatorio (máximo ${max} caracteres).`,
  );
  return value.trim();
}
function required<T>(value: T | undefined, label: string): T {
  assert(value, `${label} no existe.`);
  return value;
}
function admin(actor: Actor): void {
  assert(
    actor.role === 'admin' && actor.online && actor.aal === 'aal2',
    'Esta operación requiere un administrador con doble factor y conexión.',
    'FORBIDDEN',
  );
}
function cashier(actor: Actor, state: State, shiftId?: string) {
  const shift = required(
    state.shifts.find((x) => x.id === shiftId),
    'Turno',
  );
  assert(
    isShiftCashier(actor, shift),
    'Solo el encargado y equipo de caja de este turno pueden cobrar.',
    'FORBIDDEN',
  );
  assert(shift.status === 'open', 'El turno no está abierto.');
  return shift;
}
export function eventId(command: Command, tag: string): ID {
  let h = 1469598103934665603n;
  for (const c of tag) h = BigInt.asUintN(64, (h ^ BigInt(c.charCodeAt(0))) * 1099511628211n);
  const raw = command.id.replaceAll('-', '');
  const tail = (BigInt(`0x${raw.slice(20)}`) ^ (h & 0xffffffffffffn)).toString(16).padStart(12, '0');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${tail}`;
}
export function stockBalances(state: State, at?: string): Record<string, number> {
  return state.stock
    .filter((x) => !at || x.at <= at)
    .reduce(
      (all, x) => {
        all[x.article] = (all[x.article] ?? 0) + x.quantity;
        return all;
      },
      {} as Record<string, number>,
    );
}
export function articles(state: State): { id: string; name: string; unit: string }[] {
  return [
    ...state.flavors.flatMap((f) => [
      { id: `sealed_bag:${f.id}`, name: `Bolsas · ${f.name}`, unit: 'bolsas' },
      { id: `liquid:${f.id}`, name: `Líquido · ${f.name}`, unit: 'oz' },
    ]),
    ...state.sizes
      .filter((s) => s.cups > 0)
      .flatMap((s) => [
        { id: `package:${s.id}`, name: `Paquetes · ${s.name}`, unit: 'paquetes' },
        { id: `cup:${s.id}`, name: `Vasos · ${s.name}`, unit: 'unidades' },
      ]),
    { id: 'copita', name: 'Copitas de degustación', unit: 'unidades' },
    { id: 'coronita', name: 'Coronitas', unit: 'unidades' },
  ];
}

/** Tolerancia para una operación en línea que tardó en llegar (reintentos, red lenta). */
export const ONLINE_LAG_MS = 10 * 60_000;
/**
 * Hora con la que se registra y evalúa una operación. La hora del dispositivo solo se acepta hacia
 * adelante: una operación en línea no queda más de ONLINE_LAG_MS antes de la hora del servidor; ninguna
 * queda antes del último evento de su dispositivo, de la apertura de su turno o de la creación de su
 * pedido; y un cierre o arqueo nunca queda antes del último movimiento de dinero que debe incluir.
 */
export function effectiveAt(state: State, command: Command, actor: Actor, receivedAt: string): string {
  const reported = Date.parse(command.at);
  let t = reported;
  const floor = (value: string | number | undefined) => {
    const v = typeof value === 'string' ? Date.parse(value) : value;
    if (v !== undefined && Number.isFinite(v) && v > t) t = v;
  };
  if (actor.online) floor(Date.parse(receivedAt) - ONLINE_LAG_MS);
  // Solo operaciones del negocio: los eventos de seguridad (dexter_branch_audit) usan eventId === id
  // y llevan la hora de la base de datos, no la del dispositivo.
  for (const a of state.audit) if (a.deviceId === command.deviceId && a.eventId !== a.id) floor(a.at);
  const p = (command.payload ?? {}) as Record<string, unknown>;
  const shiftId = typeof p.shiftId === 'string' ? p.shiftId : command.shiftId;
  floor(state.shifts.find((x) => x.id === shiftId)?.openedAt);
  if (typeof p.orderId === 'string') floor(state.orders.find((x) => x.id === p.orderId)?.createdAt);
  if (command.type === 'finish_audit' || (command.type === 'count' && p.kind === 'closing')) {
    const drawer = `cash:${shiftId}`;
    for (const x of state.payments) if (x.shiftId === shiftId) floor(x.at);
    for (const x of state.expenses) if (x.shiftId === shiftId && x.source === 'cash') floor(x.at);
    for (const x of state.transfers)
      if (x.from === drawer || x.to === drawer) {
        floor(x.executedAt);
        floor(x.confirmedAt);
      }
  }
  return t === reported ? command.at : new Date(t).toISOString();
}
/** Mes calendario de Colombia (UTC−5, sin horario de verano), p. ej. "2026-10". */
export function colombiaMonth(at: string): string {
  return new Date(Date.parse(at) - 5 * 3600_000).toISOString().slice(0, 7);
}
/** Normaliza una fecha recibida (con o sin zona horaria) a ISO UTC para compararla como texto. */
function isoDate(value: unknown, label: string): string {
  assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${label} inválida.`);
  return new Date(Date.parse(value)).toISOString();
}
export function cashExpected(state: State, shiftId: string, at?: string): number {
  const shift = required(
    state.shifts.find((x) => x.id === shiftId),
    'Turno',
  );
  const before = (date: string) => !at || date <= at;
  return (
    shift.base +
    state.payments
      .filter((x) => x.shiftId === shiftId && paymentMethod(x) === 'cash' && before(x.at))
      .reduce((n, x) => n + x.amount, 0) -
    state.expenses
      .filter((x) => x.shiftId === shiftId && x.source === 'cash' && x.status === 'approved' && before(x.at))
      .reduce((n, x) => n + x.amount, 0) +
    state.transfers
      .filter((x) => x.to === `cash:${shiftId}` && x.status === 'confirmed' && before(x.confirmedAt!))
      .reduce((n, x) => n + x.amount, 0) -
    state.transfers
      .filter(
        (x) =>
          (x.executionShiftId === shiftId || (!x.executionShiftId && x.from === `cash:${shiftId}`)) &&
          x.executedAt &&
          before(x.executedAt),
      )
      .reduce((n, x) => n + x.amount, 0)
  );
}
export function openingExpectedCash(state: State): number | null {
  const last = state.counts.find((x) => x.id === state.settings[0].lastCountId);
  if (last?.cash === undefined) return null;
  const executed = state.transfers.filter(
    (x) =>
      x.shiftId === last.shiftId &&
      x.from === `cash:${last.shiftId}` &&
      x.executedAt &&
      x.executedAt >= last.at,
  );
  return last.cash - executed.reduce((n, x) => n + x.amount, 0);
}
/** Medio de un pago; los registros anteriores a las transferencias son efectivo. */
export const paymentMethod = (x: Pick<Payment, 'method'>): PaymentMethod => x.method ?? 'cash';
/** Lo cobrado en un turno por medio de pago; las transferencias también por cuenta (reembolsos restan). */
export function salesByMethod(state: State, shiftId: string) {
  const totals = { cash: 0, transfer: 0, transferCount: 0, byAccount: {} as Record<ID, number> };
  for (const x of state.payments)
    if (x.shiftId === shiftId) {
      if (paymentMethod(x) === 'cash') totals.cash += x.amount;
      else {
        totals.transfer += x.amount;
        if (x.amount > 0) totals.transferCount++;
        totals.byAccount[x.accountId!] = (totals.byAccount[x.accountId!] ?? 0) + x.amount;
      }
    }
  return totals;
}
export function locationBalance(state: State, locationId: string): number {
  return (
    (state.locations.find((x) => x.id === locationId)?.openingBalance ?? 0) +
    state.payments
      .filter((x) => paymentMethod(x) === 'transfer' && x.accountId === locationId)
      .reduce((sum, x) => sum + x.amount, 0) +
    state.transfers
      .filter((x) => x.status === 'confirmed' && x.type === 'transfer' && x.to === locationId)
      .reduce((sum, x) => sum + x.amount, 0) -
    state.transfers
      .filter((x) => x.executedAt && x.from === locationId)
      .reduce((sum, x) => sum + x.amount, 0) -
    state.expenses
      .filter((x) => x.status === 'approved' && x.source === 'treasury' && x.locationId === locationId)
      .reduce((sum, x) => sum + x.amount, 0)
  );
}
export function quotePayment(state: State, order: Order, at: string, online: boolean, codes: string[] = []) {
  if (!order.carriedCouponFromId) return quoteOrder(state, order.lines, at, online, codes);
  assert(online, 'La corrección de un ticket con cupón requiere conexión.', 'ONLINE_REQUIRED');
  assert(
    codes.length === 0,
    'Esta corrección conserva los cupones originales. Registra otros beneficios en un pedido separado.',
  );
  const original = required(
      state.orders.find((o) => o.id === order.carriedCouponFromId && o.status === 'voided'),
      'Venta original anulada',
    ),
    previous = required(
      state.orders.find((o) => o.id === order.replacesId && o.status === 'voided'),
      'Ticket sustituido',
    );
  assert(
    order.inventoryTransferred &&
      (previous.id === original.id || previous.carriedCouponFromId === original.id) &&
      state.requests.some(
        (r) => r.type === 'void' && r.referenceId === previous.id && r.status === 'approved',
      ),
    'La transferencia del beneficio requiere la anulación aprobada y los mismos productos físicos.',
  );
  const coupons = state.coupons.filter((c) => c.orderId === original.id && c.status === 'redeemed');
  assert(coupons.length > 0, 'El ticket original no tiene cupones redimidos.');
  const rules = original.lines
      .flatMap((l) => l.appliedRules ?? [])
      .filter((r) => r.couponId)
      .map((r) => r.promotion),
    couponPromoIds = new Set(coupons.map((c) => c.promotionId));
  const historical = {
    ...state,
    coupons: state.coupons.map((c) =>
      coupons.some((x) => x.id === c.id) ? { ...c, status: 'issued' as const } : c,
    ),
    promotions: [
      ...state.promotions.filter((p) => !couponPromoIds.has(p.id)),
      ...[...couponPromoIds].map((key) => ({
        ...required(
          rules.find((p) => p.id === key) ?? state.promotions.find((p) => p.id === key),
          'Regla original del cupón',
        ),
        active: true,
        maxRedemptions: null,
      })),
    ],
  };
  return quoteOrder(
    historical,
    order.lines,
    original.paidAt ?? original.createdAt,
    true,
    coupons.map((c) => c.code),
  );
}

/** All business mutations run here on the server; local replay is only an optimistic copy. */
export function applyCommand(
  original: State,
  command: Command,
  actor: Actor,
  receivedAt = new Date().toISOString(),
): { state: State; result: Result } {
  id(command.id);
  id(command.actorId);
  id(command.deviceId);
  assert(
    actor.active && actor.id === command.actorId && actor.deviceId === command.deviceId,
    'Usuario o dispositivo no autorizado.',
    'FORBIDDEN',
  );
  assert(Number.isSafeInteger(command.sequence) && command.sequence > 0, 'Secuencia inválida.');
  assert(Number.isFinite(Date.parse(command.at)), 'Fecha inválida.');
  assert(
    Date.parse(command.at) <= Date.parse(receivedAt) + 300000,
    'La hora del dispositivo está adelantada.',
  );
  const reportedAt = command.at;
  command = { ...command, at: effectiveAt(original, command, actor, receivedAt) };
  if (actor.role === 'admin' && actor.online)
    assert(actor.aal === 'aal2', 'Completa el doble factor.', 'FORBIDDEN');
  const prior = original.audit.find((x) => x.eventId === command.id);
  if (prior)
    return {
      state: structuredClone(original),
      result: {
        id: command.id,
        status: 'accepted',
        message: 'Operación ya registrada.',
        referenceId: prior.referenceId,
      },
    };
  const state = structuredClone(original),
    settings = state.settings[0],
    p = command.payload as Record<string, any>;
  const makeId = (tag: string) => eventId(command, tag);
  let ref: string | undefined,
    message = 'Registro guardado.',
    review = false;
  const notify = (channel: State['notifications'][number]['channel'], value: string) =>
    state.notifications.push({
      id: makeId(`notify:${channel}`),
      channel,
      text: value,
      at: receivedAt,
      status: 'pending',
      attempts: 0,
    });
  const movement = (article: string, amount: number, reason: string, referenceId: string, tag = article) => {
    assert(
      articles(state).some((x) => x.id === article),
      'Artículo desconocido.',
    );
    assert(Number.isFinite(amount) && amount !== 0, 'Movimiento de inventario inválido.');
    if (!article.startsWith('liquid:'))
      assert(Number.isInteger(amount), 'Este artículo se registra en unidades enteras.');
    state.stock.push({
      id: makeId(`stock:${tag}`),
      article,
      quantity: amount,
      reason,
      referenceId,
      at: command.at,
      by: actor.id,
      eventId: command.id,
    });
  };
  const evidence = (value: unknown) => {
    const key = id(value, 'Foto');
    required(
      state.attachments.find((x) => x.id === key),
      'Foto',
    );
    return key;
  };
  const operating = () => {
    assert(actor.online || actor.primary, 'El apoyo requiere conexión.', 'ONLINE_REQUIRED');
    assert(
      !settings.auditId,
      'Hay un arqueo en curso. Registra temporalmente en la planilla.',
      'AUDIT_ACTIVE',
    );
    return required(
      state.shifts.find((x) => x.status === 'open'),
      'Turno abierto',
    );
  };
  /**
   * Medio de pago pedido en la operación. Sin indicar, usa el del pago de referencia (reembolsos) o
   * efectivo. Una venta por transferencia exige una cuenta activa que recibe ventas; un reembolso, una
   * cuenta activa del negocio.
   */
  const paymentFields = (
    original?: Payment,
    refund = false,
  ): Pick<Payment, 'method' | 'accountId' | 'reference'> => {
    const method = p.method ?? (original ? paymentMethod(original) : 'cash');
    assert(method === 'cash' || method === 'transfer', 'Medio de pago inválido.');
    if (method === 'cash') return { method };
    const accountId = p.accountId ?? (p.method === undefined ? original?.accountId : undefined);
    const account = required(
      state.locations.find(
        (x) => x.id === accountId && x.active && x.type === 'bank' && (refund || x.receivesSales === true),
      ),
      'Cuenta que recibe la transferencia',
    );
    const reference = typeof p.reference === 'string' ? p.reference.trim().slice(0, 80) : '';
    return { method, accountId: account.id, ...(reference ? { reference } : {}) };
  };
  const originalPayment = (orderId?: ID) => state.payments.find((x) => x.orderId === orderId && x.amount > 0);
  const findOrder = () =>
    required(
      state.orders.find((x) => x.id === p.orderId),
      'Pedido',
    );
  const checkVersion = (order: Order) => {
    if (p.expectedVersion !== undefined)
      assert(
        order.version === p.expectedVersion,
        'El pedido cambió en otro dispositivo. Actualiza antes de continuar.',
        'CONFLICT',
      );
  };
  const sourcePricing = (): State => {
    if (command.configVersion === settings.version) return state;
    const recorded = state.parameters.find(
      (x) => x.version === command.configVersion && x.kind === 'catalog',
    );
    assert(recorded, 'La configuración de origen no existe. Requiere revisión.', 'CONFLICT');
    const history = recorded.after as { sizes: Size[]; flavors: Flavor[]; promotions: Promotion[] };
    review = true;
    return { ...state, sizes: history.sizes, flavors: history.flavors, promotions: history.promotions };
  };
  const buildLines = (inputs: unknown, pricing: State): OrderLine[] => {
    assert(
      Array.isArray(inputs) && inputs.length > 0 && inputs.length <= 100,
      'Agrega entre 1 y 100 líneas.',
    );
    const providedIds = inputs.map((x) => x.id).filter(Boolean);
    assert(new Set(providedIds).size === providedIds.length, 'No repitas identificadores de líneas.');
    let totalUnits = 0;
    return inputs.map((input: Record<string, unknown>, index: number) => {
      const flavor = required(
        pricing.flavors.find((x) => x.id === input.flavorId && x.active),
        'Sabor activo',
      );
      const size = required(
        pricing.sizes.find((x) => x.id === input.sizeId && x.active),
        'Tamaño activo',
      );
      const price = flavor.alcohol ? size.alcoholPrice : size.plainPrice;
      assert(
        price !== null && price > 0 && size.ounces > 0,
        'Este producto está pendiente de precio o composición.',
      );
      const qty = quantity(input.quantity, 'Cantidad', 500);
      assert(Number.isInteger(qty), 'La cantidad debe ser entera.');
      if (input.id) {
        const owner = state.orders.find((o) => o.lines.some((l) => l.id === input.id));
        assert(
          !owner || (command.type === 'update_order' && owner.id === p.orderId),
          'La línea pertenece a otro pedido.',
        );
      }
      totalUnits += qty;
      assert(totalUnits <= 500, 'Divide los pedidos de más de 500 productos.');
      return {
        id: input.id ? id(input.id) : makeId(`line:${index}`),
        flavorId: flavor.id,
        sizeId: size.id,
        quantity: qty,
        delivered: 0,
        listPrice: price,
        unitPrice: price,
        discount: 0,
        consumptionIds: [],
        recipe: { ounces: size.ounces, cups: size.cups, beers: size.beers },
      };
    });
  };
  const deliver = (order: Order, lines?: Record<string, number>) => {
    for (const line of order.lines) {
      const qty = lines ? (lines[line.id] ?? 0) : line.quantity - line.delivered;
      if (!qty) continue;
      quantity(qty, 'Cantidad entregada', 500);
      assert(
        Number.isInteger(qty) && line.delivered + qty <= line.quantity,
        'No puedes entregar más de lo solicitado.',
      );
      const size = {
        ...required(
          state.sizes.find((x) => x.id === line.sizeId),
          'Tamaño',
        ),
        ...line.recipe,
      };
      const deliveryId = makeId(`delivery:${line.id}`);
      state.deliveries.push({
        id: deliveryId,
        orderId: order.id,
        lineId: line.id,
        quantity: qty,
        by: actor.id,
        at: command.at,
        eventId: command.id,
      });
      if (size.cups) movement(`cup:${size.id}`, -qty * size.cups, 'delivery', order.id, `${line.id}:cup`);
      if (size.beers) movement('coronita', -qty * size.beers, 'delivery', order.id, `${line.id}:beer`);
      movement(`liquid:${line.flavorId}`, -qty * size.ounces, 'delivery', order.id, `${line.id}:liquid`);
      line.delivered += qty;
      line.consumptionIds.push(deliveryId);
    }
    order.version++;
  };
  const catalogBefore = () => ({
    sizes: structuredClone(state.sizes),
    flavors: structuredClone(state.flavors),
    promotions: structuredClone(state.promotions),
    settings: structuredClone(settings),
  });
  const versionCatalog = (before: unknown) => {
    settings.version++;
    state.parameters.push({
      id: makeId('parameter'),
      by: actor.id,
      at: receivedAt,
      kind: 'catalog',
      before,
      after: catalogBefore(),
      version: settings.version,
    });
  };

  switch (command.type) {
    case 'save_flavor': {
      admin(actor);
      const before = catalogBefore();
      const key = p.id ? id(p.id) : makeId('flavor');
      const flavor: Flavor = {
        id: key,
        name: text(p.name, 'Nombre', 60),
        alcohol: p.alcohol === true,
        active: p.active !== false,
      };
      const old = state.flavors.findIndex((x) => x.id === key);
      if (old >= 0) state.flavors[old] = flavor;
      else state.flavors.push(flavor);
      versionCatalog(before);
      ref = key;
      break;
    }
    case 'save_size': {
      admin(actor);
      const before = catalogBefore(),
        key = id(p.id);
      const old = required(
        state.sizes.find((x) => x.id === key),
        'Tamaño',
      );
      Object.assign(old, {
        alcoholPrice: p.alcoholPrice === null ? null : money(p.alcoholPrice, 'Precio con licor'),
        plainPrice: p.plainPrice === null ? null : money(p.plainPrice, 'Precio sin licor'),
        ounces: quantity(p.ounces, 'Onzas', 1000, true),
        cups: quantity(p.cups, 'Vasos', 10, true),
        beers: quantity(p.beers, 'Coronitas', 20, true),
        active: p.active === true,
      });
      assert(
        Number.isInteger(old.cups) && Number.isInteger(old.beers),
        'Vasos y coronitas deben ser enteros.',
      );
      assert(
        !old.active || (old.ounces > 0 && old.alcoholPrice !== null && old.plainPrice !== null),
        'Completa precio y composición para activar.',
      );
      versionCatalog(before);
      ref = key;
      break;
    }
    case 'configure': {
      admin(actor);
      const before = catalogBefore();
      settings.businessName = text(p.businessName ?? settings.businessName, 'Nombre', 80);
      for (const key of ['cashLimit', 'expenseLimit'] as const)
        if (p[key] !== undefined) settings[key] = money(p[key], key, true);
      if (p.courtesyQuota !== undefined) {
        settings.courtesyQuota = quantity(p.courtesyQuota, 'Cuota', 1000, true);
        assert(Number.isInteger(settings.courtesyQuota), 'Cuota entera.');
      }
      if (p.cupPackageUnits !== undefined) {
        settings.cupPackageUnits = quantity(p.cupPackageUnits, 'Unidades por paquete', 1000);
        assert(Number.isInteger(settings.cupPackageUnits), 'Unidades enteras.');
      }
      if (p.bagOunces !== undefined) settings.bagOunces = quantity(p.bagOunces, 'Onzas por bolsa', 10000);
      if (p.liquidTolerance !== undefined)
        settings.liquidTolerance =
          p.liquidTolerance === null ? null : quantity(p.liquidTolerance, 'Tolerancia', 1, true);
      if (p.syncWarningMinutes !== undefined)
        settings.syncWarningMinutes = quantity(p.syncWarningMinutes, 'Aviso de sincronización', 1440);
      if (p.skipOpeningCount !== undefined) settings.skipOpeningCount = p.skipOpeningCount === true;
      if (p.baseline !== undefined) settings.baseline = p.baseline === true;
      for (const key of ['openingChecklist', 'closingChecklist'] as const)
        if (p[key] !== undefined) {
          assert(Array.isArray(p[key]) && p[key].length <= 30, 'Checklist inválido.');
          settings[key] = p[key].map((value: unknown) => text(value, 'Tarea', 150));
        }
      if (p.expenseCategories !== undefined) {
        assert(
          Array.isArray(p.expenseCategories) && p.expenseCategories.length <= 30,
          'Categorías inválidas.',
        );
        settings.expenseCategories = p.expenseCategories.map((v: unknown) => text(v, 'Categoría', 60));
      }
      versionCatalog(before);
      ref = settings.id;
      break;
    }
    case 'initialize_stock': {
      admin(actor);
      assert(
        !settings.inventoryInitialized,
        'El inventario inicial ya fue registrado. Usa recepciones y ajustes aprobados.',
      );
      for (const [article, value] of Object.entries(p.items ?? {})) {
        const amount = quantity(value, 'Inventario inicial', 1000000, true);
        if (amount) movement(article, amount, 'initial', makeId('initial'), article);
      }
      settings.inventoryInitialized = true;
      ref = makeId('initial');
      break;
    }
    case 'request_shift': {
      const directOpening = actor.role === 'admin' && actor.online;
      if (directOpening) admin(actor);
      else
        assert(
          actor.role !== 'apoyo' && actor.primary,
          'Solo el encargado en el equipo de caja solicita turno.',
          'FORBIDDEN',
        );
      assert(
        !state.shifts.some((x) => ['open', 'requested', 'provisional'].includes(x.status)),
        'Ya existe un turno abierto, solicitado o pendiente de sincronizar.',
      );
      ref = makeId('shift');
      state.shifts.push({
        id: ref,
        cashierId: actor.id,
        deviceId: actor.deviceId,
        status: directOpening ? 'open' : 'requested',
        requestedAt: command.at,
        ...(directOpening ? { openedAt: command.at, authorizedBy: actor.id } : {}),
        base: openingExpectedCash(state) ?? (directOpening ? money(p.base ?? 0, 'Base', true) : 0),
        openingSkipped: false,
      });
      break;
    }
    case 'authorize_shift': {
      const offline = !!actor.offlineAdminId && !actor.online && actor.primary;
      if (!offline) admin(actor);
      const shift = required(
        state.shifts.find((x) => x.id === p.shiftId && x.status === 'requested'),
        'Turno solicitado',
      );
      const expected = openingExpectedCash(state);
      shift.base = expected ?? money(p.base ?? 0, 'Base', true);
      shift.authorizedBy = offline ? actor.offlineAdminId : actor.id;
      shift.openedAt = command.at;
      shift.status = 'open';
      if (offline) {
        shift.offlineAuthorizedBy = actor.offlineAdminId;
        review = true;
      }
      ref = shift.id;
      break;
    }
    case 'start_audit': {
      admin(actor);
      assert(!settings.auditId, 'Ya existe un arqueo en curso.');
      settings.auditId = makeId('audit-cut');
      ref = settings.auditId;
      break;
    }
    case 'count':
    case 'finish_audit': {
      const kind = command.type === 'finish_audit' ? 'audit' : p.kind;
      assert(['opening', 'closing', 'audit'].includes(kind), 'Tipo de conteo inválido.');
      const shift = required(
        state.shifts.find((x) => x.id === p.shiftId),
        'Turno',
      );
      if (kind === 'audit') {
        admin(actor);
        assert(settings.auditId, 'No hay arqueo iniciado.');
      } else cashier(actor, state, shift.id);
      assert(
        !state.counts.some((x) => x.shiftId === shift.id && x.kind === kind && kind !== 'audit'),
        'Este conteo ya fue presentado.',
      );
      const skipped = kind === 'opening' && p.skip === true;
      assert(!skipped || settings.skipOpeningCount, 'El conteo de apertura no se puede omitir.');
      const balances = stockBalances(state),
        items: Record<string, number> = {};
      for (const article of articles(state).filter((x) => !x.id.startsWith('liquid:'))) {
        if (skipped) continue;
        const value = (p.items ?? {})[article.id];
        assert(value !== undefined, `Falta contar ${article.name}.`);
        items[article.id] = quantity(value, article.name, 1000000, true);
        assert(Number.isInteger(items[article.id]), 'Los conteos físicos deben ser enteros.');
      }
      const counted = skipped ? undefined : money(p.cash, 'Efectivo contado', true),
        expected = kind === 'opening' ? shift.base : cashExpected(state, shift.id, command.at);
      if (command.configVersion !== settings.version) sourcePricing();
      const archived = state.parameters.find(
        (v) => v.version === command.configVersion && v.kind === 'catalog',
      )?.after as { settings?: State['settings'][number] } | undefined;
      const procedure = command.configVersion === settings.version ? settings : archived?.settings;
      const tasks =
        kind === 'audit'
          ? []
          : kind === 'opening'
            ? (procedure?.openingChecklist ?? [])
            : (procedure?.closingChecklist ?? []);
      const checklist = tasks.map((task, index) => ({ task, done: p.checklist?.[index] === true }));
      assert(
        skipped || checklist.every((item) => item.done),
        'Completa el checklist antes de presentar el conteo.',
      );
      const count: Count = {
        id: makeId('count'),
        kind,
        shiftId: shift.id,
        by: actor.id,
        at: command.at,
        cash: counted,
        items,
        expectedCash: expected,
        expectedItems: Object.fromEntries(Object.keys(items).map((k) => [k, balances[k] ?? 0])),
        difference: counted === undefined ? undefined : counted - expected,
        differences: Object.fromEntries(Object.keys(items).map((k) => [k, items[k] - (balances[k] ?? 0)])),
        notes: String(p.notes ?? '').slice(0, 1500),
        checklist,
      };
      state.counts.push(count);
      ref = count.id;
      if (kind === 'opening') {
        shift.openingSkipped = skipped;
        shift.openingCountId = count.id;
      }
      if (kind === 'audit') {
        settings.auditId = undefined;
      }
      if (kind === 'closing') {
        assert(!settings.auditId, 'Termina el arqueo antes de cerrar.');
        const retained = money(p.retained, 'Efectivo reservado', true);
        assert(retained <= counted!, 'La base no puede superar el efectivo contado.');
        count.retained = retained;
        shift.retained = retained;
        shift.remittance = counted! - retained;
        shift.closingCountId = count.id;
        shift.closedAt = command.at;
        shift.status = actor.online ? 'closed' : 'provisional';
        settings.lastRetainedCash = retained;
        settings.lastCountId = count.id;
        if (shift.remittance > 0) {
          const location = required(
            state.locations.find((x) => x.id === p.locationId && x.active),
            'Destino del remanente',
          );
          state.transfers.push({
            id: makeId('closing-transfer'),
            by: actor.id,
            recipientId: location.custodianId,
            from: `cash:${shift.id}`,
            to: location.id,
            amount: shift.remittance,
            status: 'requested',
            at: command.at,
            notes: 'Remanente de cierre',
            shiftId: shift.id,
            type: 'transfer',
            votes: [],
          });
          notify('transferencias', `Remanente de cierre pendiente: $${shift.remittance}.`);
        }
        for (const order of state.orders.filter((x) => x.shiftId === shift.id && x.status === 'open')) {
          if (order.lines.some((x) => x.delivered > 0)) {
            order.status = 'unpaid_incident';
            state.requests.push({
              id: makeId(`unpaid:${order.id}`),
              type: 'unpaid',
              by: actor.id,
              at: command.at,
              status: 'pending',
              referenceId: order.id,
              notes: 'Pedido entregado sin cobrar al cierre.',
            });
          } else order.status = order.tastings.length ? 'tasting_only' : 'cancelled';
          order.version++;
        }
      }
      if (count.difference || Object.values(count.differences ?? {}).some((x) => x !== 0))
        notify('mermas', `Diferencias registradas en conteo de ${kind}.`);
      break;
    }
    case 'create_order': {
      const shift = operating();
      const pricing = sourcePricing();
      const lines = buildLines(p.lines, pricing);
      const quote = quoteOrder(pricing, lines, command.at, actor.online);
      ref = p.orderId ? id(p.orderId) : makeId('order');
      assert(!state.orders.some((x) => x.id === ref), 'El pedido ya existe.');
      if (p.origin === 'paper') {
        assert(actor.role !== 'apoyo', 'Solo caja o admin ingresa planillas.');
        text(p.paperFolio, 'Folio', 80);
        evidence(p.evidenceId);
        assert(
          !state.orders.some((x) => x.origin === 'paper' && x.paperFolio === p.paperFolio),
          'Este folio ya fue ingresado.',
        );
        assert(Number.isFinite(Date.parse(p.originalAt)), 'Hora original inválida.');
      }
      state.orders.push({
        id: ref,
        number: ref.slice(0, 8).toUpperCase(),
        shiftId: shift.id,
        sellerId: actor.id,
        lines: quote.lines,
        tastings: [],
        status: 'open',
        createdAt: command.at,
        total: quote.total,
        version: 1,
        origin: p.origin === 'paper' ? 'paper' : 'app',
        paperFolio: p.paperFolio,
        originalAt: p.originalAt,
        evidenceId: p.evidenceId,
      });
      break;
    }
    case 'update_order': {
      operating();
      const order = findOrder();
      checkVersion(order);
      assert(order.status === 'open', 'Un pedido cobrado no se edita.');
      const inputs = buildLines(p.lines, sourcePricing());
      for (const old of order.lines) {
        const next = inputs.find((x) => x.id === old.id);
        if (old.delivered) {
          assert(
            next &&
              next.flavorId === old.flavorId &&
              next.sizeId === old.sizeId &&
              next.quantity >= old.delivered,
            'Lo entregado no se elimina ni cambia. Solicita una corrección.',
          );
          next.delivered = old.delivered;
          next.consumptionIds = old.consumptionIds;
        }
      }
      const quote = quoteOrder(sourcePricing(), inputs, command.at, actor.online);
      order.lines = quote.lines;
      order.total = quote.total;
      order.version++;
      ref = order.id;
      break;
    }
    case 'taste': {
      const shift = operating();
      const flavor = required(
        state.flavors.find((x) => x.id === p.flavorId && x.active),
        'Sabor',
      );
      let order = state.orders.find((x) => x.id === p.orderId);
      if (order) {
        checkVersion(order);
        assert(order.status === 'open', 'El pedido ya se cerró.');
      } else {
        order = {
          id: p.orderId ? id(p.orderId) : makeId('order'),
          number: makeId('order').slice(0, 8).toUpperCase(),
          shiftId: shift.id,
          sellerId: actor.id,
          lines: [],
          tastings: [],
          status: 'open',
          createdAt: command.at,
          total: 0,
          version: 1,
          origin: 'app',
        };
        state.orders.push(order);
      }
      order.tastings.push({ id: makeId('tasting'), flavorId: flavor.id, at: command.at });
      order.version++;
      movement('copita', -1, 'tasting', order.id);
      movement(`liquid:${flavor.id}`, -1, 'tasting', order.id);
      ref = order.id;
      break;
    }
    case 'cancel_order': {
      operating();
      const order = findOrder();
      checkVersion(order);
      assert(
        order.status === 'open' && !order.lines.some((x) => x.delivered),
        'Un pedido entregado requiere registrar la novedad.',
      );
      order.status = order.tastings.length ? 'tasting_only' : 'cancelled';
      order.version++;
      ref = order.id;
      break;
    }
    case 'close_tastings': {
      operating();
      const order = findOrder();
      assert(
        order.status === 'open' && !order.lines.length && order.tastings.length > 0,
        'Solo se cierra así un pedido de degustaciones.',
      );
      order.status = 'tasting_only';
      order.version++;
      ref = order.id;
      break;
    }
    case 'record_paper': {
      admin(actor);
      assert(!settings.auditId, 'Termina el arqueo antes de ingresar ventas de la planilla.');
      const shift = required(
        state.shifts.find((x) => x.id === p.shiftId),
        'Turno de la planilla',
      );
      const originalAt = text(p.originalAt, 'Hora original', 40);
      assert(Number.isFinite(Date.parse(originalAt)) && originalAt <= receivedAt, 'Hora original inválida.');
      assert(
        originalAt >= (shift.openedAt ?? shift.requestedAt) &&
          (!shift.closedAt || originalAt <= shift.closedAt),
        'La hora original debe pertenecer al turno elegido.',
      );
      const folio = text(p.paperFolio, 'Folio', 80);
      assert(
        !state.orders.some((x) => x.origin === 'paper' && x.paperFolio === folio),
        'Este folio ya fue ingresado.',
      );
      const photo = evidence(p.evidenceId),
        lines = buildLines(p.lines, state);
      lines.forEach((line, i) => {
        const price = money(p.lines[i].unitPrice, 'Precio cobrado');
        line.listPrice = price;
        line.unitPrice = price;
      });
      const total = lines.reduce((n, l) => n + l.listPrice * l.quantity, 0);
      money(total);
      ref = makeId('paper-order');
      const order: Order = {
        id: ref,
        number: ref.slice(0, 8).toUpperCase(),
        shiftId: shift.id,
        sellerId: actor.id,
        lines,
        tastings: [],
        status: 'paid',
        createdAt: command.at,
        originalAt,
        paidAt: originalAt,
        total,
        version: 1,
        origin: 'paper',
        paperFolio: folio,
        evidenceId: photo,
      };
      state.orders.push(order);
      const registeredAt = command.at;
      command = { ...command, at: originalAt };
      if (p.delivered === true) deliver(order);
      state.payments.push({
        id: makeId('paper-payment'),
        orderId: order.id,
        shiftId: shift.id,
        cashierId: shift.cashierId,
        amount: total,
        type: 'cash',
        ...paymentFields(),
        at: originalAt,
        eventId: command.id,
      });
      command = { ...command, at: registeredAt };
      review = true;
      state.requests.push({
        id: makeId('paper-review'),
        type: 'difference',
        referenceId: order.id,
        by: actor.id,
        at: registeredAt,
        status: 'pending',
        notes: `Planilla ${folio}: ${String(p.notes ?? '')} · cotejar con el efectivo separado y el conteo original.`,
      });
      message = 'Planilla registrada y vinculada para conciliación.';
      break;
    }
    case 'deliver': {
      operating();
      const order = findOrder();
      checkVersion(order);
      assert(['open', 'paid'].includes(order.status), 'Este pedido no admite entregas.');
      deliver(order, p.quantities);
      ref = order.id;
      break;
    }
    case 'pay':
    case 'redeem_coupon': {
      const shift = operating();
      cashier(actor, state, shift.id);
      const order = findOrder();
      checkVersion(order);
      assert(
        order.shiftId === shift.id && order.status === 'open',
        'El pedido no está pendiente de cobro en este turno.',
      );
      assert(order.lines.length > 0, 'Las degustaciones no generan un cobro.');
      const codes = Array.isArray(p.codes) ? p.codes.map((x: unknown) => text(x, 'Cupón', 80)) : [];
      assert(codes.length <= 10, 'Máximo diez cupones por pedido.');
      if (command.type === 'redeem_coupon') assert(codes.length > 0, 'Agrega un cupón.');
      const quote = quotePayment(
        codes.length || order.carriedCouponFromId ? state : sourcePricing(),
        order,
        command.at,
        actor.online,
        codes,
      );
      if (p.expectedTotal !== undefined)
        assert(
          quote.total === p.expectedTotal,
          'El total cambió. Revisa el pedido antes de cobrar.',
          'CONFLICT',
        );
      assert(
        quote.total > 0 || quote.coupons.length > 0,
        'Una venta de $0 requiere un cupón válido.',
        'FORBIDDEN',
      );
      order.lines = quote.lines;
      order.total = quote.total;
      order.paidAt = command.at;
      order.cashierId = actor.id;
      order.status = 'paid';
      order.version++;
      for (const key of quote.coupons) {
        const c = required(
          state.coupons.find((x) => x.id === key),
          'Cupón',
        );
        if (!order.carriedCouponFromId) {
          c.status = 'redeemed';
          c.orderId = order.id;
          c.redeemedAt = command.at;
        }
      }
      const carriedPromos = new Set(
        order.carriedCouponFromId
          ? state.orders
              .find((o) => o.id === order.carriedCouponFromId)
              ?.lines.flatMap((l) => (l.appliedRules ?? []).map((r) => r.promotion.id))
          : [],
      );
      for (const [key, uses] of Object.entries(quote.promotionUses)) {
        if (carriedPromos.has(key)) continue;
        const promo = state.promotions.find((x) => x.id === key);
        if (promo) {
          assert(
            promo.maxRedemptions === null || promo.redemptions + uses <= promo.maxRedemptions,
            'Se alcanzó el cupo de la promoción.',
          );
          promo.redemptions += uses;
        }
      }
      const credit = order.paymentCredit ?? 0;
      const amount = quote.total - credit;
      if (amount < 0) {
        assert(
          !!order.replacesId &&
            state.requests.some(
              (r) => r.type === 'void' && r.referenceId === order.replacesId && r.status === 'approved',
            ),
          'El reembolso requiere una anulación aprobada.',
        );
        evidence(p.refundEvidenceId);
      }
      if (amount !== 0)
        state.payments.push({
          id: makeId('payment'),
          orderId: order.id,
          shiftId: shift.id,
          cashierId: actor.id,
          amount,
          type: amount < 0 ? 'refund' : 'cash',
          ...paymentFields(amount < 0 ? originalPayment(order.replacesId) : undefined, amount < 0),
          at: command.at,
          eventId: command.id,
        });
      if (p.deliver === true) deliver(order);
      if (cashExpected(state, shift.id) > settings.cashLimit)
        notify('transferencias', 'La caja superó el tope de efectivo configurado.');
      ref = order.id;
      message = 'Venta registrada.';
      break;
    }
    case 'request_void': {
      const order = findOrder();
      assert(order.status === 'paid', 'Solo se anula una venta cobrada.');
      ref = makeId('request');
      state.requests.push({
        id: ref,
        type: 'void',
        referenceId: order.id,
        by: actor.id,
        at: command.at,
        status: 'pending',
        notes: text(p.notes, 'Motivo', 1500),
        evidenceId: evidence(p.evidenceId),
      });
      order.status = 'void_requested';
      order.version++;
      notify('anulaciones', `Anulación solicitada · pedido ${order.number}.`);
      break;
    }
    case 'unpaid': {
      operating();
      const order = findOrder();
      assert(
        order.status === 'open' && order.lines.some((x) => x.delivered),
        'El pedido no tiene entregas pendientes de cobro.',
      );
      order.status = 'unpaid_incident';
      order.version++;
      ref = makeId('request');
      state.requests.push({
        id: ref,
        type: 'unpaid',
        referenceId: order.id,
        by: actor.id,
        at: command.at,
        status: 'pending',
        notes: text(p.notes, 'Motivo', 1500),
      });
      break;
    }
    case 'report_damage': {
      assert(actor.online || actor.primary, 'El apoyo requiere conexión.');
      const article = text(p.article, 'Artículo', 100);
      assert(
        articles(state).some((x) => x.id === article),
        'Artículo desconocido.',
      );
      const amount = quantity(p.quantity, 'Cantidad dañada');
      if (!article.startsWith('liquid:')) assert(Number.isInteger(amount), 'Cantidad entera.');
      if (article.startsWith('sealed_bag:'))
        assert(
          p.checklist === true && typeof p.diagnosis === 'string' && p.diagnosis.trim().length > 5,
          'Completa la verificación y el diagnóstico de la bolsa.',
        );
      ref = makeId('damage');
      state.requests.push({
        id: ref,
        type: 'damage',
        by: actor.id,
        at: command.at,
        status: 'pending',
        article,
        quantity: amount,
        notes: text(p.notes, 'Motivo', 1500),
        evidenceId: evidence(p.evidenceId),
        diagnosis: p.diagnosis,
        checklist: p.checklist === true,
      });
      notify('mermas', `Daño pendiente de aprobación · ${article} · ${amount}.`);
      break;
    }
    case 'explain_difference': {
      const count = required(
        state.counts.find((x) => x.id === p.countId),
        'Conteo',
      );
      assert(
        actor.role === 'admin' || count.by === actor.id,
        'Solo puedes explicar tus conteos.',
        'FORBIDDEN',
      );
      ref = makeId('explanation');
      state.requests.push({
        id: ref,
        type: 'difference',
        referenceId: count.id,
        by: actor.id,
        at: command.at,
        status: 'pending',
        notes: text(p.notes, 'Explicación', 1500),
        evidenceId: p.evidenceId ? evidence(p.evidenceId) : undefined,
      });
      break;
    }
    case 'request_courtesy_excess': {
      admin(actor);
      ref = makeId('courtesy-excess');
      state.requests.push({
        id: ref,
        type: 'courtesy_excess',
        by: actor.id,
        at: command.at,
        status: 'pending',
        notes: text(p.notes, 'Motivo', 1500),
      });
      break;
    }
    case 'resolve_request': {
      admin(actor);
      const request = required(
        state.requests.find((x) => x.id === p.requestId && x.status === 'pending'),
        'Solicitud pendiente',
      );
      if (request.type === 'void') {
        const order = required(
          state.orders.find((x) => x.id === request.referenceId),
          'Venta',
        );
        assert(
          order.sellerId !== actor.id &&
            !state.payments.some((p) => p.orderId === order.id && p.cashierId === actor.id) &&
            order.cashierId !== actor.id,
          'No puedes aprobar la anulación de tu propia venta.',
          'FORBIDDEN',
        );
        order.status = p.approve === true ? 'voided' : 'paid';
        order.version++;
      }
      if (request.type === 'damage' && p.approve === true)
        movement(request.article!, -request.quantity!, 'approved_damage', request.id);
      if (request.type === 'courtesy_excess')
        assert(request.by !== actor.id, 'Otra persona debe autorizar el exceso de cortesías.');
      if (request.type === 'sync') {
        request.resolutionNotes = text(p.resolutionNotes, 'Explicación de la conciliación', 1500);
        if (p.approve === true) {
          const target = id(p.resolutionId, 'Registro sustituto');
          assert(
            state.orders.some((x) => x.id === target) ||
              state.counts.some((x) => x.id === target) ||
              state.expenses.some((x) => x.id === target) ||
              state.transfers.some((x) => x.id === target) ||
              state.receipts.some((x) => x.id === target),
            'Primero registra la operación correcta y vincúlala.',
          );
          request.resolutionId = target;
        }
      }
      request.status = p.approve === true ? 'approved' : 'rejected';
      request.reviewedBy = actor.id;
      request.reviewedAt = receivedAt;
      ref = request.id;
      break;
    }
    case 'replace_order': {
      const shift = operating();
      cashier(actor, state, shift.id);
      const old = required(
        state.orders.find((x) => x.id === p.orderId && x.status === 'voided'),
        'Venta anulada',
      );
      assert(
        !old.resolvedAt && !state.orders.some((x) => x.replacesId === old.id),
        'Esta venta ya fue corregida o reembolsada.',
      );
      const lines = buildLines(p.lines, sourcePricing());
      const same = p.sameDelivery === true;
      if (same) {
        assert(
          lines.length === old.lines.length && lines.every((l, i) => l.quantity === old.lines[i].quantity),
          'Para corregir la entrega conserva las cantidades; registra cualquier producto adicional como una entrega nueva.',
        );
        lines.forEach((line, i) => {
          const prior = old.lines[i],
            amount = prior.delivered;
          line.delivered = amount;
          line.consumptionIds = [...prior.consumptionIds];
          if (amount && (line.sizeId !== prior.sizeId || line.flavorId !== prior.flavorId)) {
            const a = {
                ...required(
                  state.sizes.find((x) => x.id === prior.sizeId),
                  'Tamaño original',
                ),
                ...prior.recipe,
              },
              b = {
                ...required(
                  state.sizes.find((x) => x.id === line.sizeId),
                  'Tamaño corregido',
                ),
                ...line.recipe,
              };
            if (a.cups)
              movement(`cup:${a.id}`, amount * a.cups, 'recipe_correction', old.id, `${line.id}:oldcup`);
            if (b.cups)
              movement(`cup:${b.id}`, -amount * b.cups, 'recipe_correction', old.id, `${line.id}:newcup`);
            if (a.beers)
              movement('coronita', amount * a.beers, 'recipe_correction', old.id, `${line.id}:oldbeer`);
            if (b.beers)
              movement('coronita', -amount * b.beers, 'recipe_correction', old.id, `${line.id}:newbeer`);
            movement(
              `liquid:${prior.flavorId}`,
              amount * a.ounces,
              'recipe_correction',
              old.id,
              `${line.id}:oldliquid`,
            );
            movement(
              `liquid:${line.flavorId}`,
              -amount * b.ounces,
              'recipe_correction',
              old.id,
              `${line.id}:newliquid`,
            );
          }
        });
      }
      ref = makeId('replacement');
      const replacement: Order = {
        id: ref,
        number: ref.slice(0, 8).toUpperCase(),
        shiftId: shift.id,
        sellerId: actor.id,
        lines,
        tastings: [],
        status: 'open',
        createdAt: command.at,
        total: 0,
        version: 1,
        origin: 'app',
        replacesId: old.id,
        paymentCredit: old.total,
        paymentTransferFromId: old.id,
        inventoryTransferred: same,
        carriedCouponFromId: same
          ? (old.carriedCouponFromId ??
            (state.coupons.some((c) => c.orderId === old.id && c.status === 'redeemed') ? old.id : undefined))
          : undefined,
      };
      const quote = quotePayment(sourcePricing(), replacement, command.at, actor.online);
      replacement.lines = quote.lines;
      replacement.total = quote.total;
      state.orders.push(replacement);
      old.resolvedAt = command.at;
      break;
    }
    case 'refund_order': {
      const shift = operating();
      cashier(actor, state, shift.id);
      const order = required(
        state.orders.find((x) => x.id === p.orderId && x.status === 'voided'),
        'Venta anulada',
      );
      assert(
        !order.resolvedAt && !state.orders.some((x) => x.replacesId === order.id),
        'Esta anulación ya fue conciliada.',
      );
      assert(
        state.requests.some(
          (x) => x.referenceId === order.id && x.type === 'void' && x.status === 'approved',
        ),
        'La anulación no está aprobada.',
      );
      evidence(p.evidenceId);
      if (order.total > 0)
        state.payments.push({
          id: makeId('refund'),
          orderId: order.id,
          shiftId: shift.id,
          cashierId: actor.id,
          amount: -order.total,
          type: 'refund',
          ...paymentFields(originalPayment(order.id), true),
          at: command.at,
          eventId: command.id,
        });
      order.resolvedAt = command.at;
      ref = order.id;
      break;
    }
    case 'create_shipment': {
      admin(actor);
      assert(['Medellín', 'Tarazá'].includes(p.from), 'Origen inválido.');
      assert(Array.isArray(p.items) && p.items.length > 0 && p.items.length <= 100, 'Agrega mercancía.');
      const items: ShipmentLine[] = p.items.map((v: Record<string, unknown>) => {
        const article = text(v.article, 'Artículo', 100);
        assert(
          articles(state).some((x) => x.id === article),
          'Artículo desconocido.',
        );
        return { article, quantity: quantity(v.quantity), unitCost: money(v.unitCost, 'Costo', true) };
      });
      assert(new Set(items.map((x) => x.article)).size === items.length, 'No repitas artículos en el envío.');
      ref = makeId('shipment');
      state.shipments.push({
        id: ref,
        by: actor.id,
        from: p.from,
        supplier: text(p.supplier, 'Proveedor', 100),
        items,
        at: command.at,
        status: 'in_transit',
        notes: String(p.notes ?? '').slice(0, 1500),
      });
      if (p.paidWith) {
        const amount = items.reduce((n, x) => n + x.quantity * x.unitCost, 0);
        money(amount);
        const source = p.paidWith;
        assert(['personal', 'treasury', 'cash'].includes(source), 'Origen del pago inválido.');
        if (source === 'cash') {
          const shift = operating();
          cashier(actor, state, shift.id);
          assert(amount <= settings.expenseLimit, 'La compra supera el tope de gastos de caja.');
        }
        if (source === 'treasury')
          required(
            state.locations.find((x) => x.id === p.locationId && x.active),
            'Cuenta o caja que pagó',
          );
        const exp: Expense = {
          id: makeId('purchase-expense'),
          by: actor.id,
          at: command.at,
          category: 'Insumos',
          amount,
          source,
          locationId: p.locationId,
          supplier: p.supplier,
          notes: 'Compra vinculada al envío',
          shiftId: source === 'cash' ? operating().id : undefined,
          status: 'pending',
          shipmentId: ref,
          evidenceId: p.evidenceId ? evidence(p.evidenceId) : undefined,
        };
        state.expenses.push(exp);
        state.shipments.at(-1)!.expenseId = exp.id;
        notify('gastos', `Compra registrada · $${amount}.`);
      }
      break;
    }
    case 'receive_shipment': {
      assert(actor.online || actor.primary, 'La recepción del apoyo requiere conexión.');
      const shipment = required(
        state.shipments.find((x) => x.id === p.shipmentId && x.status !== 'received'),
        'Envío pendiente',
      );
      const items: Record<string, number> = {},
        damaged: Record<string, number> = {};
      for (const [k, v] of Object.entries(p.items ?? {})) {
        assert(
          articles(state).some((x) => x.id === k),
          'Artículo desconocido.',
        );
        items[k] = quantity(v, 'Recibido', 1000000, true);
        damaged[k] = quantity((p.damaged ?? {})[k] ?? 0, 'Dañado', items[k], true);
      }
      assert(Object.keys(items).length > 0, 'Registra lo recibido.');
      const photo = evidence(p.evidenceId);
      ref = makeId('receipt');
      const previous = state.receipts.filter((x) => x.shipmentId === shipment.id);
      const expected = Object.fromEntries(
        shipment.items.map((x) => [
          x.article,
          x.quantity - previous.reduce((n, r) => n + (r.items[x.article] ?? 0), 0),
        ]),
      );
      state.receipts.push({
        id: ref,
        shipmentId: shipment.id,
        by: actor.id,
        at: command.at,
        items,
        damaged,
        expected,
        differences: Object.fromEntries(
          Object.keys({ ...expected, ...items }).map((k) => [k, (items[k] ?? 0) - (expected[k] ?? 0)]),
        ),
        evidenceId: photo,
        notes: String(p.notes ?? '').slice(0, 1500),
      });
      for (const [article, amount] of Object.entries(items)) {
        const usable = amount - (damaged[article] ?? 0);
        if (usable) movement(article, usable, 'receipt', ref);
      }
      shipment.status = shipment.items.every(
        (x) =>
          previous.reduce((n, r) => n + (r.items[x.article] ?? 0), 0) + (items[x.article] ?? 0) >= x.quantity,
      )
        ? 'received'
        : 'partial';
      if (
        Object.values(state.receipts.at(-1)!.differences!).some((x) => x !== 0) ||
        Object.values(damaged).some((x) => x > 0)
      )
        notify('mermas', 'Recepción con diferencias o mercancía dañada.');
      break;
    }
    case 'open_package': {
      operating();
      const size = required(
        state.sizes.find((x) => x.id === p.sizeId && x.cups > 0),
        'Tamaño',
      );
      const units = quantity(p.units ?? settings.cupPackageUnits, 'Unidades', 1000);
      assert(Number.isInteger(units), 'Unidades enteras.');
      const previous = state.packages.find((x) => x.sizeId === size.id && !x.closedAt);
      let difference = 0;
      if (previous) {
        assert(p.confirmEmpty === true, 'Confirma que el paquete anterior quedó vacío.');
        difference = stockBalances(state)[`cup:${size.id}`] ?? 0;
        previous.closedAt = command.at;
      }
      ref = makeId('package');
      state.packages.push({
        id: ref,
        sizeId: size.id,
        units,
        openedAt: command.at,
        by: actor.id,
        priorDifference: difference,
      });
      movement(`package:${size.id}`, -1, 'open_package', ref, 'package');
      movement(`cup:${size.id}`, units, 'open_package', ref, 'cups');
      if (difference !== 0)
        notify(
          'mermas',
          `Diferencia al abrir paquete ${size.name}: ${difference} vasos esperados del anterior.`,
        );
      break;
    }
    case 'open_bag': {
      operating();
      const flavor = required(
        state.flavors.find((x) => x.id === p.flavorId),
        'Sabor',
      );
      const ounces = quantity(p.ounces ?? settings.bagOunces, 'Onzas por bolsa', 10000);
      ref = makeId('bag');
      state.bags.push({ id: ref, flavorId: flavor.id, ounces, openedAt: command.at, by: actor.id });
      movement(`sealed_bag:${flavor.id}`, -1, 'open_bag', ref, 'bag');
      movement(`liquid:${flavor.id}`, ounces, 'open_bag', ref, 'liquid');
      break;
    }
    case 'exhaust_bag': {
      operating();
      const bag = required(
        state.bags.find((x) => x.id === p.bagId && !x.exhaustedAt),
        'Bolsa abierta',
      );
      bag.exhaustedAt = command.at;
      ref = bag.id;
      break;
    }
    case 'expense': {
      assert(actor.role !== 'apoyo', 'Solo el encargado o un admin registra gastos.', 'FORBIDDEN');
      const amount = money(p.amount);
      const source = p.source;
      assert(['cash', 'treasury', 'personal'].includes(source), 'Origen del pago inválido.');
      const shift = source === 'cash' ? operating() : undefined;
      if (shift) cashier(actor, state, shift.id);
      else admin(actor);
      const category = text(p.category, 'Categoría', 60);
      if (source === 'cash') {
        assert(settings.expenseCategories.includes(category), 'Esta categoría no se paga de caja.');
        assert(amount <= settings.expenseLimit, 'El gasto supera el tope de caja.');
      }
      if (source === 'treasury')
        required(
          state.locations.find((x) => x.id === p.locationId && x.active),
          'Cuenta o caja que pagó',
        );
      const notes = String(p.notes ?? '').slice(0, 1500);
      const photo = p.evidenceId ? evidence(p.evidenceId) : undefined;
      assert(photo || notes.trim(), 'Agrega foto o una nota explicativa.');
      ref = makeId('expense');
      state.expenses.push({
        id: ref,
        by: actor.id,
        at: command.at,
        category,
        amount,
        source,
        locationId: p.locationId,
        supplier: text(p.supplier, 'Proveedor', 100),
        notes,
        evidenceId: photo,
        shiftId: shift?.id,
        status: 'pending',
      });
      notify('gastos', `Gasto pendiente · ${category} · $${amount}.`);
      break;
    }
    case 'approve_expense': {
      admin(actor);
      const expense = required(
        state.expenses.find((x) => x.id === p.expenseId && x.status === 'pending'),
        'Gasto pendiente',
      );
      expense.status = p.approve === true ? 'approved' : 'rejected';
      expense.approvedBy = actor.id;
      if (expense.status === 'approved' && expense.source === 'personal')
        state.transfers.push({
          id: makeId('reimbursement'),
          by: actor.id,
          recipientId: expense.by,
          from: 'treasury',
          to: 'personal',
          amount: expense.amount,
          status: 'requested',
          at: command.at,
          type: 'reimbursement',
          votes: [],
          expenseId: expense.id,
          notes: `Reembolso de gasto ${expense.id}`,
        });
      ref = expense.id;
      break;
    }
    case 'save_location': {
      admin(actor);
      const key = p.id ? id(p.id) : makeId('location');
      const prior = state.locations.find((x) => x.id === key);
      const location = {
        id: key,
        name: text(p.name, 'Nombre del destino', 100),
        type: p.type,
        custodianId: id(p.custodianId),
        bank: String(p.bank ?? '').slice(0, 80),
        account: String(p.account ?? '').slice(0, 80),
        active: p.active !== false,
        openingBalance: prior?.openingBalance ?? money(p.openingBalance ?? 0, 'Saldo inicial', true),
        receivesSales: p.type === 'bank' && p.receivesSales === true,
      };
      assert(['treasury', 'bank'].includes(location.type), 'Tipo de destino inválido.');
      if (location.type === 'bank') {
        text(location.bank, 'Banco');
        text(location.account, 'Cuenta');
      }
      const old = state.locations.findIndex((x) => x.id === key);
      if (old >= 0) state.locations[old] = location;
      else state.locations.push(location);
      ref = key;
      break;
    }
    case 'request_transfer': {
      assert(actor.role !== 'apoyo', 'El apoyo no mueve dinero.', 'FORBIDDEN');
      const type = p.type === 'profit' ? 'profit' : 'transfer';
      if (type === 'profit') admin(actor);
      const location = required(
        state.locations.find((x) => x.id === p.to && x.active),
        'Destino',
      );
      let from = p.from;
      if (actor.role !== 'admin') {
        const shift = required(
          state.shifts.find((x) => x.id === p.shiftId && x.cashierId === actor.id),
          'Turno propio',
        );
        assert(actor.primary, 'Solo el equipo principal registra salidas de caja.');
        from = `cash:${shift.id}`;
      } else
        assert(
          from === 'treasury' ||
            state.locations.some((x) => x.id === from) ||
            state.shifts.some((x) => `cash:${x.id}` === from),
          'Origen desconocido.',
        );
      assert(
        location.custodianId !== actor.id || type === 'profit',
        'La entrega requiere una persona receptora distinta.',
      );
      ref = makeId('transfer');
      state.transfers.push({
        id: ref,
        by: actor.id,
        recipientId: location.custodianId,
        from,
        to: location.id,
        amount: money(p.amount),
        status: 'requested',
        at: command.at,
        notes: text(p.notes, 'Concepto', 1000),
        shiftId: p.shiftId,
        type,
        votes: [],
      });
      notify('transferencias', `Movimiento solicitado · $${p.amount}.`);
      break;
    }
    case 'approve_payout': {
      admin(actor);
      const transfer = required(
        state.transfers.find(
          (x) => x.id === p.transferId && x.status === 'requested' && x.type !== 'transfer',
        ),
        'Salida pendiente',
      );
      assert(!transfer.votes.includes(actor.id), 'Ya aprobaste esta salida.');
      evidence(p.evidenceId ?? transfer.evidenceId);
      transfer.evidenceId = p.evidenceId ?? transfer.evidenceId;
      transfer.votes.push(actor.id);
      ref = transfer.id;
      break;
    }
    case 'execute_transfer': {
      const transfer = required(
        state.transfers.find((x) => x.id === p.transferId && x.status === 'requested'),
        'Movimiento solicitado',
      );
      if (transfer.type !== 'transfer') {
        admin(actor);
        assert(transfer.votes.length >= 3, 'Reembolsos y utilidades requieren tres admins distintos.');
        assert(actor.id !== transfer.recipientId, 'Otro admin debe ejecutar el pago al beneficiario.');
        transfer.by = actor.id;
        if (transfer.from === 'treasury') {
          const source = required(
            state.locations.find((x) => x.id === p.from && x.active),
            'Cuenta o caja que paga',
          );
          transfer.from = source.id;
        }
      } else assert(actor.id === transfer.by, 'Solo quien entrega registra la ejecución.', 'FORBIDDEN');
      const location = state.locations.find((x) => x.id === transfer.to);
      if (location?.type === 'bank' || transfer.type !== 'transfer')
        transfer.evidenceId = evidence(p.evidenceId ?? transfer.evidenceId);
      else if (p.evidenceId) transfer.evidenceId = evidence(p.evidenceId);
      if (transfer.from.startsWith('cash:')) {
        const active = state.shifts.find((x) => x.status === 'open');
        const source = state.shifts.find((x) => `cash:${x.id}` === transfer.from);
        assert(
          actor.primary || isShiftCashier(actor, active ?? source),
          'Registra la salida física desde la sesión responsable de caja.',
          'FORBIDDEN',
        );
        if (active) {
          cashier(actor, state, active.id);
          transfer.executionShiftId = active.id;
        }
      }
      transfer.status = 'in_transit';
      transfer.executedAt = command.at;
      ref = transfer.id;
      notify(
        'transferencias',
        `Entrega o consignación realizada, pendiente de confirmar · $${transfer.amount}.`,
      );
      break;
    }
    case 'confirm_transfer': {
      const transfer = required(
        state.transfers.find((x) => x.id === p.transferId && x.status === 'in_transit'),
        'Movimiento en tránsito',
      );
      assert(
        transfer.recipientId === actor.id && transfer.by !== actor.id,
        'Solo el receptor, distinto del emisor, confirma.',
        'FORBIDDEN',
      );
      const received = money(p.receivedAmount, 'Monto recibido', true);
      transfer.receivedAmount = received;
      transfer.confirmedBy = actor.id;
      transfer.confirmedAt = command.at;
      transfer.status = received === transfer.amount ? 'confirmed' : 'disputed';
      ref = transfer.id;
      break;
    }
    case 'save_promotion': {
      admin(actor);
      const before = catalogBefore(),
        key = p.id ? id(p.id) : makeId('promotion');
      assert(['fixed', 'upgrade', 'nxm', 'free'].includes(p.effect), 'Efecto desconocido.');
      assert(['schedule', 'coupon'].includes(p.delivery), 'Entrega inválida.');
      assert(p.effect !== 'free' || p.delivery === 'coupon', 'Un producto gratuito requiere cupón.');
      const startsAt = isoDate(p.startsAt, 'Vigencia'),
        endsAt = isoDate(p.endsAt, 'Vigencia');
      assert(endsAt > startsAt, 'Vigencia inválida.');
      const promo: Promotion = {
        id: key,
        name: text(p.name, 'Nombre', 100),
        effect: p.effect,
        delivery: p.delivery,
        sizeIds: Array.isArray(p.sizeIds) ? p.sizeIds.map((v: unknown) => id(v)) : [],
        flavorIds: Array.isArray(p.flavorIds) ? p.flavorIds.map((v: unknown) => id(v)) : [],
        alcohol: ['all', 'yes', 'no'].includes(p.alcohol) ? p.alcohol : 'all',
        startsAt,
        endsAt,
        days: Array.isArray(p.days) ? p.days : [],
        startTime: p.startTime ?? '00:00',
        endTime: p.endTime ?? '23:59',
        maxRedemptions:
          p.maxRedemptions === null || p.maxRedemptions === undefined
            ? null
            : quantity(p.maxRedemptions, 'Cupo', 100000),
        redemptions: 0,
        active: p.active !== false,
        version: 1,
        by: actor.id,
        at: receivedAt,
      };
      assert(
        promo.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        'Días inválidos.',
      );
      assert(
        /^([01]\d|2[0-3]):[0-5]\d$/.test(promo.startTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(promo.endTime),
        'Horario inválido.',
      );
      if (promo.effect === 'fixed') promo.fixedPrice = money(p.fixedPrice, 'Precio promocional');
      if (promo.effect === 'upgrade') {
        assert(p.steps === 1 || p.steps === 2, 'El upgrade es de uno o dos tamaños.');
        promo.steps = p.steps;
      }
      if (promo.effect === 'nxm') {
        promo.take = quantity(p.take, 'Lleva N', 20);
        promo.pay = quantity(p.pay, 'Paga M', 19);
        assert(
          Number.isInteger(promo.take) && Number.isInteger(promo.pay) && promo.take > promo.pay,
          'N debe ser mayor que M y ambos enteros.',
        );
      }
      const old = state.promotions.findIndex((x) => x.id === key);
      if (old >= 0) {
        promo.version = state.promotions[old].version + 1;
        promo.redemptions = state.promotions[old].redemptions;
        state.promotions[old] = promo;
      } else state.promotions.push(promo);
      versionCatalog(before);
      ref = key;
      break;
    }
    case 'issue_coupon': {
      admin(actor);
      const promo = required(
        state.promotions.find((x) => x.id === p.promotionId && x.delivery === 'coupon' && x.active),
        'Promoción de cupón',
      );
      const courtesy = p.courtesy === true;
      if (courtesy) {
        const month = colombiaMonth(command.at),
          issued = state.coupons.filter(
            (x) => x.issuedBy === actor.id && x.courtesy && colombiaMonth(x.issuedAt) === month,
          ).length;
        if (issued >= settings.courtesyQuota) {
          const approval = state.requests.find(
            (x) =>
              x.id === p.excessRequestId &&
              x.type === 'courtesy_excess' &&
              x.status === 'approved' &&
              x.reviewedBy !== actor.id,
          );
          assert(approval, 'La cuota se agotó. Otro admin debe aprobar una cortesía adicional.');
          assert(
            !state.coupons.some((x) => x.excessApprovedBy === approval.id),
            'Esta autorización ya se utilizó.',
          );
        }
      }
      assert(
        typeof p.code === 'string' && /^[A-HJ-NP-Z2-9-]{16,60}$/.test(p.code),
        'Código de cupón inválido.',
      );
      assert(!state.coupons.some((x) => x.code === p.code), 'El código ya existe.');
      const expiresAt = isoDate(p.expiresAt, 'Fecha de vencimiento');
      assert(expiresAt > command.at && expiresAt <= promo.endsAt, 'Vencimiento inválido.');
      ref = makeId('coupon');
      state.coupons.push({
        id: ref,
        code: p.code,
        promotionId: promo.id,
        issuedBy: actor.id,
        issuedAt: command.at,
        expiresAt,
        status: 'issued',
        courtesy,
        excessApprovedBy: p.excessRequestId,
      });
      break;
    }
    case 'save_goal': {
      admin(actor);
      const startsAt = isoDate(p.startsAt, 'Fecha del período'),
        endsAt = isoDate(p.endsAt, 'Fecha del período');
      assert(['week', 'month'].includes(p.period) && endsAt > startsAt, 'Período inválido.');
      ref = makeId('goal');
      state.goals.push({
        id: ref,
        period: p.period,
        startsAt,
        endsAt,
        cups: quantity(p.cups, 'Meta en vasos', 1000000, true),
        amount: money(p.amount, 'Meta en pesos', true),
        by: actor.id,
        at: receivedAt,
      });
      break;
    }
    case 'register_attachment': {
      const key = id(p.id);
      assert(['image/jpeg', 'image/png', 'image/webp'].includes(p.mime), 'Formato de foto no permitido.');
      assert(
        typeof p.size === 'number' && p.size > 0 && p.size <= 3 * 1024 * 1024,
        'La foto debe pesar menos de 3 MB.',
      );
      assert(!state.attachments.some((x) => x.id === key), 'Foto ya registrada.');
      state.attachments.push({
        id: key,
        by: actor.id,
        mime: p.mime,
        size: p.size,
        name: text(p.name, 'Nombre', 150),
        createdAt: command.at,
        status: 'pending',
      });
      ref = key;
      break;
    }
    case 'outage': {
      assert(actor.primary || actor.online, 'Dispositivo no habilitado.');
      if (p.until) {
        const outage = required(
          state.outages.find((x) => x.id === p.id && x.deviceId === actor.deviceId),
          'Caída de conexión',
        );
        outage.until = p.until;
        ref = outage.id;
      } else {
        ref = makeId('outage');
        state.outages.push({ id: ref, deviceId: actor.deviceId, from: command.at });
      }
      break;
    }
    default:
      throw new DomainError('Operación desconocida.');
  }
  if (
    review &&
    command.type !== 'record_paper' &&
    !state.requests.some((r) => r.type === 'difference' && r.referenceId === ref && r.status === 'pending')
  )
    state.requests.push({
      id: makeId('review'),
      type: 'difference',
      by: actor.id,
      at: receivedAt,
      status: 'pending',
      referenceId: ref,
      notes:
        'Registro con configuración anterior o autorización offline. Verificar su conciliación sin modificar el evento original.',
    });
  const audit: Audit = {
    id: makeId('audit'),
    eventId: command.id,
    by: actor.id,
    deviceId: actor.deviceId,
    at: command.at,
    ...(reportedAt !== command.at ? { reportedAt } : {}),
    receivedAt,
    action: command.type,
    referenceId: ref,
    detail: review ? 'Registro con configuración anterior o autorización de contingencia.' : message,
  };
  state.audit.push(audit);
  return {
    state,
    result: {
      id: command.id,
      status: review ? 'review' : 'accepted',
      message: review ? 'Guardado; requiere revisión de contingencia.' : message,
      referenceId: ref,
      at: receivedAt,
    },
  };
}

export function redactState(full: State, actor: Actor): State {
  if (actor.role === 'admin') return structuredClone(full);
  const state = structuredClone(full),
    active = state.shifts.find(
      (x) => x.status === 'open' || x.status === 'requested' || x.status === 'provisional',
    );
  state.orders = state.orders.filter((x) => x.shiftId === active?.id || x.sellerId === actor.id);
  state.payments = [];
  state.stock = [];
  state.counts = state.counts
    .filter((x) => x.by === actor.id)
    .map(({ expectedCash: _, expectedItems: __, difference: ___, differences: ____, ...x }) => x);
  state.shipments = state.shipments
    .filter((x) => x.status !== 'received')
    .map((x) => ({ ...x, items: [], expenseId: undefined }));
  state.receipts = state.receipts
    .filter((x) => x.by === actor.id)
    .map(({ expected: _, differences: __, ...x }) => x);
  state.coupons = [];
  state.requests = state.requests.filter((x) => x.by === actor.id);
  state.expenses = state.expenses.filter((x) => x.by === actor.id);
  state.transfers = state.transfers.filter((x) => x.by === actor.id || x.recipientId === actor.id);
  state.parameters = state.parameters
    .filter((x) => x.kind === 'catalog')
    .map((x) => {
      const v = x.after as { sizes: Size[]; flavors: Flavor[]; promotions: Promotion[] };
      return { ...x, before: null, after: { sizes: v.sizes, flavors: v.flavors, promotions: v.promotions } };
    });
  state.audit = [];
  state.notifications = [];
  state.goals = [];
  return state;
}

export function migrateEmptyState(state?: Partial<State>): State {
  const fresh = initialState();
  return Object.assign(fresh, state ?? {});
}
