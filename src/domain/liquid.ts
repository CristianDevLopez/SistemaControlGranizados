import { orderedFlavors } from './flavors.ts';
import { addDays } from './business-date.ts';
import { fortnight } from './reconciliation.ts';
import type { State } from './types.ts';
export function liquidReconciliation(state: State) {
  return orderedFlavors(state.flavors).map((flavor) => {
    const bags = state.bags.filter((b) => b.flavorId === flavor.id),
      closed = bags.filter((b) => b.exhaustedAt),
      open = bags.filter((b) => !b.exhaustedAt),
      opened = bags.reduce((n, b) => n + b.ounces, 0),
      served = -state.stock
        .filter(
          (m) =>
            m.article === `liquid:${flavor.id}` &&
            ['delivery', 'recipe_correction', 'replacement_delivery', 'void_return'].includes(m.reason),
        )
        .reduce((n, m) => n + m.quantity, 0),
      tastings = state.orders.flatMap((o) => o.tastings).filter((t) => t.flavorId === flavor.id).length,
      approvedWaste = -state.stock
        .filter((m) => m.article === `liquid:${flavor.id}` && m.reason === 'approved_damage')
        .reduce((n, m) => n + m.quantity, 0),
      initial = state.stock
        .filter((m) => m.article === `liquid:${flavor.id}` && m.reason === 'initial')
        .reduce((n, m) => n + m.quantity, 0),
      remaining = initial + opened - served - tastings - approvedWaste;
    // A residual is measurable only after all opened bags of this flavor are exhausted.
    const measurable = closed.length > 0 && open.length === 0,
      unexplained = measurable ? Math.max(0, remaining) : null,
      totalLoss = measurable ? approvedWaste + (unexplained ?? 0) : null,
      ratio = totalLoss === null || initial + opened === 0 ? null : totalLoss / (initial + opened),
      tolerance = state.settings[0].liquidTolerance;
    return {
      flavorId: flavor.id,
      name: flavor.name,
      opened,
      served,
      tastings,
      approvedWaste,
      remaining,
      openBags: open.length,
      closedBags: closed.length,
      unexplained,
      ratio,
      alert: ratio !== null && tolerance !== null && ratio > tolerance,
      baseline: state.settings[0].baseline,
    };
  });
}

export function liquidFortnight(state: State, day: string, now = new Date()) {
  const period = fortnight(day);
  const midnight = (value: string) => Date.parse(`${value}T00:00:00-05:00`);
  const bagAlert = state.settings[0].bagOunces * 0.9;
  const history: ReturnType<typeof fortnight>[] = [];
  let previous = period;
  for (let index = 0; index < 6; index++) {
    previous = fortnight(addDays(previous.from, -1));
    history.push(previous);
  }

  return orderedFlavors(state.flavors).map((flavor) => {
    const bags = state.bags
      .filter((bag) => bag.flavorId === flavor.id)
      .map((bag) => ({
        ounces: bag.ounces,
        opened: Date.parse(bag.openedAt),
        exhausted: bag.exhaustedAt ? Date.parse(bag.exhaustedAt) : Infinity,
      }));
    const movements = state.stock
      .filter((movement) => movement.article === `liquid:${flavor.id}`)
      .map((movement) => ({ ...movement, time: Date.parse(movement.at) }));
    const measure = (start: number, end: number) => {
      const ofPeriod = movements.filter((movement) => movement.time >= start && movement.time < end);
      const sum = (...reasons: string[]) =>
        ofPeriod.reduce((total, move) => total + (reasons.includes(move.reason) ? move.quantity : 0), 0);
      const entered = bags.filter((bag) => bag.opened >= start && bag.opened < end);
      return {
        bagsOpened: entered.length,
        opened: entered.reduce((total, bag) => total + bag.ounces, 0),
        initial: sum('initial'),
        served: 0 - sum('delivery', 'recipe_correction', 'replacement_delivery', 'void_return'),
        tastings: 0 - sum('tasting', 'tasting_correction'),
        waste: 0 - sum('approved_damage'),
      };
    };
    const transitions = new Map<number, number>();
    for (const { opened, exhausted } of bags) {
      transitions.set(opened, (transitions.get(opened) ?? 0) + 1);
      if (Number.isFinite(exhausted)) transitions.set(exhausted, (transitions.get(exhausted) ?? 0) - 1);
    }
    const emptyAt: number[] = [];
    let openBags = 0;
    for (const [at, change] of [...transitions].sort(([a], [b]) => a - b)) {
      openBags += change;
      if (openBags === 0) emptyAt.push(at);
    }
    emptyAt.reverse();
    const boundary = (at: number) => {
      const anchor = emptyAt.find((cutoff) => cutoff < at);
      const flow = measure(anchor ?? -Infinity, at);
      const hasOpenBag = bags.some((bag) => bag.opened < at && bag.exhausted >= at);
      const measured = !hasOpenBag && flow.initial === 0;
      const estimate = flow.initial + flow.opened - flow.served - flow.tastings - flow.waste;
      return { measured, ounces: measured ? 0 : Math.max(0, estimate) };
    };
    const interval = (bounds: ReturnType<typeof fortnight>) => {
      const start = midnight(bounds.from);
      const end = Math.min(midnight(bounds.until), now.getTime());
      const opening = boundary(start);
      const closing = boundary(end);
      const flow = measure(start, end);
      const available = opening.ounces + flow.opened + flow.initial;
      const remaining = available - flow.served - flow.tastings - flow.waste;
      const unexplained = opening.measured && closing.measured ? remaining : null;
      const nearBag = Math.abs(unexplained ?? Math.min(0, remaining)) >= bagAlert;
      const ratio =
        unexplained !== null && unexplained >= -0.01 && available > 0
          ? (flow.waste + Math.max(0, unexplained)) / available
          : null;
      return { ...flow, opening, closing, unexplained, ratio, available, nearBag };
    };
    const row = interval(period);
    const historical = history.map(interval).filter((entry) => entry.ratio !== null && !entry.nearBag);
    const tolerance =
      state.settings[0].liquidTolerance ??
      (historical.length >= 2
        ? historical.reduce((total, entry) => total + entry.ratio! * entry.available, 0) /
          historical.reduce((total, entry) => total + entry.available, 0)
        : null);
    return {
      ...row,
      flavorId: flavor.id,
      name: flavor.name,
      tolerance,
      aboveTolerance: row.ratio !== null && tolerance !== null && row.ratio > tolerance,
    };
  });
}
