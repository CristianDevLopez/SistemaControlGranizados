import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Plus, Ticket, Gift, Download, Share2, CalendarClock, Power } from 'lucide-react';
import { useApp } from '../lib/store.tsx';
import type { Coupon, Promotion, PromoEffect } from '../domain/types.ts';
import { downloadFile } from '../lib/export.ts';
import {
  Badge,
  Empty,
  FieldsForm,
  Modal,
  Panel,
  date,
  localDateTime,
  money,
  stateNames,
  utc,
  type Field,
} from './components.tsx';
export function Promotions() {
  const app = useApp(),
    { state, actor } = app.data!,
    [edit, setEdit] = useState<Promotion | null | undefined>(undefined),
    [issue, setIssue] = useState(false),
    [show, setShow] = useState<Coupon | null>(null),
    [excess, setExcess] = useState(false);
  const effect = (p: Promotion) =>
    p.effect === 'fixed'
      ? `Precio fijo: ${money(p.fixedPrice ?? 0)}`
      : p.effect === 'upgrade'
        ? `Upgrade de ${p.steps} tamaño${p.steps === 1 ? '' : 's'}`
        : p.effect === 'nxm'
          ? `Lleva ${p.take} y paga ${p.pay}`
          : 'Producto gratis con cupón';
  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <div>
          <h2>Beneficios que se pueden controlar</h2>
          <p>Promociones por horario y cupones de un solo uso.</p>
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={() => setIssue(true)}>
            <Ticket size={17} />
            Emitir cupón
          </button>
          <button className="button primary" onClick={() => setEdit(null)}>
            <Plus size={17} />
            Crear promoción
          </button>
        </div>
      </div>
      <div className="promo-grid">
        {state.promotions.map((p) => (
          <Panel key={p.id} className="promo-card">
            <div className="promo-card-head">
              <span className="promo-icon">
                {p.delivery === 'coupon' ? <Ticket size={23} /> : <CalendarClock size={23} />}
              </span>
              <Badge tone={p.active ? 'green' : 'neutral'}>{p.active ? 'Activa' : 'Apagada'}</Badge>
            </div>
            <h3>{p.name}</h3>
            <strong className="promo-effect">{effect(p)}</strong>
            <p>
              {p.delivery === 'coupon'
                ? 'Se aplica con código verificado online'
                : `${p.startTime}–${p.endTime} · Hora de Colombia`}
            </p>
            <small>
              {date(p.startsAt)} — {date(p.endsAt)}
            </small>
            <small>
              {p.redemptions} beneficios aplicados{p.maxRedemptions !== null ? ` de ${p.maxRedemptions}` : ''}
            </small>
            <div className="button-row">
              <button className="button small secondary" onClick={() => setEdit(p)}>
                Editar
              </button>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await app.run('save_promotion', { ...p, active: !p.active });
                    app.toast(p.active ? 'Promoción apagada.' : 'Promoción activada.');
                  } catch (e) {
                    app.toast((e as Error).message);
                  }
                }}
              >
                <Power size={15} />
                {p.active ? 'Apagar' : 'Activar'}
              </button>
            </div>
          </Panel>
        ))}
        {!state.promotions.length && (
          <Panel>
            <Empty
              title="Crea el primer beneficio"
              description="Combina producto, efecto, vigencia y forma de entrega. Cada publicación queda en el histórico."
              action={
                <button className="button primary" onClick={() => setEdit(null)}>
                  Crear promoción
                </button>
              }
            />
          </Panel>
        )}
      </div>
      <Panel
        title="Cupones emitidos"
        action={
          <button className="text-button" onClick={() => setExcess(true)}>
            Solicitar cortesía adicional
          </button>
        }
      >
        {state.coupons.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Beneficio</th>
                  <th>Vence</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...state.coupons].reverse().map((c) => (
                  <tr key={c.id}>
                    <td>
                      <code>{c.code}</code>
                      {c.courtesy && <small>Cortesía</small>}
                    </td>
                    <td>{state.promotions.find((x) => x.id === c.promotionId)?.name}</td>
                    <td>{date(c.expiresAt)}</td>
                    <td>
                      <Badge
                        tone={
                          c.status === 'redeemed'
                            ? 'neutral'
                            : c.expiresAt < new Date().toISOString()
                              ? 'orange'
                              : 'green'
                        }
                      >
                        {c.status === 'issued' && c.expiresAt < new Date().toISOString()
                          ? 'Vencido'
                          : stateNames[c.status]}
                      </Badge>
                    </td>
                    <td>
                      <button className="button small secondary" onClick={() => setShow(c)}>
                        Ver QR y compartir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Sin cupones emitidos"
            description="Los códigos no contienen datos personales. Solo se consumen al confirmar el canje online."
          />
        )}
      </Panel>
      {edit !== undefined && <PromotionDialog promotion={edit} onClose={() => setEdit(undefined)} />}
      {issue && (
        <Modal title="Emitir cupón" onClose={() => setIssue(false)}>
          <FieldsForm
            fields={[
              {
                name: 'promotionId',
                label: 'Promoción',
                type: 'select',
                required: true,
                options: state.promotions
                  .filter((x) => x.active && x.delivery === 'coupon')
                  .map((x) => ({ value: x.id, label: x.name })),
              },
              {
                name: 'expiresAt',
                label: 'Vence (hora de Colombia)',
                type: 'datetime-local',
                required: true,
                value: localDateTime(new Date(Date.now() + 15 * 86400000)),
              },
              {
                name: 'courtesy',
                label: 'Contar dentro de mi cuota de cortesías',
                type: 'checkbox',
                value: true,
              },
              {
                name: 'excessRequestId',
                label: 'Autorización de cortesía adicional (si se agotó la cuota)',
                type: 'select',
                options: state.requests
                  .filter((x) => x.type === 'courtesy_excess' && x.by === actor.id && x.status === 'approved')
                  .map((x) => ({ value: x.id, label: `Autorizada · ${date(x.reviewedAt)}` })),
              },
            ]}
            onSubmit={async (v) => {
              const result = await app.run('issue_coupon', {
                ...v,
                expiresAt: utc(v.expiresAt),
                excessRequestId: v.excessRequestId || undefined,
              });
              setIssue(false);
              app.toast('Cupón generado. Puedes abrir su QR en la lista.');
            }}
          />
        </Modal>
      )}
      {excess && (
        <Modal title="Solicitar cortesía adicional" onClose={() => setExcess(false)}>
          <FieldsForm
            fields={[{ name: 'notes', label: 'Motivo', type: 'textarea', required: true }]}
            onSubmit={async (v) => {
              await app.run('request_courtesy_excess', v);
              setExcess(false);
              app.toast('Otro admin debe revisar la solicitud.');
            }}
          />
        </Modal>
      )}
      {show && <CouponDialog coupon={show} onClose={() => setShow(null)} />}
    </div>
  );
}
function PromotionDialog({ promotion, onClose }: { promotion: Promotion | null; onClose: () => void }) {
  const app = useApp(),
    { state } = app.data!,
    [effect, setEffect] = useState<PromoEffect>(promotion?.effect ?? 'fixed'),
    [delivery, setDelivery] = useState(promotion?.delivery ?? 'schedule');
  const fields: Field[] = [
    { name: 'name', label: 'Nombre de la promoción', required: true },
    {
      name: 'startsAt',
      label: 'Desde (Colombia)',
      type: 'datetime-local',
      required: true,
      value: localDateTime(),
    },
    {
      name: 'endsAt',
      label: 'Hasta (Colombia)',
      type: 'datetime-local',
      required: true,
      value: localDateTime(new Date(Date.now() + 30 * 86400000)),
    },
    { name: 'startTime', label: 'Hora de inicio diaria', type: 'time', required: true, value: '00:00' },
    { name: 'endTime', label: 'Hora de fin diaria', type: 'time', required: true, value: '23:59' },
    {
      name: 'days',
      label: 'Días (sin seleccionar: todos)',
      type: 'multiselect',
      options: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'].map(
        (label, value) => ({ value: String(value), label }),
      ),
    },
    {
      name: 'alcohol',
      label: 'Tipo de sabor',
      type: 'select',
      value: 'all',
      options: [
        { value: 'all', label: 'Con y sin licor' },
        { value: 'yes', label: 'Con licor' },
        { value: 'no', label: 'Sin licor' },
      ],
    },
    {
      name: 'maxRedemptions',
      label: 'Límite global de beneficios (opcional)',
      type: 'number',
      min: 1,
      hint: 'Si tiene límite global, su aplicación requiere conexión.',
    },
    ...(effect === 'fixed'
      ? [{ name: 'fixedPrice', label: 'Precio promocional', type: 'money' as const, required: true, min: 1 }]
      : effect === 'upgrade'
        ? [
            {
              name: 'steps',
              label: 'Cantidad de tamaños',
              type: 'select' as const,
              required: true,
              value: '1',
              options: [
                { value: '1', label: 'Un tamaño' },
                { value: '2', label: 'Dos tamaños' },
              ],
            },
          ]
        : effect === 'nxm'
          ? [
              {
                name: 'take',
                label: 'Lleva N',
                type: 'number' as const,
                required: true,
                min: 2,
                max: 20,
                value: 3,
              },
              {
                name: 'pay',
                label: 'Paga M',
                type: 'number' as const,
                required: true,
                min: 1,
                max: 19,
                value: 2,
              },
            ]
          : []),
    {
      name: 'sizeIds',
      label: 'Tamaños elegibles (sin seleccionar: todos)',
      type: 'multiselect',
      options: state.sizes.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name })),
    },
    {
      name: 'flavorIds',
      label: 'Sabores elegibles (sin seleccionar: todos)',
      type: 'multiselect',
      options: state.flavors.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name })),
    },
    { name: 'active', label: 'Publicar activa', type: 'checkbox', value: true },
  ];
  const initial = promotion
    ? {
        ...promotion,
        startsAt: localDateTime(new Date(promotion.startsAt)),
        endsAt: localDateTime(new Date(promotion.endsAt)),
        days: promotion.days.map(String),
        steps: String(promotion.steps ?? 1),
      }
    : {};
  return (
    <Modal title={promotion ? 'Editar promoción' : 'Crear promoción'} onClose={onClose}>
      <div className="promotion-builder">
        <label className="field">
          <span>Qué cambia</span>
          <select
            value={effect}
            onChange={(e) => {
              setEffect(e.target.value as PromoEffect);
              if (e.target.value === 'free') setDelivery('coupon');
            }}
          >
            <option value="fixed">Precio fijo</option>
            <option value="upgrade">Subir uno o dos tamaños</option>
            <option value="nxm">Lleva N y paga M</option>
            <option value="free">Producto gratis con cupón</option>
          </select>
        </label>
        <label className="field">
          <span>Cómo se entrega</span>
          <select
            value={delivery}
            disabled={effect === 'free'}
            onChange={(e) => setDelivery(e.target.value as 'schedule' | 'coupon')}
          >
            <option value="schedule">Automática por horario</option>
            <option value="coupon">Con cupón de un solo uso</option>
          </select>
        </label>
      </div>
      <FieldsForm
        key={`${effect}-${delivery}`}
        fields={fields}
        initial={initial}
        onCancel={onClose}
        submit="Publicar promoción"
        onSubmit={async (v) => {
          await app.run('save_promotion', {
            ...promotion,
            ...v,
            id: promotion?.id,
            effect,
            delivery,
            steps: Number(v.steps),
            days: (v.days ?? []).map(Number),
            startsAt: utc(v.startsAt),
            endsAt: utc(v.endsAt),
            maxRedemptions: v.maxRedemptions ?? null,
          });
          onClose();
          app.toast('Promoción publicada y guardada en el histórico.');
        }}
      />
    </Modal>
  );
}
function CouponDialog({ coupon, onClose }: { coupon: Coupon; onClose: () => void }) {
  const app = useApp(),
    [qr, setQr] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(coupon.code, { width: 350, margin: 3, errorCorrectionLevel: 'M' }).then(setQr);
  }, [coupon.code]);
  const name = app.data!.state.promotions.find((x) => x.id === coupon.promotionId)?.name;
  return (
    <Modal title="Cupón Dexter’s" onClose={onClose}>
      <div className="coupon-preview">
        <Gift size={28} />
        <h3>{name}</h3>
        {qr && <img src={qr} alt={`QR del cupón ${coupon.code}`} />}
        <strong>{coupon.code}</strong>
        <p>Válido hasta {date(coupon.expiresAt)}. Un solo uso, sujeto al beneficio indicado.</p>
        <div className="button-row">
          <button
            className="button primary"
            onClick={async () => {
              const text = `Dexter’s Granizados · ${name}\nCupón: ${coupon.code}\nVence: ${date(coupon.expiresAt)}. Un solo uso.`;
              try {
                if (navigator.share) await navigator.share({ title: 'Cupón Dexter’s', text });
                else {
                  await navigator.clipboard.writeText(text);
                  app.toast('Texto del cupón copiado.');
                }
              } catch {}
            }}
          >
            <Share2 size={16} />
            Compartir
          </button>
          <button
            className="button secondary"
            onClick={async () => {
              const blob = await (await fetch(qr)).blob();
              downloadFile(blob, `cupon-${coupon.code}.png`, 'image/png');
            }}
          >
            <Download size={16} />
            Descargar QR
          </button>
        </div>
      </div>
    </Modal>
  );
}
