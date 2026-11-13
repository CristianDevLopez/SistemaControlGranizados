import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X, Camera, LoaderCircle, Inbox } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { moneyText, parseMoney } from '../lib/money.ts';
export const money = (value: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(
    value,
  );
/**
 * Campo de pesos: acepta "150000", "150.000" o "$ 150.000" y muestra debajo el valor que se guardará.
 * El valor formateado no forma parte del nombre accesible del campo (aria-hidden + aria-describedby).
 */
export function MoneyInput({
  value,
  defaultValue,
  amount: external,
  onChange,
  name,
  required,
  placeholder,
  ariaLabel,
  autoFocus,
  preview = true,
  allowNegative = false,
}: {
  /** Texto controlado desde afuera. */
  value?: string;
  defaultValue?: unknown;
  /** Monto controlado desde afuera; el texto se resincroniza si cambia por otra razón (p. ej. al borrar una fila). */
  amount?: number | null;
  onChange?: (text: string, amount: number | null) => void;
  name?: string;
  required?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  preview?: boolean;
  allowNegative?: boolean;
}) {
  const [own, setOwn] = useState(() => moneyText(external ?? defaultValue));
  useEffect(() => {
    if (external !== undefined && (external ?? 0) !== (parseMoney(own, allowNegative) ?? 0))
      setOwn(moneyText(external));
  }, [external]);
  const text = value ?? own,
    amount = parseMoney(text, allowNegative),
    previewId = useId();
  return (
    <>
      <input
        name={name}
        type="text"
        inputMode={allowNegative ? 'text' : 'numeric'}
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-describedby={preview ? previewId : undefined}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => {
          setOwn(e.target.value);
          onChange?.(e.target.value, parseMoney(e.target.value, allowNegative));
        }}
      />
      {preview && (
        <small id={previewId} className="money-preview" aria-hidden="true">
          {amount === null ? '' : money(amount)}
        </small>
      )}
    </>
  );
}
export const date = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '—';
export const utc = (value: string) =>
  new Date(`${value.length === 10 ? `${value}T00:00` : value}-05:00`).toISOString();
