import { useState } from 'react';
import { FlaskConical, Trash2 } from 'lucide-react';
import { canCorrectTastings } from '../domain/access.ts';
import type { Order } from '../domain/types.ts';
import { useApp } from '../lib/store.tsx';
import { date } from './components.tsx';

export function TastingsEditor({
  order,
  busy = false,
  onBusyChange,
  onEmpty,
  showDates = false,
}: {
  order: Order;
  busy?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onEmpty?: () => void;
  showDates?: boolean;
}) {
  const app = useApp(),
    { state, actor } = app.data!;
  const [working, setWorking] = useState(false),
    [error, setError] = useState('');
  const editable = canCorrectTastings(
    actor,
    order,
    state.shifts.find((shift) => shift.status === 'open'),
  );
  const disabled = busy || working || !!state.settings[0].auditId || (!app.online && !actor.primary);
  const correct = async (tastingId: string, flavorId?: string) => {
    setWorking(true);
    onBusyChange?.(true);
    setError('');
    try {
      await app.run(flavorId ? 'update_tasting' : 'remove_tasting', {
        orderId: order.id,
        tastingId,
        flavorId,
        expectedVersion: order.version,
      });
      app.toast(
        flavorId
          ? 'Sabor de la degustación corregido.'
          : 'Degustación eliminada. Se restituyeron una copita y 1 oz.',
      );
      if (!flavorId && order.status === 'open' && !order.lines.length && order.tastings.length === 1)
        onEmpty?.();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setWorking(false);
      onBusyChange?.(false);
    }
  };
  if (!order.tastings.length) return null;
  return (
    <section className="tasting-list" aria-label="Degustaciones">
      <div className="tasting-heading">
        <FlaskConical size={16} />
        <strong>
          {order.tastings.length} degustación{order.tastings.length > 1 ? 'es' : ''}
        </strong>
      </div>
      {order.tastings.map((tasting, index) => (
        <div className="tasting-row" key={tasting.id}>
          <div className="tasting-flavor">
            {editable ? (
              <select
                aria-label={`Sabor de la degustación ${index + 1}`}
                value={tasting.flavorId}
                disabled={disabled}
                onChange={(event) => void correct(tasting.id, event.target.value)}
              >
                {state.flavors
                  .filter((flavor) => flavor.active || flavor.id === tasting.flavorId)
                  .map((flavor) => (
                    <option key={flavor.id} value={flavor.id} disabled={!flavor.active}>
                      {flavor.name}
                    </option>
                  ))}
              </select>
            ) : (
              <span>{state.flavors.find((flavor) => flavor.id === tasting.flavorId)?.name}</span>
            )}
            <small>1 oz · 1 copita{showDates ? ` · ${date(tasting.at)}` : ''}</small>
          </div>
          {editable && (
            <button
              className="icon-button"
              type="button"
              aria-label={`Eliminar degustación ${index + 1}`}
              title="Eliminar degustación"
              disabled={disabled}
              onClick={() => void correct(tasting.id)}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ))}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}
