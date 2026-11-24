import { usesCupPackages } from '../domain/engine.ts';
import { useApp } from '../lib/store.tsx';
import { FieldsForm, Modal } from './components.tsx';

export function AddPackages({
  onClose,
  suggested = {},
  onAdded = onClose,
}: {
  onClose: () => void;
  suggested?: Record<string, number>;
  onAdded?: () => void;
}) {
  const app = useApp();
  const { state } = app.data!;
  const sizes = state.sizes.filter(usesCupPackages);
  return (
    <Modal title="Agregar paquetes" onClose={onClose}>
      <p>Cada paquete agrega {state.settings[0].cupPackageUnits} vasos sueltos de su tamaño.</p>
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
            sizes.filter((size) => Number(values[size.id]) > 0).map((size) => [size.id, values[size.id]]),
          );
          await app.run('open_package', { quantities });
          app.toast('Paquetes agregados.');
          onAdded();
        }}
      />
    </Modal>
  );
}
