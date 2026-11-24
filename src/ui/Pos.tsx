import { AddPackages } from './AddPackages.tsx';
import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Minus,
  Check,
  ShoppingBag,
  ArrowRight,
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
import { checkoutPromotions, lineTotal, quoteOrder } from '../domain/pricing.ts';
import { additionsTotal, configuredAdditions, type CandyAddition } from '../domain/additions.ts';
import { hasAlcohol, sameFlavors } from '../domain/flavors.ts';
import { FlavorPortions, flavorName, portionLabel } from './FlavorDetails.tsx';
import {
  canWork,
  hasPermission,
  isOrderAssistant,
  isShiftCashier,
  shiftBlocksSales,
} from '../domain/access.ts';
import { operatingShift } from '../domain/employee-view.ts';
import { FlavorImage } from './FlavorImage.tsx';
import {
  ORDER_NAME_MAX_LENGTH,
  type MoneyLocation,
  type Order,
  type OrderLine,
  type State,
} from '../domain/types.ts';
import { paymentMethod, cupBalances, quotePayment, usesCupPackages } from '../domain/engine.ts';
import { Badge, Empty, Modal, MoneyInput, money, date, orderLabel, stateNames } from './components.tsx';
import { parseMoney } from '../lib/money.ts';
import { isNequiAccount, paymentNote, paymentOptionLabel, transferAccountName } from './payment-labels.ts';
import { TastingsEditor } from './TastingsEditor.tsx';
import { RegisterCashExpense } from './RegisterCashExpense.tsx';

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
  focusCoupon,
  eligiblePromotions,
  onClose,
  onDone,
}: {
  order: Order;
  initialPayment: PaymentChoice;
  focusCoupon: boolean;
  eligiblePromotions: ReturnType<typeof checkoutPromotions>;
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
    [promotionIds, setPromotionIds] = useState<string[]>([]),
    [unusedCodes, setUnusedCodes] = useState<string[]>([]),
    [applications, setApplications] = useState<
      { code: string; lineId: string; quantity: number; unitAmount: number }[]
    >([]),
    [total, setTotal] = useState(order.total),
    [quotedLines, setQuotedLines] = useState<OrderLine[]>(order.lines),
    [scanner, setScanner] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [deliver, setDeliver] = useState(true),
    [tendered, setTendered] = useState(''),
    [refundPhoto, setRefundPhoto] = useState<File | null>(null);
  const submitting = useRef(false);
  const refreshQuote = async (all: string[], selected: string[]) => {
    setBusy(true);
    setError('');
    try {
      let quote;
      if (app.online) {
        await app.sync();
        quote = await api('quote', { orderId: order.id, codes: all, promotionIds: selected });
      } else {
        quote = quotePayment(state, order, new Date().toISOString(), false, all, selected);
      }
      setTotal(quote.total);
      setQuotedLines(quote.lines);
      setCodes(all);
      setUnusedCodes(quote.unusedCodes ?? []);
      setApplications(quote.applications ?? []);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const togglePromotion = async (id: string, checked: boolean) => {
    const candidate = eligiblePromotions.find((item) => item.id === id);
    const canCombine =
      candidate?.stackable === true &&
      promotionIds.every((key) => eligiblePromotions.find((item) => item.id === key)?.stackable === true);
    const next = checked
      ? canCombine
        ? [...promotionIds, id]
        : [id]
      : promotionIds.filter((key) => key !== id);
    if (await refreshQuote(codes, next)) setPromotionIds(next);
  };
  const validate = async (value = code) => {
    const all = [...new Set([...codes, value.trim().toUpperCase()].filter(Boolean))];
    if (await refreshQuote(all, promotionIds)) {
      setCode('');
      app.toast('Beneficios verificados. Solo se consumen los aplicados al confirmar el cobro.');
    }
  };
  const due = total - (order.paymentCredit ?? 0);
  const freeCups = quotedLines
    .flatMap((line) => line.appliedRules ?? [])
    .filter((rule) => rule.couponId && rule.promotion.effect === 'free')
    .reduce((sum, rule) => sum + rule.quantity, 0);
  const isFreeCourtesy = codes.length > 0 && due === 0 && freeCups > 0;
  return (
    <Modal title={`Cobrar pedido ${orderLabel(order)}`} onClose={onClose}>
      <div className="checkout">
        <div className="checkout-amount">
          <small>Total del pedido</small>
          <strong>{money(total)}</strong>
          {order.additions?.length ? (
            <span>Incluye {money(additionsTotal(order.additions))} en adiciones</span>
          ) : null}
          {order.paymentCredit !== undefined && (
            <span>
              Pago anterior aplicado: {money(order.paymentCredit)} · {due < 0 ? 'Devolver' : 'Recibir'}:{' '}
              {money(Math.abs(due))}
            </span>
          )}
        </div>
        {eligiblePromotions.map((promotion) => (
          <label key={promotion.id} className="check-inline">
            <input
              type="checkbox"
              checked={promotionIds.includes(promotion.id)}
              disabled={busy}
              onChange={(event) => void togglePromotion(promotion.id, event.target.checked)}
            />
            <span>
              <strong>{promotion.name}</strong>
              {promotion.checkoutText && <small>{promotion.checkoutText}</small>}
            </span>
          </label>
        ))}
        {order.paymentCredit === undefined && !order.carriedCouponFromId && (
          <div className="coupon-entry">
            <label>
              Código de beneficio <small>Requiere conexión</small>
              <div className="input-action">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Escribir código"
                  aria-label="Código de cupón o cortesía"
                  autoFocus={focusCoupon}
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
                  <Badge key={c} tone={unusedCodes.includes(c) ? 'neutral' : 'green'}>
                    <Ticket size={13} />
                    {c} {unusedCodes.includes(c) ? '· Sin usar' : '· Aplicado'}
                  </Badge>
                ))}
              </div>
            )}
            {applications.map((a, index) => {
              const line = order.lines.find((l) => l.id === a.lineId);
              return (
                <p key={index}>
                  {a.code} → {a.quantity} × {state.flavors.find((f) => f.id === line?.flavorId)?.name} ·{' '}
                  {state.sizes.find((s) => s.id === line?.sizeId)?.name}. Por producto: {money(a.unitAmount)}
                </p>
              );
            })}
            {unusedCodes.length > 0 && (
              <p className="notice info">
                Sin canjear: {unusedCodes.join(', ')}. Se conservan disponibles hasta su vencimiento; no
                generan dinero ni vuelto.
              </p>
            )}
            {codes.length > 0 && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setCodes([]);
                  setUnusedCodes([]);
                  setApplications([]);
                  setTotal(order.total);
                  setQuotedLines(order.lines);
                }}
              >
                Quitar cupones y revisar de nuevo
              </button>
            )}
          </div>
        )}
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
          disabled={busy || (due < 0 && !refundPhoto) || !!code || (codes.length > 0 && !app.online)}
          onClick={async () => {
            if (submitting.current) return;
            submitting.current = true;
            setBusy(true);
            setError('');
            try {
              const refundEvidenceId = refundPhoto ? await app.photo(refundPhoto) : undefined;
              const result = await app.run(
                codes.length ? 'redeem_coupon' : 'pay',
                {
                  orderId: order.id,
                  expectedVersion: order.version,
                  expectedTotal: total,
                  codes,
                  promotionIds,
                  deliver,
                  refundEvidenceId,
                  ...paymentPayload(payment),
                },
                { onlineOnly: promotionIds.length > 0 && app.online },
              );
              app.toast(
                isFreeCourtesy
                  ? 'Cortesía registrada · $0'
                  : `${result.pendingSync ? 'Venta guardada en este equipo, pendiente de sincronizar' : 'Venta registrada'} · ${money(total)}${paymentNote(payment, state.locations)}`,
              );
              onDone();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              submitting.current = false;
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
    [nameDraft, setNameDraft] = useState<{ orderId: string | null; value: string } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [checkout, setCheckout] = useState<'payment' | 'benefit' | null>(null),
    [packageSize, setPackageSize] = useState<string | null>(null),
    [showOrders, setShowOrders] = useState(false),
    [mixing, setMixing] = useState(false),
    [mixFlavors, setMixFlavors] = useState<string[]>([]),
    [flavorGroup, setFlavorGroup] = useState('all'),
    [promotionTime, setPromotionTime] = useState(() => new Date().toISOString()),
    [payment, setPayment] = useState<PaymentChoice>(CASH);
  const actionInProgress = useRef(false);
  const active = operatingShift(state),
    orderAssistant = !app.viewRole && isOrderAssistant(actor, state),
    activeOrderKey = `active-order:${actor.branchId ?? 'legacy'}:${actor.id}`,
    storedOrder = state.orders.find((x) => x.id === orderId && x.status === 'open'),
    size = state.sizes.find((x) => x.id === sizeId),
    open = state.orders.filter((x) => x.status === 'open');
  const normalQuote =
    storedOrder && !storedOrder.carriedCouponFromId && storedOrder.lines.some((line) => line.discount > 0)
      ? quoteOrder(state, storedOrder.lines, promotionTime, app.online, [], storedOrder.additions)
      : undefined;
  const order =
    storedOrder && normalQuote
      ? { ...storedOrder, lines: normalQuote.lines, total: normalQuote.total }
      : storedOrder;
  const customerName =
    nameDraft && nameDraft.orderId === (order?.id ?? null) ? nameDraft.value : (order?.customerName ?? '');
  const canCash =
    hasPermission(actor, 'payments') &&
    !!active &&
    !shiftBlocksSales(active) &&
    order?.cashHandoff !== 'draft' &&
    isShiftCashier({ ...actor, online: app.online }, active);
  const canOrders =
    canWork(actor, state, 'orders', order?.shiftId) &&
    (!orderAssistant || app.online) &&
    (order?.cashHandoff !== 'sent' || canCash);
  const canDeliver = order?.cashHandoff !== 'draft' && canWork(actor, state, 'deliveries', order?.shiftId);
  const canCancel = !!order && !order.replacesId && !order.lines.some((line) => line.delivered > 0);
  const eligiblePromotions =
    order && order.paymentCredit === undefined && !order.replacesId && !order.carriedCouponFromId
      ? checkoutPromotions(state, order.lines, promotionTime, app.online)
      : [];
  const mixPrice = hasAlcohol({ flavorId: mixFlavors[0], flavorIds: mixFlavors }, state.flavors)
    ? size?.alcoholPrice
    : size?.plainPrice;
  useEffect(() => {
    const timer = setInterval(() => setPromotionTime(new Date().toISOString()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void getMeta<string>(activeOrderKey).then((key) => {
      if (!cancelled) setOrderId(key ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeOrderKey]);
  const select = (key: string | null) => {
    setOrderId(key);
    setNameDraft(null);
    void setMeta(activeOrderKey, key);
    setShowOrders(false);
    setMixFlavors([]);
    // Cada pedido nuevo vuelve a efectivo, el medio más común.
    setPayment(CASH);
  };
  const action = async (work: () => Promise<unknown>) => {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionInProgress.current = false;
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
  const adjustAddition = (id: CandyAddition['id'], delta: number) =>
    void action(async () => {
      if (!order) return;
      const quantities = new Map(order.additions?.map((item) => [item.id, item.quantity]));
      quantities.set(id, (quantities.get(id) ?? 0) + delta);
      const additions = [...quantities].flatMap(([id, quantity]) => (quantity > 0 ? [{ id, quantity }] : []));
      await app.run('update_order', {
        orderId: order.id,
        expectedVersion: order.version,
        lines: inputs(order.lines),
        additions,
      });
    });
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
      const result = await app.run('create_order', {
        lines: [{ ...product, quantity: 1 }],
        customerName: customerName.trim() || undefined,
        ...(!canCash ? { cashDraft: true } : {}),
      });
      select(result.referenceId!);
    }
  };
  const addFlavor = (flavorId: string) => {
    if (mixing) {
      setMixFlavors((selected) =>
        selected.includes(flavorId) ? selected.filter((id) => id !== flavorId) : [...selected, flavorId],
      );
      return;
    }
    void action(() => addProduct([flavorId]));
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
              : orderAssistant
                ? 'Los pedidos se habilitan cuando caja abre su turno.'
                : 'Solicita y autoriza el turno antes de vender'}
        </span>
        <div className="strip-end">
          <Clock3 size={15} />
          {active ? date(active.openedAt) : 'Caja única'}
        </div>
        <RegisterCashExpense key={active?.id} shift={active} />
      </div>
      {state.settings[0].auditId && (
        <div className="notice warning">
          {state.settings[0].auditRequest?.opening
            ? 'Presenta el arqueo de apertura en Turno y caja antes de vender.'
            : 'Arqueo en curso. Usa la planilla manual y conserva por separado el efectivo recibido después del corte.'}
        </div>
      )}
      {active && shiftBlocksSales(active) && (
        <div className="notice warning" role="status">
          Ventas en pausa mientras se completa el conteo del turno.
        </div>
      )}
      {!app.online && (
        <div className="notice warning">
          Sin conexión.{' '}
          {orderAssistant
            ? 'Conéctate para tomar pedidos y enviarlos a caja.'
            : actor.primary
              ? 'Las ventas se guardan en este equipo.'
              : 'Registra pedidos desde el equipo de caja mientras vuelve la conexión.'}
        </div>
      )}
      {actor.role === 'admin' &&
        active &&
        !state.settings[0].auditId &&
        size &&
        usesCupPackages(size) &&
        (cupBalances(state)[`cup:${size.id}`] ?? 0) <= 0 && (
          <div className="notice warning" aria-live="polite">
            <span>
              Según el sistema no quedan vasos sueltos de {size.name}. ¿Deseas registrar la apertura de un
              paquete? Cada paquete agrega {state.settings[0].cupPackageUnits} vasos. Si ya lo abriste,
              regístralo para evitar faltantes.
            </span>
            {canWork(actor, state, 'inventory') ? (
              <button className="button secondary" disabled={busy} onClick={() => setPackageSize(size.id)}>
                Agregar paquetes
              </button>
            ) : (
              <span>Pide al responsable de inventario que registre la apertura.</span>
            )}
          </div>
        )}
      <div className="pos-layout">
        <div className="catalog-pane">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PREPARA EL PEDIDO</span>
              <h2>¿Qué tamaño llevamos?</h2>
            </div>
          </div>
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
          <div className="section-heading small">
            <h3>{mixing ? 'Elige los sabores del vaso' : 'Elige un sabor'}</h3>
            <span>{state.flavors.filter((x) => x.active).length} disponibles</span>
          </div>
          <div className="segmented" role="group" aria-label="Filtrar sabores por licor">
            {[
              ['all', 'Todos'],
              ['no', 'Sin licor'],
              ['yes', 'Con licor'],
            ].map(([key, label]) => (
              <button
                key={key}
                className={flavorGroup === key ? 'active' : ''}
                aria-pressed={flavorGroup === key}
                onClick={() => setFlavorGroup(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {state.flavors.some((x) => x.active) ? (
            <div className="flavor-grid">
              {state.flavors
                .filter((f) => f.active && (flavorGroup === 'all' || f.alcohol === (flavorGroup === 'yes')))
                .sort((a, b) => a.name.localeCompare(b.name, 'es'))
                .map((f, index) => {
                  const price = f.alcohol ? size?.alcoholPrice : size?.plainPrice;
                  return (
                    <button
                      key={f.id}
                      className={`flavor-card flavor-${index % 6} ${mixing && mixFlavors.includes(f.id) ? 'selected' : ''}`}
                      aria-pressed={mixing ? mixFlavors.includes(f.id) : undefined}
                      onClick={() => addFlavor(f.id)}
                      disabled={
                        busy ||
                        !canOrders ||
                        !active ||
                        !!state.settings[0].auditId ||
                        (!app.online && !actor.primary) ||
                        (!mixing && price == null)
                      }
                    >
                      <div className="flavor-art">
                        <FlavorImage imageId={f.imageId} name={f.name} />
                        <span className="cup-shape">
                          <span />
                        </span>
                        <span className="flavor-orbit" />
                        <span className="flavor-plus">
                          {mixing && mixFlavors.includes(f.id) ? <Check size={19} /> : <Plus size={19} />}
                        </span>
                      </div>
                      <div className="flavor-info">
                        <span className="flavor-category">{f.alcohol ? 'CON LICOR' : 'SIN LICOR'}</span>
                        <strong>{f.name}</strong>
                        <span>
                          {mixing
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
          {mixing && (
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
                  !canOrders ||
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
        </div>
        <aside className="cart-panel">
          <div className="cart-heading">
            <div>
              <ShoppingBag size={20} />
              <h2>{order ? `Pedido ${orderLabel(order)}` : 'Nuevo pedido'}</h2>
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
                    {orderLabel(o)} · {profiles.find((p) => p.id === o.sellerId)?.name}
                  </span>
                  <strong>{money(o.total)}</strong>
                </button>
              ))}
              {!open.length && <p>No hay pedidos abiertos.</p>}
            </div>
          )}
          {canOrders && (
            <form
              className="cart-order-name"
              onSubmit={(event) => {
                event.preventDefault();
                if (!order || customerName.trim() === (order.customerName ?? '')) return;
                void action(async () => {
                  await app.run('update_order', {
                    orderId: order.id,
                    expectedVersion: order.version,
                    customerName: customerName.trim(),
                  });
                  setNameDraft(null);
                });
              }}
            >
              <label className="field">
                <span>Nombre del pedido (opcional)</span>
                <input
                  value={customerName}
                  maxLength={ORDER_NAME_MAX_LENGTH}
                  placeholder="Ej. María"
                  disabled={busy}
                  onChange={(event) =>
                    setNameDraft({ orderId: order?.id ?? null, value: event.target.value })
                  }
                />
              </label>
              {order && customerName.trim() !== (order.customerName ?? '') && (
                <button className="text-button" type="submit" disabled={busy}>
                  Guardar nombre
                </button>
              )}
            </form>
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
                            !canOrders ||
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
                          disabled={busy || !canOrders}
                          onClick={() => adjust(line, 1)}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      {!orderAssistant && (
                        <button
                          className={`delivery-chip ${line.delivered === line.quantity ? 'done' : ''}`}
                          disabled={busy || !canDeliver || !active || line.delivered === line.quantity}
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
                      )}
                    </div>
                    {line.discount > 0 && (
                      <small className="discount">Beneficio aplicado: −{money(line.discount)}</small>
                    )}
                  </div>
                ))}
                {order.lines.length > 0 && (
                  <details className="cart-line candy-additions">
                    <summary>
                      Adiciones{order.additions?.length ? ` · ${money(additionsTotal(order.additions))}` : ''}
                    </summary>
                    {configuredAdditions(state.settings[0].candyPrices).map((addition) => {
                      const quantity =
                        order.additions?.find((item) => item.id === addition.id)?.quantity ?? 0;
                      return (
                        <div className="list-row" key={addition.id}>
                          <div>
                            <strong>{addition.name}</strong>
                            <small>{money(addition.unitPrice)}</small>
                          </div>
                          <div className="quantity-control">
                            <button
                              type="button"
                              aria-label={`Quitar ${addition.name}`}
                              disabled={busy || !canOrders || quantity === 0}
                              onClick={() => adjustAddition(addition.id, -1)}
                            >
                              <Minus size={13} />
                            </button>
                            <span>{quantity}</span>
                            <button
                              type="button"
                              aria-label={`Agregar ${addition.name}`}
                              disabled={busy || !canOrders || quantity >= 500}
                              onClick={() => adjustAddition(addition.id, 1)}
                            >
                              <Plus size={13} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </details>
                )}
                {!orderAssistant && (
                  <TastingsEditor
                    order={order}
                    busy={busy}
                    onBusyChange={setBusy}
                    onEmpty={() => select(null)}
                  />
                )}
              </div>
              <div className="cart-footer">
                <div className="cart-total">
                  <span>{orderAssistant ? 'Total del pedido' : 'Total a cobrar'}</span>
                  <strong>{money(order.total)}</strong>
                </div>
                {canCash && order.lines.length > 0 ? (
                  <>
                    <PaymentPicker value={payment} onChange={setPayment} accounts={transferAccounts(state)} />
                    <button
                      className="button primary full large"
                      disabled={busy || !!state.settings[0].auditId}
                      onClick={() => {
                        if (eligiblePromotions.length) {
                          setCheckout('payment');
                          return;
                        }
                        void action(async () => {
                          const result = await app.run('pay', {
                            orderId: order.id,
                            expectedVersion: order.version,
                            expectedTotal: order.total,
                            deliver: true,
                            ...paymentPayload(payment),
                          });
                          app.toast(
                            `${result.pendingSync ? 'Venta guardada en este equipo, pendiente de sincronizar' : 'Venta registrada'} · ${money(order.total)}${paymentNote(payment, state.locations)}`,
                          );
                          select(null);
                        });
                      }}
                    >
                      <Check size={20} />
                      {eligiblePromotions.length ? 'Revisar cobro' : 'Cobrar y entregar'}
                      <ArrowRight size={18} />
                    </button>
                    {order.paymentCredit === undefined && !order.carriedCouponFromId && (
                      <button
                        className="button secondary full redeem-benefit"
                        disabled={busy || !app.online || !!state.settings[0].auditId}
                        onClick={() => setCheckout('benefit')}
                      >
                        <Ticket size={15} />
                        Redimir cupón, cortesía o promoción
                      </button>
                    )}
                    <button
                      className="text-button full"
                      disabled={busy || !!state.settings[0].auditId}
                      onClick={() => setCheckout('payment')}
                    >
                      Vuelto o entregar después
                    </button>
                  </>
                ) : order.cashHandoff === 'sent' ? (
                  <p className="muted">Pedido enviado a caja.</p>
                ) : order.lines.length > 0 ? (
                  <button
                    className="button primary full"
                    disabled={busy || !app.online || !canOrders}
                    onClick={() =>
                      void action(async () => {
                        const result = await app.run('send_order', {
                          orderId: order.id,
                          expectedVersion: order.version,
                        });
                        if (result.referenceId !== order.id)
                          throw new Error(
                            'El servidor no confirmó el envío. Revisa Estado de sincronización.',
                          );
                        select(null);
                        app.toast('Pedido disponible en el equipo de caja.');
                      })
                    }
                  >
                    Enviar a caja
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
                    disabled={busy || !canOrders || !!state.settings[0].auditId}
                    onClick={() => void action(cancelOrder)}
                  >
                    <Trash2 size={15} />
                    Cancelar pedido
                  </button>
                )}
                {!orderAssistant && (
                  <button className="text-button full" disabled={busy} onClick={() => select(null)}>
                    Guardar y abrir otro pedido
                  </button>
                )}
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
                <span>{orderAssistant ? '3 · Enviar a caja' : '3 · Cobrar'}</span>
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
            {app.online
              ? 'Conectado al negocio'
              : orderAssistant
                ? 'Sin conexión'
                : 'Guardado en este equipo'}
          </div>
        </aside>
      </div>
      {checkout && order && (
        <Checkout
          key={`${order.id}:${order.version}`}
          order={order}
          initialPayment={payment}
          focusCoupon={checkout === 'benefit'}
          eligiblePromotions={eligiblePromotions}
          onClose={() => setCheckout(null)}
          onDone={() => {
            setCheckout(null);
            select(null);
          }}
        />
      )}
      {packageSize && <AddPackages suggested={{ [packageSize]: 1 }} onClose={() => setPackageSize(null)} />}
    </>
  );
}
