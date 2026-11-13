import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Minus,
  Check,
  ShoppingBag,
  ArrowRight,
  FlaskConical,
  ScanLine,
  Ticket,
  Trash2,
  Clock3,
  UserRound,
  PackageCheck,
} from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import { api } from '../lib/api.ts';
import { getMeta, setMeta } from '../lib/db.ts';
import { lineTotal } from '../domain/pricing.ts';
import { hasAlcohol, sameFlavors } from '../domain/flavors.ts';
import { FlavorPortions, flavorName, portionLabel } from './FlavorDetails.tsx';
import { isShiftCashier } from '../domain/access.ts';
import type { MoneyLocation, Order, OrderLine, State } from '../domain/types.ts';
import { paymentMethod } from '../domain/engine.ts';
import { Badge, Empty, FieldsForm, Modal, MoneyInput, money, date, stateNames } from './components.tsx';
import { parseMoney } from '../lib/money.ts';
import { isNequiAccount, paymentNote, paymentOptionLabel, transferAccountName } from './payment-labels.ts';
import { TastingsEditor } from './TastingsEditor.tsx';

/** Cómo paga el cliente: en efectivo o por transferencia a una cuenta del negocio. */
export interface PaymentChoice {
  method: 'cash' | 'transfer';
  accountId?: string;
  reference: string;
}
export const CASH: PaymentChoice = { method: 'cash', reference: '' };
/** Cuentas activas donde los clientes pueden transferir; para devolver dinero sirve cualquier cuenta activa. */
export const transferAccounts = (state: State, refund = false): MoneyLocation[] =>
  state.locations.filter((x) => x.active && x.type === 'bank' && (refund || x.receivesSales === true));
export const paymentPayload = (choice: PaymentChoice) =>
  choice.method === 'cash'
    ? { method: 'cash' }
    : { method: 'transfer', accountId: choice.accountId, reference: choice.reference.trim() || undefined };

/**
 * Selector de un toque por cuenta receptora. Nequi siempre se identifica por su nombre.
 * Sin una cuenta Nequi activa, la opción indica que falta configurarla.
 */
export function PaymentPicker({
  value,
  onChange,
  accounts,
}: {
  value: PaymentChoice;
  onChange: (choice: PaymentChoice) => void;
  accounts: MoneyLocation[];
}) {
  const selected = value.method === 'transfer' ? accounts.find((a) => a.id === value.accountId) : undefined;
  const hasNequi = accounts.some(isNequiAccount);
  return (
    <div className="payment-picker">
      <div className="segmented" role="group" aria-label="Medio de pago">
        <button
          type="button"
          className={value.method === 'cash' ? 'active' : ''}
          aria-pressed={value.method === 'cash'}
          onClick={() => onChange(CASH)}
        >
          Efectivo
        </button>
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            className={selected?.id === a.id ? 'active' : ''}
            aria-pressed={selected?.id === a.id}
            title={`Transferencia a ${a.name}`}
            onClick={() => onChange({ method: 'transfer', accountId: a.id, reference: value.reference })}
          >
            {paymentOptionLabel(a, accounts)}
          </button>
        ))}
        {!hasNequi && (
          <button
            type="button"
            disabled
            title="El administrador debe configurar una cuenta Nequi para recibir ventas."
          >
            Nequi
          </button>
        )}
      </div>
      {!hasNequi && (
        <small className="payment-hint">
          Para habilitar Nequi, el administrador debe configurar la cuenta en Cuentas y custodia.
        </small>
      )}
      {selected && (
        <small className="payment-hint">
          Cuenta receptora: {transferAccountName(selected)} · {selected.account}
        </small>
      )}
      {value.method === 'transfer' && (
        <input
          aria-label={
            selected && isNequiAccount(selected) ? 'Comprobante de Nequi' : 'Comprobante de la transferencia'
          }
          placeholder={`${accounts.length === 1 ? `${accounts[0].name} · ` : ''}N.º de comprobante (opcional)`}
          value={value.reference}
          maxLength={80}
          onChange={(e) => onChange({ ...value, reference: e.target.value })}
        />
      )}
    </div>
  );
}

