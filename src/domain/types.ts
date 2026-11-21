export type Role = 'admin' | 'encargado' | 'apoyo';
export type ID = string;
export type Permission =
  'orders' | 'deliveries' | 'payments' | 'expenses' | 'inventory' | 'transfers' | 'shifts';
export interface Profile {
  id: ID;
  name: string;
  role: Role;
  active: boolean;
  username?: string;
  permissions?: Partial<Record<Permission, boolean>>;
}
export interface Actor extends Profile {
  branchId?: ID;
  superAdmin?: boolean;
  deviceId: ID;
  primary: boolean;
  online: boolean;
  aal: 'aal1' | 'aal2';
  offlineAdminId?: ID;
}
export interface Flavor {
  id: ID;
  name: string;
  alcohol: boolean;
  active: boolean;
  imageId?: ID;
}
export interface Size {
  id: ID;
  name: string;
  ounces: number;
  alcoholPrice: number | null;
  plainPrice: number | null;
  cups: number;
  beers: number;
  active: boolean;
  rank: number;
}
export interface Settings {
  id: ID;
  version: number;
  cashLimit: number;
  expenseLimit: number;
  expenseCategories: string[];
  courtesyQuota: number;
  requiredChangeApprovals?: 1 | 2;
  cupPackageUnits: number;
  candyPrices?: import('./additions.ts').CandyPrices;
  maxClosingBase?: number;
  closingResponseDays?: number;
  bagOunces: number;
  liquidTolerance: number | null;
  liquidBagWindow?: number;
  syncWarningMinutes: number;
  skipOpeningCount: boolean;
  baseline: boolean;
  businessName: string;
  lastRetainedCash: number | null;
  lastCountId: ID | null;
  openingChecklist?: string[];
  closingChecklist?: string[];
  inventoryInitialized?: boolean;
  auditId?: ID;
  auditRequest?: AuditRequest;
  nextOpeningAudit?: ScheduledOpeningAudit;
  rehearsalBaseline?: { countId: ID; at: string; by: ID };
}
export type AuditMode = 'full' | 'cash' | 'custom';
export interface AuditSelection {
  cash: boolean;
  items: string[];
  payments: string[];
}
export interface ScheduledOpeningAudit extends AuditSelection {
  mode: AuditMode;
  by: ID;
  at: string;
}
export interface AuditRequest extends AuditSelection {
  id: ID;
  shiftId: ID;
  by: ID;
  at: string;
  opening?: boolean;
  expectedCash?: number;
  expectedItems?: Record<string, number>;
  expectedPayments?: Record<string, number>;
}
export interface OrderLine {
  id: ID;
  flavorId: ID;
  /** Sabores en partes iguales. Si falta, todo el vaso corresponde a flavorId. */
  flavorIds?: ID[];
  sizeId: ID;
  quantity: number;
  delivered: number;
  listPrice: number;
  unitPrice: number;
  discount: number;
  promotionId?: ID;
  couponId?: ID;
  paidSizeId?: ID;
  consumptionIds: ID[];
  recipe?: { ounces: number; cups: number; beers: number };
  appliedRules?: {
    promotion: Promotion;
    couponId?: ID;
    couponCode?: string;
    quantity: number;
    unitAmount: number;
  }[];
}
export interface Tasting {
  id: ID;
  flavorId: ID;
  at: string;
}
export interface Order {
  additions?: import('./additions.ts').CandyAddition[];
  id: ID;
  number: string;
  shiftId: ID;
  sellerId: ID;
  cashierId?: ID;
  carriedCouponFromId?: ID;
  lines: OrderLine[];
  tastings: Tasting[];
  status: 'open' | 'paid' | 'void_requested' | 'voided' | 'unpaid_incident' | 'tasting_only' | 'cancelled';
  createdAt: string;
  paidAt?: string;
  total: number;
  version: number;
  origin: 'app' | 'paper';
  originalAt?: string;
  paperFolio?: string;
  evidenceId?: ID;
  replacesId?: ID;
  paymentCredit?: number;
  paymentTransferFromId?: ID;
  inventoryTransferred?: boolean;
  voidInventoryRestoredAt?: string;
  couponCode?: string;
  resolvedAt?: string;
}
export interface Payment {
  id: ID;
  orderId: ID;
  shiftId: ID;
  cashierId: ID;
  amount: number;
  type: 'cash' | 'refund';
  /** Medio de pago; si falta es efectivo (registros anteriores a las transferencias). */
  method?: PaymentMethod;
  /** Cuenta que recibió o devolvió una transferencia. */
  accountId?: ID;
  /** Número de comprobante opcional de la transferencia. */
  reference?: string;
  at: string;
  eventId: ID;
  /** Entradas compensatorias conservan intacto el recaudo original. */
  reversesId?: ID;
  correctsId?: ID;
}
export type PaymentMethod = 'cash' | 'transfer';
export interface Delivery {
  id: ID;
  orderId: ID;
  lineId: ID;
  quantity: number;
  by: ID;
  at: string;
  eventId: ID;
}
export interface StockMovement {
  id: ID;
  article: string;
  quantity: number;
  reason: string;
  referenceId: ID;
  at: string;
  by: ID;
  eventId: ID;
}
export interface BlindOpening {
  depth?: 'simple' | 'deep';
  status: 'pending' | 'recount' | 'review' | 'audit' | 'matched' | 'authorized' | 'reviewed';
  countIds?: ID[];
  audit?: { id: ID; cash: boolean; items: string[]; by?: ID; at?: string };
  auditCountIds?: ID[];
  review?: { by: ID; at: string; notes?: string };
}
export interface BlindClosing {
  status: 'recount' | 'review' | 'matched' | 'ready';
  countIds?: ID[];
}
export type ClosingCountMode = 'cash' | 'simple' | 'full';

