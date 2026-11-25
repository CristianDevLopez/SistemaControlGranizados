import type { Flavor, OrderLine } from './types.ts';

type FlavorSelection = Pick<OrderLine, 'flavorId' | 'flavorIds'>;

const catalog = [
  'manzana-verde',
  'fresa-boom',
  'mango-biche',
  'maracumango',
  'santorini',
  'perla-negra',
  'ojo-de-diablo',
  'cool-blue',
  'smirnoff',
  'red-fantasy',
];

function flavorSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '-');
}

export function catalogFlavorPhoto(name: string) {
  const slug = flavorSlug(name);
  return catalog.includes(slug) ? `/flavors/${slug}.webp` : undefined;
}

export function orderedFlavors<T extends Pick<Flavor, 'name'>>(flavors: T[]) {
  const rank = (name: string) => {
    const index = catalog.indexOf(flavorSlug(name));
    return index === -1 ? catalog.length : index;
  };
  return [...flavors].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'es'));
}

export function lineFlavorIds(line: FlavorSelection): string[] {
  return line.flavorIds?.length ? line.flavorIds : [line.flavorId];
}

export function sameFlavors(a: FlavorSelection, b: FlavorSelection): boolean {
  const left = [...lineFlavorIds(a)].sort(),
    right = [...lineFlavorIds(b)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function hasAlcohol(line: FlavorSelection, flavors: Flavor[]): boolean {
  return lineFlavorIds(line).some((id) => flavors.some((flavor) => flavor.id === id && flavor.alcohol));
}

/** No redondear el consumo: el último sabor absorbe únicamente el residuo de coma flotante. */
export function liquidPortions(line: FlavorSelection, ounces: number) {
  const ids = lineFlavorIds(line),
    share = ounces / ids.length;
  return ids.map((flavorId, index) => ({
    flavorId,
    ounces: index === ids.length - 1 ? ounces - share * index : share,
  }));
}
