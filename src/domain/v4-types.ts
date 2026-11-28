import type { Bag, Count, ID, Order, Package, Payment, StockMovement } from './types.ts';

export interface Candy {
  id: string;
  name: string;
  unit: 'unidades' | 'oz' | 'g';
  perBag: number;
  cost: number;
}
export interface ExpenseCategory {
  name: string;
  group: string;
  nature: 'Costo' | 'Gasto';
  behavior: 'Fijo' | 'Variable';
  adminOnly?: boolean;
}
export interface V4Settings {
  candyConvertedAt?: string;
  candies?: Candy[];
  recipes?: Record<ID, Record<string, number>>;
  additionRecipes?: Record<string, Record<string, number>>;
  candyTolerance?: number;
  lowStockDays?: number;
  lossDays?: number;
  expenseCategories?: ExpenseCategory[];
  expensesMigratedAt?: string;
  telegram?: {
    groups: { id: string; name: string; chatId: string }[];
    rules: Record<string, { enabled: boolean; groupId: string }>;
    dailyTime: string;
  };
}
export interface Merma {
  costMissing?: boolean;
  superseded?: boolean;
  type: 'Cierre' | 'Transporte' | 'Daños' | 'Dulces';
  article: string;
  quantity: number;
  unitCost: number;
  saleValue: number;
  shiftId?: ID;
  receiptId?: ID;
  orderId?: ID;
  sourceId: ID;
  state: 'open' | 'partial' | 'reconciled' | 'lost';
  emptyCup?: boolean;
  components?: Record<string, number>;
  recoveries: {
    id: ID;
    by: ID;
    at: string;
    kind: string;
    quantity: number;
    amount: number;
    notes: string;
    from?: string;
  }[];
  history: { by: ID; at: string; notes: string }[];
}
export interface ClosingProposal {
  corrections: Record<string, unknown>[];
  commandId: ID;
  openingIds: ID[];
  id: ID;
  version: number;
  by: ID;
  at: string;
  notes: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: ID;
  reviewedAt?: string;
  reviewNotes?: string;
  count: Count;
  employeeCountId: ID;
  stockIds: ID[];
  orderIds: ID[];
  paymentIds: ID[];
  before: { orders: Order[]; payments: Payment[]; stock: StockMovement[]; packages: Package[]; bags: Bag[] };
  expected: { cash: number; items: Record<string, number> };
  adjust: boolean;
}
