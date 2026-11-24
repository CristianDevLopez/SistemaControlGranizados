import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { closingSupplyOptions } from '../domain/engine.ts';
import type { Shift, VisibleClosingPreview } from '../domain/types.ts';
import { api } from '../lib/api.ts';
import { parseMoney } from '../lib/money.ts';
import { useApp } from '../lib/store.tsx';
import { AddPackages } from './AddPackages.tsx';
import { Modal, MoneyInput, date, money } from './components.tsx';

export function VisibleClosing({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const app = useApp();
  const { state, actor, revision } = app.data!;
  const key = `dexter:closing:${actor.id}:${shift.id}`;
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? '{}');
    } catch {
      return {};
    }
  });
  const [preview, setPreview] = useState<VisibleClosingPreview>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const units = state.settings[0].cupPackageUnits;
  const checklist = state.settings[0].closingChecklist ?? [];
  const sync = app.sync;
  const refresh = useCallback(async () => {
    try {
      await sync();
      setPreview(await api<VisibleClosingPreview>('closing-preview', { shiftId: shift.id, visible: true }));
    } catch (failure) {
      setError((failure as Error).message);
    }
  }, [shift.id, sync]);
  useEffect(() => {
    void refresh();
  }, [refresh, revision]);

  const change = (name: string, value: string) => {
    const next = { ...draft, [name]: value };
    setDraft(next);
    sessionStorage.setItem(key, JSON.stringify(next));
  };
  const labels = new Map<string, string>([
    ...closingSupplyOptions(state).map((item): [string, string] => [item.id, item.name]),
    ...state.sizes.flatMap((size): [string, string][] => [
      [`cup:${size.id}`, `Vasos sueltos · ${size.name}`],
      [`package:${size.id}`, `Paquetes cerrados · ${size.name}`],
    ]),
  ]);
  const countRows = preview
    ? [
        { id: 'cash', label: 'Efectivo', expected: preview.expectedCash, monetary: true },
        ...Object.entries(preview.expectedPayments).map(([id, expected]) => ({
          id,
          label: preview.paymentLabels[id],
          expected,
          monetary: true,
        })),
        ...Object.entries(preview.expectedItems).map(([id, expected]) => ({
          id,
          label: labels.get(id) ?? id,
          expected,
          monetary: false,
        })),
      ]
    : [];
  const counted = (id: string, monetary: boolean) =>
    monetary ? parseMoney(draft[id], id !== 'cash') : draft[id] ? Number(draft[id]) : null;
  const different = countRows.some(({ id, expected, monetary }) => {
    const actual = counted(id, monetary);
    return actual !== null && actual !== expected;
  });
  const suggested = Object.fromEntries(
    countRows.flatMap(({ id, expected, monetary }) => {
      const actual = counted(id, monetary);
      const surplus = actual === null ? 0 : actual - expected;
      return id.startsWith('cup:') && units > 0 && surplus > 0 && surplus % units === 0
        ? [[id.slice(4), surplus / units]]
        : [];
    }),
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!preview) return;
    setError('');
    setBusy(true);
    try {
      await app.run(
        'submit_blind_count',
        {
          kind: 'closing',
          attempt: shift.blindClosing ? 2 : 1,
          shiftId: shift.id,
          closingCountMode: shift.closingCountMode,
          preview,
          cash: counted('cash', true),
          items: Object.fromEntries(Object.keys(preview.expectedItems).map((id) => [id, counted(id, false)])),
          payments: Object.fromEntries(
            Object.keys(preview.expectedPayments).map((id) => [id, counted(id, true)]),
          ),
          checklist: Object.fromEntries(
            checklist.map((_, index) => [index, draft[`check:${index}`] === 'yes']),
          ),
          notes: draft.notes ?? '',
        },
        { onlineOnly: true },
      );
      sessionStorage.removeItem(key);
      onClose();
    } catch (failure) {
      setError((failure as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal title="Cierre de caja" onClose={onClose}>
        {preview ? (
          <form className="fields-form" onSubmit={submit}>
            {Object.keys(preview.expectedPayments).length > 0 && (
              <p>Compara cada cuenta con los comprobantes del turno.</p>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th>Contaste</th>
                    <th>Debería haber</th>
                  </tr>
                </thead>
                <tbody>
                  {countRows.map(({ id, label, expected, monetary }) => (
                    <tr
                      key={id}
                      className={
                        counted(id, monetary) != null && counted(id, monetary) !== expected
                          ? 'count-mismatch'
                          : undefined
                      }
                    >
                      <th scope="row">{label}</th>
                      <td>
                        {monetary ? (
                          <MoneyInput
                            ariaLabel={label}
                            value={draft[id] ?? ''}
                            onChange={(value) => change(id, value)}
                            required
                            allowNegative={id !== 'cash'}
                            preview={false}
                          />
                        ) : (
                          <input
                            aria-label={label}
                            type="number"
                            min="0"
                            max="1000000"
                            step="1"
                            inputMode="numeric"
                            value={draft[id] ?? ''}
                            onChange={(event) => change(id, event.target.value)}
                            required
                          />
                        )}
                      </td>
                      <td>{monetary ? money(expected) : expected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.keys(suggested).length > 0 && (
              <div className="notice warning">
                ¿Se abrió un paquete sin registrar?
                <button type="button" className="button secondary" onClick={() => setAdding(true)}>
                  Agregar paquetes
                </button>
              </div>
            )}
            <section>
              <h3>Movimientos del turno</h3>
              <p>
                Efectivo · Base {money(preview.cashFlow.base)} + ventas {money(preview.cashFlow.sales)} −
                gastos {money(preview.cashFlow.expenses)} − traslados netos{' '}
                {money(preview.cashFlow.transfers)} = {money(preview.expectedCash)}
              </p>
              {Object.entries(preview.cups).map(([id, cups]) => (
                <p key={id}>
                  {labels.get(id)} · Inicial {cups.initial} + paquetes agregados ({cups.packages} vasos) −
                  vendidos {cups.sold} − daños {cups.damage}
                  {cups.other ? ` + otros movimientos (${cups.other})` : ''} = {preview.expectedItems[id]}
                </p>
              ))}
              {preview.movements.length > 0 && (
                <ul>
                  {preview.movements.map((item) => (
                    <li key={item.id}>
                      {date(item.at)} · {item.label}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {checklist.map((task, index) => (
              <label className="check-inline" key={index}>
                <input
                  type="checkbox"
                  required
                  checked={draft[`check:${index}`] === 'yes'}
                  onChange={(event) => change(`check:${index}`, event.target.checked ? 'yes' : '')}
                />
                {task}
              </label>
            ))}
            <label className="field">
              <span>{different ? 'Nota sobre la diferencia *' : 'Nota'}</span>
              <textarea
                value={draft.notes ?? ''}
                onChange={(event) => change('notes', event.target.value)}
                required={different}
                maxLength={1500}
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={onClose}>
                Guardar borrador y salir
              </button>
              <button className="button primary" disabled={busy || !app.online}>
                Continuar a reparto de efectivo
              </button>
            </div>
          </form>
        ) : (
          <p role="status">{error || 'Cargando movimientos del turno…'}</p>
        )}
      </Modal>
      {adding && (
        <AddPackages
          suggested={suggested}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      )}
    </>
  );
}
