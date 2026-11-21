import { useState } from 'react';
import { businessDay, periodStart } from '../domain/business-date.ts';
import { visibleCounts } from '../domain/closing-archive.ts';
import { articles, compensatedInventory, countHasDifferences } from '../domain/engine.ts';
import { useApp } from '../lib/store.tsx';
import { Empty, Panel, date, money } from './components.tsx';

export function MermaReport({ onTurn }: { onTurn: (id: string) => void }) {
  const { state, profiles } = useApp().data!;
  const [period, setPeriod] = useState('week');
  const [day, setDay] = useState(businessDay());
  const [article, setArticle] = useState('');
  const catalog = articles(state);
  const counts = visibleCounts(state).filter(
    (count) => periodStart(businessDay(count.cutoffAt ?? count.at), period) === periodStart(day, period),
  );
  const countIds = new Set(counts.map((count) => count.id));
  const rows = new Map<
    string,
    {
      shortage: number;
      surplus: number;
      matchedShortage: number;
      matchedSurplus: number;
      matchedBoth: number;
      cost: number;
      sale: number;
    }
  >();
  for (const count of counts) {
    for (const [key, entry] of Object.entries(count.inventoryDifferences ?? {})) {
      if (article && key !== article) continue;
      const row = rows.get(key) ?? {
        shortage: 0,
        surplus: 0,
        matchedShortage: 0,
        matchedSurplus: 0,
        matchedBoth: 0,
        cost: 0,
        sale: 0,
      };
      const matched = compensatedInventory(state, count, key);
      const net = entry.quantity - Math.sign(entry.quantity) * matched;
      if (entry.quantity < 0) {
        row.shortage -= entry.quantity;
        row.matchedShortage += matched;
      } else {
        row.surplus += entry.quantity;
        row.matchedSurplus += matched;
        row.matchedBoth += (entry.compensation ?? []).reduce(
          (sum, item) => sum + (countIds.has(item.countId) ? item.quantity : 0),
          0,
        );
      }
      row.cost += net * entry.unitCost;
      row.sale += net * entry.saleValue;
      rows.set(key, row);
    }
  }
  const shifts = state.shifts.filter((shift) =>
    counts.some(
      (count) =>
        count.shiftId === shift.id && (article ? !!count.differences?.[article] : countHasDifferences(count)),
    ),
  );
  return (
    <Panel title="Reporte de mermas">
      <div className="table-toolbar">
        <label>
          Período{' '}
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="day">Día</option>
            <option value="week">Semana</option>
            <option value="fortnight">Quincena</option>
            <option value="month">Mes</option>
          </select>
        </label>
        <input
          aria-label="Fecha del reporte"
          type="date"
          value={day}
          onChange={(e) => e.target.value && setDay(e.target.value)}
        />
        <label>
          Artículo{' '}
          <select value={article} onChange={(e) => setArticle(e.target.value)}>
            <option value="">Todos</option>
            {catalog.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows.size ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Artículo</th>
                <th>Faltantes</th>
                <th>Sobrantes</th>
                <th>Compensados</th>
                <th>Neto</th>
                <th>Costo de compra neto</th>
                <th>Valor de venta neto</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].map(([key, row]) => (
                <tr key={key}>
                  <th scope="row">{catalog.find((item) => item.id === key)?.name ?? key}</th>
                  <td>{row.shortage}</td>
                  <td>{row.surplus}</td>
                  <td>{row.matchedShortage + row.matchedSurplus - row.matchedBoth}</td>
                  <td>{row.surplus - row.matchedSurplus - row.shortage + row.matchedShortage}</td>
                  <td>{money(row.cost)}</td>
                  <td>{money(row.sale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Sin mermas conciliadas en este período" />
      )}
      <h3>Turnos con diferencias</h3>
      {shifts.length ? (
        <ul>
          {shifts.map((shift) => (
            <li key={shift.id}>
              <button className="text-button" onClick={() => onTurn(shift.id)}>
                {date(shift.closedAt ?? shift.openedAt ?? shift.requestedAt)} ·{' '}
                {profiles.find((item) => item.id === shift.cashierId)?.name ?? 'Usuario archivado'} · Ver sin
                mover inventario ni plata
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Sin turnos con diferencias" />
      )}
    </Panel>
  );
}