export function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let controls: { stop: () => void } | undefined,
      cancelled = false;
    void import('@zxing/browser')
      .then(async ({ BrowserQRCodeReader }) => {
        const reader = new BrowserQRCodeReader();
        const result = await reader.decodeFromVideoDevice(undefined, video.current!, (code) => {
          if (code && !cancelled) {
            onCode(code.getText());
            onClose();
            controls?.stop();
          }
        });
        controls = result;
        if (cancelled) controls.stop();
      })
      .catch((e) => setError(`No se pudo abrir la cámara: ${(e as Error).message}`));
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, []);
  return (
    <Modal title="Escanear cupón" onClose={onClose}>
      <div className="scanner">
        <video ref={video} playsInline muted />
        {error && <p role="alert">{error}</p>}
        <p>Centra el código QR. También puedes escribir el código manualmente.</p>
      </div>
    </Modal>
  );
}

function Checkout({
  order,
  initialPayment,
  onClose,
  onDone,
}: {
  order: Order;
  initialPayment: PaymentChoice;
  onClose: () => void;
  onDone: () => void;
}) {
  const app = useApp(),
    { state } = app.data!,
    refund = (order.paymentCredit ?? 0) > order.total,
    // Si hay que devolver dinero, se propone el mismo medio con el que se pagó la venta anulada.
    original = refund
      ? state.payments.find((x) => x.orderId === order.replacesId && x.amount > 0)
      : undefined,
    [payment, setPayment] = useState<PaymentChoice>(
      original
        ? paymentMethod(original) === 'transfer'
          ? { method: 'transfer', accountId: original.accountId, reference: '' }
          : CASH
        : refund
          ? CASH
          : initialPayment,
    ),
    [code, setCode] = useState(''),
    [codes, setCodes] = useState<string[]>([]),
    [total, setTotal] = useState(order.total),
    [quotedLines, setQuotedLines] = useState<OrderLine[]>(order.lines),
    [scanner, setScanner] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [deliver, setDeliver] = useState(true),
    [tendered, setTendered] = useState(''),
    [refundPhoto, setRefundPhoto] = useState<File | null>(null);
  const validate = async (value = code) => {
    setBusy(true);
    setError('');
    try {
      const all = [...new Set([...codes, value.trim().toUpperCase()].filter(Boolean))];
      await app.sync();
      const quote = await api('quote', { orderId: order.id, codes: all });
      setTotal(quote.total);
      setQuotedLines(quote.lines);
      setCodes(all);
      setCode('');
      app.toast(
        quote.total === 0
          ? 'Cortesía verificada. Confirma el registro para canjearla.'
          : 'Código validado. Revisa el total antes de confirmar.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const due = total - (order.paymentCredit ?? 0);
  const freeCups = quotedLines
    .flatMap((line) => line.appliedRules ?? [])
    .filter((rule) => rule.couponId && rule.promotion.effect === 'free')
    .reduce((sum, rule) => sum + rule.quantity, 0);
  const isFreeCourtesy = codes.length > 0 && due === 0 && freeCups > 0;
  return (
    <Modal title={`Cobrar pedido #${order.number}`} onClose={onClose}>
      <div className="checkout">
        <div className="checkout-amount">
          <small>Total del pedido</small>
          <strong>{money(total)}</strong>
          {order.paymentCredit !== undefined && (
            <span>
              Pago anterior aplicado: {money(order.paymentCredit)} · {due < 0 ? 'Devolver' : 'Recibir'}:{' '}
              {money(Math.abs(due))}
            </span>
          )}
        </div>
        <div className="coupon-entry">
          <label>
            Cupón o cortesía <small>Requiere conexión</small>
            <div className="input-action">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Escribir código"
                aria-label="Código de cupón o cortesía"
                disabled={!app.online}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Escanear cupón"
                disabled={!app.online}
                onClick={() => setScanner(true)}
              >
                <ScanLine size={20} />
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={!code || !app.online || busy}
                onClick={() => void validate()}
              >
                Validar
              </button>
            </div>
          </label>
          {codes.length > 0 && (
            <div className="coupon-tags">
              {codes.map((c) => (
                <Badge key={c} tone="green">
                  <Ticket size={13} />
                  {c}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {freeCups > 0 && (
          <div className="notice info">
            Cortesía aplicada: {freeCups} vaso{freeCups > 1 ? 's' : ''} completo{freeCups > 1 ? 's' : ''} sin
            cobro, con todos sus sabores y componentes.
            {due === 0
              ? ' Este pedido no requiere recibir dinero.'
              : ` Los demás productos conservan su cobro: ${money(Math.max(0, due))}.`}
          </div>
        )}
        {due !== 0 && (
          <PaymentPicker value={payment} onChange={setPayment} accounts={transferAccounts(state, due < 0)} />
        )}
        {due > 0 && payment.method === 'cash' && (
          <label className="field">
            <span>
              Efectivo recibido <small>Opcional</small>
            </span>
            <MoneyInput
              value={tendered}
              onChange={(text) => setTendered(text)}
              placeholder={money(due)}
              preview={false}
            />
            {parseMoney(tendered) !== null &&
              (parseMoney(tendered)! >= due ? (
                <small>Vuelto: {money(parseMoney(tendered)! - due)}</small>
              ) : (
                <small className="warning-text">Faltan {money(due - parseMoney(tendered)!)}</small>
              ))}
          </label>
        )}
        {due < 0 && (
          <label className="field">
            <span>Foto del reembolso *</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              required
              onChange={(e) => setRefundPhoto(e.target.files?.[0] ?? null)}
            />
          </label>
        )}
        <label className="check-inline">
          <input type="checkbox" checked={deliver} onChange={(e) => setDeliver(e.target.checked)} /> Marcar
          los productos pendientes como entregados
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button
          className="button primary full large"
          disabled={busy || (due < 0 && !refundPhoto) || !!code}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const refundEvidenceId = refundPhoto ? await app.photo(refundPhoto) : undefined;
              await app.run(codes.length ? 'redeem_coupon' : 'pay', {
                orderId: order.id,
                expectedVersion: order.version,
                expectedTotal: total,
                codes,
                deliver,
                refundEvidenceId,
                ...paymentPayload(payment),
              });
              app.toast(
                isFreeCourtesy
                  ? 'Cortesía registrada · $0'
                  : `Venta registrada · ${money(total)}${paymentNote(payment, state.locations)}`,
              );
              onDone();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Check size={20} />
          {busy
            ? 'Verificando…'
            : due < 0
              ? 'Registrar devolución y corrección'
              : isFreeCourtesy
                ? deliver
                  ? 'Registrar cortesía y entregar'
                  : 'Registrar cortesía'
                : 'Confirmar cobro'}
        </button>
      </div>
      {scanner && <Scanner onCode={setCode} onClose={() => setScanner(false)} />}
    </Modal>
  );
}

export function Pos() {
  const app = useApp(),
    { state, actor, profiles } = app.data!;
  const [sizeId, setSizeId] = useState(state.sizes.find((x) => x.active)?.id ?? ''),
    [orderId, setOrderId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [checkout, setCheckout] = useState(false),
    [showOrders, setShowOrders] = useState(false),
    [tasting, setTasting] = useState(false),
    [mixing, setMixing] = useState(false),
    [mixFlavors, setMixFlavors] = useState<string[]>([]),
    [payment, setPayment] = useState<PaymentChoice>(CASH);
  const active = state.shifts.find((x) => x.status === 'open'),
    order = state.orders.find((x) => x.id === orderId && x.status === 'open'),
    size = state.sizes.find((x) => x.id === sizeId),
    open = state.orders.filter((x) => x.status === 'open');
  const canCash = isShiftCashier({ ...actor, online: app.online }, active);
  const canCancel = !!order && !order.replacesId && !order.lines.some((line) => line.delivered > 0);
  const mixPrice = hasAlcohol({ flavorId: mixFlavors[0], flavorIds: mixFlavors }, state.flavors)
    ? size?.alcoholPrice
    : size?.plainPrice;
  useEffect(() => {
    void getMeta<string>(`active-order:${actor.branchId ?? 'legacy'}`).then((key) => {
      if (key) setOrderId(key);
    });
  }, []);
  const select = (key: string | null) => {
    setOrderId(key);
    void setMeta(`active-order:${actor.branchId ?? 'legacy'}`, key);
    setShowOrders(false);
    setMixFlavors([]);
    // Cada pedido nuevo vuelve a efectivo, el medio más común.
    setPayment(CASH);
  };
  const action = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const inputs = (lines: OrderLine[]) =>
    lines.map((l) => ({
      id: l.id,
      sizeId: l.sizeId,
      flavorId: l.flavorId,
      flavorIds: l.flavorIds,
      quantity: l.quantity,
    }));
  const cancelOrder = async () => {
    if (!order || !canCancel) return;
    await app.run('cancel_order', { orderId: order.id, expectedVersion: order.version });
    select(null);
    app.toast(
      order.tastings.length
        ? 'Pedido cancelado. Las degustaciones registradas se conservan.'
        : 'Pedido cancelado.',
    );
  };
  const addProduct = async (selected: string[]) => {
    const flavorIds = [...selected].sort(),
      flavorId = flavorIds[0];
    const product = { sizeId, flavorId, flavorIds: flavorIds.length > 1 ? flavorIds : undefined };
    if (order) {
      const lines = inputs(order.lines),
        prior = lines.find((line) => line.sizeId === sizeId && sameFlavors(line, product));
      if (prior) prior.quantity++;
      else lines.push({ id: crypto.randomUUID(), ...product, quantity: 1 });
      await app.run('update_order', { orderId: order.id, lines, expectedVersion: order.version });
    } else {
      const result = await app.run('create_order', { lines: [{ ...product, quantity: 1 }] });
      select(result.referenceId!);
    }
  };
  const addFlavor = (flavorId: string) => {
    if (mixing && !tasting) {
      setMixFlavors((selected) =>
        selected.includes(flavorId) ? selected.filter((id) => id !== flavorId) : [...selected, flavorId],
      );
      return;
    }
    void action(async () => {
      if (tasting) {
        const result = await app.run('taste', {
          orderId: order?.id,
          expectedVersion: order?.version,
          flavorId,
        });
        select(result.referenceId!);
        setTasting(false);
        return;
      }
      await addProduct([flavorId]);
    });
  };
  const adjust = (line: OrderLine, delta: number) =>
    void action(async () => {
      if (!order) return;
      const lines = inputs(order.lines)
        .map((x) => (x.id === line.id ? { ...x, quantity: x.quantity + delta } : x))
        .filter((x) => x.quantity > 0);
      if (!lines.length) {
        await cancelOrder();
        return;
      }
      await app.run('update_order', { orderId: order.id, expectedVersion: order.version, lines });
    });
  return (
    <>
      <div className="shift-strip">
        <span className={`status-dot ${active ? 'green' : 'orange'}`} />
        <strong>{active ? 'Turno abierto' : 'Turno pendiente'}</strong>
        <span>
          {active
            ? profiles.find((p) => p.id === active.cashierId)?.name
            : actor.role === 'admin'
              ? 'Inicia tu caja en Turno y caja, sin autorización de otro administrador.'
              : 'Solicita y autoriza el turno antes de vender'}
        </span>
        <div className="strip-end">
          <Clock3 size={15} />
          {active ? date(active.openedAt) : 'Caja única'}
        </div>
      </div>
      {state.settings[0].auditId && (
        <div className="notice warning">
          Arqueo en curso. Usa la planilla manual y conserva por separado el efectivo recibido después del
          corte.
        </div>
      )}
      {!app.online && (
        <div className="notice warning">
          Sin conexión.{' '}
          {actor.primary
            ? 'Las ventas se guardan en este equipo. Los cupones esperan conexión.'
            : 'Registra pedidos desde el equipo de caja mientras vuelve la conexión.'}
        </div>
      )}
      <div className="pos-layout">
        <div className="catalog-pane">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PREPARA EL PEDIDO</span>
              <h2>{tasting ? 'Elige el sabor de la degustación' : '¿Qué tamaño llevamos?'}</h2>
            </div>
            <button
              className={`button ${tasting ? 'primary' : 'secondary'}`}
              disabled={!active || busy}
              onClick={() => {
                setTasting((x) => !x);
                setMixFlavors([]);
              }}
            >
              <FlaskConical size={17} /> {tasting ? 'Volver a venta' : '+1 degustación'}
            </button>
          </div>
          {!tasting && (
            <div className="size-grid">
              {state.sizes
                .filter((x) => x.active)
                .map((s) => (
                  <button
                    key={s.id}
                    className={`size-option ${sizeId === s.id ? 'selected' : ''}`}
                    onClick={() => setSizeId(s.id)}
                    aria-pressed={sizeId === s.id}
                  >
                    <span>{s.name.replace(' oz', '')}</span>
                    <small>{s.name.includes('oz') ? 'ONZAS' : s.name}</small>
                    {sizeId === s.id && (
                      <span className="selected-check">
                        <Check size={12} />
                      </span>
                    )}
                  </button>
                ))}
            </div>
          )}
          {!tasting && (
            <div className="segmented flavor-mode" role="group" aria-label="Sabores por vaso">
              <button
                aria-pressed={!mixing}
                className={!mixing ? 'active' : ''}
                disabled={busy}
                onClick={() => {
                  setMixing(false);
                  setMixFlavors([]);
                }}
              >
                Un sabor
              </button>
              <button
                aria-pressed={mixing}
                className={mixing ? 'active' : ''}
                disabled={busy}
                onClick={() => setMixing(true)}
              >
                Combinado / bomba
              </button>
            </div>
          )}
          <div className="section-heading small">
            <h3>
              {tasting ? 'Una copita · 1 oz' : mixing ? 'Elige los sabores del vaso' : 'Elige un sabor'}
            </h3>
            <span>{state.flavors.filter((x) => x.active).length} disponibles</span>
          </div>
          {state.flavors.some((x) => x.active) ? (
            <div className="flavor-grid">
              {state.flavors
                .filter((f) => f.active)
                .map((f, index) => {
                  const price = f.alcohol ? size?.alcoholPrice : size?.plainPrice;
                  return (
                    <button
                      key={f.id}
                      className={`flavor-card flavor-${index % 6} ${mixing && !tasting && mixFlavors.includes(f.id) ? 'selected' : ''}`}
                      aria-pressed={mixing && !tasting ? mixFlavors.includes(f.id) : undefined}
                      onClick={() => addFlavor(f.id)}
                      disabled={
                        busy ||
                        !active ||
                        !!state.settings[0].auditId ||
                        (!app.online && !actor.primary) ||
                        (!tasting && !mixing && price == null)
                      }
                    >
                      <div className="flavor-art">
                        <span className="cup-shape">
                          <span />
                        </span>
                        <span className="flavor-orbit" />
                        <span className="flavor-plus">
                          {mixing && !tasting && mixFlavors.includes(f.id) ? (
                            <Check size={19} />
                          ) : (
                            <Plus size={19} />
                          )}
                        </span>
                      </div>
                      <div className="flavor-info">
                        <span className="flavor-category">{f.alcohol ? 'CON LICOR' : 'SIN LICOR'}</span>
                        <strong>{f.name}</strong>
                        <span>
                          {tasting
                            ? 'Degustación · 1 oz'
                            : mixing
                              ? mixFlavors.includes(f.id)
                                ? 'Seleccionado'
                                : 'Toca para combinar'
                              : price === null
                                ? 'Precio pendiente'
                                : money(price ?? 0)}
                        </span>
                      </div>
                    </button>
                  );
                })}
            </div>
          ) : (
            <Empty
              title="Tu carta comienza aquí"
              description={
                actor.role === 'admin'
                  ? 'Agrega los sabores reales en Configuración para comenzar. Los precios de los cuatro tamaños ya están cargados.'
                  : 'El administrador está preparando los sabores del negocio.'
              }
            />
          )}
          {mixing && !tasting && (
            <section className="mix-builder" aria-label="Composición del vaso" aria-live="polite">
              <strong>
                {size?.name} · {mixFlavors.length} sabores seleccionados
              </strong>
              <p>
                Selecciona dos o más sabores. Las onzas se reparten en partes iguales. Si algún sabor lleva
                licor, se cobra la tarifa con licor.
              </p>
              {mixFlavors.map((id) => (
                <div key={id} className="mix-portion">
                  <span>{state.flavors.find((flavor) => flavor.id === id)?.name}</span>
                  <span>{portionLabel((size?.ounces ?? 0) / mixFlavors.length, mixFlavors.length)}</span>
                </div>
              ))}
              <button
                className="button primary full"
                disabled={
                  busy ||
                  !active ||
                  !!state.settings[0].auditId ||
                  (!app.online && !actor.primary) ||
                  mixFlavors.length < 2 ||
                  !size ||
                  size.ounces <= 0 ||
                  mixPrice == null
                }
                onClick={() =>
                  void action(async () => {
                    await addProduct(mixFlavors);
                    setMixFlavors([]);
                    app.toast('Combinado agregado al pedido.');
                  })
                }
              >
                <Plus size={17} /> Agregar combinado
                {mixFlavors.length > 0 && (
                  <span>{mixPrice == null ? 'Precio pendiente' : money(mixPrice)}</span>
                )}
              </button>
            </section>
          )}
          <div className="catalog-note">
            <FlaskConical size={16} />
            <span>Las degustaciones descuentan una copita y 1 oz del sabor elegido.</span>
          </div>
        </div>
        <aside className="cart-panel">
          <div className="cart-heading">
            <div>
              <ShoppingBag size={20} />
              <h2>{order ? `Pedido #${order.number}` : 'Nuevo pedido'}</h2>
            </div>
            <button
              className="icon-button"
              title="Ver pedidos abiertos"
              aria-label="Ver pedidos abiertos"
              onClick={() => setShowOrders((x) => !x)}
            >
              <Clock3 size={20} />
              {open.length > 0 && <span className="count-dot">{open.length}</span>}
            </button>
          </div>
          {showOrders && (
            <div className="open-order-picker">
              <button className="text-button" onClick={() => select(null)}>
                <Plus size={15} />
                Nuevo pedido
              </button>
              {open.map((o) => (
                <button key={o.id} onClick={() => select(o.id)}>
                  <span>
                    #{o.number} · {profiles.find((p) => p.id === o.sellerId)?.name}
                  </span>
                  <strong>{money(o.total)}</strong>
                </button>
              ))}
              {!open.length && <p>No hay pedidos abiertos.</p>}
            </div>
          )}
          {order ? (
            <>
              <div className="cart-meta">
                <UserRound size={14} />
                {profiles.find((p) => p.id === order.sellerId)?.name}
                <Badge>{order.origin === 'paper' ? 'Desde papel' : 'En preparación'}</Badge>
              </div>
              <div className="cart-lines">
                {order.lines.map((line) => (
                  <div className="cart-line" key={line.id}>
                    <div className="cart-line-head">
                      <div>
                        <strong>{flavorName(line, state.flavors)}</strong>
                        <FlavorPortions line={line} state={state} />
                        <small>
                          {state.sizes.find((x) => x.id === line.sizeId)?.name} ·{' '}
                          {hasAlcohol(line, state.flavors) ? 'Con licor' : 'Sin licor'}
                        </small>
                      </div>
                      <strong>{money(lineTotal(line))}</strong>
                    </div>
                    <div className="cart-line-bottom">
                      <div className="quantity-control">
                        <button
                          aria-label="Disminuir cantidad"
                          disabled={
                            busy ||
                            line.quantity <= line.delivered ||
                            (line.quantity === 1 && order.lines.length === 1 && !canCancel)
                          }
                          onClick={() => adjust(line, -1)}
                        >
                          <Minus size={13} />
                        </button>
                        <span>{line.quantity}</span>
                        <button
                          aria-label="Aumentar cantidad"
                          disabled={busy}
                          onClick={() => adjust(line, 1)}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <button
                        className={`delivery-chip ${line.delivered === line.quantity ? 'done' : ''}`}
                        disabled={busy || line.delivered === line.quantity}
                        onClick={() =>
                          void action(() =>
                            app.run('deliver', {
                              orderId: order.id,
                              expectedVersion: order.version,
                              quantities: { [line.id]: 1 },
                            }),
                          )
                        }
                      >
                        <Check size={13} />
                        {line.delivered}/{line.quantity} entregados
                      </button>
                    </div>
                    {line.discount > 0 && (
                      <small className="discount">Beneficio aplicado: −{money(line.discount)}</small>
                    )}
                  </div>
                ))}
                <TastingsEditor
                  order={order}
                  busy={busy}
                  onBusyChange={setBusy}
                  onEmpty={() => select(null)}
                />
              </div>
              <div className="cart-footer">
                <div className="cart-total">
                  <span>Total a cobrar</span>
                  <strong>{money(order.total)}</strong>
                </div>
                {canCash && order.lines.length > 0 ? (
                  <>
                    <PaymentPicker value={payment} onChange={setPayment} accounts={transferAccounts(state)} />
                    <button
                      className="button primary full large"
                      disabled={busy || !!state.settings[0].auditId}
                      onClick={() =>
                        void action(async () => {
                          await app.run('pay', {
                            orderId: order.id,
                            expectedVersion: order.version,
                            expectedTotal: order.total,
                            deliver: true,
                            ...paymentPayload(payment),
                          });
                          app.toast(
                            `Venta registrada · ${money(order.total)}${paymentNote(payment, state.locations)}`,
                          );
                          select(null);
                        })
                      }
                    >
                      <Check size={20} />
                      Cobrar y entregar
                      <ArrowRight size={18} />
                    </button>
                    <button className="text-button full" disabled={busy} onClick={() => setCheckout(true)}>
                      <Ticket size={15} />
                      Cupón, cortesía, vuelto o entregar después
                    </button>
                  </>
                ) : order.lines.length > 0 ? (
                  <button
                    className="button primary full"
                    disabled={busy}
                    onClick={() => {
                      select(null);
                      app.toast('Pedido disponible en el equipo de caja.');
                    }}
                  >
                    Dejar en caja
                    <ArrowRight size={18} />
                  </button>
                ) : (
                  <button
                    className="button secondary full"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await app.run('close_tastings', {
                          orderId: order.id,
                          expectedVersion: order.version,
                        });
                        select(null);
                      })
                    }
                  >
                    Cerrar solo degustaciones
                  </button>
                )}
                {canCancel && order.lines.length > 0 && (
                  <button
                    className="text-button full"
                    disabled={busy || !!state.settings[0].auditId}
                    onClick={() => void action(cancelOrder)}
                  >
                    <Trash2 size={15} />
                    Cancelar pedido
                  </button>
                )}
                <button className="text-button full" disabled={busy} onClick={() => select(null)}>
                  Guardar y abrir otro pedido
                </button>
              </div>
            </>
          ) : (
            <div className="cart-empty">
              <span className="empty-bag">
                <ShoppingBag size={38} strokeWidth={1.3} />
              </span>
              <h3>Un nuevo antojo</h3>
              <p>Elige el tamaño y toca un sabor para comenzar.</p>
              <div className="cart-steps">
                <span>1 · Tamaño</span>
                <span>2 · Sabor</span>
                <span>3 · Cobrar</span>
              </div>
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="cart-bottom-note">
            <span className="status-dot green" />{' '}
            {app.online ? 'Conectado al negocio' : 'Guardado en este equipo'}
          </div>
        </aside>
      </div>
      {checkout && order && (
        <Checkout
          order={order}
          initialPayment={payment}
          onClose={() => setCheckout(false)}
          onDone={() => {
            setCheckout(false);
            select(null);
          }}
        />
      )}
    </>
  );
}
