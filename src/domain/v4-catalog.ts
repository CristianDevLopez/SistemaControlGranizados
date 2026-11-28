import type { Coupon, Promotion, State } from './types.ts';
import type { Candy, ExpenseCategory } from './v4-types.ts';

export const verificationText = 'Verifica que la persona nos sigue en Instagram o en nuestras redes.';
export const defaultCandies: Candy[] = [
  { id: 'supply:gomas-gusanitos', name: 'Gusanitos', unit: 'unidades', perBag: 100, cost: 0 },
  { id: 'supply:cintas', name: 'Cintas', unit: 'unidades', perBag: 520, cost: 0 },
  { id: 'supply:bombones', name: 'Bombones', unit: 'unidades', perBag: 48, cost: 0 },
  { id: 'supply:minichicles', name: 'Minichicles', unit: 'oz', perBag: 35, cost: 0 },
];
export const defaultCategories: ExpenseCategory[] = [
  ...['Vasos y desechables', 'Líquido', 'Coronitas', 'Dulces', 'Pitillos', 'Empaques'].map((name) => ({
    name,
    group: 'Mercancía e insumos',
    nature: 'Costo' as const,
    behavior: 'Variable' as const,
  })),
  ...[
    'Flete Medellín–Tarazá',
    'Transporte desde la Central Mayorista',
    'Cargue y descargue',
    'Otros de logística',
  ].map((name) => ({ name, group: 'Logística', nature: 'Costo' as const, behavior: 'Variable' as const })),
  { name: 'Personal fijo (salario)', group: 'Personal', nature: 'Costo', behavior: 'Fijo' },
  { name: 'Personal por días (apoyo)', group: 'Personal', nature: 'Costo', behavior: 'Variable' },
  ...['Luz', 'Agua'].map((name) => ({
    name,
    group: 'Servicios',
    nature: 'Costo' as const,
    behavior: 'Variable' as const,
  })),
  ...['Arriendo', 'Internet'].map((name) => ({
    name,
    group: 'Local',
    nature: 'Gasto' as const,
    behavior: 'Fijo' as const,
  })),
  ...['Aseo', 'Mantenimiento'].map((name) => ({
    name,
    group: 'Operación',
    nature: 'Gasto' as const,
    behavior: 'Variable' as const,
  })),
  ...['Contador', 'Mensualidad de la app'].map((name) => ({
    name,
    group: 'Administración',
    nature: 'Gasto' as const,
    behavior: 'Fijo' as const,
  })),
  ...['Publicidad', 'Impresos', 'Premios'].map((name) => ({
    name,
    group: 'Mercadeo',
    nature: 'Gasto' as const,
    behavior: 'Variable' as const,
  })),
  { name: 'Viáticos', group: 'Viáticos', nature: 'Gasto', behavior: 'Variable', adminOnly: true },
  { name: 'Otros', group: 'Otros', nature: 'Gasto', behavior: 'Variable' },
];
export const candies = (state: State) => state.settings[0].v4?.candies ?? defaultCandies;
export const expenseCategories = (state: State) =>
  state.settings[0].v4?.expenseCategories ?? defaultCategories;
