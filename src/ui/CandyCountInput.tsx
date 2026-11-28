import { useState } from 'react';
import type { Candy } from '../domain/v4-types.ts';
export function CandyCountInput({
  candy,
  value,
  onChange,
}: {
  candy: Candy;
  value: string;
  onChange: (value: string) => void;
}) {
  const [units, setUnits] = useState(false);
  const total = Number(value) || 0,
    bags = Math.floor(total / candy.perBag),
    opened = total - bags * candy.perBag,
    fraction = Number((opened / candy.perBag).toFixed(6));
  const fractions = [0, 0.05, 0.25, 0.5, 0.75, 1];
  return (
    <div className="fields-form">
      <label className="field">
        Bolsas cerradas
        <input
          aria-label={candy.name + ' · Bolsas cerradas'}
          type="number"
          min="0"
          step="1"
          value={bags}
          onChange={(e) => onChange(String(Number(e.target.value) * candy.perBag + opened))}
        />
      </label>
      {candy.unit === 'unidades' && (
        <label className="check-inline">
          <input type="checkbox" checked={units} onChange={(e) => setUnits(e.target.checked)} />
          Contar abierta por unidades
        </label>
      )}
      {units ? (
        <label className="field">
          Unidades abiertas
          <input
            aria-label={candy.name + ' · Unidades abiertas'}
            type="number"
            min="0"
            max={candy.perBag}
            value={opened}
            onChange={(e) => onChange(String(bags * candy.perBag + Number(e.target.value)))}
          />
        </label>
      ) : (
        <label className="field">
          Bolsa abierta
          <select
            aria-label={candy.name + ' · Bolsa abierta'}
            value={fraction}
            onChange={(e) => onChange(String((bags + Number(e.target.value)) * candy.perBag))}
          >
            {!fractions.includes(fraction) && (
              <option value={fraction}>
                Conteo previo ({opened.toFixed(2)} {candy.unit})
              </option>
            )}
            {[
              [0, 'Sin bolsa abierta'],
              [0.05, 'Casi vacía (5 %)'],
              [0.25, '¼'],
              [0.5, '½'],
              [0.75, '¾'],
              [1, 'Llena'],
            ].map(([n, label]) => (
              <option key={n} value={n}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
