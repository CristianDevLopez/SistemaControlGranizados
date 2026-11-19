import { useState } from 'react';
import { adjustedClosingArticles, closingPreview } from '../domain/engine.ts';
import { suggestedCupCharge } from '../domain/reconciliation.ts';
import type { ClosingPreview, Count } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { moneyText, parseMoney } from '../lib/money.ts';
import { FieldsForm, Modal, MoneyInput, date, money, type Field } from './components.tsx';

export interface ClosingValues {
  cash: number;
  items: Record<string, number>;
  payments: Record<string, number>;
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
            const format = (value: number) => (row.monetary ? money(value) : `${value} vasos`);
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

export function ClosingApprovalDialog({ count, onClose }: { count: Count; onClose: () => void }) {
  const app = useApp(),
    { state, profiles } = app.data!;
  const shift = state.shifts.find((s) => s.id === count.shiftId)!;
  const [preview, setPreview] = useState(() => closingPreview(state, shift.id, count));
  const [values, setValues] = useState<ClosingValues>({
    cash: count.cash ?? 0,
    items: count.items,
    payments: count.payments ?? {},
  });
  const [employeeCharge, setEmployeeCharge] = useState<string | null>(null);
  const suggestedCharge = suggestedCupCharge(state.sizes, preview.expectedItems, values.items);
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
        conteo al momento del cierre. El original se conserva. Al aprobar, las diferencias de vasos ajustan el
        inventario.
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
          const confirmedCharge = employeeCharge === null ? suggestedCharge : parseMoney(employeeCharge);
          if (confirmedCharge === null) throw new Error('Escribe el monto confirmado o 0.');
          await app.run('approve_closing', {
            shiftId: shift.id,
            ...form,
            preview,
            employeeCharge: confirmedCharge,
            items: Object.fromEntries(Object.keys(preview.expectedItems).map((key) => [key, form[key]])),
            payments: Object.fromEntries(
              Object.keys(preview.expectedPayments).map((key) => [key, form[key]]),
            ),
          });
          app.toast('Cierre aprobado. El ajuste de vasos quedó registrado.');
          onClose();
        }}
      >
        <label className="field">
          <span>Valor del faltante a reportar al empleado</span>
          <MoneyInput
            required
            value={employeeCharge ?? moneyText(suggestedCharge)}
            onChange={setEmployeeCharge}
          />
          <small>Precio de venta sugerido por los vasos faltantes {money(suggestedCharge)}.</small>
        </label>
        {employeeCharge !== null && (
          <button type="button" className="text-button" onClick={() => setEmployeeCharge(null)}>
            Usar valor sugerido
          </button>
        )}
      </FieldsForm>
    </Modal>
  );
}
