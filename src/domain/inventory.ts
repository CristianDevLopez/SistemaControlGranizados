import { stockBalances } from './engine.ts';
import { inRehearsalPeriod } from './closing-archive.ts';
import { DEFAULT_LIQUID_BAG_WINDOW } from './initial.ts';
import type { Shift, State, StockMovement } from './types.ts';

export function inventoryOpenings(state: State, shift?: Shift) {
  const belongsTo = (opening: { shiftId?: string; openedAt: string }, target: Shift) =>
    opening.shiftId
      ? opening.shiftId === target.id
      : !!target.openedAt &&
        Date.parse(opening.openedAt) >= Date.parse(target.openedAt) &&
        (!target.closedAt || Date.parse(opening.openedAt) <= Date.parse(target.closedAt));
  const byId = new Map(state.shifts.map((item) => [item.id, item]));
  return [
    ...state.bags.map((bag) => ({
      ...bag,
      article: state.flavors.find((flavor) => flavor.id === bag.flavorId)?.name ?? bag.flavorId,
      kind: 'Bolsa' as const,
    })),
    ...state.packages.map((pack) => ({
      ...pack,
      article: state.sizes.find((size) => size.id === pack.sizeId)?.name ?? pack.sizeId,
      kind: 'Paquete' as const,
    })),
  ]
    .filter((opening) => !shift || belongsTo(opening, shift))
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))
    .map((opening) => ({
      ...opening,
      shift: opening.shiftId
        ? byId.get(opening.shiftId)
        : state.shifts.find((candidate) => belongsTo(opening, candidate)),
    }));
}

const roundOunces = (amount: number) => Math.round(amount * 1_000_000) / 1_000_000;

function liquidFlow(movements: StockMovement[], start: number, end = Infinity) {
  let served = 0;
  let tastings = 0;
  let approvedWaste = 0;
  let adjustment = 0;
  for (const movement of movements) {
    const time = Date.parse(movement.at);
    if (time < start || time >= end) continue;
    switch (movement.reason) {
      case 'delivery':
      case 'recipe_correction':
      case 'replacement_delivery':
        served -= movement.quantity;
        break;
      case 'tasting':
      case 'tasting_correction':
        tastings -= movement.quantity;
        break;
      case 'approved_damage':
        approvedWaste -= movement.quantity;
        break;
      case 'initial':
      case 'receipt':
      case 'inventory_correction':
      case 'void_return':
        adjustment += movement.quantity;
        break;
    }
  }
  return { served, tastings, approvedWaste, adjustment };
}

function balance(ounces: number, flow: ReturnType<typeof liquidFlow>) {
  return roundOunces(ounces + flow.adjustment - flow.served - flow.tastings - flow.approvedWaste);
}

export function liquidBagInventory(state: State) {
  const settings = state.settings[0];
  const window = settings.liquidBagWindow ?? DEFAULT_LIQUID_BAG_WINDOW;
  const tolerance = settings.liquidTolerance;
  const cutoff = settings.rehearsalBaseline ? Date.parse(settings.rehearsalBaseline.at) : -Infinity;
  const damageDates = new Map(
    state.requests.filter((request) => request.type === 'damage').map((request) => [request.id, request.at]),
  );
  return state.flavors.map((flavor) => {
    const movements = state.stock
      .filter((movement) => movement.article === `liquid:${flavor.id}`)
      .map((movement) =>
        movement.reason === 'approved_damage'
          ? { ...movement, at: damageDates.get(movement.referenceId) ?? movement.at }
          : movement,
      );
    const bags = state.bags
      .filter((bag) => bag.flavorId === flavor.id)
      .sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt))
      .map((bag, index, sorted) => {
        const endsAt = sorted[index + 1]?.openedAt ?? bag.exhaustedAt;
        return { ...bag, start: Date.parse(bag.openedAt), end: endsAt ? Date.parse(endsAt) : Infinity };
      });
    const last = bags.at(-1);
    const finished = bags.filter((bag) => bag.end >= cutoff && Number.isFinite(bag.end));
    const completed = finished.slice(-window).map((bag) => {
      const flow = liquidFlow(movements, bag.start, bag.end);
      return { ...bag, ...flow, difference: balance(bag.ounces, flow) };
    });
    const difference = roundOunces(completed.reduce((total, bag) => total + bag.difference, 0));
    const capacity = completed.reduce((total, bag) => total + bag.ounces, 0);
    const lastTwo = finished.slice(-2).map((bag) => ({
      ounces: bag.ounces,
      difference: balance(bag.ounces, liquidFlow(movements, bag.start, bag.end)),
    }));
    const consecutiveLow =
      tolerance !== null &&
      lastTwo.length === 2 &&
      lastTwo.every((bag) => bag.difference > bag.ounces * tolerance);
    const active = last?.end === Infinity ? last : undefined;
    const startingOunces = active
      ? cutoff > active.start
        ? Math.max(0, balance(active.ounces, liquidFlow(movements, active.start, cutoff)))
        : active.ounces
      : 0;
    const activeFlow = liquidFlow(movements, Math.max(cutoff, active?.start ?? last?.end ?? -Infinity));
    return {
      flavorId: flavor.id,
      name: flavor.name,
      completed,
      difference,
      remaining: balance(startingOunces, activeFlow),
      active,
      activeFlow,
      consecutiveLow,
      lastTwoDifference: roundOunces(lastTwo.reduce((sum, bag) => sum + bag.difference, 0)),
      aboveTolerance: tolerance !== null && difference > capacity * tolerance,
    };
  });
}

