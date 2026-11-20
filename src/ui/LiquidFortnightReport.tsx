import { useMemo, useState } from 'react';
import { addDays, businessDay } from '../domain/business-date.ts';
import { liquidFortnight } from '../domain/liquid.ts';
import { fortnight } from '../domain/reconciliation.ts';
import type { State } from '../domain/types.ts';
import { Badge, Empty } from './components.tsx';

const format = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const ounces = (amount: number) => `${format.format(amount)} oz`;
const percent = (amount: number) => `${format.format(amount * 100)} %`;

export function LiquidFortnightReport({ state }: { state: State }) {
  const today = businessDay();
  const [day, setDay] = useState(today);
  const { from, until } = fortnight(day);
  const rows = useMemo(
    () =>
      liquidFortnight(state, day).filter(
        (row) =>
          row.available ||
          row.served ||
          row.tastings ||
          row.waste ||
          !row.opening.measured ||
          !row.closing.measured,
      ),
    [state, day],
  );
  const configured = state.settings[0].liquidTolerance !== null;
  return (
    <div className="inventory-fortnight">
      <label className="field">
        <span>Fecha de la quincena</span>
        <input
          type="date"
          value={day}
          max={today}
          onChange={(event) => event.target.value && setDay(event.target.value)}
        />
      </label>
      <p>
        {from} a {addDays(until, -1)}. Las onzas servidas incluyen ventas, cortesías y otras entregas
        registradas. El saldo estimado indica que hay líquido pendiente de verificar al corte.
      </p>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sabor</th>
                <th>Saldo al inicio</th>
                <th>Bolsas abiertas</th>
                <th>Onzas servidas</th>
                <th>Merma aprobada</th>
                <th>Saldo al corte</th>
                <th>Diferencia y tolerancia</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.flavorId}>
                  <td>{row.name}</td>
                  <td>
                    {ounces(row.opening.ounces)}
                    {!row.opening.measured && <small>Estimado</small>}
                    {row.initial !== 0 && <small>Inventario inicial del periodo {ounces(row.initial)}</small>}
                  </td>
                  <td>
                    {row.bagsOpened}
                    <small>{ounces(row.opened)}</small>
                  </td>
                  <td>
                    {ounces(row.served)}
                    {!!row.tastings && <small>Degustaciones registradas {ounces(row.tastings)}</small>}
                  </td>
                  <td>{ounces(row.waste)}</td>
                  <td>
                    {ounces(row.closing.ounces)}
                    {!row.closing.measured && <small>Estimado</small>}
                  </td>
                  <td>
                    {row.nearBag && <Badge tone="orange">Revisar apertura o pérdida de bolsa</Badge>}
                    {row.unexplained === null ? (
                      <small>Pendiente de verificar saldos</small>
                    ) : (
                      <small>Diferencia {ounces(row.unexplained)}</small>
                    )}
                    {row.ratio !== null && <small>Merma estimada {percent(row.ratio)}</small>}
                    {row.tolerance === null ? (
                      <small>Sin histórico suficiente para sugerir tolerancia</small>
                    ) : (
                      <small>
                        {configured ? 'Tolerancia configurada' : 'Referencia histórica'}{' '}
                        {percent(row.tolerance)}
                      </small>
                    )}
                    {row.aboveTolerance && !row.nearBag && <Badge tone="orange">Supera tolerancia</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Sin movimientos de líquido en la quincena" />
      )}
    </div>
  );
}
