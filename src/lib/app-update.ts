import { useEffect, useRef, useState } from 'react';

export function useAppUpdate() {
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
    let disposed = false;
    let active = navigator.serviceWorker.controller;
    let observed: ServiceWorker | null = null;
    let checking = false;

    const refresh = () => {
      const worker = registration.current;
      if (!worker || disposed) return;
      if (!active) active = worker.active;
      setAvailable(!!(active && (worker.waiting || (worker.active && worker.active !== active))));
    };
    const watchInstallation = () => {
      observed?.removeEventListener('statechange', refresh);
      observed = registration.current?.installing ?? null;
      observed?.addEventListener('statechange', refresh);
      refresh();
    };
    const watchRegistration = (worker: ServiceWorkerRegistration) => {
      if (disposed || registration.current === worker) return;
      registration.current?.removeEventListener('updatefound', watchInstallation);
      registration.current = worker;
      worker.addEventListener('updatefound', watchInstallation);
      watchInstallation();
    };
    const check = async () => {
      if (disposed || checking || !navigator.onLine || document.visibilityState !== 'visible') return;
      refresh();
      if (registration.current?.waiting) return;
      checking = true;
      try {
        if (registration.current?.updateViaCache === 'none') await registration.current.update();
        else watchRegistration(await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }));
      } catch {
        // A temporary network or installation failure can be retried on the next check.
      } finally {
        checking = false;
        refresh();
      }
    };

    void navigator.serviceWorker
      .getRegistration()
      .then((worker) => {
        if (worker && !registration.current) watchRegistration(worker);
      })
      .catch(() => {
        // The next check can register the worker if it could not be read here.
      })
      .finally(check);
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    navigator.serviceWorker.addEventListener('controllerchange', refresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      navigator.serviceWorker.removeEventListener('controllerchange', refresh);
      registration.current?.removeEventListener('updatefound', watchInstallation);
      registration.current = null;
      observed?.removeEventListener('statechange', refresh);
    };
  }, []);

  const activate = async () => {
    const worker = registration.current?.waiting;
    if (worker) {
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          window.clearTimeout(timeout);
          worker.removeEventListener('statechange', changed);
          if (error) reject(error);
          else resolve();
        };
        const changed = () => {
          if (worker.state === 'activated') finish();
          if (worker.state === 'redundant')
            finish(new Error('La descarga cambió. Intenta actualizar de nuevo.'));
        };
        const timeout = window.setTimeout(
          () => finish(new Error('La actualización tardó demasiado. Puedes volver a intentarlo.')),
          15_000,
        );
        worker.addEventListener('statechange', changed);
        if (worker.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' });
        changed();
      });
    }
    window.location.reload();
  };

  return { available, activate };
}
