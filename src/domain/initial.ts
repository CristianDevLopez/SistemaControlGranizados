import { COLLECTIONS, type State, type Size, type Settings } from './types.ts';
export const SETTINGS_ID = '00000000-0000-4000-8000-000000000001';
export function initialState(): State {
  const s = Object.fromEntries(COLLECTIONS.map((k) => [k, []])) as unknown as State;
  const settings: Settings = {
    id: SETTINGS_ID,
    version: 1,
    cashLimit: 500000,
    expenseLimit: 30000,
    expenseCategories: ['Insumos', 'Transporte', 'Aseo', 'Mantenimiento'],
    courtesyQuota: 3,
    cupPackageUnits: 20,
    bagOunces: 202.884136,
    liquidTolerance: null,
    syncWarningMinutes: 120,
    skipOpeningCount: false,
    baseline: true,
    businessName: 'Dexter’s Granizados',
    lastRetainedCash: null,
    lastCountId: null,
  };
  s.settings = [settings];
  s.sizes = [12, 16, 20, 24].map((oz, i): Size => ({
    id: `00000000-0000-4000-8000-${String(oz).padStart(12, '0')}`,
    name: `${oz} oz`,
    ounces: oz,
    alcoholPrice: [14000, 17000, 19500, 23000][i],
    plainPrice: [10000, 12000, 14500, 17000][i],
    cups: 1,
    beers: 0,
    active: true,
    rank: i,
  }));
  s.sizes.push({
    id: '00000000-0000-4000-8000-000000003000',
    name: 'Nevera 3 litros',
    ounces: 0,
    alcoholPrice: null,
    plainPrice: null,
    cups: 0,
    beers: 2,
    active: false,
    rank: 4,
  });
  return s;
}