export function inventoryDiscrepancies(state: State, liquid = liquidBagInventory(state)) {
  const result: { id: string; article: string; amount: number; unit: string; explanation: string }[] = [];
  for (const row of liquid) {
    const id = `liquid:${row.flavorId}`;
    if (row.remaining < 0)
      result.push({
        id,
        article: row.name,
        amount: row.remaining,
        unit: 'oz',
        explanation: 'Posible bolsa abierta sin registrar. Verifica las bolsas selladas.',
      });
    if (row.difference < 0 || row.aboveTolerance)
      result.push({
        id: `${id}:closed`,
        article: row.name,
        amount: row.difference,
        unit: 'oz',
        explanation:
          row.difference < 0
            ? 'Consumo superior al contenido de las bolsas terminadas. Verifica las bolsas selladas.'
            : 'Posible salida de líquido sin registrar o apertura registrada por error.',
      });
    if (row.consecutiveLow)
      result.push({
        id: `${id}:consecutive`,
        article: row.name,
        amount: row.lastTwoDifference,
        unit: 'oz',
        explanation: 'Dos bolsas seguidas con poco consumo registrado. Verifica las bolsas selladas.',
      });
  }
  const balances = stockBalances(state);
  const cutoff = state.settings[0].rehearsalBaseline?.at;
  for (const size of state.sizes.filter((item) => item.cups > 0)) {
    const id = `cup:${size.id}`;
    const latest = state.packages
      .filter((pack) => pack.sizeId === size.id)
      .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))[0];
    const corrected =
      latest &&
      state.stock.some(
        (item) =>
          item.article === id &&
          item.at >= latest.openedAt &&
          ['inventory_correction', 'audit_adjustment', 'approved_damage'].includes(item.reason),
      );
    const physicalDifference =
      latest && !corrected && (!cutoff || latest.openedAt >= cutoff) ? -(latest.priorDifference ?? 0) : 0;
    const amount = Math.min(balances[id] ?? 0, physicalDifference);
    if (amount < 0)
      result.push({
        id,
        article: `Vasos sueltos · ${size.name}`,
        amount,
        unit: 'vasos',
        explanation: 'Posible paquete abierto sin registrar o vasos usados sin venta.',
      });
  }
  return result;
}

export function inventoryDiscrepanciesAt(state: State, at: string) {
  if (inRehearsalPeriod(state, at)) return undefined;
  const cutoff = Date.parse(at);
  return inventoryDiscrepancies({
    ...state,
    stock: state.stock.filter((move) => Date.parse(move.at) <= cutoff),
    packages: state.packages.filter((pack) => Date.parse(pack.openedAt) <= cutoff),
    bags: state.bags
      .filter((bag) => Date.parse(bag.openedAt) <= cutoff)
      .map((bag) =>
        bag.exhaustedAt && Date.parse(bag.exhaustedAt) > cutoff ? { ...bag, exhaustedAt: undefined } : bag,
      ),
  });
}
