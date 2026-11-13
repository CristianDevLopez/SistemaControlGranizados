import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { applyCommand, redactState } from '../domain/engine.ts';
import {
  type Actor,
  type Command,
  type CommandType,
  type Result,
  type Role,
  type Snapshot,
} from '../domain/types.ts';
import { isReadOnlyView, rolePreview } from '../domain/views.ts';
import {
  api,
  ApiError,
  previewReadOnlyMessage,
  sendCommands,
  setPreviewRole,
  snapshot,
  supabase,
  testGateway,
  ensureBranch,
  saveDeviceCredential,
  session,
  getActiveBranch,
  setActiveBranch,
} from './api.ts';
import {
  db,
  getMeta,
  setMeta,
  belongsToBranch,
  type DeviceCredential,
  type OfflineAuthorizer,
  type OutboxEntry,
} from './db.ts';
import { decryptPermit, pinHash, randomToken, constantEqual } from '../server/crypto.ts';
import { compressPhoto } from './photos.ts';
import { photoBlob } from './db.ts';

interface AppContext {
  data: Snapshot | null;
  sessionActor: Actor | null;
  viewRole: Role | null;
  previewing: boolean;
  changeView: (role: Role | null) => boolean;
  switchBranch: (branchId: string) => Promise<void>;
  online: boolean;
  pending: OutboxEntry[];
  photosPending: number;
  syncing: boolean;
  lastSync: string | null;
  error: string | null;
  load: () => Promise<void>;
  run: (
    type: CommandType,
    payload?: Record<string, unknown>,
    options?: { onlineOnly?: boolean; at?: string },
  ) => Promise<Result>;
  sync: () => Promise<void>;
  installUpdate: (activate: () => Promise<void>) => Promise<void>;
  photo: (file: File) => Promise<string>;
  unlockOffline: (pin: string) => Promise<boolean>;
  authorizeOffline: (shiftId: string, pin: string, permitId: string) => Promise<Result>;
  reset: () => void;
  toast: (message: string) => void;
}
const Context = createContext<AppContext | null>(null);
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('AppProvider missing');
  return value;
}
const ONLINE_TYPES = new Set<CommandType>([
  'record_paper',
  'save_flavor',
  'save_size',
  'configure',
  'initialize_stock',
  'save_promotion',
  'issue_coupon',
  'save_goal',
  'save_location',
  'create_shipment',
  'approve_expense',
  'resolve_request',
  'approve_payout',
  'request_courtesy_excess',
  'start_audit',
  'finish_audit',
]);
export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Snapshot | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [pending, setPending] = useState<OutboxEntry[]>([]),
    [syncing, setSyncing] = useState(false),
    [lastSync, setLastSync] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const [photosPending, setPhotosPending] = useState(0);
  const [viewRole, setViewRole] = useState<Role | null>(null);
  const preview = useRef<Role | null>(null);
  const current = useRef<Snapshot | null>(null),
    syncLock = useRef(false),
    syncDone = useRef<Promise<void>>(Promise.resolve()),
    commandLock = useRef<Promise<unknown>>(Promise.resolve()),
    live = useRef(true),
    recentResults = useRef(new Map<string, Result>()),
    localWrites = useRef(0);
  const switchingBranch = useRef(false);
  const installingUpdate = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((message: string) => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => {
      noticeTimer.current = null;
      if (live.current) setNotice('');
    }, 4500);
  }, []);
  useEffect(
    () => () => {
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    },
    [],
  );
  const remember = useCallback(async (value: Snapshot) => {
    if (!value.actor.superAdmin) {
      preview.current = null;
      setPreviewRole(null);
      setViewRole(null);
    }
    current.current = value;
    setData(value);
    const cached =
      value.actor.role === 'admin'
        ? {
            ...value,
            actor: { ...value.actor, superAdmin: undefined },
            state: redactState(value.state, { ...value.actor, role: 'encargado' }),
          }
        : { ...value };
    cached.access = undefined;
    await setMeta('snapshot', cached);
    if (value.actor.branchId) await setMeta(`snapshot:${value.actor.branchId}:${value.actor.id}`, cached);
  }, []);
  const updatePending = useCallback(async () => {
    const all = await db.outbox.toArray();
    setPending(
      all
        .filter((x) => belongsToBranch(x, current.current) && x.status !== 'reconciled')
        .sort((a, b) => a.sequence - b.sequence),
    );
    setPhotosPending(
      (await db.photos.toArray()).filter((p) => belongsToBranch(p, current.current) && p.status === 'pending')
        .length,
    );
  }, []);
  const load = useCallback(async () => {
    await ensureBranch();
    const result = await snapshot();
    if ('unchanged' in result) return;
    setOnline(true);
    setError(null);
    const queued = (await db.outbox.toArray())
      .filter((x) => belongsToBranch(x, result))
      .sort((a, b) => a.sequence - b.sequence);
    let state = result.state;
    for (const entry of queued) {
      if (entry.status === 'acknowledged') {
        await db.outbox.delete(entry.id);
        continue;
      }
      if (
        entry.status === 'conflict' &&
        result.state.requests.some((r) => r.type === 'sync' && r.id === entry.id && r.status !== 'pending')
      ) {
        await db.outbox.update(entry.id, { status: 'reconciled' });
        continue;
      }
      if (!entry.optimistic || entry.status === 'reconciled') continue;
      try {
        state = applyCommand(
          state,
          entry.command,
          { ...result.actor, online: entry.command.payload.offline !== true },
          new Date().toISOString(),
        ).state;
      } catch {
        /* The raw operation stays available in the incident queue. */
      }
    }
    await remember({ ...result, state });
    const at = new Date().toISOString();
    setLastSync(at);
    await setMeta('lastSync', at);
    await updatePending();
  }, [remember, updatePending]);
  const sync = useCallback(async () => {
    if (syncLock.current) {
      await syncDone.current;
      return;
    }
    if (switchingBranch.current || !navigator.onLine || !current.current) return;
    let finishSync!: () => void;
    syncDone.current = new Promise<void>((resolve) => {
      finishSync = resolve;
    });
    syncLock.current = true;
    setSyncing(true);
    try {
      await load();
      const entries = (await db.outbox.toArray())
        .filter((x) => belongsToBranch(x, current.current) && ['pending', 'conflict'].includes(x.status))
        .sort((a, b) => a.sequence - b.sequence);
      for (const entry of entries) {
        if (entry.status === 'conflict') break;
        const response = await sendCommands([entry.command]);
        const result = response.results[0];
        if (!result) throw new Error('Respuesta incompleta del servidor.');
        recentResults.current.set(entry.id, result);
        await db.outbox.update(entry.id, {
          status: result.status === 'conflict' ? 'conflict' : 'acknowledged',
          result,
          message: result.message,
        });
        if (result.status === 'conflict') {
          toast(result.message);
          break;
        }
      }
      const photos = (await db.photos.toArray()).filter(
        (x) => belongsToBranch(x, current.current) && x.status === 'pending',
      );
      for (const photo of photos) {
        try {
          const blob = photoBlob(photo);
          const target = await api('attachments/upload', { id: photo.id });
          if (target.completed) {
            await db.photos.delete(photo.id);
            continue;
          }
          if (testGateway) {
            await fetch(
              `${testGateway.replace('/dexter', '')}/test-upload/${photo.id}?path=${encodeURIComponent(target.path)}`,
              { method: 'PUT', body: blob },
            );
          } else {
            const uploaded = await supabase!.storage
              .from('evidence')
              .uploadToSignedUrl(target.path, target.token, blob, { contentType: blob.type });
            if (uploaded.error) throw uploaded.error;
          }
          await api('attachments/complete', { id: photo.id, path: target.path });
          await db.photos.delete(photo.id);
        } catch (e) {
          await db.photos.update(photo.id, { error: (e as Error).message });
        }
      }
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        if (['UNAUTHORIZED', 'FORBIDDEN', 'MFA_REQUIRED', 'DEVICE_REQUIRED'].includes(e.code))
          setOnline(false);
      } else {
        setOnline(false);
        setError('Sin conexión con el servidor. Los registros locales se conservan.');
      }
    } finally {
      syncLock.current = false;
      try {
        if (live.current) {
          setSyncing(false);
          await updatePending();
        }
      } finally {
        finishSync();
      }
    }
  }, [load, toast, updatePending]);
  const run = useCallback(
    (
      type: CommandType,
      payload: Record<string, unknown> = {},
      options: { onlineOnly?: boolean; at?: string } = {},
    ): Promise<Result> => {
      const work = async () => {
        if (installingUpdate.current)
          throw new Error('Espera a que termine la actualización de la aplicación.');
        if (switchingBranch.current) throw new Error('Espera a que termine el cambio de local.');
        if (preview.current) throw new Error(previewReadOnlyMessage);
        let committed = false;
        localWrites.current++;
        try {
          const snapshot = current.current;
          if (!snapshot) throw new Error('Inicia sesión.');
          if (snapshot.branch && snapshot.branch.status !== 'active')
            throw new Error('Este local no está activo. Consulta Locales y mensualidades.');
          const isOnline = online && navigator.onLine;
          const requiresOnline =
            options.onlineOnly ||
            ONLINE_TYPES.has(type) ||
            (type === 'request_shift' && snapshot.actor.role === 'admin' && isOnline) ||
            snapshot.actor.role === 'apoyo' ||
            type === 'redeem_coupon' ||
            (type === 'pay' && Array.isArray(payload.codes) && payload.codes.length > 0);
          if (requiresOnline && (!navigator.onLine || !online))
            throw new Error('Esta operación requiere conexión.');
          const shift = snapshot.state.shifts.find(
            (x) => x.status === 'open' || x.status === 'requested' || x.status === 'provisional',
          );
          const sequence = ((await getMeta<number>('sequence')) ?? 0) + 1;
          const command: Command = {
            id: crypto.randomUUID(),
            branchId: snapshot.actor.branchId,
            type,
            actorId: snapshot.actor.id,
            deviceId: snapshot.actor.deviceId,
            shiftId: shift?.id,
            at: options.at ?? new Date().toISOString(),
            configVersion: snapshot.state.settings[0].version,
            sequence,
            payload: { ...payload, ...(!isOnline ? { offline: true } : {}) },
          };
          const optimistic = !requiresOnline;
          let next = snapshot.state,
            result: Result = { id: command.id, status: 'accepted', message: 'Pendiente de validación.' };
          if (optimistic) {
            const applied = applyCommand(
              snapshot.state,
              command,
              { ...snapshot.actor, online: isOnline },
              new Date().toISOString(),
            );
            next = applied.state;
            result = applied.result;
          }
          await db.transaction('rw', db.meta, db.outbox, async () => {
            await db.outbox.add({
              id: command.id,
              branchId: snapshot.actor.branchId,
              actorId: snapshot.actor.id,
              sequence,
              command,
              optimistic,
              status: 'pending',
            });
            await db.meta.put({ key: 'sequence', value: sequence });
            if (optimistic) {
              const cache = {
                ...snapshot,
                access: undefined,
                actor: { ...snapshot.actor, superAdmin: undefined },
                state:
                  snapshot.actor.role === 'admin'
                    ? redactState(next, { ...snapshot.actor, role: 'encargado' })
                    : next,
              };
              await db.meta.put({ key: 'snapshot', value: cache });
              if (snapshot.actor.branchId)
                await db.meta.put({
                  key: `snapshot:${snapshot.actor.branchId}:${snapshot.actor.id}`,
                  value: cache,
                });
            }
          });
          committed = true;
          localWrites.current--;
          if (optimistic) {
            current.current = { ...snapshot, state: next };
            setData(current.current);
            await updatePending();
            void sync();
            return result;
          }
          await sync();
          if ((await db.outbox.get(command.id))?.status === 'pending' && navigator.onLine) await sync();
          const saved = await db.outbox.get(command.id);
          if (saved?.status === 'conflict') throw new Error(saved.message);
          if (saved?.status === 'pending')
            throw new Error(
              'Validación pendiente. No repitas la operación; se reintentará con el mismo identificador.',
            );
          return (
            saved?.result ??
            recentResults.current.get(command.id) ?? {
              ...result,
              referenceId: current.current?.state.audit.find((x) => x.eventId === command.id)?.referenceId,
            }
          );
        } finally {
          if (!committed) localWrites.current--;
        }
      };
      const promise = commandLock.current.then(work, work);
      commandLock.current = promise.catch(() => {});
      return promise;
    },
    [online, sync, updatePending],
  );
  const photo = useCallback(
    async (file: File) => {
      if (installingUpdate.current)
        throw new Error('Espera a que termine la actualización de la aplicación.');
      if (switchingBranch.current) throw new Error('Espera a que termine el cambio de local.');
      const branchId = current.current?.actor.branchId;
      if (preview.current) throw new Error(previewReadOnlyMessage);
      const blob = await compressPhoto(file),
        key = crypto.randomUUID();
      if (preview.current) throw new Error(previewReadOnlyMessage);
      if (branchId !== current.current?.actor.branchId || switchingBranch.current || installingUpdate.current)
        throw new Error('El local cambió. Selecciona la fotografía de nuevo.');
      await db.photos.add({
        id: key,
        branchId,
        actorId: current.current!.actor.id,
        bytes: await blob.arrayBuffer(),
        mime: blob.type,
        status: 'pending',
      });
      await run('register_attachment', { id: key, name: file.name, mime: blob.type, size: blob.size });
      return key;
    },
    [run],
  );
  const unlockOffline = useCallback(
    async (pin: string) => {
      const user = (await session())?.user;
      const selection = user ? await getActiveBranch(user.id) : undefined;
      const suffix = selection?.userId === user?.id ? `${selection?.id}:${user?.id}` : '';
      const saved = await getMeta<{ salt: string; hash: string; userId: string; branchId?: string }>(
        suffix ? `local-pin:${suffix}` : 'local-pin',
      );
      const cached = await getMeta<Snapshot>(suffix ? `snapshot:${suffix}` : 'snapshot');
      if (
        !saved ||
        !cached?.actor.primary ||
        saved.userId !== cached.actor.id ||
        (saved.branchId !== undefined && saved.branchId !== cached.actor.branchId) ||
        !constantEqual(await pinHash(pin, saved.salt), saved.hash)
      )
        return false;
      const offline = { ...cached, actor: { ...cached.actor, superAdmin: undefined } };
      preview.current = null;
      setPreviewRole(null);
      setViewRole(null);
      current.current = offline;
      setData(offline);
      setOnline(false);
      setLastSync((await getMeta<string>('lastSync')) ?? null);
      await updatePending();
      return true;
    },
    [updatePending],
  );
  const authorizeOffline = useCallback(
    async (shiftId: string, pin: string, permitId: string) => {
      if (preview.current) throw new Error(previewReadOnlyMessage);
      const permits = (await getMeta<OfflineAuthorizer[]>('offline-permits')) ?? [],
        permit = permits.find(
          (x) =>
            x.id === permitId &&
            (x.branchId
              ? x.branchId === current.current?.actor.branchId
              : current.current?.branch?.legacy || !current.current?.actor.branchId) &&
            x.expiresAt > new Date().toISOString(),
        );
      if (!permit) throw new Error('No hay una autorización vigente para este equipo.');
      let token: string;
      try {
        token = await decryptPermit(pin, permit);
      } catch {
        throw new Error('PIN de contingencia incorrecto.');
      }
      const saved = current.current!;
      current.current = { ...saved, actor: { ...saved.actor, offlineAdminId: permit.adminId } };
      try {
        return await run('authorize_shift', { shiftId, offlinePermit: token, base: 0 });
      } finally {
        if (current.current)
          current.current = {
            ...current.current,
            actor: { ...current.current.actor, offlineAdminId: undefined },
          };
      }
    },
    [run],
  );
  const reset = useCallback(() => {
    preview.current = null;
    setPreviewRole(null);
    setViewRole(null);
    current.current = null;
    setData(null);
    setPending([]);
    setPhotosPending(0);
  }, []);
  const changeView = useCallback(
    (role: Role | null) => {
      if (!current.current?.actor.superAdmin) return false;
      if (role !== null && !['admin', 'encargado', 'apoyo'].includes(role)) return false;
      if (role !== null && (localWrites.current > 0 || syncLock.current || pending.length || photosPending)) {
        toast('Termina y sincroniza las operaciones pendientes antes de cambiar de vista.');
        return false;
      }
      preview.current = isReadOnlyView(role) ? role : null;
      setPreviewRole(preview.current);
      setViewRole(role);
      return true;
    },
    [pending, photosPending, toast],
  );
  const visibleData = useMemo(
    () => (data?.actor.superAdmin && viewRole ? rolePreview(data, viewRole) : data),
    [data, viewRole],
  );
  const installUpdate = useCallback(
    async (activate: () => Promise<void>) => {
      if (installingUpdate.current || switchingBranch.current || localWrites.current > 0)
        throw new Error('Espera a que termine la operación en curso antes de actualizar.');
      if (!navigator.onLine) throw new Error('Conéctate para sincronizar antes de actualizar.');
      installingUpdate.current = true;
      try {
        await commandLock.current;
        await sync();
        // El primer intento puede haber esperado un envío anterior que aún no incluía el último registro.
        await sync();
        const snapshot = current.current;
        if (!snapshot) throw new Error('Inicia sesión antes de actualizar.');
        const queued = (await db.outbox.toArray()).some(
          (entry) =>
            belongsToBranch(entry, snapshot) && !['acknowledged', 'reconciled'].includes(entry.status),
        );
        const photos = (await db.photos.toArray()).some(
          (photo) => belongsToBranch(photo, snapshot) && photo.status === 'pending',
        );
        if (queued || photos)
          throw new Error(
            'La actualización espera registros o fotos sin sincronizar. Revisa Estado de sincronización y vuelve a intentarlo.',
          );
        await activate();
      } finally {
        installingUpdate.current = false;
      }
    },
    [sync],
  );
  const switchBranch = useCallback(
    async (branchId: string) => {
      const saved = current.current;
      if (!saved || saved.actor.branchId === branchId) return;
      if (!online || !navigator.onLine) throw new Error('Cambiar de local requiere conexión.');
      if (preview.current) throw new Error('Vuelve a Superadministrador para cambiar de local.');
      if (switchingBranch.current || syncLock.current || localWrites.current > 0 || installingUpdate.current)
        throw new Error('Espera a que termine la sincronización.');
      const queued = (await db.outbox.toArray()).some(
        (x) => x.actorId === saved.actor.id && !['acknowledged', 'reconciled'].includes(x.status),
      );
      const photos = (await db.photos.toArray()).some(
        (x) => x.actorId === saved.actor.id && x.status === 'pending',
      );
      if (queued || photos)
        throw new Error('Sincroniza y resuelve los registros pendientes antes de cambiar de local.');
      if (!saved.access?.branches.some((b) => b.id === branchId))
        throw new Error('No tienes acceso a este local.');
      switchingBranch.current = true;
      try {
        await setActiveBranch(branchId, saved.actor.id);
        setPreviewRole(null);
        preview.current = null;
        setViewRole(null);
        try {
          await load();
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'DEVICE_REQUIRED' && saved.actor.role === 'admin'))
            throw e;
          const device = await api('devices/self', { name: 'Navegador de administración', primary: false });
          await saveDeviceCredential({ id: device.deviceId, token: device.deviceToken });
          await load();
        }
        toast('Local seleccionado.');
      } catch (e) {
        if (saved.actor.branchId) await setActiveBranch(saved.actor.branchId, saved.actor.id);
        await remember(saved);
        throw e;
      } finally {
        switchingBranch.current = false;
      }
    },
    [load, online, remember, toast],
  );
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (localWrites.current > 0) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);
  const outageBusy = useRef(false);
  useEffect(() => {
    if (!data?.actor.primary || outageBusy.current || switchingBranch.current) return;
    outageBusy.current = true;
    void (async () => {
      const outageKey = `active-outage:${data.actor.branchId ?? 'legacy'}`;
      const active = await getMeta<string>(outageKey);
      if (!online && !active) {
        const result = await run('outage');
        await setMeta(outageKey, result.referenceId);
      } else if (online && active) {
        await run('outage', { id: active, until: new Date().toISOString() });
        await setMeta(outageKey, null);
      }
    })()
      .catch(() => {})
      .finally(() => {
        outageBusy.current = false;
      });
  }, [online, data?.actor.id, data?.actor.branchId, run]);
  useEffect(() => {
    live.current = true;
    const changed = () => {
      if (navigator.onLine) void sync();
      else setOnline(false);
    };
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    window.addEventListener('focus', changed);
    const timer = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        current.current &&
        navigator.onLine &&
        !switchingBranch.current &&
        !syncLock.current
      ) {
        if (pending.some((x) => x.status === 'pending') || photosPending > 0) void sync();
        else {
          syncLock.current = true;
          syncDone.current = snapshot(current.current.revision)
            .then((result) => {
              setOnline(true);
              if (!('unchanged' in result)) return load();
              if (result.access && current.current) {
                current.current = { ...current.current, access: result.access, branch: result.branch };
                setData(current.current);
              }
            })
            .catch(() => setOnline(false))
            .finally(() => {
              syncLock.current = false;
            });
        }
      }
    }, 5000);
    return () => {
      live.current = false;
      clearInterval(timer);
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', changed);
      window.removeEventListener('focus', changed);
    };
  }, [sync, load, pending, photosPending]);
  return (
    <Context.Provider
      value={{
        data: visibleData,
        sessionActor: data?.actor ?? null,
        viewRole,
        previewing: !!(data?.actor.superAdmin && isReadOnlyView(viewRole)),
        changeView,
        switchBranch,
        online,
        pending,
        photosPending,
        syncing,
        lastSync,
        error,
        load,
        run,
        sync,
        installUpdate,
        photo,
        unlockOffline,
        authorizeOffline,
        reset,
        toast,
      }}
    >
      {children}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </Context.Provider>
  );
}
export async function cacheLocalPin(pin: string, userId: string) {
  const salt = randomToken(16);
  const branch = await getActiveBranch(userId);
  const saved = {
    userId,
    branchId: branch?.userId === userId ? branch.id : undefined,
    salt,
    hash: await pinHash(pin, salt),
  };
  await setMeta('local-pin', saved);
  if (saved.branchId) await setMeta(`local-pin:${saved.branchId}:${userId}`, saved);
}
