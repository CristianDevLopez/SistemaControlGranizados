const DAY = 86400000;
const dayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const businessDay = (at: string | Date = new Date()) => dayFormatter.format(new Date(at));
export const addDays = (day: string, count: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + count * DAY).toISOString().slice(0, 10);

export function rangeError({ from, to }: { from: string; to: string }) {
  const valid = (day: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(`${day}T12:00:00Z`)) &&
    new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
  if (!valid(from) || !valid(to)) return 'Selecciona una fecha inicial y una fecha final válidas.';
  if (from > to) return 'La fecha inicial debe ser anterior o igual a la fecha final.';
  return '';
}
