import { businessDay, rangeError } from '../domain/business-date.ts';
import { hasAlcohol, lineFlavorIds } from '../domain/flavors.ts';
import { isSale, salePayments } from '../domain/payment-methods.ts';
import { componentCost, logistics } from '../domain/v4-catalog.ts';
import { lineTotal } from '../domain/pricing.ts';
import type { State } from '../domain/types.ts';

export interface ExportRange {
  from: string;
  to: string;
}
export function colombiaDate(at: string) {
  return (
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Bogota',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .format(new Date(at))
      .replace(' ', 'T') + '-05:00'
  );
}
export function localDates(row: Record<string, unknown>) {
  return {
    ...row,
    ...Object.fromEntries(
      Object.entries(row)
        .filter(
          ([, v]) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)),
        )
        .map(([key, value]) => [key + 'Colombia', colombiaDate(value as string)]),
    ),
  };
}
export function exportRange(state: State, range?: ExportRange): State {
  if (!range) return state;
  const error = rangeError(range);
  if (error) throw new Error(error);
  const inside = (at: string | undefined) =>
    !!at && businessDay(at) >= range.from && businessDay(at) <= range.to;
  const selected = { ...state };
  for (const key of [
    'orders',
    'payments',
    'deliveries',
    'stock',
    'counts',
    'receipts',
    'expenses',
    'transfers',
    'requests',
    'audit',
    'notifications',
    'packages',
    'bags',
  ] as const) {
    const rows = (state[key] as unknown as Record<string, unknown>[]).filter((row) =>
      inside((row.paidAt ?? row.at ?? row.openedAt ?? row.createdAt) as string | undefined),
    );
    Object.assign(selected, { [key]: rows });
  }
  const shipmentIds = new Set([
    ...selected.receipts.map((r) => r.shipmentId),
    ...selected.expenses.flatMap((e) => e.shipmentIds ?? (e.shipmentId ? [e.shipmentId] : [])),
  ]);
  selected.shipments = state.shipments.filter((s) => inside(s.at) || shipmentIds.has(s.id));
  const orderIds = new Set([
    ...selected.orders.map((o) => o.id),
    ...selected.payments.map((p) => p.orderId),
    ...selected.deliveries.map((d) => d.orderId),
  ]);
  for (const order of state.orders)
    if (orderIds.has(order.id) && order.replacesId) orderIds.add(order.replacesId);
  selected.orders = state.orders.filter((o) => orderIds.has(o.id));
  const shifts = new Set([
    ...selected.orders.map((o) => o.shiftId),
    ...selected.counts.flatMap((c) => (c.shiftId ? [c.shiftId] : [])),
    ...selected.expenses.flatMap((e) => (e.shiftId ? [e.shiftId] : [])),
  ]);
  selected.shifts = state.shifts.filter((s) => inside(s.openedAt ?? s.requestedAt) || shifts.has(s.id));
  return selected;
}
export function salesDetail(state: State, range?: ExportRange) {
  const inside = (at: string) => !range || (businessDay(at) >= range.from && businessDay(at) <= range.to);
  return state.orders
    .filter((o) => isSale(o) && inside(o.paidAt!))
    .flatMap((order) => {
      const count = order.lines.reduce((n, l) => n + l.quantity, 0),
        lineSum = order.lines.reduce((n, l) => n + lineTotal(l), 0);
      const additions = order.total - lineSum;
      const additionCost = !order.additions?.length
        ? 0
        : order.additionConsumption
          ? Object.entries(order.additionConsumption).reduce<number | null>((sum, [id, q]) => {
              const unit = order.componentCosts
                ? (order.componentCosts[id] ?? null)
                : componentCost(state, id, order.paidAt!);
              return sum === null || unit === null ? null : sum + q * unit;
            }, 0)
          : null;
      let ordinal = 0;
      const payments = salePayments(state, [order]);
      const methods = [
        ...new Set(
          payments.map((p) =>
            (p.method ?? 'cash') === 'cash'
              ? 'Efectivo'
              : (state.locations.find((l) => l.id === p.accountId)?.name ?? 'Transferencia'),
          ),
        ),
      ].join(' + ');
      return order.lines.flatMap((line) => {
        const rules = (line.appliedRules ?? []).flatMap((rule) =>
          Array.from({ length: rule.quantity }, () => ({
            price: rule.unitAmount,
            promotion: rule.promotion.name,
          })),
        );
        const net = lineTotal(line),
          size = state.sizes.find((s) => s.id === line.sizeId),
          flavors = lineFlavorIds(line);
        const cost = (article: string) =>
          order.componentCosts
            ? (order.componentCosts[article] ?? null)
            : componentCost(state, article, order.paidAt!);
        const cup = cost(size?.cups ? 'cup:' + line.sizeId : 'nevera');
        const liquid = flavors.map((id) => cost('liquid:' + id));
        const liquidCost = liquid.some((c) => c === null)
          ? null
          : liquid.reduce<number>(
              (n, c) => n + ((c ?? 0) * (line.recipe?.ounces ?? size?.ounces ?? 0)) / flavors.length,
              0,
            );
        const beer =
          hasAlcohol(line, state.flavors) && (line.recipe?.beers ?? size?.beers ?? 0) > 0
            ? cost('coronita')
            : 0;
        const recipe = line.candyRecipe;
        const candyCost = recipe
          ? Object.entries(recipe).reduce<number | null>(
              (sum, [id, q]) => (sum === null || cost(id) === null ? null : sum + q * cost(id)!),
              0,
            )
          : null;
        return Array.from({ length: line.quantity }, (_, index) => {
          const prices = [
            ...rules.map((r) => r.price),
            ...Array(Math.max(0, line.quantity - rules.length)).fill(line.listPrice),
          ];
          const valid = prices.reduce((n, p) => n + p, 0) === net;
          const charged = valid
            ? prices[index]
            : Math.floor(net / line.quantity) + (index < net % line.quantity ? 1 : 0);
          const extra = Math.floor(additions / count) + (ordinal < additions % count ? 1 : 0);
          ordinal++;
          const known = cup !== null && liquidCost !== null && beer !== null && candyCost !== null;
          const componentTotal = known
            ? cup + liquidCost + beer * (line.recipe?.beers ?? size?.beers ?? 0) + candyCost
            : null;
          return {
            fecha_hora_colombia: colombiaDate(order.paidAt!),
            fecha_hora_utc: order.paidAt,
            numero_pedido: order.number,
            pedido_id: order.id,
            turno: order.shiftId,
            tamano: size?.name ?? line.sizeId,
            sabores: line.bomba
              ? 'Bomba'
              : flavors.map((id) => state.flavors.find((f) => f.id === id)?.name ?? id).join(' + '),
            con_licor: hasAlcohol(line, state.flavors),
            precio_normal: line.listPrice,
            descuento: line.listPrice - charged,
            promocion: rules[index]?.promotion ?? '',
            precio_producto: charged,
            adiciones_asignadas: extra,
            precio_cobrado: charged + extra,
            medio_pago: methods,
            agregada_en_cierre: !!order.addedAtClosing,
            costo_vaso: cup,
            costo_liquido: liquidCost,
            costo_coronitas: beer === null ? null : beer * (line.recipe?.beers ?? size?.beers ?? 0),
            costo_dulces: candyCost,
            costos_por_componente: JSON.stringify(
              Object.fromEntries([
                ['vaso', cup],
                ...flavors.map((id) => ['onza:' + id, cost('liquid:' + id)]),
                ...Object.keys(recipe ?? {}).map((id) => [id, cost(id)]),
              ]),
            ),
            costo_adiciones_asignado: additionCost === null ? null : additionCost / count,
            costo_total:
              componentTotal === null || additionCost === null ? null : componentTotal + additionCost / count,
            costos_historicos_faltantes: !known || additionCost === null,
            margen_producto: componentTotal === null ? null : charged - componentTotal,
            margen_cobrado:
              componentTotal === null || additionCost === null
                ? null
                : charged + extra - componentTotal - additionCost / count,
          };
        });
      });
    });
}
export function v4ExportRows(state: State, range?: ExportRange) {
  const selected = exportRange(state, range),
    allocation = logistics(state);
  return {
    ventas_detalle: salesDetail(state, range),
    mermas: selected.requests
      .filter((r) => r.merma && !r.merma.superseded)
      .map((r) => ({
        id: r.id,
        fecha_utc: r.at,
        fecha_colombia: colombiaDate(r.at),
        ...r.merma,
        costo: r.merma!.quantity * r.merma!.unitCost,
        recuperado: r.merma!.recoveries.reduce((n, x) => n + x.amount, 0),
        perdida_neta:
          r.merma!.quantity * r.merma!.unitCost - r.merma!.recoveries.reduce((n, x) => n + x.amount, 0),
      })),
    conciliaciones: state.requests.flatMap((r) =>
      (r.merma?.recoveries ?? [])
        .filter((x) => !range || (businessDay(x.at) >= range.from && businessDay(x.at) <= range.to))
        .map((x) => ({ merma_id: r.id, ...localDates(x) })),
    ),
    gastos_clasificados: selected.expenses.map((e) => ({
      ...localDates(e as unknown as Record<string, unknown>),
      grupo: e.classification?.group,
      categoria: e.classification?.name ?? e.category,
      costo_o_gasto: e.classification?.nature,
      fijo_o_variable: e.classification?.behavior,
      envios: e.shipmentIds ?? (e.shipmentId ? [e.shipmentId] : []),
    })),
    recepciones_detalle: selected.receipts.flatMap((r) =>
      Object.entries(r.items).map(([article, n]) => ({
        recepcion: r.id,
        envio: r.shipmentId,
        articulo: article,
        llegaron_bien: n - (r.damaged[article] ?? 0),
        danados: r.damaged[article] ?? 0,
        faltante: r.missing?.[article],
        revisado: r.reviewed?.[article],
        fecha_colombia: colombiaDate(r.at),
        fecha_utc: r.at,
      })),
    ),
    logistica: selected.shipments.map((s) => ({
      envio: s.id,
      fecha_utc: s.at,
      fecha_colombia: colombiaDate(s.at),
      logistica: allocation.allocations.get(s.id) ?? 0,
    })),
  };
}
