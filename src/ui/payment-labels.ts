import type { MoneyLocation, Payment } from '../domain/types.ts';
import { isNequiAccount, transferAccountName } from '../domain/payment-methods.ts';
export { isNequiAccount, transferAccountName } from '../domain/payment-methods.ts';

export function paymentNote(
  payment: Pick<Payment, 'method' | 'accountId'>,
  accounts: MoneyLocation[],
): string {
  if (payment.method !== 'transfer') return '';
  const account = accounts.find((account) => account.id === payment.accountId);
  return ` · ${account && isNequiAccount(account) ? 'Nequi' : 'transferencia'}`;
}

export function paymentOptionLabel(account: MoneyLocation, accounts: MoneyLocation[]): string {
  if (isNequiAccount(account))
    return accounts.filter(isNequiAccount).length === 1 ? 'Nequi' : transferAccountName(account);
  return accounts.length === 1 ? 'Transferencia' : account.name;
}
