import type { State } from './types.ts';
export function liquidReconciliation(state: State) {
  return state.flavors.map((flavor) => {
    const bags = state.bags.filter((b) => b.flavorId === flavor.id),
      closed = bags.filter((b) => b.exhaustedAt),
      open = bags.filter((b) => !b.exhaustedAt),
      opened = bags.reduce((n, b) => n + b.ounces, 0),
      served = -state.stock
        .filter(
          (m) => m.article === `liquid:${flavor.id}` && ['delivery', 'recipe_correction'].includes(m.reason),
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
