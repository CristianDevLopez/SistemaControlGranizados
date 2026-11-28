import { V4Closing } from './V4Closing.tsx';
import { useState } from 'react';
import {
  adjustedClosingArticles,
  closingPreview,
  isLegacyCoolerArticle,
  approvedInventoryUpdatesSince,
} from '../domain/engine.ts';
import type { ClosingPreview, Count } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { parseMoney } from '../lib/money.ts';
import { FieldsForm, Modal, MoneyInput, date, money, type Field } from './components.tsx';

export interface ClosingValues {
  cash: number;
  items: Record<string, number>;
  payments: Record<string, number>;
}

export function ClosingConfirmation(props: { count: Count; blocked: boolean }) {
  const app = useApp();
  return app.data!.state.settings[0].v4Enabled ? (
    <V4Closing count={props.count} />
  ) : (
    <LegacyClosingConfirmation {...props} />
  );
}
function LegacyClosingConfirmation({ count, blocked }: { count: Count; blocked: boolean }) {
  const app = useApp();
  const { state, actor } = app.data!;
  const shift = state.shifts.find((item) => item.id === count.shiftId)!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const expected = closingPreview(state, shift.id, count);
  const updated = approvedInventoryUpdatesSince(state, count);
  const rows = [
    ...(!count.blindHandoff
      ? [{ id: 'cash', label: 'Efectivo', counted: count.cash, expected: expected.expectedCash, money: true }]
      : []),
    ...Object.entries(expected.expectedPayments).map(([id, amount]) => ({
      id,
      label: expected.paymentLabels[id],
      counted: count.payments?.[id],
      expected: amount,
      money: true,
    })),
    ...Object.entries(count.items)
      .filter(([id]) => !isLegacyCoolerArticle(id))
      .map(([id, amount]) => ({
        id,
        label: count.itemLabels?.[id] ?? id,
        counted: amount,
        expected: expected.expectedItems[id] ?? count.expectedItems?.[id] ?? 0,
        money: false,
      })),
  ];
  const format = (value: number | undefined, monetary: boolean) =>
    value === undefined ? '—' : monetary ? money(value) : value;
  const own = shift.cashierId === actor.id;
  return (
    <form
      className="fields-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        if (!submitter || own || busy || blocked) return;
        const data = new FormData(event.currentTarget);
        const read = (id: string, monetary = true) => {
          const value = data.get(id);
          if (value === null || value === '') return null;
          const result = monetary ? parseMoney(value, id !== 'cash') : Number(value);
          if (result === null) throw new Error('Escribe una corrección válida.');
          return result;
        };
        setError('');
        setBusy(true);
        try {
          const result = await app.run(
            'approve_closing',
            {
              shiftId: shift.id,
              adjustInventory: submitter.value === 'adjust',
              ...(count.blindHandoff ? {} : { preview: expected }),
              cash: read('cash'),
              payments: Object.fromEntries(
                Object.keys(expected.expectedPayments).map((id) => [id, read(id)]),
              ),
              items: Object.fromEntries(Object.keys(count.items).map((id) => [id, read(id, false)])),
              notes: data.get('notes'),
            },
            { onlineOnly: true },
          );
          app.toast(result.message);
        } catch (failure) {
          setError((failure as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Artículo</th>
              <th>Conteo del cajero</th>
              <th>Debería haber</th>
              <th>Conteo final del administrador</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                <td>{format(row.counted, row.money)}</td>
                <td>{format(row.expected, row.money)}</td>
                <td>
                  {row.money ? (
                    <MoneyInput
                      name={row.id}
                      ariaLabel={`Corrección · ${row.label}`}
                      allowNegative={row.id !== 'cash'}
                    />
                  ) : (
                    <input
                      name={row.id}
                      aria-label={`Corrección · ${row.label}`}
                      type="number"
                      min="0"
                      max="1000000"
                      step="1"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Escribe el total que contaste físicamente, sin sumar ni restar al conteo del cajero. Si dejas un campo
        vacío se conserva su conteo. Al confirmar y ajustar inventario se aplica el conteo final.
      </p>
      <label className="field">
        <span>Nota de revisión</span>
        <textarea name="notes" maxLength={1500} />
      </label>
      {rows.some(({ id }) => updated.has(id)) && (
        <p>
          Se conservarán los saldos aprobados después del conteo. Escribe una corrección para cambiar alguno.
        </p>
      )}
      {own && <p>Otro administrador debe confirmar este cierre.</p>}
      {count.blindHandoff && <p>El efectivo se muestra cuando confirmes la recepción del traslado.</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="button-row">
        <button className="button primary" value="adjust" disabled={blocked || own || busy || !app.online}>
          Confirmar y ajustar inventario
        </button>
        <button className="button secondary" value="verify" disabled={blocked || own || busy || !app.online}>
          Confirmar sin ajustar inventario
        </button>
      </div>
    </form>
  );
}
export function closingHasDifferences(values: ClosingValues, preview: ClosingPreview) {
  return (
    values.cash !== preview.expectedCash ||
    Object.entries(preview.expectedItems).some(([key, amount]) => values.items[key] !== amount) ||
    Object.entries(preview.expectedPayments).some(([key, amount]) => values.payments[key] !== amount)
  );
}

export function ClosingComparison({
  values,
  preview,
  labels,
}: {
  values: ClosingValues;
  preview: ClosingPreview;
  labels: Record<string, string>;
}) {
  const rows = [
    { key: 'cash', name: 'Efectivo', counted: values.cash, expected: preview.expectedCash, monetary: true },
    ...Object.entries(preview.expectedPayments).map(([key, expected]) => ({
      key,
      name: preview.paymentLabels[key],
      counted: values.payments[key] ?? 0,
      expected,
      monetary: true,
    })),
    ...Object.entries(preview.expectedItems).map(([key, expected]) => ({
      key,
      name: labels[key] ?? key,
      counted: values.items[key] ?? 0,
      expected,
      monetary: false,
    })),
  ];
  return (
    <div className="table-wrap closing-comparison">
      <table>
        <thead>
          <tr>
            <th>Concepto</th>
            <th>Registrado</th>
            <th>Según el sistema</th>
            <th>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const difference = row.counted - row.expected;
            const format = (value: number) =>
              row.monetary ? money(value) : row.key.startsWith('cup:') ? `${value} vasos` : String(value);
            return (
              <tr key={row.key}>
                <td>{row.name}</td>
                <td>{format(row.counted)}</td>
                <td>{format(row.expected)}</td>
                <td className={difference ? 'negative' : ''}>
                  {difference === 0
                    ? 'Coincide'
                    : `${difference < 0 ? 'Faltan' : 'Sobran'} ${format(Math.abs(difference))}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ClosingApprovalDialog(props: { count: Count; onClose: () => void }) {
  const app = useApp();
  return app.data!.state.settings[0].v4Enabled ? (
    <Modal title="Revisión del cierre" onClose={props.onClose}>
      <V4Closing count={props.count} />
    </Modal>
  ) : (
    <LegacyClosingApprovalDialog {...props} />
  );
}
function LegacyClosingApprovalDialog({ count, onClose }: { count: Count; onClose: () => void }) {
  const app = useApp(),
    { state, profiles } = app.data!;
  const shift = state.shifts.find((s) => s.id === count.shiftId)!;
  const [preview, setPreview] = useState(() => closingPreview(state, shift.id, count));
  const [values, setValues] = useState<ClosingValues>({
    cash: count.cash ?? 0,
    items: count.items,
    payments: count.payments ?? {},
  });
  const labels = count.itemLabels ?? {};
  const alreadyAdjusted = [...adjustedClosingArticles(state, count)]
    .filter((key) => Object.hasOwn(preview.expectedItems, key))
    .map((key) => labels[key] ?? key);
  const fields: Field[] = [
    {
      name: 'retained',
      label: 'Base reservada reconfirmada',
      type: 'money',
      value: count.retained ?? 0,
      required: true,
    },
    {
      name: 'cash',
      label: 'Efectivo reconfirmado en el cierre',
      type: 'money',
      value: count.cash,
      required: true,
    },
    ...Object.keys(preview.expectedPayments).map((key): Field => ({
      name: key,
      label: `Reconfirmado · ${preview.paymentLabels[key]}`,
      type: 'money',
      allowNegative: true,
      value: count.payments?.[key] ?? 0,
      required: true,
    })),
    ...Object.keys(preview.expectedItems).map((key): Field => ({
      name: key,
      label: labels[key] ?? key,
      type: 'number',
      min: 0,
      step: '1',
      value: count.items[key],
      required: true,
    })),
    {
      name: 'locationId',
      label: 'Destino del remanente si la corrección genera una entrega adicional',
      type: 'select',
      options: state.locations.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name })),
    },
    {
      name: 'notes',
      label: 'Resultado de la revisión y motivo de las correcciones',
      type: 'textarea',
      required: true,
    },
    {
      name: 'verified',
      label: 'Verifiqué el efectivo entregado o reservado y los comprobantes de cada cuenta',
      type: 'checkbox',
      required: true,
    },
  ];
  return (
    <Modal title="Revisar y aprobar cierre" onClose={onClose}>
      <p className="modal-intro">
        Presentado por {profiles.find((p) => p.id === count.by)?.name} · {date(count.at)}. Reconfirma el
        conteo al momento del cierre. El original se conserva. Al aprobar, las diferencias de los artículos
        contados ajustan el inventario.
      </p>
      {alreadyAdjusted.length > 0 && (
        <p>Un conteo posterior ya ajustó estos artículos: {alreadyAdjusted.join(', ')}.</p>
      )}
      <ClosingComparison values={values} preview={preview} labels={labels} />
      <button
        className="text-button"
        onClick={() => {
          setPreview(closingPreview(state, shift.id, count));
        }}
      >
        Actualizar comparación
      </button>
      <p>
        Original: {money(count.cash ?? 0)} en efectivo.
        {Object.entries(count.items)
          .map(([key, n]) => ` ${labels[key] ?? key}: ${n}.`)
          .join('')}
      </p>
      <FieldsForm
        fields={fields}
        submit="Aprobar cierre y ajustar inventario"
        onCancel={onClose}
        onValuesChange={(data) =>
          setValues({
            cash: parseMoney(data.cash) ?? 0,
            items: Object.fromEntries(
              Object.keys(preview.expectedItems).map((key) => [key, Number(data[key])]),
            ),
            payments: Object.fromEntries(
              Object.keys(preview.expectedPayments).map((key) => [key, parseMoney(data[key], true) ?? 0]),
            ),
          })
        }
        onSubmit={async (form) => {
          const result = await app.run('approve_closing', {
            shiftId: shift.id,
            ...form,
            preview,
            items: Object.fromEntries(Object.keys(preview.expectedItems).map((key) => [key, form[key]])),
            payments: Object.fromEntries(
              Object.keys(preview.expectedPayments).map((key) => [key, form[key]]),
            ),
          });
          if (!result.approvalPending) app.toast('Cierre aprobado.');
          onClose();
        }}
      />
    </Modal>
  );
}
