export type Role = 'admin' | 'encargado' | 'apoyo';
export type ID = string;
export interface Profile {
  id: ID;
  name: string;
  role: Role;
  active: boolean;
  username?: string;
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
  cupPackageUnits: number;
  bagOunces: number;
  liquidTolerance: number | null;
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
}
export interface OrderLine {
  id: ID;
  flavorId: ID;
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
  appliedRules?: { promotion: Promotion; couponId?: ID; quantity: number; unitAmount: number }[];
}
export interface Tasting {
  id: ID;
  flavorId: ID;
  at: string;
}
export interface Order {
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
  at: string;
  eventId: ID;
}
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
export interface Shift {
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
  retained?: number;
  remittance?: number;
  closedAt?: string;
  offlineAuthorizedBy?: ID;
}
export interface Count {
  id: ID;
  kind: 'opening' | 'closing' | 'audit' | 'receipt';
  shiftId?: ID;
  by: ID;
  at: string;
  cash?: number;
  items: Record<string, number>;
  expectedCash?: number;
  expectedItems?: Record<string, number>;
  difference?: number;
  differences?: Record<string, number>;
  retained?: number;
  notes: string;
  checklist?: { task: string; done: boolean }[];
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
}
export interface Transfer {
  id: ID;
  by: ID;
  recipientId: ID;
  from: string;
  to: ID;
  amount: number;
  status: 'requested' | 'in_transit' | 'confirmed' | 'disputed';
  at: string;
  executedAt?: string;
  confirmedAt?: string;
  confirmedBy?: ID;
  receivedAmount?: number;
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
}
export interface Request {
  id: ID;
  type: 'sync' | 'void' | 'damage' | 'difference' | 'unpaid' | 'courtesy_excess';
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
  by: ID;
  closedAt?: string;
  priorDifference?: number;
}
export interface Bag {
  id: ID;
  flavorId: ID;
  ounces: number;
  openedAt: string;
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
  | 'record_paper'
  | 'cancel_order'
  | 'report_damage'
  | 'explain_difference'
  | 'request_courtesy_excess'
  | 'refund_order'
  | 'initialize_stock'
  | 'save_flavor'
  | 'save_size'
  | 'configure'
  | 'request_shift'
  | 'authorize_shift'
  | 'count'
  | 'start_audit'
  | 'finish_audit'
  | 'create_order'
  | 'update_order'
  | 'taste'
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
