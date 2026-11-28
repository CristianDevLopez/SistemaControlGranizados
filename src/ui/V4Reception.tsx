import { useState } from 'react';
import { articles } from '../domain/engine.ts';
import { candies } from '../domain/v4-catalog.ts';
import type { Shipment } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { Empty, Modal, Panel, date } from './components.tsx';

type Line = { good: number; damaged: number; missing: 'later' | 'lost'; files: File[] };
export function V4Reception() {
  const app = useApp(),
    { state } = app.data!;
  const [shipment, setShipment] = useState<Shipment>();
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [notes, setNotes] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const names = new Map(
    articles(state).map((a) => [
      a.id,
      a.name + (candies(state).some((c) => c.id === a.id) ? ' (bolsas)' : ''),
    ]),
  );
  const waiting = state.shipments.filter((s) => s.status !== 'received');
  const remaining = (s: Shipment, article: string) =>
    Math.max(
      0,
      (s.items.find((i) => i.article === article)?.quantity ?? 0) -
        state.receipts
          .filter((r) => r.shipmentId === s.id)
          .reduce(
            (n, r) =>
              n +
              (r.items[article] ?? 0) +
              (r.missing?.[article] === 'lost'
                ? Math.max(0, (r.expected?.[article] ?? 0) - (r.items[article] ?? 0))
                : 0),
            0,
          ),
    );
  const change = (id: string, value: Partial<Line>) => {
    setLines((current) => ({ ...current, [id]: { ...current[id], ...value } }));
    setConfirm(false);
  };
  const totals = shipment?.items.reduce(
    (n, i) => ({
      good: n.good + (lines[i.article]?.good ?? 0),
      damaged: n.damaged + (lines[i.article]?.damaged ?? 0),
      missing:
        n.missing +
        Math.max(
          0,
          remaining(shipment, i.article) - (lines[i.article]?.good ?? 0) - (lines[i.article]?.damaged ?? 0),
        ),
    }),
    { good: 0, damaged: 0, missing: 0 },
  );
  return (
    <Panel title="Recibir mercancía">
      {waiting.length ? (
        waiting.map((s) => (
          <div className="list-row" key={s.id}>
            <div>
              <strong>
                {s.from} · {s.items.length} artículos
              </strong>
              <small>Salida {date(s.at)}</small>
            </div>
            <button
              className="button secondary"
              disabled={!app.online}
              onClick={() => {
                setShipment(s);
                setLines(
                  Object.fromEntries(
                    s.items.map((i) => [i.article, { good: 0, damaged: 0, missing: 'later', files: [] }]),
                  ),
                );
                setError('');
                setNotes('');
                setConfirm(false);
              }}
            >
              Recibir
            </button>
          </div>
        ))
      ) : (
        <Empty title="Sin envíos en camino" />
      )}
      {shipment && (
        <Modal title="Recibir mercancía" onClose={() => !busy && setShipment(undefined)}>
          <form
            className="fields-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              if (!confirm) {
                setConfirm(true);
                return;
              }
              setBusy(true);
              try {
                const payload: Record<string, unknown> = {};
                for (const item of shipment.items) {
                  const line = lines[item.article];
                  const photos = [];
                  for (const file of line.files) photos.push(await app.photo(file));
                  payload[item.article] = {
                    good: line.good,
                    damaged: line.damaged,
                    missing: line.missing,
                    photos,
                  };
                }
                await app.sync();
                const result = await app.run('v4', {
                  action: 'receive',
                  shipmentId: shipment.id,
                  lines: payload,
                  notes,
                });
                setShipment(undefined);
                app.toast(result.message);
              } catch (failure) {
                setError((failure as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {shipment.items.map((item) => {
              const id = item.article,
                line = lines[id],
                expected = remaining(shipment, id),
                missing = expected - line.good - line.damaged;
              return (
                <fieldset key={id} disabled={busy}>
                  <legend>
                    {names.get(id) ?? id} · Vienen {expected}
                  </legend>
                  <div className="form-grid">
                    <label className="field">
                      Llegaron bien
                      <input
                        type="number"
                        min="0"
                        max={expected}
                        step="0.001"
                        required
                        value={line.good}
                        onChange={(e) => change(id, { good: Number(e.target.value) })}
                      />
                    </label>
                    <label className="field">
                      Dañados
                      <input
                        type="number"
                        min="0"
                        max={Math.max(0, expected - line.good)}
                        step="0.001"
                        required
                        value={line.damaged}
                        onChange={(e) => change(id, { damaged: Number(e.target.value) })}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => change(id, { good: expected, damaged: 0 })}
                  >
                    = cantidad
                  </button>
                  {line.damaged > 0 && (
                    <label className="field">
                      Fotos del daño
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        required={!line.files.length}
                        onChange={(e) => change(id, { files: [...(e.target.files ?? [])] })}
                      />
                      <small>{line.files.length} fotos seleccionadas</small>
                    </label>
                  )}
                  {missing > 0 && (
                    <label className="field">
                      Faltan {missing}
                      <select
                        value={line.missing}
                        onChange={(e) => change(id, { missing: e.target.value as Line['missing'] })}
                      >
                        <option value="later">Viene después</option>
                        <option value="lost">No llegó</option>
                      </select>
                    </label>
                  )}
                </fieldset>
              );
            })}
            <label className="field">
              Nota
              <textarea
                value={notes}
                required={Object.values(lines).some((l) => l.missing === 'lost')}
                maxLength={1500}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setConfirm(false);
                }}
              />
            </label>
            <p role="status">
              Llegaron bien {totals?.good} · Dañados {totals?.damaged} · Faltan {totals?.missing}
            </p>
            <button className="button primary" disabled={busy}>
              {busy ? 'Guardando…' : confirm ? 'Confirmar recepción' : 'Revisar resumen'}
            </button>
          </form>
        </Modal>
      )}
    </Panel>
  );
}