export interface Shift {
  closingCountMode?: ClosingCountMode;
  id: ID;
  cashierId: ID;
  deviceId: ID;
  status: 'requested' | 'open' | 'closed' | 'provisional';
  requestedAt: string;
  openedAt?: string;
  authorizedBy?: ID;
  base: number;
  openingSkipped: boolean;
  openingCountId?: ID;
  closingCountId?: ID;
  blindOpening?: BlindOpening;
  blindClosing?: BlindClosing;
  closingFlow?: {
    versions: {
      at: string;
      countId: ID;
      retained: number;
      sent: number;
      transferId?: ID;
      notes?: string;
      payments?: { cash: number; transfer: number; byAccount: Record<ID, number> };
    }[];
    returned?: { at: string; by: ID; notes: string };
    returns?: { at: string; by: ID; notes: string }[];
    response?: { at: string; by: ID; outcome: 'accepted' | 'disagreed' | 'unanswered'; notes: string };
    responseDueAt?: string;
  };
  retained?: number;
  remittance?: number;
  closedAt?: string;
  offlineAuthorizedBy?: ID;
  /** Cuentas usadas en el turno, también en la vista de caja sin importes esperados. */
  paymentAccountIds?: ID[];
  /** Retira el cierre de la revisión habitual sin alterar los hechos del turno. */
  closingArchive?: {
    at: string;
    by: ID;
    notes: string;
    replacementCountId: ID;
  };
  closingReview?: {
    status: 'pending' | 'returned' | 'approved';
    countId?: ID;
    by?: ID;
    at?: string;
    notes?: string;
    employeeCharge?: number;
    recoveries?: { id: ID; amount: number; paidOn: string; at: string; by: ID }[];
  };
  operationsReview?: {
    verifiedTransfers?: Record<ID, { by: ID; at: string; missing?: boolean }>;
    countResolutions?: Record<ID, { notes: string; at: string; by: ID }>;
    camera?: { at: string; notes: string; by: ID };
    openingResolution?: { notes: string; at: string; by: ID };
    resolution?: { outcome: 'shortage' | 'surplus' | 'matched'; notes: string; at: string; by: ID };
  };
}
export interface Count {
  id: ID;
  kind: 'opening' | 'closing' | 'audit' | 'receipt';
  shiftId?: ID;
  by: ID;
  at: string;
  blindAttempt?: 1 | 2;
  cash?: number;
  items: Record<string, number>;
  expectedCash?: number;
  expectedItems?: Record<string, number>;
  difference?: number;
  differences?: Record<string, number>;
  /** Importes verificados por medio/cuenta, separados del efectivo físico. */
  payments?: Record<string, number>;
  paymentLabels?: Record<string, string>;
  expectedPayments?: Record<string, number>;
  paymentDifferences?: Record<string, number>;
  inventoryDifferences?: Record<
    string,
    {
      quantity: number;
      unitCost: number;
      saleValue: number;
      compensation?: { countId: ID; quantity: number }[];
    }
  >;
  retained?: number;
  notes: string;
  checklist?: { task: string; done: boolean }[];
  auditId?: ID;
  requestedBy?: ID;
  requestedAt?: string;
  itemLabels?: Record<string, string>;
  revisesId?: ID;
  cutoffAt?: string;
  receivedAt?: string;
  /** Eventos en el límite del corte; evita ambigüedad cuando comparten la misma hora. */
  stockEventIds?: ID[];
}
export interface ClosingPreview {
  expectedCash: number;
  expectedItems: Record<string, number>;
  expectedPayments: Record<string, number>;
  paymentLabels: Record<string, string>;
}
export interface ShipmentLine {
  article: string;
  quantity: number;
  unitCost: number;
}
export interface Shipment {
  id: ID;
  by: ID;
  from: 'Medellín' | 'Tarazá';
  supplier: string;
  items: ShipmentLine[];
  expenseId?: ID;
  at: string;
  status: 'in_transit' | 'partial' | 'received';
  notes: string;
}
export interface Receipt {
  id: ID;
  shipmentId: ID;
  by: ID;
  at: string;
  items: Record<string, number>;
  damaged: Record<string, number>;
  expected?: Record<string, number>;
  differences?: Record<string, number>;
  evidenceId: ID;
  notes: string;
}
export interface Expense {
  id: ID;
  by: ID;
  at: string;
  category: string;
  amount: number;
  source: 'cash' | 'treasury' | 'personal';
  locationId?: ID;
  supplier: string;
  notes: string;
  evidenceId?: ID;
  shiftId?: ID;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: ID;
  shipmentId?: ID;
}
export interface MoneyLocation {
  id: ID;
  name: string;
  type: 'treasury' | 'bank';
  custodianId: ID;
  bank?: string;
  account?: string;
  active: boolean;
  openingBalance?: number;
  /** La cuenta recibe transferencias de clientes por ventas (Nequi, Daviplata, banco). */
  receivesSales?: boolean;
}
export interface Transfer {
  id: ID;
  by: ID;
  recipientId: ID;
  from: string;
  to: ID;
  amount: number;
  status: 'requested' | 'in_transit' | 'confirmed' | 'disputed' | 'cancelled';
  at: string;
  executedAt?: string;
  executedBy?: ID;
  cancellation?: { at: string; by?: ID; notes: string; originalExecutedAt?: string };
  confirmedAt?: string;
  confirmedBy?: ID;
  receivedAmount?: number;
  blindReceipt?: boolean;
  evidenceId?: ID;
  notes: string;
  shiftId?: ID;
  executionShiftId?: ID;
  type: 'transfer' | 'reimbursement' | 'profit';
  votes: ID[];
  expenseId?: ID;
}
export type PromoEffect = 'fixed' | 'upgrade' | 'nxm' | 'free';
export interface Promotion {
  id: ID;
  name: string;
  effect: PromoEffect;
  delivery: 'schedule' | 'coupon';
  sizeIds: ID[];
  flavorIds: ID[];
  alcohol: 'all' | 'yes' | 'no';
  /** Beneficio fijo creado junto con un único código de cortesía. */
  courtesyOnly?: boolean;
  allowMixed?: boolean;
  fixedPrice?: number;
  steps?: number;
  take?: number;
  pay?: number;
  startsAt: string;
  endsAt: string;
  days: number[];
  startTime: string;
  endTime: string;
  maxRedemptions: number | null;
  redemptions: number;
  active: boolean;
  version: number;
  by: ID;
  at: string;
  /** Ausente conserva la acumulación histórica entre productos distintos. */
  stackable?: boolean;
}
export interface Coupon {
  id: ID;
  code: string;
  promotionId: ID;
  issuedBy: ID;
  issuedAt: string;
  expiresAt: string;
  status: 'issued' | 'redeemed' | 'cancelled';
  orderId?: ID;
  redeemedAt?: string;
  courtesy: boolean;
  excessApprovedBy?: ID;
  /** Condiciones entregadas al cliente, independientes de futuras ediciones. */
  benefit?: Promotion;
}
export interface Request {
  id: ID;
  type:
    | 'sync'
    | 'void'
    | 'damage'
    | 'difference'
    | 'unpaid'
    | 'courtesy_excess'
    | 'change'
    | 'payment_change'
    | 'shift_explanation';
  by: ID;
  at: string;
  status: 'pending' | 'approved' | 'rejected';
  referenceId?: ID;
  article?: string;
  quantity?: number;
  notes: string;
  evidenceId?: ID;
  reviewedBy?: ID;
  reviewedAt?: string;
  amount?: number;
  diagnosis?: string;
  checklist?: boolean;
  originalCommand?: Command;
  resolutionNotes?: string;
  resolutionId?: ID;
  response?: { notes: string; at: string };
  change?: ChangeProposal;
}
export interface ChangeVote {
  by: ID;
  name: string;
  at: string;
}
export interface ChangeRecord {
  kind: CommandType;
  label: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  proposedBy: ChangeVote;
  votes: ChangeVote[];
  access?: 'user' | 'device';
}
export interface ChangeProposal extends ChangeRecord {
  command: Command;
  requiredApprovals: 1 | 2;
  inventoryDelta?: Record<string, number>;
}
export interface Goal {
  id: ID;
  period: 'week' | 'month';
  startsAt: string;
  endsAt: string;
  cups: number;
  amount: number;
  by: ID;
  at: string;
}
export interface ParameterVersion {
  id: ID;
  by: ID;
  at: string;
  kind: string;
  before: unknown;
  after: unknown;
  version: number;
}
export interface Audit {
  id: ID;
  eventId: ID;
  by: ID;
  deviceId: ID;
  /** Hora con la que se registró (ver effectiveAt). */
  at: string;
  /** Hora que informó el dispositivo, solo cuando se corrigió. */
  reportedAt?: string;
  receivedAt: string;
  action: string;
  referenceId?: ID;
  detail: string;
  change?: ChangeRecord;
  inventoryAdjustment?: {
    notes: string;
    items: Record<string, number>;
    closingCountIds: ID[];
  };
}
export interface Notification {
  id: ID;
  channel: 'gastos' | 'anulaciones' | 'mermas' | 'transferencias';
  text: string;
  at: string;
  status: 'pending' | 'sent';
  attempts: number;
  lastError?: string;
}
export interface Package {
  id: ID;
  sizeId: ID;
  units: number;
  openedAt: string;
  shiftId?: ID;
  by: ID;
  closedAt?: string;
  priorDifference?: number;
}
export interface Bag {
  id: ID;
  flavorId: ID;
  ounces: number;
  openedAt: string;
  shiftId?: ID;
  by: ID;
  exhaustedAt?: string;
}
export interface Attachment {
  id: ID;
  by: ID;
  mime: string;
  size: number;
  name: string;
  createdAt: string;
  status: 'pending' | 'uploaded';
  path?: string;
  sha256?: string;
}
export interface Outage {
  id: ID;
  deviceId: ID;
  from: string;
  until?: string;
}
export interface State {
  transferDestinations?: { id: ID; name: string; custodian?: string; needsEvidence: boolean }[];
  ownTurnSummary?: {
    shiftId: ID;
    sizes: { name: string; quantity: number }[];
    payments: { name: string; amount: number }[];
    transferAccounts?: { name: string; amount: number }[];
    expectedCash?: number;
    expenses: number;
    handoffs: {
      id: ID;
      locationId: ID;
      destination: string;
      custodian?: string;
      amount: number;
      status: Transfer['status'];
    }[];
  }[];
  ownPaymentChanges?: (Pick<Request, 'id' | 'status' | 'notes' | 'resolutionNotes'> & {
    at?: string;
    orderNumber?: string;
  })[];
  ownRequests?: Pick<Request, 'id' | 'type' | 'at' | 'status' | 'notes' | 'resolutionNotes'>[];
  cashHandoffs?: Pick<Transfer, 'id' | 'to' | 'amount' | 'status' | 'notes'>[];
  sharedShift?: { id: ID; blocked: boolean };
  paymentChangeOrderIds?: ID[];
  orderPaymentMethods?: Record<ID, string[]>;
  shiftReviewPrompt?: { id: ID; notes: string; at: string }[];
  resolvedSyncIds?: ID[];
  /** Resumen por cuenta del turno propio en la vista del empleado. */
  transferSummary?: { name: string; amount: number }[];
  /** Proyección operativa para mostrador, sin movimientos privados de inventario. */
  cupBalances?: Record<string, number>;
  settings: Settings[];
  flavors: Flavor[];
  sizes: Size[];
  orders: Order[];
  payments: Payment[];
  deliveries: Delivery[];
  stock: StockMovement[];
  shifts: Shift[];
  counts: Count[];
  shipments: Shipment[];
  receipts: Receipt[];
  expenses: Expense[];
  locations: MoneyLocation[];
  transfers: Transfer[];
  promotions: Promotion[];
  coupons: Coupon[];
  requests: Request[];
  goals: Goal[];
  parameters: ParameterVersion[];
  audit: Audit[];
  notifications: Notification[];
  packages: Package[];
  bags: Bag[];
  attachments: Attachment[];
  outages: Outage[];
}
export const COLLECTIONS = [
  'settings',
  'flavors',
  'sizes',
  'orders',
  'payments',
  'deliveries',
  'stock',
  'shifts',
  'counts',
  'shipments',
  'receipts',
  'expenses',
  'locations',
  'transfers',
  'promotions',
  'coupons',
  'requests',
  'goals',
  'parameters',
  'audit',
  'notifications',
  'packages',
  'bags',
  'attachments',
  'outages',
] as const;
export type Collection = (typeof COLLECTIONS)[number];
export type CommandType =
  | 'request_payment_change'
  | 'review_shift'
  | 'answer_shift_review'
  | 'archive_rehearsal'
  | 'record_paper'
  | 'cancel_order'
  | 'report_damage'
  | 'explain_difference'
  | 'request_courtesy_excess'
  | 'refund_order'
  | 'initialize_stock'
  | 'correct_inventory'
  | 'save_flavor'
  | 'save_size'
  | 'change_access'
  | 'resolve_change'
  | 'set_approval_requirement'
  | 'configure'
  | 'request_shift'
  | 'authorize_shift'
  | 'count'
  | 'submit_blind_count'
  | 'review_blind_opening'
  | 'submit_blind_opening_audit'
  | 'submit_closing'
  | 'return_closing'
  | 'respond_closing'
  | 'approve_closing'
  | 'record_employee_recovery'
  | 'start_audit'
  | 'finish_audit'
  | 'adjust_count_inventory'
  | 'create_order'
  | 'update_order'
  | 'taste'
  | 'update_tasting'
  | 'remove_tasting'
  | 'close_tastings'
  | 'deliver'
  | 'pay'
  | 'redeem_coupon'
  | 'request_void'
  | 'replace_order'
  | 'resolve_request'
  | 'unpaid'
  | 'create_shipment'
  | 'receive_shipment'
  | 'open_package'
  | 'open_bag'
  | 'exhaust_bag'
  | 'expense'
  | 'approve_expense'
  | 'save_location'
  | 'request_transfer'
  | 'execute_transfer'
  | 'confirm_transfer'
  | 'cancel_transfer'
  | 'approve_payout'
  | 'save_promotion'
  | 'issue_coupon'
  | 'save_goal'
  | 'register_attachment'
  | 'outage';
export interface Command {
  id: ID;
  branchId?: ID;
  type: CommandType;
  actorId: ID;
  deviceId: ID;
  shiftId?: ID;
  at: string;
  configVersion: number;
  sequence: number;
  payload: Record<string, unknown>;
}
export interface Result {
  id: ID;
  status: 'accepted' | 'review' | 'conflict';
  message: string;
  code?: string;
  /** Validación denegada antes de guardar, sin una solicitud de conciliación en el servidor. */
  finalRejection?: true;
  approvalPending?: true;
  referenceId?: ID;
  revision?: number;
  at?: string;
}
export interface Snapshot {
  branch?: import('./platform.ts').Branch;
  access?: import('./platform.ts').Access;
  state: State;
  revision: number;
  profiles: Profile[];
  devices: Device[];
  actor: Actor;
  serverAt: string;
  offlineAuthorizers?: { id: ID; name: string; salt: string; hash: string }[];
}
export interface Device {
  id: ID;
  branchId?: ID;
  userId: ID;
  name: string;
  active: boolean;
  primary: boolean;
  lastSeen?: string;
}
export class DomainError extends Error {
  constructor(
    message: string,
    public code = 'VALIDATION',
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
