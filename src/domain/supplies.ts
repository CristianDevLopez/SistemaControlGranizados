import type { State } from './types.ts';

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
  return catalog.map(([key, name, defaultUnit]) => {
    const id = `supply:${key}`;
    const config = state.settings[0].supplies?.[id];
    return { id, name, unit: config?.unit ?? defaultUnit, initialized: config?.initialized === true };
  });
}