export const localDateTime = (date = new Date()) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(date)
    .replace(' ', 'T');
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'orange' | 'red' | 'blue';
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Inbox size={32} strokeWidth={1.4} />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-header">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" onCancel={onClose}>
      <div className="modal-header">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Cerrar" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export interface Field {
  name: string;
  label: string;
  type?:
    | 'text'
    | 'number'
    | 'money'
    | 'password'
    | 'email'
    | 'textarea'
    | 'select'
    | 'checkbox'
    | 'photo'
    | 'datetime-local'
    | 'date'
    | 'month'
    | 'time'
    | 'multiselect';
  required?: boolean;
  value?: unknown;
  hint?: string;
  min?: number;
  max?: number;
  step?: string;
  options?: { value: string; label: string }[];
}
function FormField({ field, children }: { field: Field; children: ReactNode }) {
  const Container = field.type === 'multiselect' ? 'div' : 'label';
  return (
    <Container
      className={`field ${['textarea', 'photo', 'multiselect'].includes(field.type ?? '') ? 'wide' : ''} ${field.type === 'checkbox' ? 'check-field' : ''}`}
      role={field.type === 'multiselect' ? 'group' : undefined}
      aria-label={field.type === 'multiselect' ? field.label : undefined}
    >
      {children}
    </Container>
  );
}
export function FieldsForm({
  fields,
  onSubmit,
  submit = 'Guardar',
  children,
  onCancel,
  initial = {},
}: {
  fields: Field[];
  onSubmit: (values: Record<string, any>) => Promise<unknown>;
  submit?: string;
  children?: ReactNode;
  onCancel?: () => void;
  initial?: Record<string, unknown>;
}) {
  const app = useApp();
  const [values, setValues] = useState<Record<string, any>>(() =>
      Object.fromEntries(
        fields.map((f) => [
          f.name,
          initial[f.name] ?? f.value ?? (f.type === 'checkbox' ? false : f.type === 'multiselect' ? [] : ''),
        ]),
      ),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const change = (field: Field, value: unknown) => setValues((v) => ({ ...v, [field.name]: value }));
  return (
    <form
      className="fields-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
          const ready = { ...values };
          for (const f of fields) {
            if (f.type === 'number') ready[f.name] = values[f.name] === '' ? null : Number(values[f.name]);
            if (f.type === 'money') {
              const amount = parseMoney(values[f.name]);
              if (amount === null && String(values[f.name] ?? '').trim())
                throw new Error(`${f.label}: escribe un monto en pesos.`);
              if (amount !== null && f.min !== undefined && amount < f.min)
                throw new Error(`${f.label}: el mínimo es ${money(f.min)}.`);
              if (amount !== null && f.max !== undefined && amount > f.max)
                throw new Error(`${f.label}: el máximo es ${money(f.max)}.`);
              ready[f.name] = amount;
            }
            if (f.type === 'photo')
              ready[f.name] = values[f.name] instanceof File ? await app.photo(values[f.name]) : undefined;
          }
          await onSubmit(ready);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        {fields.map((f) => (
          <FormField key={f.name} field={f}>
            <span>
              {f.label}
              {f.required && ' *'}
            </span>
            {f.type === 'textarea' ? (
              <textarea
                required={f.required}
                maxLength={1500}
                value={values[f.name]}
                onChange={(e) => change(f, e.target.value)}
              />
            ) : f.type === 'select' ? (
              <select
                required={f.required}
                value={values[f.name]}
                onChange={(e) => change(f, e.target.value)}
              >
                <option value="">Seleccionar…</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === 'multiselect' ? (
              <div className="choice-list">
                {f.options?.map((o) => (
                  <label key={o.value}>
                    <input
                      type="checkbox"
                      checked={values[f.name].includes(o.value)}
                      onChange={(e) =>
                        change(
                          f,
                          e.target.checked
                            ? [...values[f.name], o.value]
                            : values[f.name].filter((v: string) => v !== o.value),
                        )
                      }
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            ) : f.type === 'photo' ? (
              <div className="photo-input">
                <Camera size={20} />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  capture="environment"
                  required={f.required}
                  onChange={(e) => change(f, e.target.files?.[0])}
                />
              </div>
            ) : f.type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={!!values[f.name]}
                onChange={(e) => change(f, e.target.checked)}
              />
            ) : f.type === 'money' ? (
              <MoneyInput
                required={f.required}
                value={
                  typeof values[f.name] === 'number' ? moneyText(values[f.name]) : (values[f.name] ?? '')
                }
                onChange={(text) => change(f, text)}
              />
            ) : (
              <input
                type={f.type ?? 'text'}
                required={f.required}
                min={f.min}
                max={f.max}
                step={f.step ?? (f.type === 'number' ? '1' : undefined)}
                value={values[f.name] ?? ''}
                autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                onChange={(e) => change(f, e.target.value)}
              />
            )}
            {f.hint && <small>{f.hint}</small>}
          </FormField>
        ))}
      </div>
      {children}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={18} /> : null}
          {busy ? 'Guardando…' : submit}
        </button>
      </div>
    </form>
  );
}
export const stateNames: Record<string, string> = {
  open: 'Abierto',
  paid: 'Cobrado',
  void_requested: 'Anulación pendiente',
  voided: 'Anulado',
  unpaid_incident: 'Entregado sin pagar',
  tasting_only: 'Solo degustaciones',
  requested: 'Solicitado',
  closed: 'Cerrado',
  provisional: 'Pendiente de sincronizar',
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  in_transit: 'En tránsito',
  confirmed: 'Confirmado',
  disputed: 'En disputa',
  partial: 'Recepción parcial',
  received: 'Recibido',
  issued: 'Disponible',
  redeemed: 'Redimido',
  cancelled: 'Cancelado',
};
