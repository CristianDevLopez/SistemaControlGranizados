import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  ShoppingBag,
  ClipboardList,
  Package,
  Wallet,
  Truck,
  Ticket,
  ShieldCheck,
  Settings as SettingsIcon,
  RefreshCw,
  Wifi,
  WifiOff,
  Menu,
  X,
  LogOut,
  ChevronRight,
  ArrowUpRight,
  Download,
  Building2,
} from 'lucide-react';
import { useApp } from './lib/store.tsx';
import { logout, supabase } from './lib/api.ts';
import { recoveryPath } from './lib/recovery.ts';
import { Login } from './ui/Login.tsx';
import { PasswordRecovery } from './ui/PasswordRecovery.tsx';
import { Pos } from './ui/Pos.tsx';
import { Orders } from './ui/Orders.tsx';
import { Cash } from './ui/Cash.tsx';
import { Inventory } from './ui/Inventory.tsx';
import { Purchasing } from './ui/Purchasing.tsx';
import { Promotions } from './ui/Promotions.tsx';
import { Settings } from './ui/Settings.tsx';
import { Control } from './ui/Control.tsx';
import { Platform } from './ui/Platform.tsx';
import { branchStatusLabels } from './domain/platform.ts';
import { Badge, Modal, date } from './ui/components.tsx';
import { downloadFile } from './lib/export.ts';
import { roleLabels } from './domain/views.ts';
import type { Role } from './domain/types.ts';
const pages = [
  { id: 'pos', label: 'Mostrador', icon: ShoppingBag, group: 'OPERACIÓN' },
  { id: 'orders', label: 'Pedidos', icon: ClipboardList },
  { id: 'inventory', label: 'Inventario', icon: Package },
  { id: 'cash', label: 'Turno y caja', icon: Wallet },
  { id: 'purchases', label: 'Compras y gastos', icon: Truck },
  { id: 'promotions', label: 'Promociones', icon: Ticket, admin: true, group: 'ADMINISTRACIÓN' },
  { id: 'control', label: 'Control y aprobaciones', icon: ShieldCheck, admin: true },
  { id: 'settings', label: 'Configuración', icon: SettingsIcon, admin: true },
  { id: 'locals', label: 'Locales y mensualidades', icon: Building2, admin: true },
];
export function App() {
  const app = useApp(),
    [page, setPage] = useState('pos'),
    [mobile, setMobile] = useState(false),
    [syncOpen, setSyncOpen] = useState(false),
    [exit, setExit] = useState(false);
  const [recovery, setRecovery] = useState<'request' | 'reset' | null>(() =>
    window.location.pathname === recoveryPath ? 'reset' : null,
  );
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  useEffect(() => {
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery('reset');
    });
    return () => subscription?.data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!app.data) return;
    const activate = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).get('activar-superadmin')) app.reset();
    };
    activate();
    window.addEventListener('hashchange', activate);
    return () => window.removeEventListener('hashchange', activate);
  }, [app.data, app.reset]);
  if (recovery)
    return (
      <PasswordRecovery
        key={recovery}
        reset={recovery === 'reset'}
        onChanged={app.reset}
        onClose={() => {
          if (recovery === 'reset') app.reset();
          window.history.replaceState(null, '', '/');
          setRecovery(null);
        }}
      />
    );
  if (!app.data) return <Login onRecover={() => setRecovery('request')} />;
  const { state, actor } = app.data,
    nav = pages.filter(
      (p) =>
        (!p.admin || actor.role === 'admin') &&
        (p.id !== 'locals' || app.data?.branch?.isOwner || (app.sessionActor?.superAdmin && !app.viewRole)),
    ),
    active = nav.find((p) => p.id === page) ?? pages[0],
    pending = app.pending.filter((p) => p.status === 'pending').length + app.photosPending,
    conflicts = app.pending.filter((p) => p.status === 'conflict').length,
    shift = state.shifts.find((s) => s.status === 'open');
  const canUpdate = !app.pending.length && !app.photosPending && !shift;
  const sessionActor = app.sessionActor ?? actor;
  const changeView = (role: Role | null) => {
    if (app.changeView(role)) {
      setPage('pos');
      setMobile(false);
      setSyncOpen(false);
    }
  };
  const navigate = (id: string) => {
    setPage(id);
    setMobile(false);
  };
  const leave = async () => {
    await logout();
    app.reset();
    setExit(false);
  };
  return (
    <div className="app-shell">
      {mobile && (
        <button className="nav-backdrop" aria-label="Cerrar menú" onClick={() => setMobile(false)} />
      )}
      <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}>
        <a
          className="brand"
          href="#mostrador"
          onClick={(e) => {
            e.preventDefault();
            navigate('pos');
          }}
        >
          <img src="/dexter.jpg" alt="Dexter’s" />
          <span>
            <strong>
              DEXTER’S<span>GRANIZADOS</span>
            </strong>
            <small>El mostrador</small>
          </span>
        </a>
        <button
          className="icon-button mobile-close"
          aria-label="Cerrar menú"
          onClick={() => setMobile(false)}
        >
          <X size={21} />
        </button>
        <div className="business-location branch-selector">
          <label>
            Local de trabajo
            <select
              aria-label="Local de trabajo"
              value={app.data.branch?.id ?? ''}
              disabled={!app.online || app.syncing || !!app.viewRole}
              onChange={(e) =>
                void app
                  .switchBranch(e.target.value)
                  .then(() => {
                    setMobile(false);
                  })
                  .catch((e) => app.toast((e as Error).message))
              }
            >
              {(app.data.access?.branches ?? (app.data.branch ? [app.data.branch] : [])).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.businessName} · {b.name}
                </option>
              ))}
            </select>
          </label>
          <small>{app.data.branch?.city || 'Ubicación por configurar'} · Una caja por local</small>
        </div>
        <nav aria-label="Menú principal">
          {nav.map((p) => (
            <div key={p.id}>
              {p.group && <span className="nav-group">{p.group}</span>}
              <button
                aria-label={p.label}
                onClick={() => navigate(p.id)}
                className={`nav-item ${active.id === p.id ? 'active' : ''}`}
                aria-current={active.id === p.id ? 'page' : undefined}
              >
                <p.icon size={19} />
                <span>{p.label}</span>
                {p.id === 'orders' && state.orders.filter((o) => o.status === 'open').length > 0 && (
                  <span className="nav-number">{state.orders.filter((o) => o.status === 'open').length}</span>
                )}
                {p.id === active.id && <ChevronRight size={15} />}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-mini">
            <span className={`status-dot ${app.online ? 'green' : 'orange'}`} />
            <span>
              {app.online ? 'Conectado al negocio' : 'Operando sin conexión'}
              <small>
                {pending
                  ? `${pending} por sincronizar`
                  : app.lastSync
                    ? `Última conexión ${date(app.lastSync)}`
                    : 'Sincronización lista'}
              </small>
            </span>
          </div>
          <button className="profile-button" onClick={() => setExit(true)}>
            <span className="avatar">{sessionActor.name.slice(0, 2).toUpperCase()}</span>
            <span>
              <strong>{sessionActor.name}</strong>
              <small>
                {sessionActor.superAdmin
                  ? 'Superadministrador'
                  : sessionActor.role === 'admin'
                    ? 'Administrador'
                    : sessionActor.role === 'encargado'
                      ? 'Encargado de caja'
                      : 'Apoyo de mostrador'}
              </small>
            </span>
            <LogOut size={17} />
          </button>
          <small className="version">DEXTER’S · VERSIÓN 1.0</small>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Abrir menú"
              onClick={() => setMobile(true)}
            >
              <Menu size={23} />
            </button>
            <span>{app.data.branch?.name ?? 'Mi negocio'}</span>
            <ChevronRight size={14} />
            <strong>{active.label}</strong>
          </div>
          <div className="topbar-actions">
            <span className="today">
              {new Intl.DateTimeFormat('es-CO', {
                timeZone: 'America/Bogota',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }).format(new Date())}
            </span>
            <button
              className={`sync-button ${conflicts ? 'has-conflict' : ''}`}
              onClick={() => setSyncOpen(true)}
              aria-label="Estado de sincronización"
            >
              {app.syncing ? (
                <RefreshCw size={16} className="spin" />
              ) : app.online ? (
                <Wifi size={16} />
              ) : (
                <WifiOff size={16} />
              )}
              <span>
                {conflicts
                  ? `${conflicts} por revisar`
                  : pending
                    ? `${pending} pendientes`
                    : app.online
                      ? 'Sincronizado'
                      : 'Sin conexión'}
              </span>
            </button>
          </div>
        </header>
        <div className="page-content">
          {sessionActor.superAdmin && (
            <section className="superadmin-bar" aria-label="Vistas de superadministrador">
              <div className="superadmin-title">
                <ShieldCheck size={22} aria-hidden="true" />
                <div>
                  <strong>Superadministrador</strong>
                  <small>
                    {app.viewRole === 'admin'
                      ? 'Vista de administrador · Edición habilitada'
                      : app.previewing
                        ? 'Explora la experiencia de cada rol'
                        : 'Tu acceso exclusivo al negocio'}
                  </small>
                </div>
              </div>
              <label className="superadmin-select">
                Vista de la aplicación
                <select
                  value={app.viewRole ?? 'superadmin'}
                  onChange={(e) =>
                    changeView(e.target.value === 'superadmin' ? null : (e.target.value as Role))
                  }
                >
                  <option value="superadmin">Superadministrador</option>
                  {Object.entries(roleLabels).map(([role, label]) => (
                    <option key={role} value={role}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {app.viewRole && (
                <button className="button secondary small" onClick={() => changeView(null)}>
                  Volver a superadministrador
                </button>
              )}
              {app.viewRole === 'admin' && (
                <p className="preview-explanation" role="status">
                  <strong>Administrador · Edición habilitada.</strong> Puedes agregar productos y cambiar
                  precios, promociones y parámetros sin esperar a otro administrador. Los cambios quedan
                  registrados con tu usuario.
                </p>
              )}
              {app.previewing && (
                <p className="preview-explanation" role="status">
                  <strong>Solo consulta · {roleLabels[app.viewRole!]}</strong>.{' '}
                  {actor.name !== roleLabels[actor.role] ? `Vista de ${actor.name}. ` : ''}Puedes recorrer las
                  pantallas y abrir formularios. Para guardar cambios, cambia a Administrador o
                  Superadministrador.
                </p>
              )}
            </section>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {active.id === 'pos' ? 'CADA PEDIDO CUENTA' : 'DEXTER’S · OPERACIÓN'}
              </span>
              <h1>{active.id === 'pos' ? 'Hagamos un gran día.' : active.label}</h1>
              <p>
                {active.id === 'pos'
                  ? 'Todo lo que necesitas, a un toque de distancia.'
                  : active.id === 'cash'
                    ? 'Un turno claro. Cada peso con su destino.'
                    : active.id === 'inventory'
                      ? 'De la primera bolsa al último vaso.'
                      : 'La información del negocio, siempre a la mano.'}
              </p>
            </div>
            {active.id === 'pos' && (
              <span className="heading-note">
                <span className="status-dot green" />
                Mostrador listo
                <ArrowUpRight size={16} />
              </span>
            )}
          </div>
          {app.error && (
            <div className="notice warning" role="status">
              {app.error}
            </div>
          )}
          {!app.online && actor.role === 'apoyo' && (
            <div className="notice warning">
              La consulta sigue disponible. Las modificaciones del apoyo requieren conexión.
            </div>
          )}
          {needRefresh && (
            <div className="notice info">
              <span>
                Hay una actualización disponible.{' '}
                {canUpdate
                  ? 'Puedes instalarla ahora.'
                  : 'Se instalará al terminar el turno y sincronizar los pendientes.'}
              </span>
              {canUpdate && (
                <button className="button small secondary" onClick={() => void updateServiceWorker(true)}>
                  Actualizar app
                </button>
              )}
            </div>
          )}
          {app.data.branch && app.data.branch.status !== 'active' && (
            <div className="notice warning" role="status">
              {branchStatusLabels[app.data.branch.status]}. La operación está deshabilitada; puedes consultar
              los registros y gestionar el local en Locales y mensualidades.
            </div>
          )}
          <div key={`${app.data.branch?.id}-${app.viewRole ?? 'session'}-${active.id}`}>
            {active.id === 'pos' ? (
              <Pos />
            ) : active.id === 'orders' ? (
              <Orders />
            ) : active.id === 'inventory' ? (
              <Inventory />
            ) : active.id === 'cash' ? (
              <Cash />
            ) : active.id === 'purchases' ? (
              <Purchasing />
            ) : active.id === 'promotions' ? (
              <Promotions />
            ) : active.id === 'control' ? (
              <Control />
            ) : active.id === 'locals' ? (
              <Platform />
            ) : (
              <Settings />
            )}
          </div>
        </div>
        <footer className="main-footer">
          <span>
            {state.settings[0].businessName} · {app.data.branch?.name}
          </span>
          <span>Hecho para que todo cuadre.</span>
        </footer>
      </main>
      {syncOpen && (
        <Modal title="Estado de sincronización" onClose={() => setSyncOpen(false)}>
          <div className="detail-content">
            <p>
              {app.online
                ? 'Conexión disponible.'
                : 'El servidor no está disponible. Las operaciones locales se conservan.'}
            </p>
            <p>
              Última sincronización: <strong>{date(app.lastSync ?? undefined)}</strong>
            </p>
            <div className="button-row">
              <button className="button primary" disabled={app.syncing} onClick={() => void app.sync()}>
                <RefreshCw size={17} />
                Sincronizar ahora
              </button>
              {app.pending.length > 0 && (
                <button
                  className="button secondary"
                  onClick={() => {
                    const entries = app.pending.map((e) => ({
                      ...e,
                      command: { ...e.command, payload: { ...e.command.payload, offlinePermit: undefined } },
                    }));
                    downloadFile(
                      new Blob(
                        [
                          JSON.stringify(
                            { exportedAt: new Date().toISOString(), operations: entries },
                            null,
                            2,
                          ),
                        ],
                        { type: 'application/json' },
                      ),
                      `dexter-pendientes-${Date.now()}.json`,
                    );
                  }}
                >
                  <Download size={16} />
                  Exportar respaldo local
                </button>
              )}
            </div>
            {app.photosPending > 0 && (
              <div className="notice warning">
                {app.photosPending} fotografías esperan subir. Se reintentarán al recuperar conexión.
              </div>
            )}
            {app.pending.length ? (
              <div className="sync-list">
                {app.pending.map((p) => (
                  <div className="list-row" key={p.id}>
                    <div>
                      <strong>Operación {p.sequence}</strong>
                      <small>
                        {date(p.command.at)} · {p.message ?? 'Esperando confirmación del servidor'}
                      </small>
                      <small>Referencia: {p.id}</small>
                    </div>
                    <Badge tone={p.status === 'conflict' ? 'orange' : 'neutral'}>
                      {p.status === 'conflict' ? 'Por conciliar' : 'Pendiente'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : app.photosPending === 0 ? (
              <div className="notice success">Todas tus operaciones están sincronizadas.</div>
            ) : null}
          </div>
        </Modal>
      )}
      {exit && (
        <Modal title="Cambiar de usuario" onClose={() => setExit(false)}>
          <div className="detail-content">
            <p>
              {app.pending.length
                ? 'Hay registros pendientes. Permanecerán en este navegador y deberán sincronizarse al volver con el mismo usuario.'
                : 'Tu actividad sincronizada queda guardada en el negocio.'}
            </p>
            {sessionActor.role === 'admin' && (
              <button
                className="text-button"
                onClick={() => {
                  app.changeView(null);
                  setExit(false);
                  setRecovery('request');
                }}
              >
                Recuperar mi contraseña
              </button>
            )}
            <div className="form-actions">
              <button className="button secondary" onClick={() => setExit(false)}>
                Continuar aquí
              </button>
              <button className="button primary" onClick={() => void leave()}>
                Cerrar sesión
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
