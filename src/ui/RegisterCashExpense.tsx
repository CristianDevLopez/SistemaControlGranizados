import { useState } from 'react';
import { hasPermission, isShiftCashier, shiftBlocksSales } from '../domain/access.ts';
import type { Shift } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { FieldsForm, Modal } from './components.tsx';

export function RegisterCashExpense({ shift }: { shift?: Shift }) {
  const app = useApp();
  const { actor, state } = app.data!;
  const [open, setOpen] = useState(false);
  const { auditId, expenseCategories, expenseLimit } = state.settings[0];
  if (
    app.viewRole ||
    shift?.status !== 'open' ||
    !isShiftCashier({ ...actor, online: app.online }, shift) ||
    !hasPermission(actor, 'expenses') ||
    shiftBlocksSales(shift) ||
    auditId
  )
    return null;

  return (
    <>
      <button
        className="button secondary"
        disabled={!app.online}
        title={app.online ? undefined : 'Conéctate para registrar el gasto'}
        onClick={() => setOpen(true)}
      >
        Registrar gasto
      </button>
      {open && (
        <Modal title="Registrar gasto" onClose={() => setOpen(false)}>
          <p>Registra el dinero que ya salió de caja. Un administrador revisará el gasto.</p>
          <FieldsForm
            fields={[
              {
                name: 'category',
                label: 'Categoría',
                type: 'select',
                required: true,
                options: expenseCategories.map((value) => ({ value, label: value })),
              },
              {
                name: 'amount',
                label: 'Monto pagado',
                type: 'money',
                min: 1,
                max: expenseLimit,
                required: true,
              },
              { name: 'supplier', label: 'Proveedor', required: true },
              { name: 'evidenceId', label: 'Soporte fotográfico', type: 'photo' },
              { name: 'notes', label: 'Nota (obligatoria si no hay foto)', type: 'textarea' },
            ]}
            onCancel={() => setOpen(false)}
            onSubmit={async (values) => {
              await app.run(
                'expense',
                { ...values, source: 'cash', shiftId: shift.id },
                { onlineOnly: true },
              );
              setOpen(false);
              app.toast('Gasto enviado a aprobación.');
            }}
          />
        </Modal>
      )}
    </>
  );
}
