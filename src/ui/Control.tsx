import { useState } from 'react';
import { Download, RefreshCw, ShieldCheck, AlertTriangle, Check } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { exportZip, downloadFile } from '../lib/export.ts';
import { articles, countHasDifferences, stockBalances } from '../domain/engine.ts';
import { Badge, Empty, Panel, Stat, date, money, stateNames, Modal, FieldsForm } from './components.tsx';
import { EvidenceButton } from './Purchasing.tsx';
export function Control() {
  const app = useApp(),
    { state, actor, profiles } = app.data!,
    [filter, setFilter] = useState('pending'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [reconcile, setReconcile] = useState<{ requestId: string; approve: boolean } | null>(null);
  const pending = state.requests.filter((r) => r.status === 'pending'),
    stock = stockBalances(state),
    negative = Object.entries(stock).filter(([, v]) => v < 0);
  const labels: Record<string, string> = {
    void: 'Anulación',
    damage: 'Daño / desperdicio',
    difference: 'Explicación de diferencia',
    unpaid: 'Pedido sin pagar',
    courtesy_excess: 'Cortesía adicional',
    sync: 'Conflicto de sincronización',
  };
  const resolve = async (requestId: string, approve: boolean) => {
    if (state.requests.find((r) => r.id === requestId)?.type === 'sync') {
      setReconcile({ requestId, approve });
      return;
    }
    try {
      await app.run('resolve_request', { requestId, approve });
      app.toast(approve ? 'Solicitud aprobada.' : 'Solicitud rechazada.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>Control de la operación</h2>
          <p>Las diferencias ayudan a revisar el proceso. No califican personas.</p>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const payload = await api('export');
              downloadFile(
                new Uint8Array(exportZip(payload)).buffer,
                `dexter-exportacion-${new Date().toISOString().slice(0, 10)}.zip`,
                'application/zip',
              );
              app.toast('Exportación generada con archivos relacionados y diccionario.');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={17} />
          {busy ? 'Preparando…' : 'Exportar información'}
        </button>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="stats-grid">
        <Stat label="Solicitudes pendientes" value={pending.length} />
        <Stat label="Artículos con saldo negativo" value={negative.length} />
        <Stat
          label="Movimientos en tránsito"
          value={state.transfers.filter((x) => x.status === 'in_transit').length}
        />
        <Stat label="Configuración vigente" value={`v${state.settings[0].version}`} />
      </div>
      <Panel
        title="Solicitudes de revisión"
        action={
          <select aria-label="Filtrar solicitudes" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="pending">Pendientes</option>
            <option value="all">Todas</option>
          </select>
        }
      >
        {state.requests.filter((x) => filter === 'all' || x.status === 'pending').length ? (
          <div className="requests-list">
            {[...state.requests]
              .reverse()
              .filter((x) => filter === 'all' || x.status === 'pending')
              .map((r) => {
                const sale = state.orders.find((o) => o.id === r.referenceId),
                  own =
                    (r.type === 'void' && (sale?.sellerId === actor.id || sale?.cashierId === actor.id)) ||
                    (r.type === 'courtesy_excess' && r.by === actor.id);
                return (
                  <article className="request-card" key={r.id}>
                    <div className="request-head">
                      <div>
                        <Badge
                          tone={
                            r.status === 'pending' ? 'orange' : r.status === 'approved' ? 'green' : 'neutral'
                          }
                        >
                          {stateNames[r.status]}
                        </Badge>
                        <h3>{labels[r.type] ?? r.type}</h3>
                      </div>
                      <small>{date(r.at)}</small>
                    </div>
                    <p>{r.notes}</p>
                    {r.article && (
                      <p>
                        <strong>
                          {articles(state).find((x) => x.id === r.article)?.name} · {r.quantity}
                        </strong>
                      </p>
                    )}
                    {r.diagnosis && <p>Diagnóstico: {r.diagnosis}</p>}
                    {sale && (
                      <p>
                        Pedido #{sale.number} · {money(sale.total)}
                      </p>
                    )}
                    <div className="request-footer">
                      <small>Reporta: {profiles.find((x) => x.id === r.by)?.name}</small>
                      <div className="button-row">
                        {r.evidenceId && <EvidenceButton id={r.evidenceId} />}{' '}
                        {r.status === 'pending' && !own && (
                          <>
                            <button
                              className="button small secondary"
                              onClick={() => void resolve(r.id, false)}
                            >
                              Rechazar
                            </button>
                            <button className="button small primary" onClick={() => void resolve(r.id, true)}>
                              <Check size={14} />
                              Aprobar
                            </button>
                          </>
                        )}
                        {r.status === 'pending' && own && <small>Debe revisarla otro admin</small>}
                      </div>
                    </div>
                  </article>
                );
              })}
          </div>
        ) : (
          <Empty
            title="Sin solicitudes pendientes"
            description="Las anulaciones, daños y diferencias que requieran revisión aparecerán aquí."
          />
        )}
      </Panel>
      <Panel title="Diferencias para revisar">
        {negative.length || state.counts.some(countHasDifferences) ? (
          <div className="anomaly-grid">
            {negative.map(([article, amount]) => (
              <div className="anomaly" key={article}>
                <AlertTriangle size={18} />
                <div>
                  <strong>{articles(state).find((x) => x.id === article)?.name}</strong>
                  <p>
                    Saldo teórico:{' '}
                    {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(amount)}. Revisar
                    entradas, entregas y pérdidas registradas.
                  </p>
                </div>
              </div>
            ))}
            {state.counts.filter(countHasDifferences).map((c) => (
              <div className="anomaly" key={c.id}>
                <AlertTriangle size={18} />
                <div>
                  <strong>Diferencias de conteo · {date(c.at)}</strong>
                  {!!c.difference && (
                    <p>
                      {money(c.difference ?? 0)} en el conteo original. Las explicaciones y aprobaciones se
                      consultan por separado.
                    </p>
                  )}
                  {Object.entries(c.paymentDifferences ?? {})
                    .filter(([, amount]) => amount !== 0)
                    .map(([key, amount]) => (
                      <p key={key}>
                        {c.paymentLabels?.[key] ?? key}: {money(amount)}
                      </p>
                    ))}
                  {Object.entries(c.differences ?? {})
                    .filter(([, amount]) => amount !== 0)
                    .map(([key, amount]) => (
                      <p key={key}>
                        {articles(state).find((a) => a.id === key)?.name ?? key}: {amount} unidades
                      </p>
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Sin diferencias registradas" />
        )}
      </Panel>
      <Panel
        title="Avisos a administradores"
        action={
          <button
            className="text-button"
            onClick={async () => {
              try {
                await api('notifications/retry', {});
                app.toast('Reintento solicitado.');
              } catch (e) {
                app.toast((e as Error).message);
              }
            }}
          >
            <RefreshCw size={15} />
            Reintentar
          </button>
        }
      >
        {state.notifications.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Aviso</th>
                  <th>Canal</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {[...state.notifications]
                  .reverse()
                  .slice(0, 100)
                  .map((n) => (
                    <tr key={n.id}>
                      <td>
                        {n.text}
                        <small>{date(n.at)}</small>
                        {n.lastError && <small>{n.lastError}</small>}
                      </td>
                      <td>{n.channel}</td>
                      <td>
                        <Badge tone={n.status === 'sent' ? 'green' : 'orange'}>
                          {n.status === 'sent' ? 'Enviado' : 'Pendiente'}
                        </Badge>
                        <small>{n.attempts} intentos</small>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Sin avisos por enviar" />
        )}
      </Panel>
      <Panel title="Rastro de auditoría">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Momento</th>
                <th>Acción</th>
                <th>Usuario</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {[...state.audit]
                .reverse()
                .slice(0, 150)
                .map((a) => (
                  <tr key={a.id}>
                    <td>{date(a.at)}</td>
                    <td>{a.action}</td>
                    <td>{profiles.find((x) => x.id === a.by)?.name}</td>
                    <td>{a.detail}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {reconcile && (
        <Modal title="Conciliar operación pendiente" onClose={() => setReconcile(null)}>
          <p className="modal-intro">
            Conserva el registro original. Si ocurrió una venta real, ingresa primero el pedido desde la
            planilla y vincúlalo aquí. Si el registro es incorrecto o repetido, explica por qué se descarta.
          </p>
          <FieldsForm
            fields={[
              {
                name: 'resolutionNotes',
                label: 'Explicación y verificación realizada',
                type: 'textarea',
                required: true,
              },
              ...(reconcile.approve
                ? [
                    {
                      name: 'resolutionId',
                      label: 'Registro correcto que sustituye esta operación',
                      type: 'select' as const,
                      required: true,
                      options: [
                        ...state.orders.map((o) => ({
                          value: o.id,
                          label: `Pedido #${o.number} · ${money(o.total)}`,
                        })),
                        ...state.counts.map((c) => ({ value: c.id, label: `Conteo · ${date(c.at)}` })),
                        ...state.expenses.map((e) => ({
                          value: e.id,
                          label: `Gasto · ${e.category} · ${money(e.amount)}`,
                        })),
                        ...state.transfers.map((t) => ({
                          value: t.id,
                          label: `Movimiento · ${money(t.amount)} · ${date(t.at)}`,
                        })),
                        ...state.receipts.map((r) => ({ value: r.id, label: `Recepción · ${date(r.at)}` })),
                      ],
                    },
                  ]
                : []),
            ]}
            onCancel={() => setReconcile(null)}
            submit={reconcile.approve ? 'Vincular y conciliar' : 'Descartar con explicación'}
            onSubmit={async (v) => {
              await app.run('resolve_request', { ...reconcile, ...v });
              setReconcile(null);
              app.toast('Conciliación registrada. La caja podrá continuar la sincronización.');
            }}
          />
        </Modal>
      )}
    </div>
  );
}
