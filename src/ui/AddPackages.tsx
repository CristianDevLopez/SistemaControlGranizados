import { useState } from 'react';
import { usesCupPackages } from '../domain/engine.ts';
import { useApp } from '../lib/store.tsx';
import { FieldsForm, Modal } from './components.tsx';

export function AddPackages({
  onClose,
  suggested = {},
  closingShiftId,
  onAdded = onClose,
}: {
  onClose: () => void;
  suggested?: Record<string, number>;
  closingShiftId?: string;
  onAdded?: () => void;
}) {
  const app = useApp();
  const { state } = app.data!;
  const [query, setQuery] = useState('');
  const allSizes = state.sizes.filter(usesCupPackages);
  const sizes = allSizes.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Modal title="Agregar paquetes" onClose={onClose}>
      <p>Cada paquete agrega {state.settings[0].cupPackageUnits} vasos sueltos de su tamaño.</p>
      {state.settings[0].v4Enabled && (
        <input
          className="search"
          aria-label="Buscar paquete"
          placeholder="Buscar paquete…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <FieldsForm
        fields={sizes.map((size) => ({
          name: size.id,
          label: size.name,
          type: 'number',
          min: 0,
          max: 1000,
          step: '1',
          value: suggested[size.id],
        }))}
        submit="Agregar paquetes"
        onCancel={onClose}
        onSubmit={async (values) => {
          const quantities = Object.fromEntries(
            allSizes.filter((size) => Number(values[size.id]) > 0).map((size) => [size.id, values[size.id]]),
          );
          await app.run(
            'open_package',
            { quantities, ...(closingShiftId && { closingRecount: true, shiftId: closingShiftId }) },
            { onlineOnly: !!closingShiftId },
          );
          app.toast('Paquetes agregados.');
          onAdded();
        }}
      />
    </Modal>
  );
}
