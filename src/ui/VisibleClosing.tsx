import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { BlindClosingPreview, Shift } from '../domain/types.ts';
import { api } from '../lib/api.ts';
import { parseMoney } from '../lib/money.ts';
import { useApp } from '../lib/store.tsx';
import { AddPackages } from './AddPackages.tsx';
import { CandyCountInput } from './CandyCountInput.tsx';
import { candies } from '../domain/v4-catalog.ts';
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
  const [form, setForm] = useState<BlindClosingPreview>();
  const preview = form?.recount?.preview;
  const [error, setError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const units = state.settings[0].cupPackageUnits;
  const checklist = state.settings[0].closingChecklist ?? [];
  const sync = app.sync;
  const refresh = useCallback(async () => {
    try {
      await sync();
      setForm(
        await api<BlindClosingPreview>('closing-preview', { shiftId: shift.id, visible: true, blind: true }),
      );
      setPreviewError('');
    } catch (failure) {
      setPreviewError((failure as Error).message);
    }
  }, [shift.id, sync]);
  useEffect(() => {
    if (app.online) void refresh();
  }, [app.online, refresh, revision]);

  const change = (name: string, value: string) => {
    const next = { ...draft, [name]: value };
    setDraft(next);
    sessionStorage.setItem(key, JSON.stringify(next));
  };
  const labels = new Map(form?.items.map(({ id, name }) => [id, name]));
  const countRows = form
    ? [
        { id: 'cash', label: 'Efectivo', expected: preview?.expectedCash, monetary: true },
        ...form.items.map(({ id, name }) => ({
          id,
          label: id.startsWith('cup:')
            ? name.replace('Vasos ·', 'Vasos sueltos ·')
            : id.startsWith('package:')
              ? name.replace('Paquetes ·', 'Paquetes cerrados ·')
              : name,
          expected: preview?.expectedItems[id],
          monetary: false,
        })),
      ]
    : [];
  const firstValues = form?.recount;
  const entry = (name: string) =>
    draft[name] ??
    (name === 'notes'
      ? (firstValues?.notes ?? '')
      : String((name === 'cash' ? firstValues?.cash : firstValues?.items[name]) ?? ''));
  const counted = (id: string, monetary: boolean) =>
    monetary
      ? parseMoney(entry(id))
      : entry(id)
        ? Number(entry(id))
        : state.settings[0].v4Enabled && candies(state).some((c) => c.id === id)
          ? 0
          : null;
  const different = countRows.some(({ id, expected, monetary }) => {
    const actual = counted(id, monetary);
    return expected !== undefined && actual !== null && actual !== expected;
  });
  const suggested = Object.fromEntries(
    countRows.flatMap(({ id, expected, monetary }) => {
      const actual = counted(id, monetary);
      const surplus = actual === null || expected === undefined ? 0 : actual - expected;
      return id.startsWith('cup:') && units > 0 && surplus > 0 && surplus % units === 0
        ? [[id.slice(4), surplus / units]]
        : [];
    }),
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    setError('');
    setBusy(true);
    try {
      const result = await app.run(
        'submit_blind_count',
        {
          kind: 'closing',
          attempt: preview ? 2 : 1,
          blind: true,
          shiftId: shift.id,
          closingCountMode: shift.closingCountMode,
          preview,
          cash: counted('cash', true),
          items: Object.fromEntries(form.items.map(({ id }) => [id, counted(id, false)])),
          checklist: Object.fromEntries(
            checklist.map((_, index) => [index, draft[`check:${index}`] === 'yes']),
          ),
          notes: entry('notes'),
        },
        { onlineOnly: true },
      );
      if (result.code === 'COUNT_RECOUNT') {
        app.toast(result.message);
        await refresh();
      } else {
        sessionStorage.removeItem(key);
        onClose();
      }
    } catch (failure) {
      setError((failure as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal title={preview ? 'Cierre de caja · Segundo conteo' : 'Cierre de caja'} onClose={onClose}>
        {form ? (
          <form className="fields-form" onSubmit={submit}>
            <p>1. Conteo de cierre · 2. Entrega de efectivo</p>
            <p className={preview ? 'notice warning' : undefined} role="status">
              {preview
                ? 'Hay diferencias con lo esperado. Vuelve a contar: ahora ves cuánto debería haber. Si olvidaste registrar un gasto, un paquete o una bolsa, regístralo antes.'
                : 'Cuenta el efectivo, los vasos y los demás artículos del turno.'}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th>Contaste</th>
                    {preview && <th>Debería haber</th>}
                  </tr>
                </thead>
                <tbody>
                  {countRows
                    .map(({ id, label, expected, monetary }) => (
                      <tr
                        key={id}
                        className={
                          expected !== undefined &&
                          counted(id, monetary) != null &&
                          counted(id, monetary) !== expected
                            ? 'count-mismatch'
                            : undefined
                        }
                      >
                        <th scope="row">{label}</th>
                        <td>
                          {monetary ? (
                            <MoneyInput
                              ariaLabel={label}
                              value={entry(id)}
                              onChange={(value) => change(id, value)}
                              required
                              preview={false}
                            />
                          ) : state.settings[0].v4Enabled && candies(state).some((c) => c.id === id) ? (
                            <CandyCountInput
                              candy={candies(state).find((c) => c.id === id)!}
                              value={entry(id)}
                              onChange={(value) => change(id, value)}
                            />
                          ) : (
                            <input
                              aria-label={label}
                              type="number"
                              min="0"
                              max="1000000"
                              step="1"
                              inputMode="numeric"
                              value={entry(id)}
                              onChange={(event) => change(id, event.target.value)}
                              required
                            />
                          )}
                        </td>
                        {preview && <td>{monetary ? money(expected ?? 0) : expected}</td>}
                      </tr>
                    ))
                    .flatMap((row, index) =>
                      index !== 0
                        ? [row]
                        : [
                            row,
                            ...form.accounts.map(({ id, name, amount }) => (
                              <tr key={id}>
                                <th scope="row">Ventas · {name}</th>
                                <td colSpan={preview ? 2 : 1}>{money(amount)}</td>
                              </tr>
                            )),
                          ],
                    )}
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
            {preview && (
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
            )}
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
                value={entry('notes')}
                onChange={(event) => change('notes', event.target.value)}
                required={different && !state.settings[0].v4Enabled}
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
              <button className="button primary" disabled={busy || !app.online || !!previewError}>
                {preview ? 'Enviar segundo conteo' : 'Enviar primer conteo'}
              </button>
            </div>
          </form>
        ) : (
          !previewError && <p role="status">Cargando movimientos del turno…</p>
        )}
        {previewError && (
          <div className="notice warning">
            <p role="status">{previewError}</p>
            <button
              type="button"
              className="button secondary"
              disabled={!app.online}
              onClick={() => void refresh()}
            >
              Reintentar consulta
            </button>
          </div>
        )}
      </Modal>
      {adding && (
        <AddPackages
          suggested={suggested}
          closingShiftId={shift.id}
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
