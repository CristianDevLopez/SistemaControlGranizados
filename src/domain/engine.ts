import { supplies } from './supplies.ts';
import { COOLER_SIZE_ID, initialState } from './initial.ts';
import { employeeView } from './employee-view.ts';
import { currentPayments, isSale, paymentMethod, paymentTotals, salePayments } from './payment-methods.ts';
import { candyAdditions, priceAdditions } from './additions.ts';
export { currentPayments, paymentMethod } from './payment-methods.ts';
import {
  canCorrectTastings,
  commandPermission,
  expenseCustodianId,
  expenseCustodianMessage,
  isCustomerOrderCommand,
  isOrderAssistant,
  hasPermission,
  isShiftCashier,
  shiftBlocksSales,
} from './access.ts';
import { lineTotal, quoteOrder } from './pricing.ts';
import { orderedFlavors, hasAlcohol, liquidPortions, sameFlavors } from './flavors.ts';
import { inRehearsalPeriod, rehearsalRequest, rehearsalShift } from './closing-archive.ts';
import { applyChangeApproval, type ApprovalAccess } from './change-approval.ts';
import {
  DomainError,
  ORDER_NAME_MAX_LENGTH,
  type Actor,
  type Audit,
  type AuditSelection,
  type Command,
  type ClosingPreview,
  type VisibleClosingPreview,
  type BlindClosingPreview,
  type Count,
  type Expense,
  type Flavor,
  type ID,
  type Order,
  type OrderLine,
  type Payment,
  type Promotion,
  type Request,
  type Result,
  type ShipmentLine,
  type Shift,
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
function orderCustomerName(value: unknown): string {
  assert(
    typeof value === 'string' && value.length <= ORDER_NAME_MAX_LENGTH,
    `El nombre del pedido debe tener máximo ${ORDER_NAME_MAX_LENGTH} caracteres.`,
  );
  return value.trim();
}
function required<T>(value: T | undefined, label: string): T {
  assert(value, `${label} no existe.`);
  return value;
}
function admin(actor: Actor): void {
  assert(
    actor.role === 'admin' && actor.online,
    'Esta operación requiere un administrador con conexión.',
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
export function eventId(command: Pick<Command, 'id'>, tag: string): ID {
  let h = 1469598103934665603n;
  for (const c of tag) h = BigInt.asUintN(64, (h ^ BigInt(c.charCodeAt(0))) * 1099511628211n);
  const raw = command.id.replaceAll('-', '');
  const tail = (BigInt(`0x${raw.slice(20)}`) ^ (h & 0xffffffffffffn)).toString(16).padStart(12, '0');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${tail}`;
}
export function syncOrderId(command: Command): string | undefined {
  const orderId = command.payload.orderId;
  switch (command.type) {
    case 'create_order':
    case 'taste':
      return typeof orderId === 'string' ? orderId : eventId(command, 'order');
    case 'update_order':
    case 'send_order':
    case 'cancel_order':
    case 'close_tastings':
    case 'update_tasting':
    case 'remove_tasting':
    case 'deliver':
    case 'pay':
    case 'redeem_coupon':
      return typeof orderId === 'string' ? orderId : undefined;
  }
}

export function usesCupPackages(size: Size) {
  return size.id !== COOLER_SIZE_ID && size.cups > 0;
}

export function isLegacyCoolerArticle(article: string) {
  return article === `cup:${COOLER_SIZE_ID}` || article === `package:${COOLER_SIZE_ID}`;
}

export function approvedInventoryUpdatesSince(state: State, count: Count) {
  const included = new Set(count.stockEventIds);
  const received = new Map(state.audit.map((event) => [event.eventId, event.receivedAt]));
  return new Set(
    state.stock
      .filter((item) => {
        if (!['inventory_correction', 'audit_adjustment'].includes(item.reason) || included.has(item.eventId))
          return false;
        const appliedAt = received.get(item.eventId) ?? item.at;
        return (
          appliedAt > (count.receivedAt ?? count.at) ||
          (appliedAt === count.receivedAt && !!count.stockEventIds)
        );
      })
      .map((item) => item.article),
  );
}

export function stockBalances(state: State, at?: string): Record<string, number> {
  const baseline = state.settings[0]?.rehearsalBaseline;
  const baselineCount =
    baseline && (!at || at >= baseline.at)
      ? state.counts.find((count) => count.id === baseline.countId)
      : undefined;
  const balances: Record<string, number> = Object.fromEntries(
    Object.entries(baselineCount?.items ?? {}).filter(([key]) => !isLegacyCoolerArticle(key)),
  );
  for (const movement of state.stock) {
    if (isLegacyCoolerArticle(movement.article) || (at && movement.at > at)) continue;
    if (
      baseline &&
      baselineCount &&
      Object.hasOwn(baselineCount.items, movement.article) &&
      (movement.at <= baseline.at ||
        (movement.referenceId === baselineCount.id && movement.reason === 'audit_adjustment'))
    )
      continue;
    balances[movement.article] = (balances[movement.article] ?? 0) + movement.quantity;
  }
  return balances;
}
export function articles(state: State): { id: string; name: string; unit: string }[] {
  return [
    ...orderedFlavors(state.flavors).flatMap((f) => [
      { id: `sealed_bag:${f.id}`, name: `Bolsas · ${f.name}`, unit: 'bolsas' },
      { id: `liquid:${f.id}`, name: `Líquido · ${f.name}`, unit: 'oz' },
    ]),
    ...state.sizes.filter(usesCupPackages).flatMap((s) => [
      { id: `package:${s.id}`, name: `Paquetes · ${s.name}`, unit: 'paquetes' },
      { id: `cup:${s.id}`, name: `Vasos · ${s.name}`, unit: 'unidades' },
    ]),
    { id: 'nevera', name: 'Neveras', unit: 'unidades' },
    { id: 'coronita', name: 'Coronitas', unit: 'unidades' },
    ...supplies(state),
  ];
}

export function physicalArticles(state: State) {
  const initialized = new Set(
    supplies(state)
      .filter((item) => item.initialized)
      .map((item) => item.id),
  );
  return articles(state).filter(
    (x) => !x.id.startsWith('liquid:') && (!x.id.startsWith('supply:') || initialized.has(x.id)),
  );
}

export function blindCountArticles(state: State) {
  return physicalArticles(state).filter((item) => item.id !== 'nevera');
}

export function compensatedInventory(state: State, count: Count, article: string): number {
  const entry = count.inventoryDifferences?.[article];
  if (!entry) return 0;
  if (entry.quantity > 0) return (entry.compensation ?? []).reduce((sum, match) => sum + match.quantity, 0);
  return state.counts.reduce(
    (sum, item) =>
      sum +
      (item.inventoryDifferences?.[article]?.compensation ?? []).reduce(
        (total, match) => total + (match.countId === count.id ? match.quantity : 0),
        0,
      ),
    0,
  );
}

export function shiftCountArticles(state: State, shift: Shift, kind: 'opening' | 'closing') {
  const depth = shift.blindOpening?.depth;
  if (kind === 'closing') {
    if (shift.closingCountMode === 'cash') return [];
    if (shift.closingCountMode === 'full') return physicalArticles(state);
    if (shift.closingCountMode === 'simple')
      return blindCountArticles(state).filter((item) => item.id.startsWith('cup:'));
  }
  if (!depth) return blindCountArticles(state);
  if (kind === 'closing' || depth === 'simple')
    return physicalArticles(state).filter(
      (item) =>
        item.id.startsWith('cup:') || (kind === 'opening' && shift.blindOpening?.items?.includes(item.id)),
    );
  return physicalArticles(state);
}

const countOutcomes = {
  COUNT_MATCHED: 'Todo coincide. ¡Buen turno!',
  COUNT_RECOUNT: 'Algo no coincide. Vuelve a contar todo.',
  COUNT_REVIEW: 'Turno enviado a revisión',
} as const;
type CountOutcome = keyof typeof countOutcomes;

export function countArticles(state: State, kind: Count['kind'], shift?: Shift) {
  const list = physicalArticles(state);
  const request = state.settings[0].auditRequest;
  if (kind === 'audit' && request) return list.filter((x) => request.items.includes(x.id));
  if (kind === 'closing' && shift?.closingCountMode) return shiftCountArticles(state, shift, kind);
  return kind === 'closing' ? list.filter((x) => x.id.startsWith('cup:')) : list;
}

function verifyClosingCountMode(shift: Shift, mode: unknown) {
  assert(
    mode === shift.closingCountMode,
    'El tipo de cuadre cambió. Actualiza el turno y vuelve a abrir el conteo.',
    'CLOSING_CHANGED',
  );
}

export function adjustableCountArticles(state: State, count: Count) {
  if (count.kind !== 'audit' && count.kind !== 'opening') return [];
  return physicalArticles(state).filter(({ id }) => Object.hasOwn(count.items, id));
}

export function countInventoryAdjustment(state: State, countId: ID): Audit | undefined {
  return state.audit.find((a) => a.referenceId === countId && a.inventoryAdjustment);
}

export function adjustedClosingArticles(state: State, closing: Count): Set<string> {
  return new Set(
    state.audit.flatMap(({ inventoryAdjustment: adjustment }) =>
      adjustment?.closingCountIds.includes(closing.id) ? Object.keys(adjustment.items) : [],
    ),
  );
}

export function countPaymentMethods(state: State, shiftId: ID, kind: Count['kind']) {
  if (kind === 'closing') return closingPaymentMethods(state, shiftId);
  if (kind !== 'audit') return [];
  return state.locations
    .map((account) => ({ id: `transfer:${account.id}`, account }))
    .filter((x) => state.settings[0].auditRequest?.payments.includes(x.id));
}

/** Cuentas configuradas o usadas en el turno, aunque después se hayan desactivado. */
export function closingPaymentMethods(state: State, shiftId?: ID) {
  const used = new Set(state.shifts.find((s) => s.id === shiftId)?.paymentAccountIds ?? []);
  for (const p of state.payments)
    if (p.shiftId === shiftId && paymentMethod(p) === 'transfer' && p.accountId) used.add(p.accountId);
  return state.locations
    .filter((x) => (x.type === 'bank' && x.active && x.receivesSales) || used.has(x.id))
    .map((account) => ({ id: `transfer:${account.id}`, account }));
}

export function countHasDifferences(count: Count): boolean {
  return (
    !!count.difference ||
    Object.values(count.differences ?? {}).some((x) => x !== 0) ||
    Object.values(count.paymentDifferences ?? {}).some((x) => x !== 0)
  );
}

export function cupBalances(state: State): Record<string, number> {
  return (
    state.cupBalances ??
    Object.fromEntries(Object.entries(stockBalances(state)).filter(([key]) => key.startsWith('cup:')))
  );
}

/** Un cierre revisado sigue comparando el corte original, no el stock de otro turno. */
export function closingPreview(state: State, shiftId: ID, original?: Count): ClosingPreview {
  const methods = original
    ? [
        ...new Set([
          ...Object.keys(original.payments ?? {}),
          ...state.payments
            .filter((p) => p.shiftId === shiftId && paymentMethod(p) === 'transfer' && p.accountId)
            .map((p) => `transfer:${p.accountId}`),
        ]),
      ].map((key) => ({
        id: key,
        account: {
          id: key.slice(9),
          name:
            original.paymentLabels?.[key] ?? state.locations.find((l) => l.id === key.slice(9))?.name ?? key,
        },
      }))
    : closingPaymentMethods(state, shiftId);
  const totals = paymentsByMethod(state, shiftId).byAccount;
  const shift = state.shifts.find((item) => item.id === shiftId);
  const balances = stockBalances(state);
  const liveInventory =
    original?.visibleClosing &&
    shift?.closingReview?.status !== 'approved' &&
    shift?.closingCountId === original.id &&
    !shift.closingArchive &&
    !rehearsalShift(state, shift);
  const expectedItems = original
    ? Object.fromEntries(
        Object.entries(original.expectedItems ?? {}).filter(
          ([key]) =>
            !isLegacyCoolerArticle(key) &&
            (original.visibleClosing || shift?.closingCountMode === 'full' || key.startsWith('cup:')),
        ),
      )
    : Object.fromEntries(countArticles(state, 'closing', shift).map((a) => [a.id, balances[a.id] ?? 0]));
  if (liveInventory) {
    for (const key of Object.keys(expectedItems)) expectedItems[key] = balances[key] ?? 0;
  } else if (original) {
    const included = new Set(original.stockEventIds ?? []);
    const eventTimes = new Map(state.audit.map((a) => [a.eventId, a.receivedAt]));
    const closes = new Map(state.counts.map((c) => [c.id, c]));
    const beforeOriginal = (count: Count) => {
      const left = count.receivedAt ?? count.at,
        right = original.receivedAt ?? original.at;
      return left < right || (left === right && count.at <= original.at);
    };
    const previousShifts = new Set(
      state.shifts
        .filter(
          (s) =>
            s.id === shiftId ||
            (s.closingCountId &&
              closes.has(s.closingCountId) &&
              beforeOriginal(closes.get(s.closingCountId)!)),
        )
        .map((s) => s.id),
    );
    const orders = new Set(state.orders.filter((o) => previousShifts.has(o.shiftId)).map((o) => o.id));
    for (const movement of state.stock) {
      if (!Object.hasOwn(expectedItems, movement.article)) continue;
      if (original.stockEventIds ? included.has(movement.eventId) : movement.at <= original.at) continue;
      const received = eventTimes.get(movement.eventId);
      if (original.receivedAt && received && received < original.receivedAt) continue;
      const prior = state.counts.find((c) => c.id === movement.referenceId);
      const priorShift = state.shifts.find((s) => s.closingCountId === prior?.id);
      const previousClosing =
        movement.reason === 'closing_adjustment' &&
        prior &&
        priorShift &&
        priorShift.id !== shiftId &&
        previousShifts.has(priorShift.id);
      const damage =
        movement.reason === 'approved_damage' &&
        state.requests.some((r) => r.id === movement.referenceId && r.at <= original.at);
      const openingCorrection =
        ['open_package', 'opening_correction'].includes(movement.reason) &&
        (state.packages.some((item) => item.id === movement.referenceId && item.shiftId === shiftId) ||
          movement.referenceId === shiftId);
      if (orders.has(movement.referenceId) || previousClosing || damage || openingCorrection)
        expectedItems[movement.article] = (expectedItems[movement.article] ?? 0) + movement.quantity;
    }
  }
  // El remanente entregado después del corte no es un faltante de ese cierre.
  let expectedCash = original
    ? cashExpected(state, shiftId, original.at) +
      state.payments
        .filter((p) => p.shiftId === shiftId && paymentMethod(p) === 'cash' && p.at > original.at)
        .reduce((n, p) => n + p.amount, 0) -
      state.expenses
        .filter(
          (e) =>
            e.shiftId === shiftId && e.source === 'cash' && e.status === 'approved' && e.at > original.at,
        )
        .reduce((n, e) => n + e.amount, 0)
    : cashExpected(state, shiftId);
  if (original?.visibleClosing && shift) {
    expectedCash -= state.expenses
      .filter((item) => item.shiftId === shiftId && item.source === 'cash' && item.status === 'pending')
      .reduce((sum, item) => sum + item.amount, 0);
    const handoffId = shift.closingFlow?.versions.at(-1)?.transferId;
    const handoff = state.transfers.find((item) => item.id === handoffId);
    if (handoff?.executedAt && handoff.executedAt <= original.at) expectedCash += handoff.amount;
  }
  return {
    expectedCash,
    expectedItems,
    expectedPayments: Object.fromEntries(
      methods.map(({ id: key, account }) => [key, totals[account.id] ?? 0]),
    ),
    paymentLabels: Object.fromEntries(methods.map(({ id: key, account }) => [key, account.name])),
  };
}

const isAutomaticClosingArticle = (id: string) => id.startsWith('cup:') || id.startsWith('package:');

export function closingSupplyOptions(state: State) {
  return articles(state).filter(({ id }) => !id.startsWith('liquid:') && !isAutomaticClosingArticle(id));
}

export function visibleClosingArticles(state: State, shift: Shift) {
  return articles(state).filter(
    ({ id }) =>
      !id.startsWith('liquid:') && (isAutomaticClosingArticle(id) || shift.closingSupplies?.includes(id)),
  );
}

export function visibleClosingPreview(state: State, shift: Shift): VisibleClosingPreview {
  const balances = stockBalances(state);
  const totals = paymentsByMethod(state, shift.id);
  const expenses = state.expenses.filter((item) => item.shiftId === shift.id && item.status !== 'rejected');
  const transfers = state.transfers.filter(
    (item) => item.shiftId === shift.id || item.from === `cash:${shift.id}`,
  );
  const packages = state.packages.filter((item) => !item.voidedAt && item.shiftId === shift.id);
  const bags = state.bags.filter((item) => !item.voidedAt && item.shiftId === shift.id);
  const cutoff =
    state.counts.find((count) => count.id === shift.openingCountId)?.at ??
    shift.openedAt ??
    shift.requestedAt;
  const orders = new Set(state.orders.filter((order) => order.shiftId === shift.id).map((order) => order.id));
  const pending = expenses
    .filter((item) => item.source === 'cash' && item.status === 'pending')
    .reduce((sum, item) => sum + item.amount, 0);
  const cashExpenses = expenses
    .filter((item) => item.source === 'cash')
    .reduce((sum, item) => sum + item.amount, 0);
  const expectedCash = cashExpected(state, shift.id) - pending;
  const methods = closingPaymentMethods(state, shift.id);
  const list = visibleClosingArticles(state, shift);
  const expectedItems = Object.fromEntries(list.map(({ id }) => [id, balances[id] ?? 0]));
  const moneyLabel = (amount: number) => '$' + amount.toLocaleString('es-CO');
  return {
    expectedCash,
    expectedItems,
    expectedPayments: Object.fromEntries(
      methods.map(({ id, account }) => [id, totals.byAccount[account.id] ?? 0]),
    ),
    paymentLabels: Object.fromEntries(methods.map(({ id, account }) => [id, account.name])),
    cashFlow: {
      base: shift.base,
      sales: totals.cash,
      expenses: cashExpenses,
      transfers: shift.base + totals.cash - cashExpenses - expectedCash,
    },
    cups: Object.fromEntries(
      list
        .filter(({ id }) => id.startsWith('cup:'))
        .map(({ id }) => {
          const initial = stockBalances(state, cutoff)[id] ?? 0;
          const added = packages
            .filter((item) => item.sizeId === id.slice(4))
            .reduce((sum, item) => sum + item.units, 0);
          const entries = state.stock.filter((item) => item.article === id);
          const sold = -entries
            .filter((item) => orders.has(item.referenceId))
            .reduce((sum, item) => sum + item.quantity, 0);
          const damage = -entries
            .filter((item) => item.at >= cutoff && item.reason === 'approved_damage')
            .reduce((sum, item) => sum + item.quantity, 0);
          return [
            id,
            {
              initial,
              packages: added,
              sold,
              damage,
              other: expectedItems[id] - initial - added + sold + damage,
            },
          ];
        }),
    ),
    movements: [
      ...expenses.map(({ id, at, category, amount }) => ({
        id,
        at,
        label: `Gasto · ${category} · ${moneyLabel(amount)}`,
      })),
      ...transfers.map(({ id, at, executedAt, to, amount }) => ({
        id,
        at: executedAt ?? at,
        label: `Traslado · ${state.locations.find((item) => item.id === to)?.name ?? 'Caja'} · ${moneyLabel(amount)}`,
      })),
      ...packages.map(({ id, openedAt, sizeId }) => ({
        id,
        at: openedAt,
        label: `Paquete agregado · ${state.sizes.find((item) => item.id === sizeId)?.name ?? sizeId}`,
      })),
      ...bags.map(({ id, openedAt, flavorId }) => ({
        id,
        at: openedAt,
        label: `Bolsa de líquido abierta · ${state.flavors.find((item) => item.id === flavorId)?.name ?? flavorId}`,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
  };
}

export function closingNeedsRecount(shift: Shift) {
  return (
    shift.blindClosing?.status === 'recount' ||
    (shift.blindClosing?.status === 'ready' && !!shift.blindClosing.countIds?.length && !shift.closingCountId)
  );
}

export function blindClosingPreview(state: State, shift: Shift): BlindClosingPreview {
  const sales = salesByMethod(state, shift.id);
  const first = closingNeedsRecount(shift)
    ? state.counts.find((count) => count.id === shift.blindClosing?.countIds?.[0])
    : undefined;
  return {
    items: visibleClosingArticles(state, shift),
    accounts: closingPaymentMethods(state, shift.id).map(({ id, account }) => ({
      id,
      name: account.name,
      amount: sales.byAccount[account.id] ?? 0,
    })),
    ...(first && {
      recount: {
        preview: visibleClosingPreview(state, shift),
        cash: first.cash,
        items: first.items,
        notes: first.notes,
      },
    }),
  };
}

function matchesClosingPreview(preview: any, expected: ClosingPreview): boolean {
  const same = (a: Record<string, unknown> = {}, b: Record<string, unknown>) =>
    a &&
    typeof a === 'object' &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(b).every(([key, value]) => a[key] === value);
  return (
    !!preview &&
    preview.expectedCash === expected.expectedCash &&
    same(preview.expectedItems, expected.expectedItems) &&
    same(preview.expectedPayments, expected.expectedPayments) &&
    same(preview.paymentLabels, expected.paymentLabels)
  );
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
  if (command.type === 'submit_blind_count' || command.type === 'submit_blind_opening_audit')
    for (const movement of state.stock) if (!movement.article.startsWith('liquid:')) floor(movement.at);
  if (
    command.type === 'start_audit' ||
    command.type === 'finish_audit' ||
    command.type === 'submit_blind_opening_audit' ||
    (['count', 'submit_blind_count'].includes(command.type) && p.kind === 'closing')
  ) {
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
          ((x.executedAt && before(x.executedAt)) ||
            (!!at &&
              x.cancellation?.originalExecutedAt &&
              before(x.cancellation.originalExecutedAt) &&
              x.cancellation.at > at)),
      )
      .reduce((n, x) => n + x.amount, 0)
  );
}
export function reviewedClosingCashInDrawer(state: State, shift: Shift): number | undefined {
  const version = shift.closingFlow?.versions.at(-1);
  const review = shift.closingReview;
  if (!version || review?.status !== 'approved' || !review.countId) return undefined;
  const count = state.counts.find((item) => item.id === review.countId);
  if (count?.cash === undefined) return undefined;
  const transfer = state.transfers.find((item) => item.id === version.transferId);
  if (transfer?.blindReceipt) return undefined;
  const sent = transfer ? (transfer.executedAt ? transfer.amount : 0) : version.sent;
  return Math.max(0, count.cash - sent);
}

export function openingExpectedCash(state: State): number | null {
  const prior = state.shifts
    .filter((shift) => shift.status === 'closed' && shift.retained !== undefined)
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0];
  if (prior?.closingFlow && !rehearsalShift(state, prior))
    return reviewedClosingCashInDrawer(state, prior) ?? prior.retained!;
  const last = state.counts.find((x) => x.id === state.settings[0].lastCountId);
  if (last?.cash === undefined) return null;
  const executed = state.transfers.filter(
    (x) =>
      x.shiftId === last.shiftId &&
      x.from === `cash:${last.shiftId}` &&
      x.executedAt &&
      x.executedAt >= (last.cutoffAt ?? last.at),
  );
  return last.cash - executed.reduce((n, x) => n + x.amount, 0);
}
/** Movimientos de dinero del turno para arqueos y cierres. */
export function paymentsByMethod(state: State, shiftId: ID) {
  return paymentTotals(currentPayments(state.payments).filter((payment) => payment.shiftId === shiftId));
}

export function salesByMethod(state: State, shiftId: ID) {
  return paymentTotals(
    salePayments(
      state,
      state.orders.filter((o) => o.shiftId === shiftId && isSale(o)),
    ),
  );
}
export function locationBalance(state: State, locationId: string): number {
  return (
    (state.locations.find((x) => x.id === locationId)?.openingBalance ?? 0) +
    state.payments
      .filter(
        (x) =>
          paymentMethod(x) === 'transfer' &&
          x.accountId === locationId &&
          !state.shifts.some(
            (shift) => shift.id === x.shiftId && shift.operationsReview?.verifiedTransfers?.[x.id]?.missing,
          ),
      )
      .reduce((sum, x) => sum + x.amount, 0) +
    state.transfers
      .filter(
        (x) => ['confirmed', 'disputed'].includes(x.status) && x.type === 'transfer' && x.to === locationId,
      )
      .reduce((sum, x) => sum + (x.receivedAmount ?? x.amount), 0) -
    state.transfers
      .filter((x) => x.executedAt && x.from === locationId)
      .reduce((sum, x) => sum + x.amount, 0) -
    state.expenses
      .filter((x) => x.status === 'approved' && x.source === 'treasury' && x.locationId === locationId)
      .reduce((sum, x) => sum + x.amount, 0)
  );
}
export function promotionSelection(ids: unknown, legacyId?: unknown): string[] {
  if (ids === undefined) return legacyId === undefined ? [] : [id(legacyId)];
  assert(Array.isArray(ids) && ids.length <= 20, 'Selección de promociones inválida.');
  return ids.map((value) => id(value));
}

export function quotePayment(
  state: State,
  order: Order,
  at: string,
  online: boolean,
  codes: string[] = [],
  selectedPromotions?: string | string[],
) {
  assert(
    !selectedPromotions ||
      selectedPromotions.length === 0 ||
      (order.paymentCredit === undefined && !order.replacesId && !order.carriedCouponFromId),
    'Las promociones de mostrador se aplican a pedidos nuevos.',
  );
  if (!order.carriedCouponFromId) {
    assert(
      !(order.paymentCredit && codes.length),
      'No se agregan cupones a una corrección con pago anterior: no son dinero ni generan devolución.',
    );
    return quoteOrder(state, order.lines, at, online, codes, order.additions, selectedPromotions);
  }
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
    order.additions,
  );
}

/** All business mutations run here on the server; local replay is only an optimistic copy. */
export function applyCommand(
  original: State,
  command: Command,
  actor: Actor,
  receivedAt = new Date().toISOString(),
  access?: ApprovalAccess,
): { state: State; result: Result } {
  return applyChangeApproval(original, command, actor, receivedAt, access, applyCommandCore);
}

function applyCommandCore(
  original: State,
  command: Command,
  actor: Actor,
  receivedAt: string,
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
  const prior = original.audit.find((x) => x.eventId === command.id);
  if (prior) {
    const outcome = (Object.keys(countOutcomes) as CountOutcome[]).find(
      (code) => countOutcomes[code] === prior.detail,
    );
    return {
      state: structuredClone(original),
      result: {
        id: command.id,
        status: 'accepted',
        ...(outcome
          ? { code: outcome, message: countOutcomes[outcome] }
          : { message: 'Operación ya registrada.', referenceId: prior.referenceId }),
      },
    };
  }
  const state = structuredClone(original),
    settings = state.settings[0],
    p = command.payload as Record<string, any>;
  const permission = commandPermission(command.type);
  const orderAssistant = isOrderAssistant(actor, state);
  if (orderAssistant) {
    assert(
      isCustomerOrderCommand(command.type) &&
        p.origin !== 'paper' &&
        (command.type === 'create_order' ||
          state.orders.some((order) => order.id === p.orderId && order.sellerId === actor.id)),
      'Solo el encargado y equipo de caja del turno tienen permiso para esta operación.',
      'FORBIDDEN',
    );
    assert(actor.online, 'El apoyo requiere conexión.', 'ONLINE_REQUIRED');
  }
  assert(
    !permission || hasPermission(actor, permission),
    'No tienes permiso para esta operación.',
    'FORBIDDEN',
  );
  // Resolver las referencias reales impide eludir el cierre enviando otro turno en el comando.
  {
    const order = state.orders.find((x) => x.id === p.orderId);
    if (order?.cashHandoff === 'draft')
      assert(order.sellerId === actor.id, 'El pedido aún está en preparación.', 'FORBIDDEN');
    if (order?.cashHandoff === 'sent' && ['update_order', 'cancel_order'].includes(command.type))
      assert(
        isShiftCashier(
          actor,
          state.shifts.find((shift) => shift.id === order.shiftId && shift.status === 'open'),
        ),
        'El pedido ya se envió. Caja puede modificarlo.',
        'FORBIDDEN',
      );
    const count = state.counts.find((x) => x.id === p.countId);
    const transfer = state.transfers.find((x) => x.id === p.transferId);
    const expense = state.expenses.find((x) => x.id === p.expenseId);
    const request = state.requests.find((x) => x.id === p.requestId);
    const referencedOrder = state.orders.find((x) => x.id === request?.referenceId);
    const shifts = [
      command.shiftId,
      p.shiftId,
      order?.shiftId,
      count?.shiftId,
      expense?.shiftId,
      referencedOrder?.shiftId,
      transfer?.shiftId,
      transfer?.executionShiftId,
      transfer?.from.startsWith('cash:') ? transfer.from.slice(5) : undefined,
      transfer?.to.startsWith('cash:') ? transfer.to.slice(5) : undefined,
      typeof p.from === 'string' && p.from.startsWith('cash:') ? p.from.slice(5) : undefined,
    ];
    const closed = shifts.some((key) =>
      state.shifts.some((s) => s.id === key && ['closed', 'provisional'].includes(s.status)),
    );
    if (closed && !['submit_closing', 'respond_closing'].includes(command.type)) {
      assert(
        actor.role === 'admin',
        'Turno cerrado: solo un administrador puede registrar movimientos o correcciones.',
        'SHIFT_CLOSED',
      );
      admin(actor);
    }
    if (actor.role !== 'admin' && permission && command.type !== 'request_shift')
      assert(
        state.shifts.some((s) => s.status === 'open'),
        'No hay turno abierto.',
        'SHIFT_CLOSED',
      );
  }
  const makeId = (tag: string) => eventId(command, tag);
  const startAudit = (shift: Shift, selection: AuditSelection, by: ID, opening = false) => {
    settings.auditId = makeId('audit-cut');
    const balances = stockBalances(state);
    const totals = opening ? {} : paymentsByMethod(state, shift.id).byAccount;
    settings.auditRequest = {
      id: settings.auditId,
      shiftId: shift.id,
      by,
      at: command.at,
      ...(opening ? { opening: true } : {}),
      ...selection,
      expectedCash: selection.cash
        ? opening
          ? shift.base
          : cashExpected(state, shift.id, command.at)
        : undefined,
      expectedItems: Object.fromEntries(selection.items.map((key) => [key, balances[key] ?? 0])),
      expectedPayments: Object.fromEntries(
        selection.payments.map((key) => {
          const accountId = key.slice('transfer:'.length);
          return [key, opening ? locationBalance(state, accountId) : (totals[accountId] ?? 0)];
        }),
      ),
    };
  };
  const configureOpeningCount = (shift: Shift, selection?: unknown) => {
    const allowed = physicalArticles(state).map(({ id }) => id);
    assert(
      selection === undefined || (Array.isArray(selection) && selection.every((id) => allowed.includes(id))),
      'Artículos de apertura inválidos.',
    );
    const scheduled = settings.nextOpeningAudit;
    if (scheduled?.mode === 'full') shift.blindOpening!.depth = 'deep';
    shift.blindOpening!.items = [
      ...new Set([...(scheduled?.items ?? []), ...((selection ?? []) as string[])]),
    ];
    delete settings.nextOpeningAudit;
  };
  const activateOpeningAudit = (shift: Shift, blind = false) => {
    if (shift.blindOpening?.depth) return;
    const scheduled = settings.nextOpeningAudit;
    if (!scheduled) return;
    const items = physicalArticles(state)
      .map((x) => x.id)
      .filter((key) => key !== 'copita' && (scheduled.mode === 'full' || scheduled.items.includes(key)));
    const payments = blind
      ? []
      : scheduled.payments.filter((key) =>
          state.locations.some((x) => x.type === 'bank' && key === `transfer:${x.id}`),
        );
    const cash = scheduled.cash || (!items.length && !payments.length);
    startAudit(shift, { cash, items, payments }, scheduled.by, true);
    settings.nextOpeningAudit = undefined;
  };
  let ref: string | undefined,
    message = 'Registro guardado.',
    review = false;
  let outcome: CountOutcome | undefined;
  let inventoryAdjustment: Audit['inventoryAdjustment'];
  const notify = (channel: State['notifications'][number]['channel'], value: string) =>
    state.notifications.push({
      id: makeId(`notify:${channel}`),
      channel,
      text: value,
      at: receivedAt,
      status: 'pending',
      attempts: 0,
    });
  const movement = (
    article: string,
    amount: number,
    reason: string,
    referenceId: string,
    tag = article,
    at = command.at,
  ) => {
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
      at,
      by: actor.id,
      eventId: command.id,
    });
    if (state.cupBalances && article.startsWith('cup:'))
      state.cupBalances[article] = (state.cupBalances[article] ?? 0) + amount;
  };
  const recordBlindCount = (
    shift: Shift,
    kind: Count['kind'],
    list: ReturnType<typeof blindCountArticles>,
    expectedCash: number | undefined,
    attempt?: 1 | 2,
  ) => {
    const balances = stockBalances(state);
    const items: Record<string, number> = {};
    const expectedItems: Record<string, number> = {};
    const differences: Record<string, number> = {};
    for (const { id: key, name } of list) {
      const counted = quantity(p.items?.[key], name, 1_000_000, true);
      assert(Number.isInteger(counted), 'Los conteos físicos deben ser enteros.');
      items[key] = counted;
      expectedItems[key] = balances[key] ?? 0;
      differences[key] = counted - expectedItems[key];
    }
    const cash = expectedCash === undefined ? undefined : money(p.cash, 'Efectivo contado', true);
    const count: Count = {
      id: makeId('count'),
      kind,
      shiftId: shift.id,
      by: actor.id,
      at: command.at,
      receivedAt,
      blindAttempt: attempt,
      cash,
      expectedCash,
      difference: cash === undefined || expectedCash === undefined ? undefined : cash - expectedCash,
      items,
      expectedItems,
      differences,
      itemLabels: Object.fromEntries(list.map((x) => [x.id, x.name])),
      notes: '',
    };
    {
      const eventTimes = new Map(state.audit.map((a) => [a.eventId, a.receivedAt]));
      count.stockEventIds = [
        ...new Set(
          state.stock
            .filter(
              (m) =>
                Object.hasOwn(expectedItems, m.article) &&
                (eventTimes.get(m.eventId) ?? receivedAt) >= receivedAt,
            )
            .map((m) => m.eventId),
        ),
      ];
    }
    state.counts.push(count);
    ref = count.id;
    return count;
  };
  const reconcileInventory = (count: Count, adjusted = new Set<string>()) => {
    const closing = count.kind === 'closing';
    const entries: NonNullable<Count['inventoryDifferences']> = {};
    const purchases = state.shipments
      .filter((shipment) => shipment.at <= (count.cutoffAt ?? count.at))
      .sort((a, b) => a.at.localeCompare(b.at))
      .flatMap((shipment) => shipment.items);
    for (const [article, delta] of Object.entries(count.differences ?? {})) {
      if (!delta) continue;
      const size = state.sizes.find((item) => article.endsWith(`:${item.id}`));
      const price = purchases
        .filter((item) => item.article === article || (size && item.article === `package:${size.id}`))
        .at(-1);
      const entry = {
        quantity: delta,
        unitCost: price ? price.unitCost / (price.article === article ? 1 : settings.cupPackageUnits) : 0,
        saleValue: article.startsWith('cup:') ? (size?.plainPrice ?? size?.alcoholPrice ?? 0) : 0,
        compensation: [] as { countId: ID; quantity: number }[],
      };
      entries[article] = entry;
    }
    if (!Object.keys(entries).length) return;
    count.inventoryDifferences = entries;
    for (const [article, entry] of Object.entries(entries)) {
      if (adjusted.has(article)) continue;
      movement(
        article,
        entry.quantity,
        closing ? 'closing_adjustment' : `${count.kind}_compensation`,
        count.id,
      );
    }
  };
  const finishOrders = (shift: Shift) => {
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
    const shift = required(
      state.shifts.find((x) => x.status === 'open'),
      'Turno abierto',
    );
    assert(!shiftBlocksSales(shift), 'Las ventas están en pausa hasta completar el conteo.', 'SHIFT_COUNT');
    return shift;
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
  const originalPayment = (orderId?: ID) =>
    currentPayments(state.payments).find((x) => x.orderId === orderId && x.amount > 0);
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
        'ORDER_VERSION_CONFLICT',
      );
  };
  const inventoryOpening = () => {
    if (p.correction !== true) return { shiftId: operating().id, at: command.at };
    admin(actor);
    const shift = required(
      state.shifts.find((x) => x.id === p.shiftId && x.openedAt),
      'Turno',
    );
    const at = isoDate(p.openedAt ?? shift.closedAt ?? command.at, 'Hora de apertura del insumo');
    assert(
      Date.parse(at) >= Date.parse(shift.openedAt!) &&
        Date.parse(at) <= Math.min(Date.parse(shift.closedAt ?? command.at), Date.parse(command.at)),
      'La apertura del insumo debe quedar dentro del turno.',
    );
    message = `Apertura corregida · ${text(p.notes, 'Motivo', 1500)}`;
    return { shiftId: shift.id, at };
  };
  const sourcePricing = (): State => {
    if (command.configVersion === settings.version) return state;
    const recorded = state.parameters.find(
      (x) => x.version === command.configVersion && x.kind === 'catalog',
    );
    assert(recorded, 'La configuración de origen no existe. Requiere revisión.', 'CONFLICT');
    const history = recorded.after as {
      sizes: Size[];
      flavors: Flavor[];
      promotions: Promotion[];
      settings?: State['settings'][number];
    };
    review = true;
    return {
      ...state,
      settings: [history.settings ?? { ...settings, candyPrices: undefined }],
      sizes: history.sizes,
      flavors: history.flavors,
      promotions: history.promotions,
    };
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
      const selection = input.flavorIds === undefined ? [input.flavorId] : input.flavorIds;
      assert(
        Array.isArray(selection) && selection.length > 0 && selection.length <= 100,
        'Selecciona entre 1 y 100 sabores.',
      );
      const flavorIds = selection.map((value: unknown) => id(value, 'Sabor')).sort();
      assert(new Set(flavorIds).size === flavorIds.length, 'No repitas sabores en el mismo vaso.');
      assert(
        input.flavorId === undefined || flavorIds.includes(input.flavorId as string),
        'El sabor principal debe pertenecer a la mezcla.',
      );
      flavorIds.forEach((flavorId) =>
        required(
          pricing.flavors.find((x) => x.id === flavorId && x.active),
          'Sabor activo',
        ),
      );
      const selectionLine = { flavorId: flavorIds[0], flavorIds };
      const size = required(
        pricing.sizes.find((x) => x.id === input.sizeId && x.active),
        'Tamaño activo',
      );
      const alcohol = hasAlcohol(selectionLine, pricing.flavors);
      const price = alcohol ? size.alcoholPrice : size.plainPrice;
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
        flavorId: flavorIds[0],
        ...(flavorIds.length > 1 ? { flavorIds } : {}),
        sizeId: size.id,
        quantity: qty,
        delivered: 0,
        listPrice: price,
        unitPrice: price,
        discount: 0,
        consumptionIds: [],
        recipe: { ounces: size.ounces, cups: size.cups, beers: alcohol ? size.beers : 0 },
      };
    });
  };
  const deliveryStock = (line: OrderLine, qty: number) => {
    const size = {
      ...required(
        state.sizes.find((item) => item.id === line.sizeId),
        'Tamaño',
      ),
      ...line.recipe,
    };
    return [
      {
        article: size.id === COOLER_SIZE_ID ? 'nevera' : `cup:${size.id}`,
        amount: qty * (size.id === COOLER_SIZE_ID ? 1 : size.cups),
      },
      { article: 'coronita', amount: hasAlcohol(line, state.flavors) ? qty * size.beers : 0 },
      ...liquidPortions(line, qty * size.ounces).map(({ flavorId, ounces }) => ({
        article: `liquid:${flavorId}`,
        amount: ounces,
      })),
    ].filter((item) => item.amount !== 0);
  };
  const restoreVoidedInventory = (order: Order) => {
    const stock = state.stock.filter(
      (item) => item.referenceId === order.id && ['delivery', 'replacement_delivery'].includes(item.reason),
    );
    const restored = new Map<string, number>();
    const add = (article: string, amount: number) =>
      restored.set(article, (restored.get(article) ?? 0) + amount);
    for (const item of stock) add(item.article, -item.quantity);
    if (order.inventoryTransferred && !stock.some((item) => item.reason === 'replacement_delivery')) {
      // Los sustitutos del flujo anterior conservaban los identificadores de las entregas del ticket original.
      const deliveries = new Map(state.deliveries.map((item) => [item.id, item]));
      for (const line of order.lines) {
        const inherited = Math.min(
          line.delivered,
          line.consumptionIds.reduce((total, key) => {
            const delivery = deliveries.get(key);
            return total + (delivery && delivery.orderId !== order.id ? delivery.quantity : 0);
          }, 0),
        );
        if (inherited) for (const item of deliveryStock(line, inherited)) add(item.article, item.amount);
      }
    }
    for (const [article, amount] of restored) {
      if (amount > 0)
        movement(
          article === `cup:${COOLER_SIZE_ID}` ? 'nevera' : article,
          amount,
          'void_return',
          order.id,
          article,
          receivedAt,
        );
    }
    order.voidInventoryRestoredAt = receivedAt;
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
      for (const { article, amount } of deliveryStock(line, qty)) {
        const tag = article.startsWith('cup:') ? 'cup' : article === 'coronita' ? 'beer' : article;
        movement(article, -amount, 'delivery', order.id, `${line.id}:${tag}`);
      }
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
    case 'change_access':
    case 'resolve_change': {
      admin(actor);
      break;
    }
    case 'set_approval_requirement': {
      admin(actor);
      assert(p.required === 1 || p.required === 2, 'Elige una o dos aprobaciones.');
      settings.requiredChangeApprovals = p.required;
      ref = settings.id;
      break;
    }
    case 'save_flavor': {
      admin(actor);
      const before = catalogBefore();
      const key = p.id ? id(p.id) : makeId('flavor');
      const flavor: Flavor = {
        id: key,
        name: text(p.name, 'Nombre', 60),
        alcohol: p.alcohol === true,
        active: p.active !== false,
        imageId:
          p.removeImage === true
            ? undefined
            : p.imageId
              ? evidence(p.imageId)
              : state.flavors.find((f) => f.id === key)?.imageId,
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
      if (p.maxClosingBase !== undefined)
        settings.maxClosingBase = money(p.maxClosingBase, 'Base máxima de cierre', true);
      for (const { id, name } of candyAdditions) {
        if (p[`candy:${id}`] !== undefined)
          (settings.candyPrices ??= {})[id] = money(p[`candy:${id}`], name, true);
      }
      if (p.cupPackageUnits !== undefined) {
        settings.cupPackageUnits = quantity(p.cupPackageUnits, 'Unidades por paquete', 1000);
        assert(Number.isInteger(settings.cupPackageUnits), 'Unidades enteras.');
      }
      if (p.bagOunces !== undefined) settings.bagOunces = quantity(p.bagOunces, 'Onzas por bolsa', 10000);
      if (p.liquidTolerance !== undefined)
        settings.liquidTolerance =
          p.liquidTolerance === null ? null : quantity(p.liquidTolerance, 'Tolerancia', 1, true);
      if (p.liquidBagWindow !== undefined) {
        const value = quantity(p.liquidBagWindow, 'Bolsas por revisión de líquido', 100);
        assert(Number.isInteger(value), 'El número de bolsas debe ser entero.');
        settings.liquidBagWindow = value;
      }
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
      throw new DomainError('El inventario inicial ya está registrado. Propón una corrección de inventario.');
    }
    case 'correct_inventory': {
      admin(actor);
      const article = text(p.article, 'Artículo', 100);
      assert(!article.startsWith('supply:'), 'Ajusta este insumo mediante un conteo.');
      const notes = text(p.notes, 'Motivo', 1500);
      assert(typeof p.quantity === 'number', 'Cantidad inválida.');
      quantity(Math.abs(p.quantity), 'Cantidad', 1_000_000);
      ref = makeId('inventory-correction');
      movement(article, p.quantity, 'inventory_correction', ref, article, receivedAt);
      message = `Corrección de inventario · ${article} · ${p.quantity} · ${notes}`;
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
      assert(
        !state.shifts.some(
          (shift) =>
            !rehearsalShift(state, shift) &&
            !shift.closingArchive &&
            ['pending', 'returned'].includes(shift.closingReview?.status ?? ''),
        ),
        'Otro administrador debe confirmar el cierre anterior antes de abrir un turno.',
      );
      const last = state.shifts
        .filter((shift) => shift.closedAt && !rehearsalShift(state, shift))
        .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))[0];
      const reconcileClosingId =
        last?.closingReview?.inventoryVerification?.status === 'pending' ? last.id : undefined;
      const depth = reconcileClosingId || (last && last.cashierId !== actor.id) ? 'deep' : 'simple';
      ref = makeId('shift');
      const shift: Shift = {
        id: ref,
        cashierId: actor.id,
        deviceId: actor.deviceId,
        status: directOpening ? 'open' : 'requested',
        requestedAt: command.at,
        ...(directOpening ? { openedAt: command.at, authorizedBy: actor.id } : {}),
        blindOpening: { status: 'pending', depth },
        reconcileClosingId,
        base: openingExpectedCash(state) ?? (directOpening ? money(p.base ?? 0, 'Base', true) : 0),
        openingSkipped: false,
      };
      state.shifts.push(shift);
      if (directOpening) configureOpeningCount(shift, p.openingItems);
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
      if (shift.blindOpening?.depth) {
        assert(!offline, 'La apertura requiere hacer el conteo con conexión.');
        configureOpeningCount(shift, p.openingItems);
      } else if (!offline && shift.cashierId !== actor.id) shift.blindOpening = { status: 'pending' };
      else activateOpeningAudit(shift, shift.cashierId !== actor.id || actor.role !== 'admin');
      if (offline) {
        shift.offlineAuthorizedBy = actor.offlineAdminId;
        review = true;
      }
      ref = shift.id;
      break;
    }
    case 'start_audit': {
      admin(actor);
      assert(p.when === undefined || p.when === 'next_opening', 'Momento de arqueo inválido.');
      const scheduled = p.when === 'next_opening';
      if (scheduled && p.cancel === true) {
        settings.nextOpeningAudit = undefined;
        ref = settings.id;
        break;
      }
      if (!scheduled) assert(!settings.auditId, 'Ya existe un arqueo en curso.');
      const shift = scheduled
        ? undefined
        : required(
            state.shifts.find((x) => x.id === p.shiftId && x.status === 'open'),
            'Turno abierto',
          );
      if (shift) assert(!shiftBlocksSales(shift), 'El turno tiene un conteo pendiente.');
      const mode = p.mode ?? 'custom';
      assert(mode === 'full' || mode === 'cash' || mode === 'custom', 'Tipo de arqueo inválido.');
      const selected = (value: unknown, allowed: string[], label: string): string[] => {
        assert(
          Array.isArray(value) && value.every((x) => typeof x === 'string' && allowed.includes(x)),
          `${label} inválidos.`,
        );
        assert(new Set(value).size === value.length, `No repitas ${label.toLowerCase()}.`);
        return value;
      };
      const allowedItems = physicalArticles(state).map((x) => x.id);
      const allowedPayments =
        shift?.cashierId === actor.id ? closingPaymentMethods(state, shift.id).map((x) => x.id) : [];
      const items =
        mode === 'full'
          ? allowedItems
          : mode === 'custom'
            ? selected(p.items ?? [], allowedItems, 'Artículos')
            : [];
      const payments =
        mode === 'full'
          ? allowedPayments
          : mode === 'custom'
            ? selected(p.payments ?? [], allowedPayments, 'Medios de pago')
            : [];
      assert(p.cash === undefined || typeof p.cash === 'boolean', 'Selección de efectivo inválida.');
      const cash = mode !== 'custom' || p.cash === true;
      assert(cash || items.length || payments.length, 'Selecciona al menos un ítem para contar.');
      if (shift) {
        startAudit(shift, { cash, items, payments }, actor.id);
        ref = settings.auditId;
      } else {
        settings.nextOpeningAudit = { mode, cash, items, payments, by: actor.id, at: command.at };
        ref = settings.id;
      }
      break;
    }
    case 'submit_blind_count': {
      assert(actor.online, 'Conéctate para enviar el conteo.', 'ONLINE_REQUIRED');
      const kind = p.kind;
      assert(kind === 'opening' || kind === 'closing', 'Tipo de conteo inválido.');
      const shift = cashier(actor, state, p.shiftId);
      assert(!settings.auditId, 'Completa el arqueo solicitado antes de continuar.');
      const current = kind === 'opening' ? shift.blindOpening : shift.blindClosing;
      const recount =
        kind === 'closing'
          ? closingNeedsRecount(shift) ||
            (p.blind !== true && current?.status === 'ready' && current.countIds?.length === 1)
          : current?.status === 'recount';
      const attempt = recount ? 2 : 1;
      assert(p.attempt === attempt, 'El conteo cambió. Actualiza el turno.');
      if (kind === 'opening') {
        assert(
          !shift.blindClosing &&
            !shift.openingCountId &&
            (!current || current.status === 'pending' || current.status === 'recount'),
          'La apertura ya fue contada.',
        );
      } else {
        verifyClosingCountMode(shift, p.closingCountMode);
        assert(
          (!shift.closingCountId || recount) &&
            (!current || recount) &&
            (!shiftBlocksSales(shift) || recount),
          'Completa el conteo de apertura antes de cerrar.',
        );
      }
      if (kind === 'closing' && (p.blind === true || p.preview !== undefined)) {
        const expected = visibleClosingPreview(state, shift);
        assert(
          (p.blind === true && attempt === 1) || matchesClosingPreview(p.preview, expected),
          'Los movimientos cambiaron. Revisa el cierre actualizado.',
          'CLOSING_CHANGED',
        );
        const count = recordBlindCount(
          shift,
          kind,
          visibleClosingArticles(state, shift),
          expected.expectedCash,
          p.blind === true ? attempt : undefined,
        );
        count.visibleClosing = true;
        shift.visibleClosing = true;
        count.expectedPayments = expected.expectedPayments;
        count.paymentLabels = expected.paymentLabels;
        count.payments = {};
        count.paymentDifferences = {};
        for (const [key, amount] of Object.entries(expected.expectedPayments)) {
          const checked = p.blind === true ? amount : p.payments?.[key];
          assert(typeof checked === 'number', `Cuenta los comprobantes de ${expected.paymentLabels[key]}.`);
          money(Math.abs(checked), 'Importe de comprobantes', true);
          count.payments[key] = checked;
          count.paymentDifferences[key] = checked - amount;
        }
        const differs = countHasDifferences(count);
        count.notes =
          differs && (p.blind !== true || attempt === 2)
            ? text(p.notes, 'Nota sobre la diferencia', 1500)
            : String(p.notes ?? '').slice(0, 1500);
        count.checklist = (settings.closingChecklist ?? []).map((task, index) => ({
          task,
          done: p.checklist?.[index] === true,
        }));
        assert(
          count.checklist.every(({ done }) => done),
          'Completa el checklist antes de presentar el conteo.',
        );
        const needsRecount = p.blind === true && attempt === 1 && differs;
        shift.blindClosing = {
          status: needsRecount ? 'recount' : 'ready',
          ...(needsRecount && { requiresRecount: true as const }),
          countIds: [...(current?.countIds ?? []), count.id],
        };
        if (needsRecount) {
          outcome = 'COUNT_RECOUNT';
          message = 'Hay una diferencia. Realiza el segundo conteo.';
          break;
        }
        shift.closingCountId = count.id;
        message = 'Conteo guardado. Reparte el efectivo para enviar el cierre.';
        break;
      }
      const count = recordBlindCount(
        shift,
        kind,
        shiftCountArticles(state, shift, kind),
        kind === 'opening' ? shift.base : cashExpected(state, shift.id),
        attempt,
      );
      if (shift.blindOpening?.depth) {
        const tasks = (kind === 'opening' ? settings.openingChecklist : settings.closingChecklist) ?? [];
        count.checklist = tasks.map((task, index) => ({ task, done: p.checklist?.[index] === true }));
        assert(
          count.checklist.every((item) => item.done),
          'Completa el checklist antes de presentar el conteo.',
        );
      }
      const outstanding =
        (count.difference ?? 0) !== 0 ||
        Object.entries(count.differences ?? {}).some(
          ([article, delta]) => delta !== compensatedInventory(state, count, article),
        );
      const status =
        kind === 'opening' && shift.reconcileClosingId
          ? 'review'
          : !outstanding
            ? 'matched'
            : attempt === 1
              ? 'recount'
              : 'review';
      const countIds = [...(current?.countIds ?? []), count.id];
      outcome =
        status === 'matched' ? 'COUNT_MATCHED' : status === 'recount' ? 'COUNT_RECOUNT' : 'COUNT_REVIEW';
      if (kind === 'opening') {
        shift.blindOpening = { ...shift.blindOpening, status, countIds };
        if (status !== 'recount') shift.openingCountId = count.id;
        if (status === 'matched') {
          shift.openedAt ??= command.at;
          activateOpeningAudit(shift, true);
        }
      } else if (shift.blindOpening?.depth) {
        shift.blindClosing = { status: status === 'recount' ? 'recount' : 'ready', countIds };
        if (status !== 'recount') shift.closingCountId = count.id;
        message =
          status === 'matched'
            ? 'Todo coincide. Confirma los medios de pago y reparte el efectivo.'
            : status === 'recount'
              ? 'Conteo guardado. Realiza el segundo conteo para continuar.'
              : 'Recuento guardado. Confirma los medios de pago y reparte el efectivo.';
        outcome = undefined;
      } else {
        shift.blindClosing = { status, countIds };
        if (status !== 'recount') {
          shift.closingCountId = count.id;
          shift.closedAt = command.at;
          shift.status = 'closed';
          shift.closingReview = status === 'review' ? { status: 'pending' } : undefined;
          shift.retained = count.cash;
          shift.remittance = 0;
          settings.lastCountId = count.id;
          settings.lastRetainedCash = count.cash!;
          finishOrders(shift);
        }
      }
      if (status === 'review')
        notify(
          'mermas',
          `El turno de ${actor.name} requiere revisión de ${kind === 'opening' ? 'apertura' : 'cierre'}.`,
        );
      break;
    }
    case 'review_blind_opening': {
      admin(actor);
      const shift = required(
        state.shifts.find((x) => x.id === p.shiftId && !x.closingArchive),
        'Turno',
      );
      const opening = required(shift.blindOpening, 'Apertura en revisión');
      assert(
        opening.status === 'review' || opening.status === 'authorized',
        'La apertura no está en revisión.',
      );
      const action = p.action;
      assert(
        action === 'authorize' ||
          action === 'request_audit' ||
          action === 'resolve' ||
          action === 'approve_count',
        'Acción inválida.',
      );
      const notes = p.notes == null || p.notes === '' ? undefined : text(p.notes, 'Nota', 1500);
      if (action === 'approve_count') {
        assert(opening.status === 'review' && shift.status === 'open', 'La apertura ya fue revisada.');
        const count = required(
          state.counts.find((item) => item.id === (opening.auditCountIds?.at(-1) ?? shift.openingCountId)),
          'Conteo de apertura',
        );
        const previous = state.shifts
          .filter(
            (item) =>
              item.id !== shift.id &&
              item.closedAt &&
              item.closedAt <= shift.requestedAt &&
              !item.closingArchive &&
              !rehearsalShift(state, item),
          )
          .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))[0];
        const prior = state.counts.find(
          (item) => item.id === (previous?.closingReview?.countId ?? previous?.closingCountId),
        );
        const balances = stockBalances(state);
        const attributed: Record<string, number> = {};
        const uncovered: Record<string, { difference: number; lastFullCountAt?: string }> = {};
        const lastFullCount = state.counts
          .filter(
            (item) =>
              (item.cutoffAt ?? item.at) < count.at &&
              (item.kind === 'audit' || item.kind === 'opening') &&
              physicalArticles(state)
                .filter(({ id }) => !id.startsWith('supply:'))
                .every(({ id }) => Object.hasOwn(item.items, id)),
          )
          .sort((a, b) => (b.cutoffAt ?? b.at).localeCompare(a.cutoffAt ?? a.at))[0];
        const inventoryUpdated = approvedInventoryUpdatesSince(state, count);
        for (const [key, actual] of Object.entries(count.items)) {
          if (isLegacyCoolerArticle(key)) continue;
          const value = p.items?.[key] ?? p[key];
          const corrected =
            value == null ? actual : quantity(value, count.itemLabels?.[key] ?? key, 1000000, true);
          assert(Number.isInteger(corrected), 'Los conteos físicos deben ser enteros.');
          const adjustment =
            (inventoryUpdated.has(key) && value == null ? (balances[key] ?? 0) : corrected) -
            (balances[key] ?? 0);
          if (adjustment) movement(key, adjustment, 'audit_adjustment', count.id, key, receivedAt);
          if (!adjustment) continue;
          if (prior && Object.hasOwn(prior.items, key)) attributed[key] = adjustment;
          else
            uncovered[key] = {
              difference: adjustment,
              lastFullCountAt: lastFullCount?.cutoffAt ?? lastFullCount?.at,
            };
        }
        if (previous?.closingReview && prior) {
          (previous.closingReview.openingChecks ??= []).push({
            countId: count.id,
            differences: attributed,
            cash: count.difference,
          });
          if (previous.id === shift.reconcileClosingId)
            previous.closingReview.inventoryVerification = { status: 'verified', countId: count.id };
        }
        if (Object.keys(uncovered).length) {
          (shift.operationsReview ??= {}).openingDifferences = { countId: count.id, items: uncovered };
        }
        if (count.cash !== undefined) shift.base = count.cash;
        shift.openedAt ??= command.at;
        shift.authorizedBy = actor.id;
        opening.status = 'reviewed';
        opening.review = { by: actor.id, at: receivedAt, notes };
        if (count.kind === 'audit') {
          ((shift.operationsReview ??= {}).countResolutions ??= {})[count.id] = {
            by: actor.id,
            at: receivedAt,
            notes: notes ?? 'Arqueo de apertura aprobado.',
          };
        }
        message = 'Apertura aprobada e inventario ajustado.';
        ref = count.id;
        break;
      }
      if (action === 'authorize') {
        assert(shift.status === 'open' && opening.status === 'review', 'La apertura ya fue autorizada.');
        assert(!shift.reconcileClosingId, 'Aprueba primero el arqueo completo de apertura.');
        const counted = state.counts.find((count) => count.id === shift.openingCountId)?.cash;
        if (counted !== undefined) shift.base = counted;
        opening.status = 'authorized';
        shift.openedAt ??= command.at;
        shift.authorizedBy = actor.id;
        activateOpeningAudit(shift, true);
        message = 'Ventas habilitadas. La diferencia de apertura sigue en revisión.';
      } else if (action === 'request_audit') {
        assert(!shift.reconcileClosingId, 'El arqueo completo ya fue presentado. Aprueba el conteo.');
        assert(shift.status === 'open' && opening.status === 'review', 'El turno ya fue habilitado.');
        const allowed = blindCountArticles(state).map((x) => x.id);
        const items = p.all === true ? allowed : (p.items ?? []);
        const cash = p.all === true || p.cash === true;
        assert(
          Array.isArray(items) &&
            items.every((key) => typeof key === 'string' && allowed.includes(key)) &&
            new Set(items).size === items.length &&
            (cash || items.length),
          'Selecciona los artículos o el efectivo para el arqueo.',
        );
        opening.audit = { id: makeId('opening-audit'), cash, items, by: actor.id, at: receivedAt };
        opening.status = 'audit';
        message = 'Arqueo de apertura solicitado.';
      } else {
        assert(
          opening.status === 'authorized' && notes,
          'Autoriza el turno y escribe una nota para revisarlo.',
        );
        opening.status = 'reviewed';
        message = 'Apertura revisada.';
      }
      opening.review = { by: actor.id, at: receivedAt, notes };
      ref = shift.id;
      break;
    }
    case 'submit_blind_opening_audit': {
      assert(actor.online, 'Conéctate para enviar el conteo.', 'ONLINE_REQUIRED');
      const shift = cashier(actor, state, p.shiftId);
      const opening = shift.blindOpening;
      assert(
        opening?.status === 'audit' && opening.audit?.id === p.auditId,
        'El arqueo cambió. Actualiza el turno.',
      );
      const audit = opening.audit!;
      const list = blindCountArticles(state).filter((x) => audit.items.includes(x.id));
      const count = recordBlindCount(shift, 'audit', list, audit.cash ? shift.base : undefined);
      count.auditId = audit.id;
      count.requestedAt = audit.at;
      count.requestedBy = audit.by;
      (opening.auditCountIds ??= []).push(count.id);
      opening.audit = undefined;
      if (countHasDifferences(count)) {
        opening.status = 'review';
        outcome = 'COUNT_REVIEW';
        notify('mermas', `El arqueo de apertura del turno de ${actor.name} requiere revisión.`);
      } else {
        opening.status = 'reviewed';
        shift.openedAt ??= command.at;
        shift.authorizedBy = audit.by;
        outcome = 'COUNT_MATCHED';
        activateOpeningAudit(shift, true);
      }
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
        assert(command.type === 'finish_audit', 'Presenta el arqueo solicitado.');
        assert(settings.auditId, 'No hay arqueo iniciado.');
        cashier(actor, state, shift.id);
        assert(actor.online, 'Presentar el arqueo requiere conexión.', 'ONLINE_REQUIRED');
        assert(p.auditId === settings.auditId, 'El arqueo cambió. Actualiza antes de contar.');
        assert(
          !settings.auditRequest || settings.auditRequest.shiftId === shift.id,
          'Este arqueo corresponde a otro turno.',
        );
      } else {
        cashier(actor, state, shift.id);
        assert(!shift.blindOpening && !shift.blindClosing, 'Presenta el conteo ciego del turno.');
        if (kind === 'closing') verifyClosingCountMode(shift, p.closingCountMode);
      }
      const auditRequest = kind === 'audit' ? settings.auditRequest : undefined;
      const openingAudit = auditRequest?.opening === true;
      if (kind === 'opening')
        assert(!settings.auditRequest?.opening, 'Presenta el arqueo de apertura programado.');
      const recordedKind = openingAudit && !shift.openingCountId ? 'opening' : kind;
      assert(
        recordedKind === 'audit' ||
          !state.counts.some((x) => x.shiftId === shift.id && x.kind === recordedKind),
        'Este conteo ya fue presentado.',
      );
      const skipped = kind === 'opening' && p.skip === true;
      assert(!skipped || settings.skipOpeningCount, 'El conteo de apertura no se puede omitir.');
      const balances = (!openingAudit && auditRequest?.expectedItems) || stockBalances(state),
        items: Record<string, number> = {},
        list = countArticles(state, kind, shift);
      for (const article of list) {
        if (skipped) continue;
        const value = (p.items ?? {})[article.id];
        assert(value !== undefined, `Falta contar ${article.name}.`);
        items[article.id] = quantity(value, article.name, 1000000, true);
        assert(Number.isInteger(items[article.id]), 'Los conteos físicos deben ser enteros.');
      }
      const legacyPaymentOnly =
        actor.role !== 'admin' && !!auditRequest && !auditRequest.cash && !list.length;
      const countsCash =
        !skipped && (kind !== 'audit' || !auditRequest || auditRequest.cash || legacyPaymentOnly);
      const counted = countsCash ? money(p.cash, 'Efectivo contado', true) : undefined,
        expected =
          kind === 'opening'
            ? shift.base
            : !countsCash
              ? undefined
              : auditRequest && !legacyPaymentOnly
                ? auditRequest.expectedCash
                : openingAudit
                  ? shift.base
                  : cashExpected(state, shift.id, command.at);
      if (command.configVersion !== settings.version) sourcePricing();
      const archived = state.parameters.find(
        (v) => v.version === command.configVersion && v.kind === 'catalog',
      )?.after as { settings?: State['settings'][number] } | undefined;
      const procedure = command.configVersion === settings.version ? settings : archived?.settings;
      const tasks =
        recordedKind === 'audit'
          ? []
          : recordedKind === 'opening'
            ? (procedure?.openingChecklist ?? [])
            : (procedure?.closingChecklist ?? []);
      const checklist = tasks.map((task, index) => ({ task, done: p.checklist?.[index] === true }));
      assert(
        skipped || checklist.every((item) => item.done),
        'Completa el checklist antes de presentar el conteo.',
      );
      const count: Count = {
        id: makeId('count'),
        kind: recordedKind,
        shiftId: shift.id,
        by: actor.id,
        at: command.at,
        cash: counted,
        items,
        itemLabels: Object.fromEntries(list.map((x) => [x.id, x.name])),
        expectedCash: expected,
        expectedItems: Object.fromEntries(Object.keys(items).map((k) => [k, balances[k] ?? 0])),
        difference: counted === undefined || expected === undefined ? undefined : counted - expected,
        differences: Object.fromEntries(Object.keys(items).map((k) => [k, items[k] - (balances[k] ?? 0)])),
        notes: String(p.notes ?? '').slice(0, 1500),
        checklist,
      };
      if (kind === 'closing' || (kind === 'audit' && actor.role === 'admin')) {
        const methods = countPaymentMethods(state, shift.id, kind);
        const totals = paymentsByMethod(state, shift.id).byAccount;
        count.payments = {};
        count.paymentLabels = {};
        count.expectedPayments = {};
        count.paymentDifferences = {};
        for (const { id: key, account } of methods) {
          const amount = p.payments?.[key];
          assert(typeof amount === 'number', `Falta verificar transferencias · ${account.name}.`);
          money(Math.abs(amount), `Transferencias verificadas · ${account.name}`, true);
          count.payments[key] = amount;
          count.paymentLabels[key] = account.name;
          count.expectedPayments[key] = auditRequest
            ? (auditRequest.expectedPayments?.[key] ?? 0)
            : (totals[account.id] ?? 0);
          count.paymentDifferences[key] = amount - count.expectedPayments[key];
        }
      }
      state.counts.push(count);
      ref = count.id;
      if (recordedKind === 'opening') {
        shift.openingSkipped = skipped;
        shift.openingCountId = count.id;
      }
      if (kind === 'audit') {
        count.auditId = settings.auditId;
        count.requestedBy = auditRequest?.by;
        count.requestedAt = auditRequest?.at;
        settings.auditId = undefined;
        settings.auditRequest = undefined;
      }
      if (kind === 'closing') {
        assert(!settings.auditId, 'Termina el arqueo antes de cerrar.');
        if (p.preview !== undefined && actor.online && !state.cupBalances)
          assert(
            matchesClosingPreview(p.preview, closingPreview(state, shift.id)),
            'El sistema cambió. Revisa de nuevo el cuadre antes de enviarlo.',
            'CLOSING_CHANGED',
          );
        const retained = money(p.retained, 'Efectivo reservado', true);
        assert(retained <= counted!, 'La base no puede superar el efectivo contado.');
        count.retained = retained;
        shift.retained = retained;
        shift.remittance = counted! - retained;
        shift.closingCountId = count.id;
        shift.closedAt = command.at;
        shift.status = actor.online ? 'closed' : 'provisional';
        shift.closingReview = { status: 'pending' };
        count.receivedAt = receivedAt;
        const eventTimes = new Map(state.audit.map((a) => [a.eventId, a.receivedAt]));
        count.stockEventIds = [
          ...new Set(
            state.stock
              .filter(
                (m) =>
                  m.article.startsWith('cup:') &&
                  (!eventTimes.has(m.eventId) || eventTimes.get(m.eventId)! >= receivedAt),
              )
              .map((m) => m.eventId),
          ),
        ];
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
        finishOrders(shift);
      }
      if (countHasDifferences(count)) notify('mermas', `Diferencias registradas en conteo de ${kind}.`);
      break;
    }
    case 'adjust_count_inventory': {
      admin(actor);
      assert(!settings.auditId, 'Termina el arqueo activo antes de ajustar el inventario.');
      const count = required(
        state.counts.find((c) => c.id === p.countId),
        'Conteo',
      );
      const list = adjustableCountArticles(state, count);
      assert(list.length, 'Este conteo no tiene artículos físicos para ajustar.');
      assert(!countInventoryAdjustment(state, count.id), 'Este conteo ya se usó para ajustar el inventario.');
      assert(p.confirmed === true, 'Confirma que verificaste las existencias actuales.');
      const notes = text(p.notes, 'Motivo del ajuste', 1500);
      const balances = stockBalances(state);
      const items: Record<string, number> = {};
      for (const { id: key, name } of list) {
        const expected = balances[key] ?? 0;
        assert(
          expected === p.expectedItems?.[key],
          'El inventario cambió. Abre de nuevo el conteo y verifica las existencias.',
        );
        const counted = quantity(p.items?.[key], name, 1000000, true);
        assert(Number.isInteger(counted), 'Los conteos físicos deben ser enteros.');
        items[key] = counted;
        if (counted !== expected)
          movement(key, counted - expected, 'audit_adjustment', count.id, key, receivedAt);
      }
      // Un cierre pendiente anterior conserva sus diferencias, pero sus artículos ya se conciliaron.
      const pending = new Set(
        state.shifts
          .filter((s) => s.closingCountId && !s.closingArchive && s.closingReview?.status !== 'approved')
          .map((s) => s.closingCountId),
      );
      const closingCountIds = state.counts
        .filter((c) => pending.has(c.id) && Object.keys(c.items).some((key) => Object.hasOwn(items, key)))
        .map((c) => c.id);
      inventoryAdjustment = { notes, items, closingCountIds };
      ref = count.id;
      message = 'Inventario ajustado y conteo original conservado.';
      break;
    }
    case 'submit_closing': {
      assert(actor.online, 'Conéctate para presentar el cierre.');
      const shift = required(
        state.shifts.find((s) => s.id === p.shiftId),
        'Turno',
      );
      const canResubmit =
        shift.closingReview?.status === 'returned' &&
        shift.cashierId === actor.id &&
        actor.primary &&
        actor.role === 'encargado' &&
        hasPermission(actor, 'shifts');
      assert(
        (isShiftCashier(actor, shift) || canResubmit) &&
          (shift.blindOpening?.depth || shift.visibleClosing) &&
          hasPermission(actor, 'shifts'),
        'Solo puede enviar la caja del turno.',
        'FORBIDDEN',
      );
      assert(
        !shift.blindClosing?.requiresRecount,
        'Realiza el segundo conteo antes de repartir el efectivo.',
      );
      const flow = (shift.closingFlow ??= { versions: [] });
      assert(
        (shift.status === 'open' || flow.returned) && !rehearsalShift(state, shift) && !shift.closingArchive,
        'El cierre ya fue enviado o está archivado.',
      );
      let count = required(
        state.counts.find(
          (item) => item.id === (flow.versions.at(-1)?.countId ?? shift.blindClosing?.countIds?.at(-1)),
        ),
        'Conteo de cierre',
      );
      assert(p.countId === count.id, 'El conteo cambió. Actualiza el cierre.');
      const retained = money(p.retained, 'Efectivo que dejas', true);
      const sent = money(p.sent, 'Efectivo que envías', true);
      assert(retained + sent === count.cash, 'La base más lo enviado debe ser igual al efectivo contado.');
      assert(
        retained <= (settings.maxClosingBase ?? settings.cashLimit),
        'La base supera el máximo de Configuración.',
      );
      assert(p.verified === true, 'Confirma los medios de pago con tus comprobantes.');
      const totals = paymentsByMethod(state, shift.id);
      assert(
        p.cashTotal === totals.cash && p.transferTotal === totals.transfer,
        'Los totales cambiaron. Actualiza y verifica de nuevo.',
      );
      const previousVersion = flow.versions.at(-1);
      const previous = state.transfers.find((t) => t.id === previousVersion?.transferId);
      if (
        previousVersion &&
        state.shifts.some((item) => item.id !== shift.id && item.requestedAt >= shift.closedAt!)
      )
        assert(retained === previousVersion.retained, 'La base ya pasó a otro turno y debe conservarse.');
      let transferId = previous?.id;
      if (previous) {
        assert(
          sent === previous.amount && p.locationId === previous.to,
          'La entrega ya salió. Conserva su monto y destinatario en la corrección.',
        );
      } else if (sent) {
        const location = required(
          state.locations.find((item) => item.active && item.id === p.locationId),
          'Destino del traslado',
        );
        assert(location.custodianId !== actor.id, 'El receptor debe ser distinto de quien entrega.');
        transferId = makeId('closing-transfer');
        state.transfers.push({
          id: transferId,
          by: actor.id,
          recipientId: location.custodianId,
          from: `cash:${shift.id}`,
          to: location.id,
          amount: sent,
          status: 'in_transit',
          at: command.at,
          executedAt: command.at,
          executedBy: actor.id,
          notes: 'Remanente de cierre',
          shiftId: shift.id,
          executionShiftId: shift.id,
          type: 'transfer',
          votes: [],
        });
        notify('transferencias', 'Remanente de cierre en camino. El custodio debe contar y confirmar.');
      }
      const notes = flow.returned ? text(p.notes, 'Corrección realizada', 1500) : undefined;
      if (flow.returned && p.items && Object.keys(p.items).length) {
        const items = Object.fromEntries(
          Object.keys(count.items).map((article) => {
            const value = quantity(p.items[article], count.itemLabels?.[article] ?? article, 1_000_000, true);
            assert(Number.isInteger(value), 'Los conteos deben ser enteros.');
            return [article, value];
          }),
        );
        count = {
          ...count,
          id: makeId('closing-correction'),
          revisesId: count.id,
          cutoffAt: count.cutoffAt ?? count.at,
          at: command.at,
          items,
          notes: notes!,
          differences: Object.fromEntries(
            Object.entries(items).map(([article, value]) => [
              article,
              value - (count.expectedItems?.[article] ?? 0),
            ]),
          ),
        };
        state.counts.push(count);
      }
      flow.versions.push({
        at: receivedAt,
        countId: count.id,
        retained,
        sent,
        transferId,
        notes,
        payments: { cash: totals.cash, transfer: totals.transfer, byAccount: totals.byAccount },
      });
      delete flow.returned;
      shift.closingCountId = count.id;
      shift.closedAt ??= command.at;
      shift.status = 'closed';
      shift.retained = retained;
      shift.remittance = sent;
      shift.closingReview = { status: 'pending' };
      shift.blindClosing!.status = countHasDifferences(count) ? 'review' : 'matched';
      if (flow.versions.length === 1) {
        settings.lastCountId = count.id;
        settings.lastRetainedCash = retained;
        finishOrders(shift);
      }
      message = notes ? 'Cierre corregido y reenviado.' : 'Cierre enviado para aprobación.';
      ref = shift.id;
      break;
    }
    case 'return_closing':
    case 'respond_closing': {
      throw new DomainError('Usa la revisión del cierre y las solicitudes de explicación.', 'FORBIDDEN');
    }
    case 'approve_closing': {
      admin(actor);
      const shift = required(
        state.shifts.find((s) => s.id === p.shiftId),
        'Turno',
      );
      assert(['closed', 'provisional'].includes(shift.status), 'Primero presenta el cierre.');
      assert(!shift.closingArchive, 'Este cierre está archivado y no admite nuevos ajustes.');
      assert(shift.closingReview?.status !== 'approved', 'Este cierre ya fue aprobado.');
      const original = required(
        state.counts.find((c) => c.id === shift.closingCountId),
        'Cierre original',
      );
      assert(shift.cashierId !== actor.id, 'Otro administrador debe confirmar el cierre.', 'FORBIDDEN');
      if (shift.closingFlow) {
        assert(
          ['pending', 'returned'].includes(shift.closingReview?.status ?? '') &&
            !rehearsalShift(state, shift),
          'El cierre no está pendiente de aprobación.',
        );
        const version = shift.closingFlow.versions.at(-1)!;
        const transfer = state.transfers.find((item) => item.id === version.transferId);
        const payments = currentPayments(state.payments).filter(
          (item) => item.shiftId === shift.id && paymentMethod(item) === 'transfer' && item.amount > 0,
        );
        const verified = shift.operationsReview?.verifiedTransfers;
        assert(
          !state.requests.some(
            (request) =>
              request.type === 'payment_change' &&
              request.status === 'pending' &&
              state.orders.some((order) => order.id === request.referenceId && order.shiftId === shift.id),
          ),
          'Resuelve las solicitudes de cambio de medio de pago antes de aprobar.',
        );
        assert(
          payments.every((item) => verified?.[item.id]),
          'Verifica todas las transferencias del turno.',
        );
        const cutoffAt = original.cutoffAt ?? original.at;
        const expected = closingPreview(state, shift.id, { ...original, at: cutoffAt });
        if (p.preview && original.visibleClosing)
          assert(
            matchesClosingPreview(p.preview, expected),
            'El sistema cambió. Revisa el cierre actualizado.',
            'CLOSING_CHANGED',
          );
        const expectedCash =
          expected.expectedCash +
          (!original.visibleClosing && transfer?.executedAt && transfer.executedAt <= cutoffAt
            ? transfer.amount
            : 0);
        const cash = p.cash == null ? original.cash! : money(p.cash, 'Corrección de efectivo', true);
        const sent = transfer ? (transfer.executedAt ? transfer.amount : 0) : version.sent;
        assert(cash >= sent, 'El efectivo corregido debe cubrir el traslado que ya salió de caja.');
        const items = Object.fromEntries(
          Object.entries(original.items)
            .filter(([key]) => !isLegacyCoolerArticle(key))
            .map(([key, amount]) => {
              const corrected =
                p.items?.[key] == null
                  ? amount
                  : quantity(p.items[key], original.itemLabels?.[key] ?? key, 1000000, true);
              assert(Number.isInteger(corrected), 'Los conteos físicos deben ser enteros.');
              return [key, corrected];
            }),
        );
        const amounts = Object.fromEntries(
          Object.keys(expected.expectedPayments).map((key) => {
            const value = p.payments?.[key] ?? original.payments?.[key] ?? 0;
            assert(typeof value === 'number', 'Corrección de comprobantes inválida.');
            money(Math.abs(value), 'Corrección de comprobantes', true);
            return [key, value];
          }),
        );
        ref = makeId('closing-review');
        const reviewed: Count = {
          ...original,
          id: ref,
          revisesId: original.id,
          cutoffAt: original.cutoffAt ?? original.at,
          at: command.at,
          by: actor.id,
          ...expected,
          expectedCash,
          cash,
          items,
          payments: amounts,
          differences: Object.fromEntries(
            Object.entries(items).map(([key, amount]) => [
              key,
              amount - (expected.expectedItems[key] ?? original.expectedItems?.[key] ?? 0),
            ]),
          ),
          difference: cash - expectedCash,
          notes: typeof p.notes === 'string' ? p.notes.trim().slice(0, 1500) : '',
          retained: cash - sent,
          paymentLabels: Object.fromEntries([
            ...Object.entries(expected.paymentLabels),
            ...payments.map((item) => [
              `payment:${item.id}`,
              `Transferencia · Pedido #${state.orders.find((order) => order.id === item.orderId)?.number ?? ''}`,
            ]),
            ...(transfer ? [[`handoff:${transfer.id}`, 'Traslado de efectivo']] : []),
          ]),
          paymentDifferences: Object.fromEntries([
            ...Object.entries(amounts).map(([key, amount]) => [
              key,
              amount - (expected.expectedPayments[key] ?? 0),
            ]),
            ...payments
              .filter((item) => verified?.[item.id]?.missing)
              .map((item) => [`payment:${item.id}`, -item.amount]),
            ...(transfer?.status === 'disputed'
              ? [[`handoff:${transfer.id}`, transfer.receivedAmount! - transfer.amount]]
              : []),
          ]),
        };
        const adjusted = new Set(
          shift.closingFlow.versions.flatMap((item) => {
            const count = state.counts.find((count) => count.id === item.countId);
            return count ? [...adjustedClosingArticles(state, count)] : [];
          }),
        );
        if (original.visibleClosing)
          for (const key of approvedInventoryUpdatesSince(state, original))
            if (p.items?.[key] == null) adjusted.add(key);
        const adjustInventory = p.adjustInventory !== false;
        delete shift.closingFlow.returned;
        if (adjustInventory) reconcileInventory(reviewed, adjusted);
        state.counts.push(reviewed);
        shift.closingReview = {
          status: 'approved',
          countId: reviewed.id,
          by: actor.id,
          at: receivedAt,
          ...(adjustInventory ? {} : { inventoryVerification: { status: 'pending' } }),
        };
        message = adjustInventory
          ? 'Cierre confirmado e inventario ajustado.'
          : 'Cierre confirmado. La siguiente apertura requiere un arqueo completo.';
        break;
      }
      const expected = closingPreview(state, shift.id, original);
      assert(
        matchesClosingPreview(p.preview, expected),
        'El sistema cambió. Vuelve a revisar el cierre antes de aprobarlo.',
        'CLOSING_CHANGED',
      );
      assert(p.verified === true, 'Confirma la verificación del efectivo y las cuentas.');
      const notes = text(p.notes, 'Resultado de la revisión', 1500);
      const cash = money(p.cash, 'Efectivo reconfirmado', true);
      const retained = money(p.retained ?? original.retained ?? 0, 'Base reservada reconfirmada', true);
      assert(cash >= retained, 'El efectivo reconfirmado no cubre la base reservada.');
      const items: Record<string, number> = {},
        payments: Record<string, number> = {};
      for (const key of Object.keys(expected.expectedItems)) {
        items[key] = quantity(p.items?.[key], original.itemLabels?.[key] ?? 'Vasos', 1000000, true);
        assert(Number.isInteger(items[key]), 'Los vasos deben ser enteros.');
      }
      for (const key of Object.keys(expected.expectedPayments)) {
        const amount = p.payments?.[key];
        assert(typeof amount === 'number', 'Falta verificar una cuenta.');
        money(Math.abs(amount), 'Transferencias reconfirmadas', true);
        payments[key] = amount;
      }
      const differences = Object.fromEntries(
        Object.keys(items).map((k) => [k, items[k] - expected.expectedItems[k]]),
      );
      const paymentDifferences = Object.fromEntries(
        Object.keys(payments).map((k) => [k, payments[k] - expected.expectedPayments[k]]),
      );
      ref = makeId('closing-review');
      const reviewed: Count = {
        ...original,
        id: ref,
        by: actor.id,
        at: command.at,
        cutoffAt: original.at,
        revisesId: original.id,
        cash,
        retained,
        items,
        payments,
        ...expected,
        difference: cash - expected.expectedCash,
        differences,
        paymentDifferences,
        notes,
      };
      state.counts.push(reviewed);
      const adjusted = adjustedClosingArticles(state, original);
      for (const [article, delta] of Object.entries(differences))
        if (delta && !adjusted.has(article)) movement(article, delta, 'closing_adjustment', original.id);
      shift.closingReview = {
        status: 'approved',
        countId: ref,
        by: actor.id,
        at: receivedAt,
        notes,
      };
      shift.status = 'closed';
      shift.retained = retained;
      shift.remittance = cash - retained;
      if (settings.lastCountId === original.id) {
        settings.lastCountId = ref;
        settings.lastRetainedCash = retained;
      }
      // Solo la solicitud pendiente puede corregirse; nunca se reescribe una entrega ejecutada.
      const pending = state.transfers.find(
        (t) => t.shiftId === shift.id && t.notes === 'Remanente de cierre' && t.status === 'requested',
      );
      const remittances = state.transfers.filter(
        (t) => t.shiftId === shift.id && t.notes === 'Remanente de cierre',
      );
      const remaining = Math.max(
        0,
        shift.remittance - remittances.filter((t) => t.executedAt).reduce((n, t) => n + t.amount, 0),
      );
      if (pending) {
        if (remaining > 0) pending.amount = remaining;
        else pending.status = 'cancelled';
      } else if (remaining > 0) {
        const location = required(
          state.locations.find((l) => l.active && l.id === (p.locationId || remittances[0]?.to)),
          'Destino del remanente',
        );
        state.transfers.push({
          id: makeId('review-transfer'),
          by: actor.id,
          recipientId: location.custodianId,
          from: `cash:${shift.id}`,
          to: location.id,
          amount: remaining,
          status: 'requested',
          at: command.at,
          notes: 'Remanente de cierre',
          shiftId: shift.id,
          type: 'transfer',
          votes: [],
        });
      }
      message = 'Cierre aprobado. Inventario ajustado y revisión conservada.';
      break;
    }
    case 'record_employee_recovery': {
      throw new DomainError('El registro de descuentos de nómina fue retirado.', 'FORBIDDEN');
    }
    case 'create_order': {
      const shift = operating();
      const pricing = sourcePricing();
      const customerName = p.customerName === undefined ? '' : orderCustomerName(p.customerName);
      const lines = buildLines(p.lines, pricing);
      const additions =
        p.additions === undefined ? undefined : priceAdditions(p.additions, pricing.settings[0].candyPrices);
      const quote = quoteOrder(pricing, lines, command.at, actor.online, [], additions);
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
        ...(customerName ? { customerName } : {}),
        shiftId: shift.id,
        sellerId: actor.id,
        ...(p.cashDraft === true && p.origin !== 'paper' ? { cashHandoff: 'draft' } : {}),
        lines: quote.lines,
        ...(additions?.length ? { additions } : {}),
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
    case 'send_order': {
      assert(actor.online, 'Conéctate para enviar el pedido a caja.', 'ONLINE_REQUIRED');
      const shift = operating();
      const order = findOrder();
      checkVersion(order);
      assert(
        order.status === 'open' && order.shiftId === shift.id && order.lines.length,
        'El pedido no está listo para enviar a caja.',
      );
      if (order.cashHandoff === 'draft') {
        order.cashHandoff = 'sent';
        order.version++;
      }
      ref = order.id;
      break;
    }
    case 'update_order': {
      operating();
      const order = findOrder();
      checkVersion(order);
      assert(order.status === 'open', 'Un pedido cobrado no se edita.');
      if (p.customerName !== undefined) {
        const customerName = orderCustomerName(p.customerName);
        if (customerName) order.customerName = customerName;
        else delete order.customerName;
        if (p.lines === undefined && p.additions === undefined) {
          order.version++;
          ref = order.id;
          break;
        }
      }
      const inputs = buildLines(p.lines, sourcePricing());
      for (const old of order.lines) {
        const next = inputs.find((x) => x.id === old.id);
        if (old.delivered) {
          assert(
            next && sameFlavors(next, old) && next.sizeId === old.sizeId && next.quantity >= old.delivered,
            'Lo entregado no se elimina ni cambia. Solicita una corrección.',
          );
          next.delivered = old.delivered;
          next.consumptionIds = old.consumptionIds;
        }
      }
      const additions =
        p.additions === undefined
          ? order.additions
          : priceAdditions(p.additions, sourcePricing().settings[0].candyPrices);
      const quote = quoteOrder(sourcePricing(), inputs, command.at, actor.online, [], additions);
      order.lines = quote.lines;
      if (additions?.length) order.additions = additions;
      else delete order.additions;
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
      movement(`liquid:${flavor.id}`, -1, 'tasting', order.id);
      ref = order.id;
      break;
    }
    case 'update_tasting':
    case 'remove_tasting': {
      assert(
        actor.online || actor.primary,
        'Esta corrección requiere conexión desde este equipo.',
        'ONLINE_REQUIRED',
      );
      assert(!settings.auditId, 'Termina el arqueo antes de corregir degustaciones.', 'AUDIT_ACTIVE');
      const order = findOrder();
      checkVersion(order);
      assert(
        canCorrectTastings(
          actor,
          order,
          state.shifts.find((shift) => shift.status === 'open'),
        ),
        'Solo un administrador puede corregir degustaciones de turnos anteriores.',
        'FORBIDDEN',
      );
      const tastingId = id(p.tastingId, 'Degustación');
      const tasting = required(
        order.tastings.find((tasting) => tasting.id === tastingId),
        'Degustación',
      );
      if (command.type === 'remove_tasting') {
        movement(`liquid:${tasting.flavorId}`, 1, 'tasting_correction', order.id, 'old-flavor', tasting.at);
        order.tastings = order.tastings.filter((item) => item.id !== tasting.id);
        if (
          !order.tastings.length &&
          (order.status === 'tasting_only' || (order.status === 'open' && !order.lines.length))
        )
          order.status = 'cancelled';
        message = `Degustación ${tasting.id} eliminada: sabor ${tasting.flavorId}, registrada ${tasting.at}. Se restituye 1 oz.`;
      } else {
        const flavor = required(
          state.flavors.find((flavor) => flavor.id === p.flavorId && flavor.active),
          'Sabor activo',
        );
        if (flavor.id !== tasting.flavorId) {
          movement(`liquid:${tasting.flavorId}`, 1, 'tasting_correction', order.id, 'old-flavor', tasting.at);
          movement(`liquid:${flavor.id}`, -1, 'tasting_correction', order.id, 'new-flavor', tasting.at);
          message = `Degustación ${tasting.id} corregida: sabor ${tasting.flavorId} por ${flavor.id}. Se conserva 1 oz de consumo.`;
          tasting.flavorId = flavor.id;
        }
      }
      order.version++;
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
      checkVersion(order);
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
      assert(!shiftBlocksSales(shift), 'Completa el conteo del turno antes de registrar ventas.');
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
      assert(order.cashHandoff !== 'draft', 'Envía el pedido a caja antes de registrar la entrega.');
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
      assert(order.cashHandoff !== 'draft', 'Envía el pedido a caja antes de cobrar.');
      checkVersion(order);
      assert(
        order.shiftId === shift.id && order.status === 'open',
        'El pedido no está pendiente de cobro en este turno.',
      );
      assert(order.lines.length > 0, 'Las degustaciones no generan un cobro.');
      const codes = Array.isArray(p.codes) ? p.codes.map((x: unknown) => text(x, 'Cupón', 80)) : [];
      assert(codes.length <= 10, 'Máximo diez cupones por pedido.');
      if (command.type === 'redeem_coupon') assert(codes.length > 0, 'Agrega un cupón.');
      const selectedPromotions = promotionSelection(p.promotionIds, p.counterPromotionId);
      const quote = quotePayment(
        codes.length || order.carriedCouponFromId || (selectedPromotions.length && actor.online)
          ? state
          : sourcePricing(),
        order,
        command.at,
        actor.online,
        codes,
        selectedPromotions,
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
      if (typeof shift.base === 'number' && cashExpected(state, shift.id) > settings.cashLimit)
        notify('transferencias', 'La caja superó el tope de efectivo configurado.');
      ref = order.id;
      message = 'Venta registrada.';
      break;
    }
    case 'request_payment_change': {
      const order = findOrder();
      const shift = operating();
      assert(
        order.shiftId === shift.id && order.status === 'paid',
        'Selecciona un pedido cobrado del turno.',
        'FORBIDDEN',
      );
      assert(hasPermission(actor, 'orders'), 'No tienes permiso para solicitar el cambio.', 'FORBIDDEN');
      assert(
        !state.requests.some(
          (request) =>
            request.type === 'payment_change' &&
            request.referenceId === order.id &&
            request.status === 'pending',
        ),
        'El pedido ya tiene un cambio pendiente.',
      );
      assert(originalPayment(order.id), 'El pedido no tiene un pago para corregir.');
      ref = makeId('payment-change');
      state.requests.push({
        id: ref,
        type: 'payment_change',
        referenceId: order.id,
        by: actor.id,
        at: command.at,
        status: 'pending',
        notes: text(p.notes, 'Nota', 1500),
      });
      message = 'Solicitud enviada. El administrador la verá en Solicitudes.';
      break;
    }
    case 'review_shift': {
      admin(actor);
      const shift = required(
        state.shifts.find((item) => item.id === p.shiftId),
        'Turno',
      );
      assert(!shift.closingArchive && !rehearsalShift(state, shift), 'Este turno está archivado.');
      if (p.action === 'set_closing_supplies') {
        assert(
          shift.status === 'open' && !shift.blindClosing && !shift.closingCountId,
          'El cierre ya comenzó o el turno ya no está abierto.',
        );
        const allowed = new Set(closingSupplyOptions(state).map((item) => item.id));
        const selected = p.items;
        assert(
          Array.isArray(selected) && selected.every((key) => allowed.has(key)),
          'Selecciona insumos del inventario.',
        );
        shift.closingSupplies = [...new Set<string>(selected)];
        ref = shift.id;
        message = 'Insumos guardados para este cierre.';
        break;
      }
      if (p.action === 'set_closing_count_mode') {
        assert(
          shift.status === 'open' && !shift.blindClosing && !shift.closingCountId,
          'El conteo de cierre ya comenzó o el turno ya no está abierto.',
        );
        assert(
          p.mode === 'cash' || p.mode === 'simple' || p.mode === 'full',
          'Elige un tipo de cuadre válido.',
        );
        shift.closingCountMode = p.mode;
        ref = shift.id;
        message = 'Tipo de cuadre guardado para este turno.';
        break;
      }
      const metadata = (shift.operationsReview ??= {});
      const payments = currentPayments(state.payments).filter((payment) => payment.shiftId === shift.id);
      ref = shift.id;
      switch (p.action) {
        case 'correct_opening': {
          assert(
            shift.status !== 'closed' || shift.closingReview?.status === 'pending',
            'La corrección se registra antes de confirmar el cierre.',
          );
          const bag = state.bags.find((item) => item.id === p.openingId);
          const pack = state.packages.find((item) => item.id === p.openingId);
          const opening = required(bag ?? pack, 'Apertura original');
          assert(
            !opening.voidedAt &&
              (opening.shiftId === shift.id ||
                (!opening.shiftId &&
                  shift.openedAt &&
                  opening.openedAt >= shift.openedAt &&
                  (!shift.closedAt || opening.openedAt <= shift.closedAt))),
            'Apertura ajena al turno o ya retirada.',
          );
          const notes = text(p.notes, 'Motivo', 1500);
          const at = p.remove === true ? undefined : isoDate(p.openedAt, 'Hora de apertura');
          assert(
            !at || (at >= (shift.openedAt ?? shift.requestedAt) && at <= (shift.closedAt ?? command.at)),
            'La apertura debe quedar dentro del turno.',
          );
          const stocked = bag ? `sealed_bag:${bag.flavorId}` : `package:${pack!.sizeId}`;
          const loose = bag ? `liquid:${bag.flavorId}` : `cup:${pack!.sizeId}`;
          const amount = bag?.ounces ?? pack!.units;
          if (at !== opening.openedAt) {
            movement(stocked, 1, 'opening_correction', shift.id, 'restore-closed', opening.openedAt);
            movement(loose, -amount, 'opening_correction', shift.id, 'restore-loose', opening.openedAt);
            if (at) {
              movement(stocked, -1, 'opening_correction', shift.id, 'move-closed', at);
              movement(loose, amount, 'opening_correction', shift.id, 'move-loose', at);
              opening.openedAt = at;
            } else opening.voidedAt = command.at;
          }
          if (bag) {
            const active = state.bags
              .filter((item) => item.flavorId === bag.flavorId && !item.voidedAt)
              .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
            active.forEach((item, index) => {
              item.exhaustedAt = active[index + 1]?.openedAt;
            });
          }
          message = `Apertura ${at ? 'corregida' : 'retirada'} · ${notes}`;
          ref = opening.id;
          break;
        }
        case 'verify_transfer': {
          const payment = required(
            payments.find((item) => item.id === p.paymentId && paymentMethod(item) === 'transfer'),
            'Transferencia',
          );
          const verified = (metadata.verifiedTransfers ??= {});
          assert(
            !shift.closingFlow || shift.closingReview?.status !== 'approved',
            'El cierre ya fue aprobado.',
          );
          verified[payment.id] = { by: actor.id, at: receivedAt, missing: p.missing === true };
          message =
            p.missing === true ? 'Transferencia registrada como faltante.' : 'Transferencia verificada.';
          break;
        }
        case 'reject_payment_change': {
          const request = required(
            state.requests.find(
              (item) =>
                item.id === p.requestId &&
                item.type === 'payment_change' &&
                item.status === 'pending' &&
                state.orders.some((order) => order.id === item.referenceId && order.shiftId === shift.id),
            ),
            'Solicitud pendiente',
          );
          request.status = 'rejected';
          request.reviewedBy = actor.id;
          request.reviewedAt = receivedAt;
          request.resolutionNotes = text(p.notes, 'Motivo', 1500);
          message = 'Cambio de medio de pago rechazado.';
          break;
        }
        case 'correct_payment': {
          assert(
            !shift.closingFlow || shift.closingReview?.status !== 'approved',
            'El cierre ya fue aprobado.',
          );
          const request =
            p.requestId === undefined
              ? undefined
              : required(
                  state.requests.find(
                    (item) =>
                      item.id === p.requestId && item.type === 'payment_change' && item.status === 'pending',
                  ),
                  'Solicitud pendiente',
                );
          const payment = required(
            payments.find(
              (item) =>
                item.amount > 0 && (request ? item.orderId === request.referenceId : item.id === p.paymentId),
            ),
            'Pago',
          );
          assert(p.method === 'cash' || p.method === 'transfer', 'Elige el medio de pago correcto.');
          const next = paymentFields();
          assert(
            paymentMethod(payment) !== next.method || payment.accountId !== next.accountId,
            'El pago ya está en ese medio.',
          );
          state.payments.push({
            ...payment,
            id: makeId('payment-reversal'),
            amount: -payment.amount,
            type: 'refund',
            reversesId: payment.id,
            correctsId: undefined,
            eventId: command.id,
          });
          state.payments.push({
            ...payment,
            ...next,
            accountId: next.accountId,
            reference: next.reference,
            id: makeId('payment-correction'),
            correctsId: payment.id,
            eventId: command.id,
          });
          const notes = text(p.notes, 'Motivo de la corrección', 1500);
          for (const pending of state.requests.filter(
            (item) =>
              item.type === 'payment_change' &&
              item.referenceId === payment.orderId &&
              item.status === 'pending',
          )) {
            pending.status = 'approved';
            pending.reviewedBy = actor.id;
            pending.reviewedAt = receivedAt;
            pending.resolutionId = makeId('payment-correction');
            pending.resolutionNotes = notes;
          }
          const closing = state.counts.find((item) => item.id === shift.closingCountId);
          if (
            !shift.closingFlow &&
            closing?.cash !== undefined &&
            !metadata.resolution &&
            closing.cash !== cashExpected(state, shift.id, closing.cutoffAt ?? closing.at)
          ) {
            shift.closingReview = { status: 'pending' };
          }
          message = 'Medio de pago corregido. El cuadre se recalculó.';
          break;
        }
        case 'ask_explanation': {
          assert(
            !state.requests.some(
              (item) =>
                item.type === 'shift_explanation' &&
                item.referenceId === shift.id &&
                item.status === 'pending',
            ),
            'El turno ya tiene una explicación pendiente.',
          );
          state.requests.push({
            id: makeId('explanation'),
            type: 'shift_explanation',
            by: actor.id,
            at: receivedAt,
            status: 'pending',
            referenceId: shift.id,
            notes: text(p.notes, 'Pregunta', 1500),
          });
          message = 'Explicación solicitada.';
          break;
        }
        case 'camera': {
          const at = isoDate(p.cameraAt, 'Hora de revisión de cámaras');
          metadata.camera = { at, notes: text(p.notes, 'Nota', 1500), by: actor.id };
          message = 'Turno marcado para revisar cámaras.';
          break;
        }
        case 'resolve_count': {
          const count = required(
            state.counts.find(
              (item) =>
                item.id === p.countId &&
                item.kind === 'audit' &&
                item.shiftId === shift.id &&
                !inRehearsalPeriod(state, item.at),
            ),
            'Arqueo',
          );
          const resolutions = (metadata.countResolutions ??= {});
          assert(
            countHasDifferences(count) && !resolutions[count.id],
            'El arqueo no está pendiente de revisión.',
          );
          resolutions[count.id] = { by: actor.id, at: receivedAt, notes: text(p.notes, 'Nota', 1500) };
          message = 'Diferencia de arqueo revisada.';
          break;
        }
        case 'resolve_opening': {
          const count = state.counts.find(
            (item) => item.id === shift.openingCountId && item.kind === 'opening',
          );
          assert(
            !shift.blindOpening &&
              !metadata.openingResolution &&
              count &&
              !inRehearsalPeriod(state, count.at) &&
              countHasDifferences(count),
            'La apertura no está pendiente de revisión.',
          );
          metadata.openingResolution = {
            notes: text(p.notes, 'Nota de resolución', 1500),
            at: receivedAt,
            by: actor.id,
          };
          message = 'Apertura revisada.';
          break;
        }
        case 'resolve': {
          assert(
            !shift.closingFlow &&
              shift.status === 'closed' &&
              shift.closingCountId &&
              shift.closingReview?.status !== 'approved' &&
              !metadata.resolution,
            'El cierre no está pendiente de resolución.',
          );
          assert(
            p.outcome === 'shortage' || p.outcome === 'surplus' || p.outcome === 'matched',
            'Elige un resultado.',
          );
          const notes = text(p.notes, 'Nota de resolución', 1500);
          metadata.resolution = { outcome: p.outcome, notes, at: receivedAt, by: actor.id };
          shift.closingReview = {
            ...shift.closingReview,
            status: 'approved',
            countId: shift.closingCountId,
            by: actor.id,
            at: receivedAt,
            notes,
          };
          message = 'Diferencia cerrada.';
          break;
        }
        default:
          throw new DomainError('Acción de revisión inválida.');
      }
      break;
    }
    case 'answer_shift_review': {
      const request = required(
        state.requests.find(
          (item) =>
            item.id === p.requestId &&
            item.type === 'shift_explanation' &&
            item.status === 'pending' &&
            !rehearsalRequest(state, item),
        ),
        'Solicitud pendiente',
      );
      assert(
        state.shifts.some((shift) => shift.id === request.referenceId && shift.cashierId === actor.id),
        'La solicitud pertenece a otro turno.',
        'FORBIDDEN',
      );
      request.response = { notes: text(p.notes, 'Explicación', 1500), at: receivedAt };
      request.status = 'approved';
      ref = request.id;
      message = 'Explicación enviada.';
      break;
    }
    case 'archive_rehearsal': {
      admin(actor);
      const count = required(
        state.counts.find((item) => item.id === p.countId && item.kind === 'audit'),
        'Arqueo de referencia',
      );
      const at = count.cutoffAt ?? count.at;
      assert(
        !settings.rehearsalBaseline || at > settings.rehearsalBaseline.at,
        'Elige un arqueo posterior al de referencia actual.',
      );
      settings.rehearsalBaseline = { countId: count.id, at, by: actor.id };
      ref = count.id;
      message = 'Período de ensayo archivado.';
      break;
    }
    case 'request_void': {
      const order = findOrder();
      assert(order.status === 'paid', 'Solo se anula una venta cobrada.');
      if (actor.role !== 'admin') cashier(actor, state, order.shiftId);
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
      assert(!article.startsWith('supply:'), 'Registra la diferencia de este insumo mediante un conteo.');
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
        referenceId: state.shifts.find((item) => item.status === 'open')?.id,
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
        state.requests.find(
          (x) =>
            x.id === p.requestId &&
            x.status === 'pending' &&
            !['change', 'payment_change', 'shift_explanation'].includes(x.type) &&
            !rehearsalRequest(state, x),
        ),
        'Solicitud pendiente',
      );
      if (request.type === 'void') {
        const order = required(
          state.orders.find((x) => x.id === request.referenceId),
          'Venta',
        );
        assert(
          request.by !== actor.id &&
            order.sellerId !== actor.id &&
            !state.payments.some((p) => p.orderId === order.id && p.cashierId === actor.id) &&
            order.cashierId !== actor.id,
          'No puedes aprobar la anulación de tu propia venta.',
          'FORBIDDEN',
        );
        if (p.approve === true) {
          assert(
            order.status === 'void_requested' && !order.voidInventoryRestoredAt,
            'La anulación ya fue procesada.',
          );
          restoreVoidedInventory(order);
          message = 'Anulación aprobada. Inventario descontado reintegrado.';
        }
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
      ref = makeId('replacement');
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
          if (old.voidInventoryRestoredAt) {
            if (amount)
              for (const item of deliveryStock(line, amount)) {
                movement(
                  item.article,
                  -item.amount,
                  'replacement_delivery',
                  ref!,
                  `${line.id}:${item.article}`,
                );
              }
            return;
          }
          if (amount && (line.sizeId !== prior.sizeId || !sameFlavors(line, prior))) {
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
            for (const portion of liquidPortions(prior, amount * a.ounces))
              movement(
                `liquid:${portion.flavorId}`,
                portion.ounces,
                'recipe_correction',
                old.id,
                `${line.id}:oldliquid:${portion.flavorId}`,
              );
            for (const portion of liquidPortions(line, amount * b.ounces))
              movement(
                `liquid:${portion.flavorId}`,
                -portion.ounces,
                'recipe_correction',
                old.id,
                `${line.id}:newliquid:${portion.flavorId}`,
              );
          }
        });
      }
      const replacement: Order = {
        id: ref,
        number: ref.slice(0, 8).toUpperCase(),
        ...(old.customerName ? { customerName: old.customerName } : {}),
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
        ...(old.additions?.length ? { additions: old.additions } : {}),
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
      const photo = p.evidenceId ? evidence(p.evidenceId) : undefined;
      ref = makeId('shipment');
      state.shipments.push({
        id: ref,
        by: actor.id,
        from: p.from,
        supplier: text(p.supplier, 'Proveedor', 100),
        items,
        evidenceId: photo,
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
          locationId: source === 'treasury' ? p.locationId : undefined,
          supplier: p.supplier,
          notes: 'Compra vinculada al envío',
          shiftId: source === 'cash' ? operating().id : undefined,
          status: 'pending',
          shipmentId: ref,
          evidenceId: photo,
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
      const shipmentItems = shipment.items.filter((item) => item.article !== 'copita');
      const expected = Object.fromEntries(
        shipmentItems.map((x) => [
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
      shipment.status = shipmentItems.every(
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
    case 'save_supply': {
      admin(actor);
      const supply = required(
        supplies(state).find((item) => item.id === p.article),
        'Insumo',
      );
      const unit = text(p.unit, 'Unidad cerrada', 60);
      const initial = p.initial == null ? null : quantity(p.initial, 'Cantidad inicial', 1_000_000, true);
      if (initial !== null) {
        assert(!supply.initialized, 'El saldo inicial ya se registró.');
        assert(Number.isInteger(initial), 'La cantidad inicial debe ser entera.');
        const adjustment = initial - (stockBalances(state)[supply.id] ?? 0);
        if (adjustment) movement(supply.id, adjustment, 'supply_initial', supply.id);
      }
      (settings.supplies ??= {})[supply.id] = { unit, initialized: supply.initialized || initial !== null };
      ref = supply.id;
      message =
        initial === null
          ? `${supply.name} · Unidad cerrada: ${unit}`
          : `${supply.name} · Saldo inicial: ${initial} (${unit})`;
      break;
    }
    case 'open_supply': {
      const shift = operating();
      const supply = required(
        supplies(state).find((item) => item.id === p.article && item.initialized),
        'Insumo con saldo inicial',
      );
      assert(
        (stockBalances(state)[supply.id] ?? 0) >= 1,
        'No quedan unidades cerradas. Registra la recepción o revisa el conteo.',
      );
      ref = shift.id;
      movement(supply.id, -1, 'open_supply', shift.id);
      message = `Apertura registrada · ${supply.name}`;
      break;
    }
    case 'open_package': {
      const opening =
        p.closingRecount === true
          ? (() => {
              assert(
                actor.online && !settings.auditId,
                'Conéctate para agregar paquetes durante el recuento.',
              );
              const shift = cashier(actor, state, p.shiftId);
              assert(closingNeedsRecount(shift), 'El turno no tiene un segundo conteo pendiente.');
              return { shiftId: shift.id, at: command.at };
            })()
          : inventoryOpening();
      const { shiftId, at } = opening;
      const units = quantity(settings.cupPackageUnits, 'Unidades por paquete', 1000);
      assert(Number.isInteger(units), 'Unidades enteras.');
      const batch = p.quantities !== undefined;
      const quantities = batch ? p.quantities : { [p.sizeId]: p.quantity ?? 1 };
      assert(
        quantities && typeof quantities === 'object' && !Array.isArray(quantities),
        'Indica la cantidad de paquetes por tamaño.',
      );
      const entries = Object.entries(quantities).map(([sizeId, value]) => {
        assert(
          state.sizes.some((size) => size.id === sizeId && usesCupPackages(size)),
          'Tamaño inválido.',
        );
        const count = quantity(value, 'Cantidad de paquetes', 1000, true);
        assert(Number.isInteger(count), 'La cantidad de paquetes debe ser entera.');
        return { sizeId, count };
      });
      const total = entries.reduce((sum, item) => sum + item.count, 0);
      assert(total > 0 && total <= 1000, 'Agrega entre 1 y 1000 paquetes.');
      for (const { sizeId, count } of entries) {
        for (let index = 0; index < count; index++) {
          const suffix = !batch && index === 0 ? '' : `:${sizeId}:${index}`;
          const packageId = makeId(`package${suffix}`);
          ref ??= packageId;
          state.packages.push({ id: packageId, sizeId, units, openedAt: at, shiftId, by: actor.id });
          movement(`package:${sizeId}`, -1, 'open_package', packageId, `package${suffix}`, at);
          movement(`cup:${sizeId}`, units, 'open_package', packageId, `cups${suffix}`, at);
        }
      }
      break;
    }
    case 'open_bag': {
      const { shiftId, at } = inventoryOpening();
      const flavor = required(
        state.flavors.find((x) => x.id === p.flavorId),
        'Sabor',
      );
      const ounces = quantity(settings.bagOunces, 'Onzas por bolsa', 10000);
      const bags = state.bags
        .filter((x) => !x.voidedAt && x.flavorId === flavor.id)
        .sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
      const next = bags.find((x) => Date.parse(x.openedAt) > Date.parse(at));
      for (const bag of bags) {
        if (Date.parse(bag.openedAt) > Date.parse(at)) break;
        if (!bag.exhaustedAt || Date.parse(bag.exhaustedAt) > Date.parse(at)) bag.exhaustedAt = at;
      }
      ref = makeId('bag');
      state.bags.push({
        id: ref,
        flavorId: flavor.id,
        ounces,
        openedAt: at,
        shiftId,
        by: actor.id,
        exhaustedAt: next?.openedAt,
      });
      movement(`sealed_bag:${flavor.id}`, -1, 'open_bag', ref, 'bag', at);
      movement(`liquid:${flavor.id}`, ounces, 'open_bag', ref, 'liquid', at);
      break;
    }
    case 'exhaust_bag': {
      throw new DomainError('Abrir otra bolsa del mismo sabor cierra la anterior.');
    }
    case 'expense': {
      assert(actor.role !== 'apoyo', 'Solo el encargado o un admin registra gastos.', 'FORBIDDEN');
      const amount = money(p.amount);
      const source = p.source;
      assert(['cash', 'treasury', 'personal'].includes(source), 'Origen del pago inválido.');
      const correctionShift =
        source !== 'treasury' && actor.role === 'admin' && p.shiftId
          ? required(
              state.shifts.find((s) => s.id === p.shiftId),
              'Turno',
            )
          : undefined;
      const shift = source === 'cash' ? (correctionShift ?? operating()) : correctionShift;
      if (shift && !(actor.role === 'admin' && ['closed', 'provisional'].includes(shift.status)))
        cashier(actor, state, shift.id);
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
        locationId: source === 'treasury' ? p.locationId : undefined,
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
      assert(actor.id !== expenseCustodianId(state, expense), expenseCustodianMessage, 'FORBIDDEN');
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
    case 'request_transfer':
    case 'execute_transfer': {
      assert(actor.role !== 'apoyo', 'El apoyo no mueve dinero.', 'FORBIDDEN');
      assert(actor.online, 'Conéctate para registrar el movimiento.', 'ONLINE_REQUIRED');
      const requesting = command.type === 'request_transfer';
      const creating = requesting || p.transferId === undefined;
      const drawer = (from?: string) => {
        const shift = state.shifts.find((x) => x.status === 'open');
        assert(
          shift && (!from || from === `cash:${shift.id}`) && isShiftCashier(actor, shift),
          'Solo el responsable del turno activo puede registrar un movimiento desde su caja.',
          'FORBIDDEN',
        );
        return operating();
      };
      const ownedAccount = (from: unknown) => {
        const account = state.locations.find((x) => x.id === from);
        assert(
          account?.active && account.custodianId === actor.id,
          'Solo el custodio de la cuenta de origen puede registrar el movimiento.',
          'FORBIDDEN',
        );
        return account;
      };
      let transfer: Transfer;
      if (creating) {
        const type = p.type === 'profit' ? 'profit' : 'transfer';
        if (type === 'profit') {
          admin(actor);
          assert(requesting, 'La salida por utilidad requiere aprobación.');
        }
        const location = required(
          state.locations.find((x) => x.id === p.to && x.active),
          'Destino',
        );
        const fromCash = actor.role !== 'admin' || String(p.from ?? '').startsWith('cash:');
        const shift = fromCash ? drawer(actor.role === 'admin' ? p.from : undefined) : undefined;
        if (shift && p.shiftId) assert(p.shiftId === shift.id, 'El turno de caja cambió.');
        const from = shift ? `cash:${shift.id}` : p.from;
        if (!shift && !(type === 'profit' && from === 'treasury')) ownedAccount(from);
        assert(from !== location.id, 'Selecciona un destino diferente del origen.');
        transfer = {
          id: makeId('transfer'),
          by: actor.id,
          recipientId: location.custodianId,
          from,
          to: location.id,
          amount: money(p.amount),
          status: 'requested',
          at: command.at,
          notes: text(p.notes, 'Concepto', 1000),
          shiftId: shift?.id,
          type,
          votes: [],
        };
        state.transfers.push(transfer);
        if (requesting) {
          ref = transfer.id;
          notify('transferencias', `Movimiento solicitado · $${transfer.amount}.`);
          break;
        }
      } else {
        transfer = required(
          state.transfers.find((x) => x.id === p.transferId && x.status === 'requested'),
          'Movimiento solicitado',
        );
      }

      if (transfer.type !== 'transfer') {
        admin(actor);
        assert(transfer.votes.length >= 3, 'Reembolsos y utilidades requieren tres admins distintos.');
        transfer.by = actor.id;
        if (transfer.from === 'treasury') transfer.from = ownedAccount(p.from).id;
      }
      if (transfer.from.startsWith('cash:')) transfer.executionShiftId = drawer(transfer.from).id;
      else {
        admin(actor);
        ownedAccount(transfer.from);
      }
      const location =
        transfer.type === 'transfer'
          ? required(
              state.locations.find((x) => x.id === transfer.to && x.active),
              'Destino activo',
            )
          : state.locations.find((x) => x.id === transfer.to);
      if (transfer.type === 'transfer')
        assert(
          location?.custodianId === transfer.recipientId,
          'La custodia del destino cambió. Registra un nuevo movimiento.',
        );
      const ownTransfer = transfer.type === 'transfer' && location?.custodianId === actor.id;
      assert(
        actor.id !== transfer.recipientId || ownTransfer,
        'La persona que recibe debe ser distinta de quien entrega.',
        'FORBIDDEN',
      );
      const proof = p.evidenceId ?? transfer.evidenceId;
      if (proof || location?.type === 'bank' || transfer.type !== 'transfer')
        transfer.evidenceId = evidence(proof);
      transfer.status = ownTransfer ? 'confirmed' : 'in_transit';
      transfer.executedAt = command.at;
      transfer.executedBy = actor.id;
      if (ownTransfer) {
        transfer.receivedAmount = transfer.amount;
        transfer.confirmedBy = actor.id;
        transfer.confirmedAt = command.at;
      }
      ref = transfer.id;
      message = ownTransfer
        ? 'Traslado entre cuentas propias confirmado.'
        : 'Movimiento ejecutado. El destinatario debe confirmar la recepción.';
      notify('transferencias', `${message} · $${transfer.amount}.`);
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
    case 'confirm_transfer': {
      admin(actor);
      const transfer = required(
        state.transfers.find((x) => x.id === p.transferId && x.status === 'in_transit'),
        'Movimiento en tránsito',
      );
      assert(
        transfer.recipientId === actor.id && transfer.by !== actor.id && transfer.executedBy !== actor.id,
        'Solo confirma el administrador receptor, distinto de quien solicitó y entregó.',
        'FORBIDDEN',
      );
      const received = money(p.receivedAmount, 'Monto recibido', true);
      transfer.receivedAmount = received;
      transfer.confirmedBy = actor.id;
      transfer.confirmedAt = command.at;
      transfer.status = received === transfer.amount ? 'confirmed' : 'disputed';
      if (received !== transfer.amount && transfer.shiftId) {
        const shift = state.shifts.find((item) => item.id === transfer.shiftId);
        if (shift?.closingReview?.status === 'approved')
          (shift.closingReview.handoffDifferences ??= {})[transfer.id] = received - transfer.amount;
      }
      ref = transfer.id;
      break;
    }
    case 'cancel_transfer': {
      admin(actor);
      const transfer = required(
        state.transfers.find(
          (item) =>
            item.id === p.transferId &&
            item.type === 'transfer' &&
            ['requested', 'in_transit'].includes(item.status),
        ),
        'Traslado pendiente',
      );
      if (transfer.status === 'in_transit') {
        assert(p.cashRestored === true, 'Confirma que el dinero permanece en el origen o ya se devolvió.');
        if (transfer.from.startsWith('cash:'))
          assert(
            state.shifts.some((shift) => shift.status === 'open' && `cash:${shift.id}` === transfer.from),
            'La caja de origen debe estar abierta para anular esta entrega.',
          );
      }
      transfer.cancellation = {
        at: command.at,
        by: actor.id,
        notes: text(p.notes, 'Motivo', 1500),
        originalExecutedAt: transfer.executedAt,
      };
      transfer.status = 'cancelled';
      delete transfer.executedAt;
      ref = transfer.id;
      message = 'Traslado anulado.';
      break;
    }
    case 'save_promotion': {
      admin(actor);
      const before = catalogBefore(),
        key = p.id ? id(p.id) : makeId('promotion');
      assert(
        !state.promotions.some((promotion) => promotion.id === key && promotion.courtesyOnly),
        'La cortesía ya emitida conserva sus condiciones. Genera otro código para ofrecer un beneficio diferente.',
      );
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
        stackable: p.stackable === true,
        checkoutText: p.checkoutText ? text(p.checkoutText, 'Texto de la casilla', 250) : undefined,
        limitedSchedule:
          p.limitedSchedule === true ||
          (p.limitedSchedule === undefined &&
            ((Array.isArray(p.days) && p.days.length > 0) ||
              (p.startTime && p.startTime !== '00:00') ||
              (p.endTime && p.endTime !== '23:59'))),
      };
      assert(
        promo.sizeIds.every((key) => state.sizes.some((s) => s.id === key)) &&
          promo.flavorIds.every((key) => state.flavors.some((f) => f.id === key)),
        'Productos de la promoción desconocidos.',
      );
      const priorPromo = state.promotions.find((x) => x.id === key);
      const legacyConditionsUnchanged =
        priorPromo &&
        priorPromo.effect === 'free' &&
        JSON.stringify(priorPromo.sizeIds) === JSON.stringify(promo.sizeIds) &&
        JSON.stringify(priorPromo.flavorIds) === JSON.stringify(promo.flavorIds) &&
        priorPromo.alcohol === promo.alcohol;
      if (promo.effect === 'free' && !legacyConditionsUnchanged)
        assert(
          promo.sizeIds.length > 0 && promo.flavorIds.length > 0,
          'Define los tamaños y sabores exactos del producto de cortesía.',
        );
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
      let promo: Promotion;
      if (p.courtesySpec !== undefined) {
        const spec = p.courtesySpec;
        assert(
          spec && typeof spec === 'object' && !Array.isArray(spec),
          'Define las condiciones de la cortesía.',
        );
        assert(
          spec.allowMixed === undefined || typeof spec.allowMixed === 'boolean',
          'Define si la cortesía admite combinados.',
        );
        assert(
          spec.stackable === undefined || typeof spec.stackable === 'boolean',
          'Define si la cortesía es acumulable.',
        );
        const size = required(
          state.sizes.find((size) => size.id === spec.sizeId && size.active && size.ounces > 0),
          'Tamaño activo',
        );
        assert(
          ['all', 'yes', 'no'].includes(spec.alcohol),
          'Define si la cortesía es con licor, sin licor o de ambos tipos.',
        );
        const flavorInputs = spec.flavorIds ?? [];
        assert(
          Array.isArray(flavorInputs) && flavorInputs.length <= 100,
          'Sabores de la cortesía inválidos.',
        );
        const flavorIds = flavorInputs.map((value: unknown) => id(value, 'Sabor'));
        assert(new Set(flavorIds).size === flavorIds.length, 'No repitas sabores de la cortesía.');
        flavorIds.forEach((flavorId: string) =>
          required(
            state.flavors.find((flavor) => flavor.id === flavorId && flavor.active),
            'Sabor activo',
          ),
        );
        assert(
          state.flavors.some(
            (flavor) =>
              flavor.active &&
              (!flavorIds.length || flavorIds.includes(flavor.id)) &&
              (spec.alcohol === 'all' || flavor.alcohol === (spec.alcohol === 'yes')) &&
              (flavor.alcohol ? size.alcoholPrice : size.plainPrice) !== null,
          ),
          'No hay sabores disponibles para esta cortesía.',
        );
        const expiresAt = isoDate(p.expiresAt, 'Fecha de vencimiento');
        assert(expiresAt > command.at, 'Vencimiento inválido.');
        promo = {
          id: makeId('courtesy-promotion'),
          name: text(spec.name ?? `Cortesía de ${size.name}`, 'Nombre de la cortesía', 100),
          effect: 'free',
          delivery: 'coupon',
          sizeIds: [size.id],
          flavorIds,
          alcohol: spec.alcohol,
          courtesyOnly: true,
          allowMixed: spec.allowMixed !== false,
          stackable: spec.stackable !== false,
          startsAt: command.at,
          endsAt: expiresAt,
          days: [],
          startTime: '00:00',
          endTime: '00:00',
          maxRedemptions: 1,
          redemptions: 0,
          active: true,
          version: 1,
          by: actor.id,
          at: command.at,
        };
        state.promotions.push(promo);
      } else {
        promo = required(
          state.promotions.find((x) => x.id === p.promotionId && x.delivery === 'coupon' && x.active),
          'Promoción de cupón',
        );
        assert(!promo.courtesyOnly, 'Esta cortesía ya tiene su código. Genera una nueva cortesía.');
      }
      const courtesy = p.courtesySpec !== undefined || p.courtesy === true;
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
        benefit: {
          ...structuredClone(promo),
          sizeIds: promo.sizeIds.length
            ? [...promo.sizeIds]
            : state.sizes.filter((s) => s.active).map((s) => s.id),
          flavorIds: promo.flavorIds.length
            ? [...promo.flavorIds]
            : state.flavors.filter((f) => f.active).map((f) => f.id),
        },
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
    detail: outcome
      ? countOutcomes[outcome]
      : review
        ? 'Registro con configuración anterior o autorización de contingencia.'
        : message,
    ...(inventoryAdjustment ? { inventoryAdjustment } : {}),
  };
  state.audit.push(audit);
  return {
    state,
    result: {
      id: command.id,
      status: review ? 'review' : 'accepted',
      message: outcome
        ? countOutcomes[outcome]
        : review
          ? 'Guardado; requiere revisión de contingencia.'
          : message,
      ...(outcome ? { code: outcome } : { referenceId: ref }),
      at: receivedAt,
    },
  };
}

export function redactState(full: State, actor: Actor): State {
  if (actor.role !== 'admin') return structuredClone(employeeView(full, actor));
  const state = structuredClone(full);
  state.orders = state.orders.filter((order) => order.cashHandoff !== 'draft' || order.sellerId === actor.id);
  for (const transfer of state.transfers) {
    if (transfer.status !== 'in_transit' || transfer.recipientId !== actor.id) continue;
    transfer.blindReceipt = true;
    transfer.amount = 0;
    const shift = state.shifts.find((item) =>
      item.closingFlow?.versions.some((v) => v.transferId === transfer.id),
    );
    if (!shift) continue;
    delete shift.remittance;
    for (const version of shift.closingFlow!.versions.filter((item) => item.transferId === transfer.id))
      version.sent = 0;
    state.counts = state.counts.flatMap((count) => {
      if (count.shiftId !== shift.id || count.kind !== 'closing') return [count];
      if (!count.visibleClosing) return [];
      const { cash, expectedCash, difference, retained, notes, ...rest } = count;
      return [{ ...rest, blindHandoff: true, notes: '' }];
    });
  }
  return state;
}

export function migrateEmptyState(state?: Partial<State>): State {
  const fresh = initialState();
  return Object.assign(fresh, state ?? {});
}
