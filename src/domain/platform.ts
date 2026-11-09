import type { Profile, Role } from './types.ts';

export type BranchStatus = 'requested' | 'active' | 'suspended' | 'archived';
export interface Business {
  id: string;
  name: string;
  ownerId: string | null;
}
export interface Branch {
  id: string;
  legacy?: boolean;
  businessId: string;
  businessName: string;
  name: string;
  address: string;
  city: string;
  status: BranchStatus;
  monthlyFee: number | null;
  billingStart: string | null;
  role: Role;
  isOwner: boolean;
}
export interface Access {
  developer: boolean;
  legacyBranchId: string;
  businesses: Business[];
  branches: Branch[];
}
export interface Invoice {
  id: string;
  branchId: string;
  period: string;
  amount: number;
  paid: number;
  dueDate: string;
  voided: boolean;
  voidReason: string | null;
}
export interface SubscriptionPayment {
  id: string;
  invoiceId: string;
  amount: number;
  paidAt: string;
  reference: string;
  by: string;
}
export interface PlatformView extends Access {
  owners: Profile[];
  invoices: Invoice[];
  payments: SubscriptionPayment[];
}
export const branchStatusLabels: Record<BranchStatus, string> = {
  requested: 'Pendiente de activación',
  active: 'Activo',
  suspended: 'Suspendido',
  archived: 'Archivado',
};
