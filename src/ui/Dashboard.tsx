import { useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Download, TrendingUp, ShoppingBag, Receipt, CupSoda } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { csv, downloadFile } from '../lib/export.ts';
import {
  businessDay,
  dashboardData,
  periodRange,
  rangeError,
  type DashboardPeriod,
} from '../domain/dashboard.ts';
import { Badge, Empty, Panel, Stat, date, money, stateNames } from './components.tsx';

const number = (value: number) => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(value);
const dayLabel = (key: string) =>
  new Intl.DateTimeFormat('es-CO', {
    day: key.length === 10 ? 'numeric' : undefined,
    month: 'short',
    year: key.length === 7 ? 'numeric' : undefined,
    timeZone: 'America/Bogota',
  }).format(new Date(`${key.length === 7 ? `${key}-01` : key}T12:00:00Z`));
function Change({ current, previous, disabled }: { current: number; previous: number; disabled: boolean }) {
  if (disabled)
    return <small className="dashboard-change">Comparación disponible para todos los turnos</small>;
  if (!previous)
    return (
      <small className="dashboard-change">
        {current ? 'Sin base en el periodo anterior' : 'Sin actividad en ambos periodos'}
      </small>
    );
  const change = ((current - previous) / previous) * 100;
  return (
    <small className={`dashboard-change ${change > 0 ? 'up' : change < 0 ? 'down' : ''}`}>
      {change > 0 ? '+' : ''}
      {number(change)} % vs. periodo anterior
    </small>
  );
}

