import { rangeError } from '../domain/business-date.ts';
import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { exportZip, downloadFile } from '../lib/export.ts';
import { inRehearsalPeriod } from '../domain/closing-archive.ts';
import { Badge, Empty, Panel, date } from './components.tsx';

export function AdminRecords() {
  const app = useApp();
  const { state, actor, profiles } = app.data!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  if (actor.role !== 'admin') return null;
  const notifications = state.notifications.filter((item) => !inRehearsalPeriod(state, item.at));
  return (
    <>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <details>
        <summary>Exportación, avisos y auditoría</summary>
        <div className="form-grid">
          <label className="field">
            Desde (Colombia)
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            Hasta (Colombia)
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if ((from || to) && rangeError({ from, to })) throw new Error(rangeError({ from, to }));
              const payload = await api('export');
              downloadFile(
                new Uint8Array(exportZip(payload, from && to ? { from, to } : undefined)).buffer,
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
          {notifications.length ? (
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
                  {[...notifications]
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
                            {n.status === 'sent'
                              ? 'Enviado'
                              : n.status === 'failed'
                                ? 'Fallido'
                                : 'Pendiente'}
                          </Badge>
                          <small>{n.attempts} intentos</small>
                          {n.status === 'failed' && (
                            <button
                              className="text-button"
                              onClick={async () => {
                                await api('notifications/retry', { id: n.id });
                                await app.load();
                              }}
                            >
                              Reintentar aviso
                            </button>
                          )}
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
      </details>
    </>
  );
}
