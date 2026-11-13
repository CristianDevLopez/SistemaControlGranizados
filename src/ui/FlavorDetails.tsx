import { lineFlavorIds, liquidPortions } from '../domain/flavors.ts';
import type { Flavor, OrderLine, State } from '../domain/types.ts';

export function flavorName(line: Pick<OrderLine, 'flavorId' | 'flavorIds'>, flavors: Flavor[]) {
  return lineFlavorIds(line)
    .map((id) => flavors.find((flavor) => flavor.id === id)?.name ?? 'Sabor')
    .join(' + ');
}

export function FlavorPortions({ line, state }: { line: OrderLine; state: State }) {
  const ids = lineFlavorIds(line);
  if (ids.length < 2) return null;
  const ounces = line.recipe?.ounces ?? state.sizes.find((size) => size.id === line.sizeId)?.ounces ?? 0;
  return (
    <small className="flavor-portions">
      Por vaso:{' '}
      {liquidPortions(line, ounces)
        .map(
          (portion) =>
            `${state.flavors.find((flavor) => flavor.id === portion.flavorId)?.name ?? 'Sabor'}: ${portionLabel(portion.ounces, ids.length)}`,
        )
        .join(' · ')}
    </small>
  );
}

export function portionLabel(ounces: number, count: number) {
  const rounded = Math.round(ounces * 1000) / 1000;
  return `1/${count} · ${Math.abs(rounded - ounces) > 1e-9 ? '≈' : ''}${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(rounded)} oz`;
}
