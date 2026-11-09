import { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { configured, recoveryLinkError, supabase } from '../lib/api.ts';
import {
  recoveryConfirmation,
  recoveryFactor,
  requestPasswordRecovery,
  updateRecoveredPassword,
} from '../lib/recovery.ts';

export function PasswordRecovery({
  reset,
  initialEmail = '',
  onClose,
  onChanged,
}: {
  reset: boolean;
  initialEmail?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [phase, setPhase] = useState<
    'request' | 'sent' | 'checking' | 'mfa' | 'password' | 'done' | 'invalid'
  >(reset ? 'checking' : 'request');
  const [email, setEmail] = useState(initialEmail),
    [factorId, setFactorId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!reset) {
      if (!initialEmail)
        void supabase?.auth.getSession().then(({ data }) => {
          if (active && data.session?.user.email) setEmail(data.session.user.email);
        });
      return () => {
        active = false;
      };
    }
    if (!supabase || recoveryLinkError) {
      setError('El enlace venció o no es válido. Solicita uno nuevo.');
      setPhase('invalid');
      return;
    }
    void recoveryFactor(supabase)
      .then((factor) => {
        if (!active) return;
        setFactorId(factor ?? '');
        setPhase(factor ? 'mfa' : 'password');
      })
      .catch((e) => {
        if (active) {
          setError((e as Error).message);
          setPhase('invalid');
        }
      });
    return () => {
      active = false;
    };
  }, [reset, initialEmail]);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      if (!supabase) throw new Error('La recuperación necesita conexión con el negocio.');
      if (phase === 'request') {
        await requestPasswordRecovery(supabase, email, window.location.origin);
        setPhase('sent');
      } else if (phase === 'mfa') {
        const { error } = await supabase.auth.mfa.challengeAndVerify({
          factorId,
          code: String(form.get('code')),
        });
        if (error) throw new Error('Código incorrecto o vencido. Escribe el código actual de tu aplicación.');
        setPhase('password');
      } else if (phase === 'password') {
        await updateRecoveredPassword(
          supabase,
          String(form.get('password')),
          String(form.get('confirmation')),
        );
        formElement.reset();
        onChanged();
        setPhase('done');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const requestAgain = () => {
    setPhase('request');
    setError('');
    window.history.replaceState(null, '', '/');
  };
  return (
    <div className="login-page">
      <div className="login-intro">
        <img src="/dexter.jpg" alt="Dexter’s" />
        <span className="eyebrow">DEXTER’S GRANIZADOS · TARAZÁ</span>
        <h1>
          Recupera
          <br />
          tu acceso.
        </h1>
        <p>Tu negocio y tu cuenta, protegidos.</p>
      </div>
      <section className="login-card">
        <div className="login-icon">
          <KeyRound size={26} />
        </div>
        <h2>
          {
            {
              request: 'Recuperar contraseña',
              sent: 'Revisa tu correo',
              checking: 'Verificando el enlace',
              mfa: 'Verifica tu identidad',
              password: 'Elige tu nueva contraseña',
              done: 'Contraseña actualizada',
              invalid: 'Solicita un nuevo enlace',
            }[phase]
          }
        </h2>
        <p>
          {
            {
              request:
                'Escribe el correo de tu cuenta de administrador. Te enviaremos un enlace de recuperación.',
              sent: recoveryConfirmation,
              checking: 'Espera un momento mientras comprobamos tu acceso.',
              mfa: 'Escribe el código de tu aplicación de autenticación. Tu doble factor se conserva.',
              password: 'Usa entre 14 y 200 caracteres. No necesitas recordar la contraseña anterior.',
              done: 'Ya puedes ingresar como Administrador con tu nueva contraseña y el doble factor habitual.',
              invalid: 'El enlace puede haber vencido o ya haberse utilizado.',
            }[phase]
          }
        </p>
        {['request', 'mfa', 'password'].includes(phase) && (
          <form className="login-form" onSubmit={submit}>
            {phase === 'request' && (
              <label>
                Correo electrónico
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            {phase === 'mfa' && (
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
            )}
            {phase === 'password' && (
              <>
                <label>
                  Nueva contraseña
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={14}
                    maxLength={200}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirmar nueva contraseña
                  <input
                    name="confirmation"
                    type="password"
                    required
                    minLength={14}
                    maxLength={200}
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full" disabled={busy || !configured}>
              {busy
                ? 'Verificando…'
                : phase === 'request'
                  ? 'Enviar enlace de recuperación'
                  : phase === 'mfa'
                    ? 'Verificar código'
                    : 'Guardar nueva contraseña'}
              <ArrowRight size={18} />
            </button>
          </form>
        )}
        {phase === 'invalid' && (
          <>
            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full" onClick={requestAgain}>
              Solicitar otro enlace
              <ArrowRight size={18} />
            </button>
          </>
        )}
        <div className="login-links">
          <button className="text-button" disabled={busy} onClick={onClose}>
            {phase === 'done' ? 'Ir al acceso de administrador' : 'Volver al acceso'}
          </button>
        </div>
        <div className="login-security">
          <ShieldCheck size={15} />
          <span>La recuperación conserva tus permisos y tu doble factor.</span>
        </div>
      </section>
    </div>
  );
}
