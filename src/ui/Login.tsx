import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowRight, ShieldCheck, WifiOff, Smartphone, FlaskConical } from 'lucide-react';
import {
  api,
  ApiError,
  configured,
  loginAdmin,
  loginPin,
  session,
  supabase,
  testGateway,
  saveDeviceCredential,
} from '../lib/api.ts';
import { getMeta, setMeta } from '../lib/db.ts';
import { cacheLocalPin, useApp } from '../lib/store.tsx';
function consumeActivationToken() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('activar-superadmin');
  if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return token ?? '';
}
export function Login({ onRecover }: { onRecover: () => void }) {
  const app = useApp();
  const [activation, setActivation] = useState(consumeActivationToken);
  const [mode, setMode] = useState<
      'admin' | 'employee' | 'setup' | 'superadmin' | 'mfa' | 'device' | 'offline'
    >(activation ? 'superadmin' : 'employee'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [qr, setQr] = useState(''),
    [factorId, setFactorId] = useState(''),
    [factorSecret, setFactorSecret] = useState(''),
    [rememberPin, setRememberPin] = useState('');
  const ready = async () => {
    try {
      await app.load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'MFA_REQUIRED') {
        setMode('mfa');
        await prepareMfa();
      } else if (e instanceof ApiError && e.code === 'DEVICE_REQUIRED') setMode('device');
      else throw e;
    }
  };
  const prepareMfa = async () => {
    if (testGateway) return;
    const listed = await supabase!.auth.mfa.listFactors();
    const existing = listed.data?.totp.find((f) => f.status === 'verified');
    if (existing) {
      setFactorId(existing.id);
      return;
    }
    const pending = listed.data?.all.filter((f) => f.status === 'unverified') ?? [];
    for (const factor of pending) await supabase!.auth.mfa.unenroll({ factorId: factor.id });
    const response = await supabase!.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Dexter Mostrador',
    });
    if (response.error) throw response.error;
    setFactorId(response.data.id);
    setQr(await QRCode.toDataURL(response.data.totp.uri, { width: 220, margin: 2 }));
    setFactorSecret(response.data.totp.secret);
  };
  useEffect(() => {
    const activate = () => {
      const token = consumeActivationToken();
      if (token) {
        setActivation(token);
        setMode('superadmin');
        setError('');
      }
    };
    window.addEventListener('hashchange', activate);
    return () => window.removeEventListener('hashchange', activate);
  }, []);
  useEffect(() => {
    if (activation) return;
    void session().then((s) => {
      if (s) void ready().catch((e) => setError((e as Error).message));
    });
  }, []);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget),
      v = (k: string) => String(f.get(k) ?? '');
    try {
      if (mode === 'superadmin') {
        await api('superadmin/setup', {
          token: activation,
          name: v('name'),
          email: v('email'),
          password: v('password'),
        });
        setActivation('');
        setMode('admin');
        app.toast('Tu acceso privado está creado. Activa el doble factor para continuar.');
        await loginAdmin(v('email'), v('password'));
        await ready();
      } else if (mode === 'setup') {
        await api('setup', {
          name: v('name'),
          email: v('email'),
          password: v('password'),
          token: v('token'),
        });
        setMode('admin');
        app.toast('Administrador creado. Inicia sesión para activar el doble factor.');
      } else if (mode === 'admin') {
        await loginAdmin(v('email'), v('password'));
        await ready();
      } else if (mode === 'employee') {
        await loginPin({
          username: v('username'),
          pin: v('pin'),
          enrollmentCode: v('enrollment'),
          deviceName: v('deviceName') || 'Celular',
        });
        const s = await session();
        if (s) await cacheLocalPin(v('pin'), s.user.id);
        await ready();
      } else if (mode === 'mfa') {
        const result = await supabase!.auth.mfa.challengeAndVerify({ factorId, code: v('code') });
        if (result.error) throw result.error;
        await ready();
      } else if (mode === 'device') {
        const result = await api('devices/self', {
          name: v('deviceName') || 'Equipo principal',
          primary: f.get('primary') === 'on',
        });
        await saveDeviceCredential({ id: result.deviceId, token: result.deviceToken });
        const s = await session();
        if (v('localPin') && s) await cacheLocalPin(v('localPin'), s.user.id);
        await ready();
      } else if (mode === 'offline') {
        if (!(await app.unlockOffline(v('pin'))))
          throw new Error('PIN incorrecto o este equipo no está habilitado para operar offline.');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!configured)
    return (
      <div className="login-page">
        <div className="login-intro">
          <img src="/dexter.jpg" alt="Dexter’s" />
          <span className="eyebrow">DEXTER’S GRANIZADOS</span>
          <h1>
            El mostrador,
            <br />
            bajo control.
          </h1>
          <p>Pedidos, caja e inventario en un solo lugar.</p>
        </div>
        <section className="login-card">
          <ShieldCheck size={36} />
          <h2>Conectar el negocio</h2>
          <p>Esta instalación necesita la dirección y la clave pública del proyecto Supabase de Dexter’s.</p>
          <p>
            La configuración del despliegue está documentada en el proyecto. No hay ventas ni usuarios
            ficticios.
          </p>
        </section>
      </div>
    );
  return (
    <div className="login-page">
      <div className="login-intro">
        <img src="/dexter.jpg" alt="Dexter’s" />
        <span className="eyebrow">DEXTER’S GRANIZADOS · TARAZÁ</span>
        <h1>
          Todo listo para
          <br />
          un gran día.
        </h1>
        <p>Cada local, su caja y sus pedidos bajo control.</p>
        <div className="login-benefits">
          <span>
            <ShieldCheck size={18} /> Acceso protegido
          </span>
          <span>
            <WifiOff size={18} /> Respaldo sin conexión
          </span>
        </div>
        <small>Mostrador · Versión 1.0</small>
      </div>
      <section className="login-card">
        <div className="login-icon">
          <FlaskConical size={26} />
        </div>
        <h2>
          {
            {
              employee: 'Bienvenido al mostrador',
              admin: 'Acceso de administrador',
              setup: 'Configurar Dexter’s',
              superadmin: 'Activar tu acceso privado',
              mfa: 'Verifica tu identidad',
              device: 'Registrar este equipo',
              offline: 'Continuar sin conexión',
            }[mode]
          }
        </h2>
        <p>
          {
            {
              employee: 'Entra con el usuario y PIN asignados.',
              admin: 'Usa tu correo y contraseña. Después verificaremos el doble factor.',
              setup: 'Usa el código privado de configuración entregado al propietario.',
              superadmin:
                'Crea tu acceso de superadministrador con el correo reservado. Después activarás el doble factor.',
              mfa: qr
                ? 'Añade esta cuenta a tu app de autenticación y escribe el código.'
                : 'Escribe el código de tu app de autenticación.',
              device: 'Este registro vincula el navegador a tu negocio.',
              offline: 'Solo disponible en un equipo de caja previamente autorizado.',
            }[mode]
          }
        </p>
        {['admin', 'employee'].includes(mode) && (
          <div className="segmented">
            <button
              className={mode === 'employee' ? 'active' : ''}
              onClick={() => {
                setMode('employee');
                setError('');
              }}
            >
              Empleado
            </button>
            <button
              className={mode === 'admin' ? 'active' : ''}
              onClick={() => {
                setMode('admin');
                setError('');
              }}
            >
              Administrador
            </button>
          </div>
        )}
        <form onSubmit={submit} className="login-form">
          {mode === 'superadmin' && (
            <label>
              Tu nombre
              <input name="name" required maxLength={100} autoComplete="name" />
            </label>
          )}
          {mode === 'setup' && (
            <>
              <label>
                Nombre del administrador
                <input name="name" required maxLength={100} />
              </label>
              <label>
                Código de configuración
                <input name="token" required type="password" autoComplete="off" />
              </label>
            </>
          )}
          {['admin', 'setup', 'superadmin'].includes(mode) && (
            <>
              <label>
                Correo electrónico
                <input name="email" type="email" required autoComplete="username" />
              </label>
              <label>
                Contraseña
                <input
                  name="password"
                  type="password"
                  required
                  minLength={['setup', 'superadmin'].includes(mode) ? 14 : 1}
                  maxLength={200}
                  autoComplete={['setup', 'superadmin'].includes(mode) ? 'new-password' : 'current-password'}
                />
              </label>
            </>
          )}
          {mode === 'employee' && (
            <>
              <label>
                Usuario
                <input name="username" required autoComplete="username" placeholder="Tu usuario" />
              </label>
              <label>
                PIN
                <input
                  name="pin"
                  required
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="current-password"
                  placeholder="6 dígitos"
                />
              </label>
              <details>
                <summary>
                  <Smartphone size={16} /> Registrar un dispositivo nuevo
                </summary>
                <label>
                  Código del administrador
                  <input name="enrollment" autoComplete="off" />
                </label>
                <label>
                  Nombre del equipo
                  <input name="deviceName" placeholder="Celular de apoyo" />
                </label>
              </details>
            </>
          )}
          {mode === 'mfa' && (
            <>
              {qr && (
                <div className="auth-qr">
                  <img src={qr} alt="QR para configurar doble factor" />
                  <details>
                    <summary>Configurar con clave manual</summary>
                    <code>{factorSecret}</code>
                  </details>
                </div>
              )}
              <label>
                Código de seis dígitos
                <input
                  name="code"
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  autoFocus
                />
              </label>
            </>
          )}
          {mode === 'device' && (
            <>
              <label>
                Nombre del equipo
                <input name="deviceName" required placeholder="Equipo de caja" />
              </label>
              <label className="check-inline">
                <input name="primary" type="checkbox" /> Este será el equipo principal de caja
              </label>
              <label>
                PIN local para respaldo offline
                <input name="localPin" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} />
              </label>
            </>
          )}
          {mode === 'offline' && (
            <label>
              PIN de este equipo
              <input
                name="pin"
                required
                type="password"
                pattern="[0-9]{6}"
                inputMode="numeric"
                maxLength={6}
              />
            </label>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? 'Verificando…' : 'Continuar'}
            <ArrowRight size={18} />
          </button>
        </form>
        <div className="login-links">
          {mode === 'admin' && (
            <button className="text-button" onClick={onRecover}>
              Olvidé mi contraseña
            </button>
          )}
          {!['offline', 'superadmin'].includes(mode) && (
            <button
              className="text-button"
              onClick={() => {
                setMode('offline');
                setError('');
              }}
            >
              Entrar sin conexión
            </button>
          )}
          {!['mfa', 'device', 'superadmin'].includes(mode) && (
            <button
              className="text-button"
              onClick={() => {
                setMode(mode === 'setup' ? 'employee' : 'setup');
                setError('');
              }}
            >
              {mode === 'setup' ? 'Volver al acceso' : 'Configurar primer administrador'}
            </button>
          )}
        </div>
        <div className="login-security">
          <ShieldCheck size={15} />
          <span>La actividad se registra para proteger la operación.</span>
        </div>
      </section>
    </div>
  );
}
