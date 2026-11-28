import type { State } from './types.ts';
import { candies } from './v4-catalog.ts';

const catalog = [
  ['bolsa-cierre', 'Bolsa cierre', 'paquete'],
  ['bolsa-t25', 'Bolsa T25', 'paquete'],
  ['papel-chicle', 'Papel chicle', 'paquete'],
  ['pitillo-cuchara', 'Pitillo cuchara', 'bolsa'],
  ['bombones', 'Bombones', 'bolsa'],
  ['minichicles', 'Minichicles', 'bolsa'],
  ['gomas-gusanitos', 'Gomas gusanitos', 'bolsa'],
  ['cintas', 'Cintas', 'rollo'],
  ['bolsas-basura-grandes', 'Bolsas de basura grandes', 'paquete'],
  ['rollos-basura', 'Rollos sin abrir de bolsas de basura', 'rollo'],
  ['rollos-papeleras', 'Rollos sin abrir de bolsas papeleras', 'rollo'],
] as const;

export function supplies(state: State) {
  const result = catalog.map(([key, name, defaultUnit]) => {
    const id = `supply:${key}`;
    const config = state.settings[0].supplies?.[id];
    const candy = state.settings[0].v4Enabled ? candies(state).find((c) => c.id === id) : undefined;
    return {
      id,
      name: candy?.name ?? name,
      unit: candy?.unit ?? config?.unit ?? defaultUnit,
      initialized: candy ? true : config?.initialized === true,
    };
  });
  if (state.settings[0].v4Enabled)
    for (const candy of candies(state))
      if (!result.some((s) => s.id === candy.id))
        result.push({ id: candy.id, name: candy.name, unit: candy.unit, initialized: true });
  return result;
}
