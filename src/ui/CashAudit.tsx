import { useState } from 'react';
import { articles, closingPaymentMethods } from '../domain/engine.ts';
import type { Count, Shift } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { Modal, date, money } from './components.tsx';
import { transferAccountName } from './payment-labels.ts';

export function AuditSetupDialog({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const app = useApp(),
    { state, profiles } = app.data!;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title="Definir arqueo sorpresa" onClose={onClose}>
      <p className="modal-intro">
        Selecciona qué debe contar{' '}
        {profiles.find((x) => x.id === shift.cashierId)?.name ?? 'el responsable del turno'}. Al iniciar se
        guardan los valores esperados del corte y se pausa la operación hasta que presente el conteo.
      </p>
      <form
        className="fields-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError('');
          try {
            await app.run('start_audit', {
              shiftId: shift.id,
              cash: form.has('cash'),
              items: form.getAll('items').map(String),
              payments: form.getAll('payments').map(String),
            });
            app.toast('Arqueo solicitado. El responsable del turno debe ingresar las cantidades.');
            onClose();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset>
          <legend>Dinero</legend>
          <label className="check-inline">
            <input type="checkbox" name="cash" defaultChecked />
            Efectivo
          </label>
          {closingPaymentMethods(state, shift.id).map(({ id, account }) => (
            <label className="check-inline" key={id}>
              <input type="checkbox" name="payments" value={id} />
              Transferencias · {transferAccountName(account)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Inventario</legend>
          {articles(state).map((article) => (
            <label className="check-inline" key={article.id}>
              <input type="checkbox" name="items" value={article.id} />
              {article.name} ({article.unit})
            </label>
          ))}
        </fieldset>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Solicitando…' : 'Solicitar conteo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CountReviewDialog({ count, onClose }: { count: Count; onClose: () => void }) {
  const { state, profiles } = useApp().data!;
  const label = (id?: string) => profiles.find((p) => p.id === id)?.name ?? 'Sin registro';
  const rows = [
    ...(count.cash === undefined
      ? []
      : [
          {
            key: 'cash',
            name: 'Efectivo',
            counted: money(count.cash),
            expected: money(count.expectedCash ?? 0),
            difference: count.difference ?? 0,
            monetary: true,
          },
        ]),
    ...Object.entries(count.payments ?? {}).map(([key, amount]) => ({
      key,
      name: `Transferencias · ${count.paymentLabels?.[key] ?? key}`,
      counted: money(amount),
      expected: money(count.expectedPayments?.[key] ?? 0),
      difference: count.paymentDifferences?.[key] ?? 0,
      monetary: true,
    })),
    ...Object.entries(count.items).map(([key, amount]) => {
      const article = articles(state).find((a) => a.id === key),
        unit = key.startsWith('liquid:') ? 'oz' : (article?.unit ?? 'unidades');
      return {
        key,
        name: count.itemLabels?.[key] ?? article?.name ?? key,
        counted: `${amount} ${unit}`,
        expected: `${count.expectedItems?.[key] ?? 0} ${unit}`,
        difference: count.differences?.[key] ?? 0,
        monetary: false,
      };
    }),
  ];
  return (
    <Modal
      title={count.kind === 'audit' ? 'Revisión del arqueo sorpresa' : 'Revisión del conteo'}
      onClose={onClose}
    >
      <p className="modal-intro">
        Contado por {label(count.by)} · {date(count.at)}.
        {count.requestedBy && ` Solicitado por ${label(count.requestedBy)} · ${date(count.requestedAt)}.`}
        {count.kind === 'audit' && ' Los valores esperados corresponden al corte guardado al solicitarlo.'}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ítem solicitado</th>
              <th>Contado / verificado</th>
              <th>Esperado original</th>
              <th>Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.name}</td>
                <td>{row.counted}</td>
                <td>{row.expected}</td>
                <td className={row.difference ? 'negative' : ''}>
                  {row.monetary ? money(row.difference) : row.difference}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {count.notes && <p>Novedades: {count.notes}</p>}
      <div className="form-actions">
        <button className="button secondary" onClick={onClose}>
          Cerrar revisión
        </button>
      </div>
    </Modal>
  );
}