export function Dashboard() {
  const app = useApp(),
    { state, profiles } = app.data!;
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const [range, setRange] = useState(() => periodRange('month'));
  const [shiftId, setShiftId] = useState('');
  const [showTable, setShowTable] = useState(false);
  const [metric, setMetric] = useState<'amount' | 'tickets' | 'units'>('amount');
  const error = rangeError(range);
  const data = useMemo(
    () => (error ? null : dashboardData(state, { ...range, shiftId })),
    [state, range, shiftId, error],
  );
  const name = (id?: string) => profiles.find((p) => p.id === id)?.name ?? 'Usuario archivado';
  const availableShifts = state.shifts
    .filter(
      (s) =>
        s.openedAt &&
        (!range.to || businessDay(s.openedAt) <= range.to) &&
        (!s.closedAt || !range.from || businessDay(s.closedAt) >= range.from),
    )
    .sort((a, b) => b.openedAt!.localeCompare(a.openedAt!));
  const selectPeriod = (value: DashboardPeriod) => {
    setPeriod(value);
    setShiftId('');
    if (value !== 'custom') setRange(periodRange(value));
  };
  const changeRange = (key: 'from' | 'to', value: string) => {
    setPeriod('custom');
    setShiftId('');
    setRange((r) => ({ ...r, [key]: value }));
  };
  const exportData = () => {
    if (!data) return;
    const rows: Record<string, unknown>[] = [];
    const add = (section: string, indicator: string, value: string | number) =>
      rows.push({
        Desde: range.from,
        Hasta: range.to,
        Local: app.data?.branch?.name ?? '',
        Turno: shiftId || 'Todos',
        Seccion: section,
        Indicador: indicator,
        Valor: value,
      });
    for (const [label, value] of [
      ['Ventas netas COP', data.amount],
      ['Tickets', data.tickets],
      ['Unidades', data.units],
      ['Ticket promedio COP', data.average],
      ['Descuentos COP', data.discounts],
      ['Costo de promociones COP', data.promotionCost],
      ['Costo de cortesías COP', data.courtesyCost],
      ['Devoluciones COP', data.refunds],
      ['Gastos aprobados COP', data.expenses],
      ['Anulaciones', data.voided],
      ['Entregado sin pagar COP', data.unpaid],
    ] as const)
      add('Resumen', label, value);
    data.series.forEach((s) =>
      rows.push({
        Desde: range.from,
        Hasta: range.to,
        Turno: shiftId || 'Todos',
        Seccion: 'Evolución',
        Fecha: s.key,
        Ventas_COP: s.amount,
        Tickets: s.tickets,
        Unidades: s.units,
      }),
    );
    data.shifts.forEach((s) =>
      rows.push({
        Seccion: 'Turnos',
        Turno: s.id,
        Apertura: s.shift?.openedAt,
        Responsable: name(s.shift?.cashierId),
        Ventas_COP: s.amount,
        Tickets: s.tickets,
        Unidades: s.units,
      }),
    );
    data.products.forEach((p) =>
      rows.push({
        Seccion: 'Productos',
        Producto: p.name,
        Tamaño: p.size,
        Ventas_COP: p.amount,
        Unidades: p.units,
      }),
    );
    data.methods.forEach((m) => add('Ventas por medio de pago', m.name, m.amount));
    for (const [label, values] of [
      ['Tamaño', data.breakdown.sizes],
      ['Sabor', data.breakdown.flavors],
      ['Con o sin licor', data.breakdown.alcohol],
    ] as const) {
      values.forEach((value) =>
        rows.push({ Seccion: label, Producto: value.name, Ventas_COP: value.amount, Unidades: value.units }),
      );
    }
    downloadFile(
      new TextEncoder().encode(csv(rows)).buffer,
      `dexter-dashboard-${range.from}-${range.to}.csv`,
      'text/csv;charset=utf-8',
    );
  };
  const max = data ? Math.max(1, ...data.series.map((p) => p[metric])) : 1;
  const peak = data?.hours.reduce((a, b) => (b.tickets > a.tickets ? b : a));
  const best = data?.series.reduce((a, b) => (b.amount > a.amount ? b : a));
  return (
    <div className="page-stack dashboard">
      <div className="page-toolbar">
        <div>
          <h2>El pulso de tu negocio</h2>
          <p>Ventas, devoluciones y avance de metas del local.</p>
        </div>
        <button className="button secondary" disabled={!data} onClick={exportData}>
          <Download size={17} /> Exportar ventas
        </button>
      </div>
      <section className="panel dashboard-filters" aria-label="Filtros del dashboard">
        <div className="dashboard-filter-title">
          <CalendarDays size={18} />
          <strong>Periodo de consulta</strong>
          <Badge tone="green">{app.data?.branch?.name ?? 'Local actual'}</Badge>
        </div>
        <div className="dashboard-presets" role="group" aria-label="Periodos rápidos">
          {(
            [
              ['today', 'Hoy'],
              ['week', 'Esta semana'],
              ['month', 'Este mes'],
              ['year', 'Este año'],
              ['custom', 'Personalizado'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={period === id}
              className={period === id ? 'selected' : ''}
              onClick={() => selectPeriod(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="dashboard-filter-grid">
          <label>
            Mes
            <input
              type="month"
              value={
                period === 'custom' && range.from.slice(0, 7) !== range.to.slice(0, 7)
                  ? ''
                  : range.from.slice(0, 7)
              }
              onChange={(e) => {
                const month = e.target.value;
                if (!month) return;
                const [year, m] = month.split('-').map(Number);
                const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
                setRange({ from: `${month}-01`, to: `${month}-${lastDay}` });
                setPeriod('custom');
                setShiftId('');
              }}
            />
          </label>
          <label>
            Desde
            <input type="date" value={range.from} onChange={(e) => changeRange('from', e.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={range.to} onChange={(e) => changeRange('to', e.target.value)} />
          </label>
          <label>
            Turno
            <select aria-label="Turno" value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
              <option value="">Todos los turnos</option>
              {availableShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {date(s.openedAt!)} · {name(s.cashierId)} · {stateNames[s.status]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="dashboard-caption">
          Fechas inclusivas · Hora de Colombia · Cambia el local desde «Local de trabajo».
        </p>
      </section>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {data && (
        <>
          <div className="dashboard-context">
            <span>
              <span className="status-dot green" />
              {dayLabel(range.from)} — {dayLabel(range.to)} ·{' '}
              {shiftId ? 'Un turno seleccionado' : 'Todos los turnos'}
            </span>
            <span>
              {!app.online || app.pending.length
                ? 'Datos locales; revisa los pendientes de sincronización.'
                : app.lastSync
                  ? `Actualizado ${date(app.lastSync)}`
                  : 'Según la información cargada del local'}
            </span>
          </div>
          <div className="stats-grid dashboard-kpis" aria-live="polite">
            {[
              {
                label: 'Ventas netas',
                value: money(data.amount),
                current: data.amount,
                previous: data.previous.amount,
                icon: TrendingUp,
              },
              {
                label: 'Tickets cobrados',
                value: number(data.tickets),
                current: data.tickets,
                previous: data.previous.tickets,
                icon: Receipt,
              },
              {
                label: 'Ticket promedio',
                value: money(data.average),
                current: data.average,
                previous: data.previous.average,
                icon: ShoppingBag,
              },
              {
                label: 'Unidades vendidas',
                value: number(data.units),
                current: data.units,
                previous: data.previous.units,
                icon: CupSoda,
              },
            ].map((k) => (
              <article className="stat dashboard-kpi" key={k.label}>
                <span>
                  {k.label}
                  <k.icon size={18} />
                </span>
                <strong>{k.value}</strong>
                <Change current={k.current} previous={k.previous} disabled={!!shiftId} />
              </article>
            ))}
          </div>
          {!shiftId && (
            <p className="dashboard-caption">
              Comparación con {data.previousFrom} a {data.previousTo}, el mismo número de días. Si el periodo
              incluye hoy, la jornada está en curso.
            </p>
          )}
          {!data.tickets && (
            <div className="notice info" role="status">
              No hay ventas cobradas vigentes en este periodo. Prueba otro mes o turno; los movimientos de
              dinero se muestran por separado.
            </div>
          )}
          <div className="dashboard-main-grid">
            <Panel
              title="Evolución de ventas"
              className="dashboard-evolution"
              action={
                <select
                  aria-label="Indicador del gráfico"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as typeof metric)}
                >
                  <option value="amount">Ventas en COP</option>
                  <option value="tickets">Tickets</option>
                  <option value="units">Unidades</option>
                </select>
              }
            >
              <div className="dashboard-chart-head">
                <span>
                  {data.monthly ? 'Por mes' : 'Por día'} · {data.series.length}{' '}
                  {data.monthly ? 'meses' : 'días'}
                </span>
                <button
                  className="text-button"
                  onClick={() => setShowTable(!showTable)}
                  aria-expanded={showTable}
                >
                  {showTable ? 'Ocultar tabla' : 'Ver tabla de datos'}
                </button>
              </div>
              <div
                className="dashboard-chart"
                role="img"
                aria-label={`Evolución ${data.monthly ? 'mensual' : 'diaria'} de ${metric === 'amount' ? 'ventas en pesos' : metric === 'tickets' ? 'tickets' : 'unidades'}. Los valores exactos están disponibles en la tabla de datos.`}
              >
                <div className="dashboard-chart-scale">
                  <span>
                    {metric === 'amount'
                      ? money(max === 1 && !data.amount ? 0 : max)
                      : number(max === 1 && !data.tickets ? 0 : max)}
                  </span>
                  <span>0</span>
                </div>
                <div className="dashboard-bars">
                  {data.series.map((p, index) => (
                    <div className="dashboard-bar-column" key={p.key}>
                      <div className="dashboard-bar-track">
                        <div className="dashboard-bar" style={{ height: `${(p[metric] / max) * 100}%` }}>
                          <span className="dashboard-bar-tooltip">
                            {dayLabel(p.key)}: {metric === 'amount' ? money(p.amount) : number(p[metric])}
                          </span>
                        </div>
                      </div>
                      <span className="dashboard-bar-label">
                        {index === 0 ||
                        index === data.series.length - 1 ||
                        (index % Math.ceil(data.series.length / 7) === 0 &&
                          index < data.series.length - Math.ceil(data.series.length / 7))
                          ? dayLabel(p.key)
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {showTable && (
                <div className="table-wrap">
                  <table>
                    <caption className="dashboard-table-caption">
                      Ventas por {data.monthly ? 'mes' : 'día'}
                    </caption>
                    <thead>
                      <tr>
                        <th>Periodo</th>
                        <th>Ventas netas</th>
                        <th>Tickets</th>
                        <th>Unidades</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.series.map((p) => (
                        <tr key={p.key}>
                          <td>{p.key}</td>
                          <td>{money(p.amount)}</td>
                          <td>{p.tickets}</td>
                          <td>{p.units}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="dashboard-highlights">
                <div>
                  <small>Mejor {data.monthly ? 'mes' : 'día'}</small>
                  <strong>{best?.amount ? dayLabel(best.key) : 'Sin ventas'}</strong>
                  <span>{money(best?.amount ?? 0)}</span>
                </div>
                <div>
                  <small>Hora con más tickets</small>
                  <strong>
                    {peak?.tickets
                      ? `${String(peak.hour).padStart(2, '0')}:00–${String(peak.hour).padStart(2, '0')}:59`
                      : 'Sin ventas'}
                  </strong>
                  <span>{peak?.tickets ?? 0} tickets · Hora de cobro</span>
                </div>
              </div>
            </Panel>
            <Panel title="Dinero del periodo">
              <div className="dashboard-finance">
                <h3 className="dashboard-payment-heading">Ventas netas por medio de pago</h3>
                {data.methods.map((m) => (
                  <div className="dashboard-finance-row" key={m.key}>
                    <span>{m.name}</span>
                    <strong>{money(m.amount)}</strong>
                  </div>
                ))}
                <div className="dashboard-finance-row">
                  <span>Devoluciones realizadas</span>
                  <strong>{money(data.refunds)}</strong>
                </div>
                <div className="dashboard-finance-row">
                  <span>Gastos aprobados</span>
                  <strong>{money(data.expenses)}</strong>
                </div>
                <p className="dashboard-caption">
                  Las devoluciones figuran en la fecha en que se registraron. Los gastos incluyen compras y
                  pagos desde todas las fuentes.
                </p>
              </div>
            </Panel>
          </div>
          <div className="dashboard-secondary-grid">
            <Panel title="Productos más vendidos" action={<Badge>Por unidades</Badge>}>
              {data.products.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto / tamaño</th>
                        <th>Unidades</th>
                        <th>Ventas netas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.products.slice(0, 10).map((p, i) => (
                        <tr key={p.key}>
                          <td>
                            <div className="dashboard-product">
                              <span>{i + 1}</span>
                              <div>
                                <strong>{p.name}</strong>
                                <small>{p.size}</small>
                                <progress
                                  aria-label={`Participación de ${p.name}, ${p.size}`}
                                  value={p.units}
                                  max={data.units || 1}
                                />
                              </div>
                            </div>
                          </td>
                          <td>{p.units}</td>
                          <td>{money(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title="Aún no hay productos vendidos"
                  description="Aquí verás los sabores, mezclas y tamaños que más se venden."
                />
              )}
            </Panel>
            <Panel title="Seguimiento de la operación">
              <div className="dashboard-operation">
                <Stat
                  label="Costo de promociones"
                  value={money(data.promotionCost)}
                  note="Descuento sobre el precio de lista"
                />
                <Stat label="Costo de cortesías" value={money(data.courtesyCost)} note="Valor no cobrado" />
                <Stat label="Tickets anulados" value={data.voided} note="Según fecha del cobro original" />
                <Stat label="Pedidos abiertos" value={data.open} note="Creados en el periodo" />
                <Stat label="Entregado sin pagar" value={money(data.unpaid)} note="Incidentes del periodo" />
              </div>
              {!!data.pendingVoids && (
                <p className="dashboard-caption dashboard-pending">
                  {data.pendingVoids} anulaciones pendientes de aprobación; siguen incluidas en las ventas.
                </p>
              )}
            </Panel>
          </div>
          <Panel title="Ventas por promoción">
            {data.promotions.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Promoción</th>
                      <th>Pedidos</th>
                      <th>Vasos</th>
                      <th>Descuento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.promotions.map((item) => (
                      <tr key={item.id}>
                        <th scope="row">{item.name}</th>
                        <td>{item.orders}</td>
                        <td>{item.cups}</td>
                        <td>{money(item.discount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Sin promociones aplicadas en este período" />
            )}
          </Panel>
          <Panel title="Ventas por tamaño, sabor y licor">
            {data.tickets ? (
              <div className="dashboard-goals">
                {(
                  [
                    ['Tamaño', data.breakdown.sizes],
                    ['Sabor', data.breakdown.flavors],
                    ['Con o sin licor', data.breakdown.alcohol],
                  ] as const
                ).map(([label, values]) => (
                  <details key={label} open>
                    <summary>{label}</summary>
                    {label === 'Sabor' && (
                      <p className="dashboard-table-caption">
                        Las mezclas reparten unidades y valor por igual entre sus sabores.
                      </p>
                    )}
                    <div className="table-wrap">
                      <table aria-label={`Ventas · ${label}`}>
                        <thead>
                          <tr>
                            <th>{label}</th>
                            <th>Unidades</th>
                            <th>Ventas netas</th>
                          </tr>
                        </thead>
                        <tbody>
                          {values.map((value) => (
                            <tr key={value.key}>
                              <td>{value.name}</td>
                              <td>{number(value.units)}</td>
                              <td>{money(value.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <Empty title="Sin ventas en este periodo" />
            )}
          </Panel>
          <Panel title="Resultados por turno" action={<Badge>{data.shifts.length} turnos</Badge>}>
            {!!data.shifts.length && (
              <p className="dashboard-table-caption">
                Ventas cobradas dentro del rango seleccionado. Los turnos que cruzan medianoche pueden
                aparecer parcialmente.
              </p>
            )}
            {data.shifts.length ? (
              <div className="table-wrap">
                <table aria-label="Resultados por turno">
                  <thead>
                    <tr>
                      <th>Apertura / responsable</th>
                      <th>Estado</th>
                      <th>Ventas netas</th>
                      <th>Tickets</th>
                      <th>Ticket promedio</th>
                      <th>Unidades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.shifts.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.shift?.openedAt ? date(s.shift.openedAt) : 'Turno archivado'}</strong>
                          <small>{name(s.shift?.cashierId)}</small>
                        </td>
                        <td>
                          <Badge tone={s.shift?.status === 'open' ? 'green' : 'neutral'}>
                            {stateNames[s.shift?.status ?? ''] ?? 'Archivado'}
                          </Badge>
                        </td>
                        <td>{money(s.amount)}</td>
                        <td>{s.tickets}</td>
                        <td>{money(s.average)}</td>
                        <td>{s.units}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="Sin turnos en este periodo" />
            )}
          </Panel>
          <Panel title="Avance de metas" action={<BarChart3 size={18} />}>
            {data.goals.length ? (
              <div className="dashboard-goals">
                {data.goals.map((g) => (
                  <article key={g.id}>
                    <Badge>{g.period === 'month' ? 'Mensual' : 'Semanal'}</Badge>
                    <h3>
                      {date(g.startsAt)} — {date(g.endsAt)}
                    </h3>
                    <p>Resultado del periodo completo de la meta, hasta los datos disponibles.</p>
                    {g.amount > 0 && (
                      <>
                        <div className="dashboard-finance-row">
                          <span>
                            {money(g.actual.amount)} de {money(g.amount)}
                          </span>
                          <strong>{number((g.actual.amount / g.amount) * 100)} %</strong>
                        </div>
                        <progress
                          aria-label="Avance de meta en pesos"
                          value={Math.min(g.actual.amount, g.amount)}
                          max={g.amount}
                        />
                      </>
                    )}
                    {g.cups > 0 && (
                      <>
                        <div className="dashboard-finance-row">
                          <span>
                            {g.actual.units} de {g.cups} unidades
                          </span>
                          <strong>{number((g.actual.units / g.cups) * 100)} %</strong>
                        </div>
                        <progress
                          aria-label="Avance de meta en unidades"
                          value={Math.min(g.actual.units, g.cups)}
                          max={g.cups}
                        />
                      </>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title={
                  shiftId
                    ? 'Las metas se consultan con todos los turnos'
                    : 'Sin metas configuradas para estas fechas'
                }
                description="Crea metas semanales o mensuales desde Configuración → Metas."
              />
            )}
          </Panel>
          <details className="dashboard-definitions">
            <summary>Cómo se calculan los indicadores</summary>
            <p>
              Ventas netas: total de tickets cobrados vigentes, después de descuentos. Excluye anulados,
              cancelados, pedidos abiertos y entregados sin pagar. Una solicitud de anulación sigue siendo
              venta hasta aprobarse. Las correcciones cuentan una sola vez, con el ticket sustituto y su fecha
              de cobro; las anulaciones posteriores actualizan el histórico.
            </p>
            <p>
              Ticket promedio: ventas netas divididas entre tickets cobrados. Las unidades incluyen productos
              gratuitos en tickets cobrados y cada mezcla cuenta como un solo producto. Los medios de pago
              muestran movimientos netos por su fecha efectiva, incluidas las devoluciones. Los traslados y
              las bases de apertura no son ventas.
            </p>
            <p>
              Los filtros corresponden al local seleccionado y al momento del cobro en Colombia. Las metas
              muestran su periodo completo y solo aparecen con todos los turnos. Los gráficos agrupan por mes
              cuando el rango supera 62 días.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
