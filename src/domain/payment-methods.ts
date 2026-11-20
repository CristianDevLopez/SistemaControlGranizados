import type { MoneyLocation, Payment, PaymentMethod, State } from './types.ts';

/** Los pagos anteriores al soporte de transferencias se registraban en efectivo. */
export const paymentMethod = (payment: Pick<Payment, 'method'>): PaymentMethod => payment.method ?? 'cash';

export function currentPayments(payments: Payment[]): Payment[] {
  const reversed = new Set(payments.flatMap((payment) => (payment.reversesId ? [payment.reversesId] : [])));
  return payments.filter((payment) => !payment.reversesId && !reversed.has(payment.id));
}

export function isNequiAccount(account: MoneyLocation): boolean {
  return /\bnequi\b/i.test(account.bank ?? '') || /\bnequi\b/i.test(account.name);
}

export function transferAccountName(account?: MoneyLocation): string {
  if (!account) return 'Cuenta';
  return isNequiAccount(account) && !/\bnequi\b/i.test(account.name)
    ? `Nequi · ${account.name}`
    : account.name;
}

export function orderPaymentLabels(state: State, orders = state.orders): Record<string, string[]> {
  const accounts = new Map(state.locations.map((account) => [account.id, account]));
  const sourceOrders = new Map(state.orders.map((order) => [order.id, order]));
  const collected = new Map<string, Set<string>>();
  for (const payment of currentPayments(state.payments)) {
    if (payment.amount <= 0) continue;
    const account = payment.accountId ? accounts.get(payment.accountId) : undefined;
    const label =
      paymentMethod(payment) === 'cash'
        ? 'Efectivo'
        : account
          ? `Transferencia · ${transferAccountName(account)}`
          : 'Transferencia';
    const labels = collected.get(payment.orderId) ?? new Set<string>();
    labels.add(label);
    collected.set(payment.orderId, labels);
  }
  return Object.fromEntries(
    orders.flatMap((order) => {
      if (!order.paidAt) return [];
      const labels = new Set(state.orderPaymentMethods?.[order.id]);
      const visited = new Set<string>();
      let sourceId: string | undefined = order.id;
      while (sourceId && !visited.has(sourceId)) {
        visited.add(sourceId);
        for (const label of collected.get(sourceId) ?? []) labels.add(label);
        sourceId = sourceOrders.get(sourceId)?.paymentTransferFromId;
      }
      return labels.size ? [[order.id, [...labels]]] : order.total === 0 ? [[order.id, ['Sin cobro']]] : [];
    }),
  );
}