export function promotionMessage(p: Promotion, coupon: Coupon, state: State) {
  const flavors =
    !p.flavorIds.length || state.flavors.filter((f) => f.active).every((f) => p.flavorIds.includes(f.id))
      ? 'Todos los sabores'
      : p.flavorIds.map((id) => state.flavors.find((f) => f.id === id)?.name ?? 'Sabor').join(', ');
  const sizes =
    !p.sizeIds.length || state.sizes.filter((s) => s.active).every((s) => p.sizeIds.includes(s.id))
      ? 'todos los tamaños'
      : p.sizeIds.map((id) => state.sizes.find((s) => s.id === id)?.name ?? 'Tamaño').join(', ');
  const suggested =
    p.courtesyOnly || p.effect === 'free'
      ? '🎉 ¡Felicidades! Te regalamos un granizado en Dexter’s. Muéstranos este código y escoge tu sabor favorito 🍧'
      : p.versus
        ? '⚔ ' +
          state.flavors.find((f) => f.id === p.versus!.a)?.name +
          ' vs ' +
          state.flavors.find((f) => f.id === p.versus!.b)?.name +
          ': pide uno de los dos y disfruta el beneficio.'
        : p.effect === 'nxm'
          ? '👯 Trae a tus amigos: llevan ' + p.take + ' granizados y pagan ' + p.pay + '.'
          : p.effect === 'upgrade'
            ? '⬆ Pide tu granizado y te lo damos un tamaño más grande.'
            : 'Disfruta nuestro precio especial en Dexter’s.';
  const schedule =
    (p.limitedSchedule ?? (p.days.length > 0 || p.startTime !== '00:00' || p.endTime !== '23:59'))
      ? ' · ' + p.startTime + '–' + p.endTime + ' Colombia'
      : '';
  return (
    (p.shareText?.trim() || suggested) +
    '\nCódigo: ' +
    coupon.code +
    '\n' +
    flavors +
    ' · ' +
    sizes +
    schedule +
    ' · Vence ' +
    new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short' }).format(
      new Date(coupon.expiresAt),
    ) +
    '. Un solo uso. No canjeable por dinero.'
  );
}
export function candyRecipe(state: State, sizeId: string): Record<string, number> {
  const configured = state.settings[0].v4?.recipes?.[sizeId];
  if (configured) return configured;
  const size = state.sizes.find((s) => s.id === sizeId);
  const cooler = size?.cups === 0;
  return {
    'supply:minichicles': cooler ? 6 : (size?.ounces ?? 0) >= 24 ? 2 : 1,
    'supply:gomas-gusanitos': cooler ? 12 : (size?.ounces ?? 0) >= 20 ? 3 : 2,
    'supply:cintas': cooler ? 6 : 1,
    'supply:bombones': cooler ? 6 : 1,
  };
}
export function additionRecipe(state: State, id: string): Record<string, number> {
  return (
    state.settings[0].v4?.additionRecipes?.[id] ??
    (
      {
        cintas: { 'supply:cintas': 1 },
        bonbon: { 'supply:bombones': 1 },
        chicles: { 'supply:minichicles': 1 },
        gomitas: { 'supply:gomas-gusanitos': 2 },
        todos: {
          'supply:bombones': 1,
          'supply:gomas-gusanitos': 2,
          'supply:cintas': 1,
          'supply:minichicles': 1,
        },
      } as Record<string, Record<string, number>>
    )[id] ??
    {}
  );
}
export function componentCost(state: State, article: string, at: string): number | null {
  const candy = candies(state).find((c) => c.id === article);
  const candidates = state.shipments.filter((s) => s.at <= at).sort((a, b) => b.at.localeCompare(a.at));
  for (const shipment of candidates) {
    const direct = shipment.items.find((i) => i.article === article);
    if (direct) return direct.unitCost / (candy?.perBag ?? 1);
    if (article.startsWith('cup:')) {
      const pack = shipment.items.find((i) => i.article === article.replace('cup:', 'package:'));
      if (pack) return pack.unitCost / state.settings[0].cupPackageUnits;
    }
    if (article.startsWith('liquid:')) {
      const bag = shipment.items.find((i) => i.article === article.replace('liquid:', 'sealed_bag:'));
      if (bag) return bag.unitCost / state.settings[0].bagOunces;
    }
  }
  return candy?.cost ? candy.cost / candy.perBag : null;
}
export function logistics(state: State) {
  const allocations = new Map<string, number>();
  let undistributed = 0;
  for (const expense of state.expenses.filter(
    (e) => e.status === 'approved' && e.classification?.group === 'Logística',
  )) {
    const ids = [...new Set(expense.shipmentIds ?? (expense.shipmentId ? [expense.shipmentId] : []))];
    const weights = ids.map((id) => {
      const shipment = state.shipments.find((s) => s.id === id);
      return {
        id,
        value: state.receipts
          .filter((r) => r.shipmentId === id)
          .reduce(
            (sum, r) =>
              sum +
              Object.entries(r.items).reduce(
                (n, [article, total]) =>
                  n +
                  Math.max(0, total - (r.damaged[article] ?? 0) + (r.reviewed?.[article]?.good ?? 0)) *
                    (shipment?.items.find((i) => i.article === article)?.unitCost ?? 0),
                0,
              ),
            0,
          ),
      };
    });
    const total = weights.reduce((n, w) => n + w.value, 0);
    if (!total) {
      undistributed += expense.amount;
      continue;
    }
    let remaining = expense.amount;
    const positive = weights.filter((w) => w.value > 0);
    positive.forEach((w, index) => {
      const share =
        index === positive.length - 1 ? remaining : Math.round((expense.amount * w.value) / total);
      remaining -= share;
      allocations.set(w.id, (allocations.get(w.id) ?? 0) + share);
    });
  }
  return { allocations, undistributed };
}
