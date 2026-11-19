import type { Order, State } from './types.ts';
import { addDays, businessDay, rangeError } from './business-date.ts';
export { addDays, businessDay, rangeError } from './business-date.ts';

const DAY = 86400000;
const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Bogota',
  hour: '2-digit',
  hourCycle: 'h23',
});

export type DashboardPeriod = 'today' | 'week' | 'month' | 'year' | 'custom';
export interface DashboardFilter {
  from: string;
  to: string;
  shiftId: string;
}
export function periodRange(period: Exclude<DashboardPeriod, 'custom'>, today = businessDay()) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return {
    from:
      period === 'today'
        ? today
        : period === 'week'
          ? addDays(today, -((weekday + 6) % 7))
          : period === 'month'
            ? `${today.slice(0, 7)}-01`
            : `${today.slice(0, 4)}-01-01`,
    to: today,
  };
}
export const isSale = (o: Order) => !!o.paidAt && (o.status === 'paid' || o.status === 'void_requested');
export interface SalesSummary {
  amount: number;
  tickets: number;
  units: number;
  average: number;
  discounts: number;
}
export function summarizeSales(orders: Order[]): SalesSummary {
  const amount = orders.reduce((n, o) => n + o.total, 0);
  return {
    amount,
    tickets: orders.length,
    units: orders.reduce((n, o) => n + o.lines.reduce((s, l) => s + l.quantity, 0), 0),
    average: orders.length ? amount / orders.length : 0,
    discounts: orders.reduce(
      (n, o) => n + Math.max(0, o.lines.reduce((s, l) => s + l.listPrice * l.quantity, 0) - o.total),
      0,
    ),
  };
}
export function dashboardData(state: State, filter: DashboardFilter) {
  const error = rangeError(filter);
  if (error) throw new Error(error);
  const start = Date.parse(`${filter.from}T00:00:00-05:00`),
    end = Date.parse(`${addDays(filter.to, 1)}T00:00:00-05:00`),
    duration = end - start;
  const inRange = (at: string, a = start, b = end) => {
    const t = Date.parse(at);
    return t >= a && t < b;
  };
  const matchesShift = (shiftId?: string) => !filter.shiftId || shiftId === filter.shiftId;
  const sales = state.orders.filter((o) => isSale(o) && matchesShift(o.shiftId) && inRange(o.paidAt!));
  const previous = summarizeSales(
    state.orders.filter(
      (o) => isSale(o) && matchesShift(o.shiftId) && inRange(o.paidAt!, start - duration, start),
    ),
  );
  const payments = state.payments.filter((p) => matchesShift(p.shiftId) && inRange(p.at));
  const refunds = payments.filter((p) => p.amount < 0).reduce((n, p) => n - p.amount, 0);
  const expenses = state.expenses
    .filter((e) => e.status === 'approved' && matchesShift(e.shiftId) && inRange(e.at))
    .reduce((n, e) => n + e.amount, 0);
  const monthly = duration / DAY > 62;
  const buckets = new Map<string, { key: string; amount: number; tickets: number; units: number }>();
  for (let day = monthly ? `${filter.from.slice(0, 7)}-01` : filter.from; day <= filter.to;) {
    const key = monthly ? day.slice(0, 7) : day;
    buckets.set(key, { key, amount: 0, tickets: 0, units: 0 });
    if (monthly) {
      const next = new Date(`${day}T12:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      day = next.toISOString().slice(0, 10);
    } else day = addDays(day, 1);
  }
  const products = new Map<
    string,
    { key: string; name: string; size: string; units: number; amount: number }
  >();
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, amount: 0, tickets: 0 }));
  const flavorNames = new Map(state.flavors.map((f) => [f.id, f.name]));
  const sizeNames = new Map(state.sizes.map((s) => [s.id, s.name]));
  const shifts = new Map<string, Order[]>();
  for (const o of sales) {
    const key = businessDay(o.paidAt!).slice(0, monthly ? 7 : 10),
      bucket = buckets.get(key)!;
    bucket.amount += o.total;
    bucket.tickets++;
    bucket.units += o.lines.reduce((n, l) => n + l.quantity, 0);
    const hour = Number(hourFormatter.format(new Date(o.paidAt!)));
    hours[hour].amount += o.total;
    hours[hour].tickets++;
    const shiftOrders = shifts.get(o.shiftId) ?? [];
    shiftOrders.push(o);
    shifts.set(o.shiftId, shiftOrders);
    for (const l of o.lines) {
      const flavorIds = [...new Set(l.flavorIds?.length ? l.flavorIds : [l.flavorId])].sort();
      const productKey = JSON.stringify([flavorIds, l.sizeId]);
      const product = products.get(productKey) ?? {
        key: productKey,
        name: flavorIds.map((id) => flavorNames.get(id) ?? 'Sabor archivado').join(' + '),
        size: sizeNames.get(l.sizeId) ?? 'Tamaño archivado',
        units: 0,
        amount: 0,
      };
      product.units += l.quantity;
      product.amount += l.listPrice * l.quantity - l.discount;
      products.set(productKey, product);
    }
  }
  // Incluye turnos sin ventas que estuvieron abiertos dentro del periodo.
  for (const s of state.shifts) {
    if (
      s.openedAt &&
      matchesShift(s.id) &&
      Date.parse(s.openedAt) < end &&
      (!s.closedAt || Date.parse(s.closedAt) >= start) &&
      !shifts.has(s.id)
    )
      shifts.set(s.id, []);
  }
  const methods = [
    {
      key: 'cash',
      name: 'Efectivo',
      amount: payments.filter((p) => !p.method || p.method === 'cash').reduce((n, p) => n + p.amount, 0),
    },
    ...[...new Set(payments.filter((p) => p.method === 'transfer').map((p) => p.accountId))].map((id) => ({
      key: `transfer:${id}`,
      name: state.locations.find((l) => l.id === id)?.name ?? 'Cuenta archivada',
      amount: payments
        .filter((p) => p.method === 'transfer' && p.accountId === id)
        .reduce((n, p) => n + p.amount, 0),
    })),
  ];
  const issues = state.orders.filter((o) => matchesShift(o.shiftId) && inRange(o.paidAt ?? o.createdAt));
  const goals = filter.shiftId
    ? []
    : state.goals
        .filter((g) => Date.parse(g.startsAt) < end && Date.parse(g.endsAt) > start)
        .map((g) => ({
          ...g,
          actual: summarizeSales(
            state.orders.filter(
              (o) => isSale(o) && inRange(o.paidAt!, Date.parse(g.startsAt), Date.parse(g.endsAt)),
            ),
          ),
        }));
  return {
    ...summarizeSales(sales),
    previous,
    previousFrom: businessDay(new Date(start - duration)),
    previousTo: addDays(filter.from, -1),
    series: [...buckets.values()],
    monthly,
    products: [...products.values()].sort((a, b) => b.units - a.units || b.amount - a.amount),
    hours,
    shifts: [...shifts]
      .map(([id, orders]) => ({
        id,
        shift: state.shifts.find((s) => s.id === id),
        ...summarizeSales(orders),
      }))
      .sort((a, b) => (b.shift?.openedAt ?? '').localeCompare(a.shift?.openedAt ?? '')),
    methods,
    refunds,
    expenses,
    receipts: payments.reduce((n, p) => n + p.amount, 0),
    goals,
    voided: issues.filter((o) => o.status === 'voided').length,
    unpaid: issues.filter((o) => o.status === 'unpaid_incident').reduce((n, o) => n + o.total, 0),
    open: issues.filter((o) => o.status === 'open').length,
    pendingVoids: issues.filter((o) => o.status === 'void_requested').length,
  };
}
