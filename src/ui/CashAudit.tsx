import { useState } from 'react';
import {
  adjustableCountArticles,
  articles,
  closingPaymentMethods,
  countInventoryAdjustment,
  physicalArticles,
  stockBalances,
} from '../domain/engine.ts';
import type { AuditMode, Count, Shift } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { FieldsForm, Modal, date, money } from './components.tsx';
import { transferAccountName } from './payment-labels.ts';

export const auditModeLabels: Record<AuditMode, string> = {
  full: 'Completo',
  cash: 'Solo efectivo',
  custom: 'Personalizado',
};

export function AuditSetupDialog({ shift, onClose }: { shift?: Shift; onClose: () => void }) {
  const app = useApp(),
    { state, profiles, actor } = app.data!;
  const schedule = shift ? undefined : state.settings[0].nextOpeningAudit;
  const methods = shift?.cashierId === actor.id ? closingPaymentMethods(state, shift.id) : [];
  const [mode, setMode] = useState<AuditMode>(shift ? 'custom' : 'full');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title={shift ? 'Definir arqueo sorpresa' : 'Programar arqueo de apertura'} onClose={onClose}>
      <p className="modal-intro">
        {shift
          ? `Se pausará la operación hasta que ${profiles.find((x) => x.id === shift.cashierId)?.name ?? 'el responsable del turno'} presente el conteo.`
          : 'La próxima apertura de este local contará efectivo, paquetes de vasos, vasos sueltos, bolsas selladas, neveras y coronitas.'}
      </p>
      <form
        className="fields-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
          const cancel = form.get('action') === 'cancel';
          setBusy(true);
          setError('');
          try {
            await app.run('start_audit', {
              ...(shift ? { shiftId: shift.id } : { when: 'next_opening', cancel }),
              mode,
              cash: form.has('cash'),
              items: form.getAll('items').map(String),
              payments: form.getAll('payments').map(String),
            });
            app.toast(
              shift
                ? 'Arqueo solicitado. El responsable del turno debe ingresar las cantidades.'
                : cancel
                  ? 'Programación cancelada.'
                  : 'Arqueo programado para la próxima apertura.',
            );
            onClose();
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {shift && (
          <label className="field">
            <span>Tipo de arqueo</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as AuditMode)}>
              {Object.entries(auditModeLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
            {mode === 'full' && (
              <small>
                Incluye efectivo, bolsas selladas, paquetes de vasos, vasos sueltos y coronas.
                {!!methods.length && ' Incluye las transferencias del turno.'}
              </small>
            )}
          </label>
        )}
        {shift && mode === 'custom' && (
          <>
            <fieldset>
              <legend>Dinero</legend>
              <label className="check-inline">
                <input type="checkbox" name="cash" defaultChecked={schedule?.cash ?? true} />
                Efectivo
              </label>
              {methods.map(({ id, account }) => (
                <label className="check-inline" key={id}>
                  <input
                    type="checkbox"
                    name="payments"
                    value={id}
                    defaultChecked={schedule?.payments.includes(id)}
                  />
                  Transferencias · {transferAccountName(account)}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Inventario físico</legend>
              {physicalArticles(state).map((article) => (
                <label className="check-inline" key={article.id}>
                  <input
                    type="checkbox"
                    name="items"
                    value={article.id}
                    defaultChecked={schedule?.items.includes(article.id)}
                  />
                  {article.name} ({article.unit})
                </label>
              ))}
            </fieldset>
          </>
        )}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          {schedule && (
            <button className="button secondary" name="action" value="cancel" disabled={busy}>
              Quitar programación
            </button>
          )}
          <button type="button" className="button secondary" onClick={onClose}>
            Volver
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Guardando…' : shift ? 'Solicitar conteo' : 'Guardar programación'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CountReviewDialog({ count, onClose }: { count: Count; onClose: () => void }) {
  const app = useApp();
  const { state, profiles } = app.data!;
  const [adjusting, setAdjusting] = useState<Record<string, number> | null>(null);
  const adjustable = adjustableCountArticles(state, count);
  const adjustmentEvent = countInventoryAdjustment(state, count.id);
  const adjustment = adjustmentEvent?.inventoryAdjustment;
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
      name: `${count.kind === 'opening' ? 'Saldo de apertura' : 'Transferencias'} · ${count.paymentLabels?.[key] ?? key}`,
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
  if (adjusting && !adjustment) {
    return (
      <Modal title="Ajustar inventario al conteo" onClose={() => setAdjusting(null)}>
        <p className="modal-intro">
          Los valores iniciales vienen del conteo del {date(count.at)}. Si hubo ventas, entradas o mermas
          desde entonces, actualiza las cantidades tras verificar las existencias de hoy.
        </p>
        <FieldsForm
          fields={[
            ...adjustable.map(({ id, name, unit }) => ({
              name: id,
              label: `${name} (${unit}) · registrado ${adjusting[id] ?? 0}`,
              type: 'number' as const,
              value: count.items[id],
              min: 0,
              step: '1',
              required: true,
            })),
            { name: 'notes', label: 'Motivo del ajuste', type: 'textarea', required: true },
            {
              name: 'confirmed',
              label: 'Verifiqué las cantidades físicas actuales',
              type: 'checkbox',
              required: true,
            },
          ]}
          submit="Proponer ajuste de inventario"
          onCancel={() => setAdjusting(null)}
          onSubmit={async ({ notes, confirmed, ...items }) => {
            await app.run('adjust_count_inventory', {
              countId: count.id,
              items,
              notes,
              confirmed,
              expectedItems: adjusting,
            });
            setAdjusting(null);
          }}
        />
      </Modal>
    );
  }
  return (
    <Modal
      title={count.kind === 'audit' ? 'Revisión del arqueo sorpresa' : 'Revisión del conteo'}
      onClose={onClose}
    >
      <p className="modal-intro">
        Contado por {label(count.by)} · {date(count.at)}.
        {count.requestedBy && ` Solicitado por ${label(count.requestedBy)} · ${date(count.requestedAt)}.`}
        {count.kind === 'audit' && ' Los valores esperados corresponden al corte guardado al solicitarlo.'}
        {count.kind === 'opening' &&
          count.auditId &&
          ' Los valores esperados corresponden al corte de apertura.'}
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
                <td>
                  {row.counted}
                  {adjustment?.items[row.key] !== undefined && (
                    <small>Existencia confirmada: {adjustment.items[row.key]}</small>
                  )}
                </td>
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
      {adjustmentEvent && adjustment && (
        <p>
          Inventario ajustado por {label(adjustmentEvent.by)} · {date(adjustmentEvent.receivedAt)}.{' '}
          {adjustment.notes}
        </p>
      )}
      {count.revisesId && (
        <p>
          Revisión administrativa; se conserva el conteo original. Faltante reportado al empleado:{' '}
          {money(
            state.shifts.find((s) => s.closingReview?.countId === count.id)?.closingReview?.employeeCharge ??
              0,
          )}
          . Este registro no ejecuta descuentos de nómina.
        </p>
      )}
      <div className="form-actions">
        {adjustable.length > 0 && !adjustment && (
          <button
            className="button primary"
            disabled={!app.online || !!state.settings[0].auditId}
            onClick={() => {
              const balances = stockBalances(state);
              setAdjusting(Object.fromEntries(adjustable.map(({ id }) => [id, balances[id] ?? 0])));
            }}
          >
            Ajustar inventario al conteo
          </button>
        )}
        <button className="button secondary" onClick={onClose}>
          Cerrar revisión
        </button>
      </div>
    </Modal>
  );
}
