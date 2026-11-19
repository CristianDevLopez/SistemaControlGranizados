import { useState } from 'react';
import { addDays, businessDay } from '../domain/business-date.ts';
import { fortnight, recoveredAmount } from '../domain/reconciliation.ts';
import type { Count, Shift } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { Empty, FieldsForm, Modal, Panel, date, money } from './components.tsx';

export function EmployeeRecoveries({ onReview }: { onReview: (count: Count) => void }) {
  const app = useApp();
  const { state, profiles } = app.data!;
  const today = businessDay();
  const [day, setDay] = useState(today);
  const [employee, setEmployee] = useState('');
  const [selected, setSelected] = useState<Shift | null>(null);
  const { from, until } = fortnight(day);
  const lastDay = addDays(until, -1);
  const name = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? id;
  const charges = state.shifts.filter(
    (shift) => shift.closingReview?.status === 'approved' && (shift.closingReview.employeeCharge ?? 0) > 0,
  );
  const rows = charges
    .filter((shift) => !employee || shift.cashierId === employee)
    .map((shift) => {
      const count = state.counts.find((count) => count.id === shift.closingReview?.countId);
      const cutoff = count?.cutoffAt ?? shift.closedAt ?? shift.requestedAt;
      const recovered = recoveredAmount(shift.closingReview);
      return { shift, count, cutoff, recovered, pending: shift.closingReview!.employeeCharge! - recovered };
    })
    .sort((left, right) => right.cutoff.localeCompare(left.cutoff));
  const unpaid = rows.filter((row) => row.pending > 0 && businessDay(row.cutoff) < until);
  const settled = rows
    .flatMap((row) =>
      (row.shift.closingReview?.recoveries ?? [])
        .filter((recovery) => recovery.paidOn >= from && recovery.paidOn < until)
        .map((recovery) => ({ ...row, recovery })),
    )
    .sort((left, right) => right.recovery.paidOn.localeCompare(left.recovery.paidOn));

  return (
    <Panel title="Faltantes y descuentos por quincena">
      <div className="form-grid">
        <label className="field">
          <span>Fecha de la quincena</span>
          <input
            type="date"
            max={today}
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Empleado</span>
          <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
            <option value="">Todos</option>
            {[...new Set(charges.map((shift) => shift.cashierId))]
              .sort((a, b) => name(a).localeCompare(name(b)))
              .map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
          </select>
        </label>
      </div>
      <h3>Saldo pendiente actual · {money(unpaid.reduce((sum, row) => sum + row.pending, 0))}</h3>
      {unpaid.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Empleado y cierre</th>
                <th>Confirmado</th>
                <th>Descontado</th>
                <th>Pendiente</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {unpaid.map(({ shift, count, cutoff, recovered, pending }) => (
                <tr key={shift.id}>
                  <td>
                    {name(shift.cashierId)}
                    <small>{date(cutoff)}</small>
                  </td>
                  <td>{money(shift.closingReview?.employeeCharge ?? 0)}</td>
                  <td>{money(recovered)}</td>
                  <td>{money(pending)}</td>
                  <td>
                    {count && (
                      <button className="text-button" onClick={() => onReview(count)}>
                        Ver cuadre
                      </button>
                    )}
                    <button className="text-button" disabled={!app.online} onClick={() => setSelected(shift)}>
                      Registrar descuento
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Sin faltantes pendientes en este corte" />
      )}
      <h3>
        Ventas por mermas de empleado · {money(settled.reduce((sum, row) => sum + row.recovery.amount, 0))}
      </h3>
      <p>
        {from} a {lastDay} · Descuentos aplicados en la quincena
      </p>
      {settled.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Fecha del descuento</th>
                <th>Importe</th>
                <th>Cuadre de origen</th>
                <th>Registrado por</th>
              </tr>
            </thead>
            <tbody>
              {settled.map(({ shift, count, cutoff, recovery }) => (
                <tr key={recovery.id}>
                  <td>{name(shift.cashierId)}</td>
                  <td>{recovery.paidOn}</td>
                  <td>{money(recovery.amount)}</td>
                  <td>
                    {count ? (
                      <button className="text-button" onClick={() => onReview(count)}>
                        {date(cutoff)}
                      </button>
                    ) : (
                      date(cutoff)
                    )}
                  </td>
                  <td>{name(recovery.by)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Sin descuentos registrados en la quincena" />
      )}
      {selected && (
        <Modal title="Confirmar descuento de quincena" onClose={() => setSelected(null)}>
          <p>
            {name(selected.cashierId)} · Cierre del {date(selected.closedAt)}
          </p>
          <FieldsForm
            onCancel={() => setSelected(null)}
            submit="Registrar descuento aplicado"
            fields={[
              {
                name: 'amount',
                label: 'Valor descontado',
                type: 'money',
                min: 1,
                required: true,
                value:
                  (selected.closingReview?.employeeCharge ?? 0) - recoveredAmount(selected.closingReview),
                max: (selected.closingReview?.employeeCharge ?? 0) - recoveredAmount(selected.closingReview),
              },
              {
                name: 'paidOn',
                label: 'Fecha real del descuento',
                type: 'date',
                required: true,
                value: lastDay < today ? lastDay : today,
              },
              {
                name: 'confirmed',
                label: 'Confirmo que apliqué este descuento al pagar la quincena',
                type: 'checkbox',
                required: true,
              },
            ]}
            onSubmit={async (values) => {
              await app.run('record_employee_recovery', {
                ...values,
                shiftId: selected.id,
                expectedRecovered: recoveredAmount(selected.closingReview),
              });
              setSelected(null);
              app.toast('Descuento aplicado registrado en Ventas por mermas de empleado.');
            }}
          />
        </Modal>
      )}
    </Panel>
  );
}
