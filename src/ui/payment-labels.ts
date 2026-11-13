import type { MoneyLocation, Payment } from '../domain/types.ts';

export function isNequiAccount(account: MoneyLocation): boolean {
  return /\bnequi\b/i.test(account.bank ?? '') || /\bnequi\b/i.test(account.name);
}

export function transferAccountName(account?: MoneyLocation): string {
  if (!account) return 'Cuenta';
  return isNequiAccount(account) && !/\bnequi\b/i.test(account.name)
    ? `Nequi · ${account.name}`
    : account.name;
}

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
