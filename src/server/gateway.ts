import {
  applyCommand,
  assert,
  id,
  redactState,
  quotePayment,
  closingPreview,
  visibleClosingPreview,
  promotionSelection,
  syncOrderId,
} from '../domain/engine.ts';
import {
  DomainError,
  type Actor,
  type Command,
  type Device,
  type Profile,
  type State,
} from '../domain/types.ts';
import { hasPermission, isShiftCashier, shiftBlocksSales } from '../domain/access.ts';
import type { ApprovalAccess } from '../domain/change-approval.ts';
import type { Access } from '../domain/platform.ts';
import type { Backend, DeviceSecret } from './backend.ts';
import { isRetryableDatabaseCode } from '../domain/sync-errors.ts';
import { counterChanges, counterNeedsFullState, counterScope, counterState } from './counter-state.ts';
import { constantEqual, couponCode, encryptPermit, pinHash, randomToken, sha256 } from './crypto.ts';

const staffCommands = new Set([
  'request_shift',
  'submit_blind_count',
  'submit_closing',
  'respond_closing',
  'submit_blind_opening_audit',
  'finish_audit',
  'create_order',
  'send_order',
  'update_order',
  'cancel_order',
  'taste',
  'update_tasting',
  'remove_tasting',
  'close_tastings',
  'deliver',
  'pay',
  'redeem_coupon',
  'request_void',
  'unpaid',
  'request_payment_change',
  'request_transfer',
  'execute_transfer',
  'answer_shift_review',
  'open_package',
  'open_supply',
  'open_bag',
  'report_damage',
  'expense',
  'register_attachment',
  'outage',
]);

export interface GatewayOptions {
  backend: Backend;
  allowedOrigins: string[];
  now?: () => Date;
  appUrl?: string;
}
export function createGateway(options: GatewayOptions) {
  const now = () => options.now?.() ?? new Date();
  return async function gateway(req: Request): Promise<Response> {
    let store = options.backend;
    let databasePhase = 'request';
    const origin = req.headers.get('origin') ?? '',
      allowed = !origin || options.allowedOrigins.includes(origin);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    };
    if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] =
      'authorization, apikey, content-type, x-device-id, x-device-token, x-branch-id, x-preview-role, if-none-match, x-client-info';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (req.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers });
    if (!allowed) return json({ error: 'Origen no autorizado.' }, 403);
    try {
      const url = new URL(req.url),
        route = url.pathname.replace(/^.*\/dexter\/?/, '').replace(/^\//, '');
      assert(req.method === 'GET' || req.method === 'POST', 'Método no permitido.');
      const length = Number(req.headers.get('content-length') ?? 0);
      assert(length <= 2_000_000, 'Solicitud demasiado grande.');
      const rawBody = req.method === 'POST' ? await req.text() : '';
      assert(rawBody.length <= 2_000_000, 'Solicitud demasiado grande.');
      const body = rawBody ? JSON.parse(rawBody) : {};
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
      const rate = async (key: string, limit = 5, seconds = 300) =>
        assert(
          await store.rate(await sha256(key), limit, seconds),
          'Demasiados intentos. Espera unos minutos.',
          'RATE_LIMIT',
        );
      if (route === 'health')
        return json({
          ok: true,
          app: 'dexter',
          version: 3,
          multiLocal: true,
          orderHandoff: true,
          retryableSync: true,
          scopedCounter: true,
        });
      if (route === 'superadmin/setup') {
        await rate(`owner-setup:${ip}`, 5, 900);
        assert(req.method === 'POST', 'Método no permitido.');
        assert(
          typeof body.token === 'string' && body.token.length >= 32,
          'Activación inválida.',
          'FORBIDDEN',
        );
        const email = String(body.email ?? '')
          .trim()
          .toLowerCase();
        const hash = await sha256(body.token);
        const valid = await store.superAdmin('check', { email, hash });
        assert(valid, 'Activación inválida, vencida o ya utilizada.', 'FORBIDDEN');
        assert(
          typeof body.password === 'string' && body.password.length >= 14 && body.password.length <= 200,
          'La contraseña debe tener entre 14 y 200 caracteres.',
        );
        assert(
          typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 100,
          'Nombre inválido.',
        );
        const userId = await store.createAuthUser(valid.email, body.password);
        try {
          const claimed = await store.superAdmin('claim', {
            hash,
            userId,
            email: valid.email,
            name: body.name.trim(),
          });
          assert(claimed?.ok, 'La activación ya fue utilizada.', 'CONFLICT');
        } catch (error) {
          await store.deleteAuthUser(userId);
          throw error;
        }
        return json({ ok: true });
      }
      if (route === 'setup') {
        await rate(`setup:${ip}`, 5, 900);
        assert(
          typeof body.token === 'string' && body.token.length >= 32,
          'Código de configuración inválido.',
        );
        const hash = await sha256(body.token),
          valid = await store.security('setup_check', { hash });
        assert(valid?.ok, 'Código de configuración inválido o ya utilizado.', 'FORBIDDEN');
        assert(
          typeof body.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email),
          'Correo inválido.',
        );
        assert(
          typeof body.password === 'string' && body.password.length >= 14 && body.password.length <= 200,
          'La contraseña debe tener al menos 14 caracteres.',
        );
        assert(
          typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 100,
          'Nombre inválido.',
        );
        assert(
          !(await store.superAdmin('reserved', { email: body.email }))?.reserved,
          'Este correo tiene un acceso privado reservado.',
          'FORBIDDEN',
        );
        const userId = await store.createAuthUser(body.email, body.password);
        const claimed = await store.security('setup', { hash });
        if (!claimed?.ok) {
          await store.deleteAuthUser(userId);
          throw new DomainError('La configuración inicial ya fue realizada.', 'CONFLICT');
        }
        await store.saveProfile({ id: userId, name: body.name.trim(), role: 'admin', active: true });
        await store.platform(userId, 'bootstrap');
        return json({
          ok: true,
          message: 'Administrador creado. Inicia sesión con Google o con tu correo y contraseña.',
        });
      }
      if (route === 'login-pin') {
        await rate(`pin:${ip}:${String(body.username).toLowerCase()}`, 5, 300);
        assert(
          typeof body.pin === 'string' && /^\d{6}$/.test(body.pin),
          'Usuario, PIN o dispositivo inválido.',
          'FORBIDDEN',
        );
        const secret = await store.security('staff_get', {
          username: String(body.username ?? '').toLowerCase(),
        });
        assert(
          secret && constantEqual(await pinHash(body.pin, secret.salt), secret.pin_hash),
          'Usuario, PIN o dispositivo inválido.',
          'FORBIDDEN',
        );
        const profile = await store.profile(secret.userId);
        assert(profile?.active && profile.role !== 'admin', 'Acceso no autorizado.', 'FORBIDDEN');
        let device: DeviceSecret | undefined;
        let returnedToken: string | undefined;
        if (body.enrollmentCode) {
          const enrollment = await store.security('enrollment_consume', {
            userId: profile.id,
            hash: await sha256(String(body.enrollmentCode)),
          });
          assert(enrollment, 'Código de registro vencido o utilizado.', 'FORBIDDEN');
          store = store.forBranch(enrollment.branch_id);
          const branchProfile = await store.profile(profile.id);
          assert(
            branchProfile?.active && branchProfile.role !== 'admin',
            'Sin acceso operativo al local.',
            'FORBIDDEN',
          );
          returnedToken = randomToken();
          device = {
            id: crypto.randomUUID(),
            userId: profile.id,
            name: String(body.deviceName ?? 'Celular').slice(0, 80),
            active: true,
            primary: false,
            tokenHash: await sha256(returnedToken),
          };
          await store.saveDevice(device);
        } else {
          device = (await store.devices()).find(
            (x) => x.id === body.deviceId && x.userId === profile.id && x.active,
          );
          assert(
            device &&
              typeof body.deviceToken === 'string' &&
              constantEqual(await sha256(body.deviceToken), device.tokenHash),
            'Este dispositivo debe registrarlo un administrador.',
            'FORBIDDEN',
          );
          if (device.branchId) store = store.forBranch(device.branchId);
          const branchProfile = await store.profile(profile.id);
          assert(
            branchProfile?.active && branchProfile.role !== 'admin',
            'Sin acceso operativo al local.',
            'FORBIDDEN',
          );
        }
        return json({
          session: await store.pinSession(profile.id),
          deviceId: device!.id,
          deviceToken: returnedToken,
          profile,
          branchId: store.branchId ?? device!.branchId,
        });
      }
      const auth = req.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '',
        identity = await store.verifyUser(auth);
      assert(identity, 'Inicia sesión para continuar.', 'UNAUTHORIZED');
      let profile = await store.profile(identity.id);
      assert(profile?.active, 'El usuario está desactivado o no tiene acceso.', 'USER_REVOKED');
      const ownerId = (await store.superAdmin('owner'))?.userId;
      const isSuperAdmin = profile.role === 'admin' && profile.id === ownerId;
      const access: Access = await store.platform(profile.id, 'access');
      access.branches = access.branches.map((branch) =>
        branch.role === 'admin'
          ? branch
          : {
              ...branch,
              monthlyFee: null,
              billingStart: null,
            },
      );
      if (route === 'access') return json(access);
      if (route.startsWith('platform/')) {
        assert(profile.role === 'admin', 'Esta operación requiere un administrador.', 'FORBIDDEN');
        assert(
          !req.headers.get('x-preview-role'),
          'Vuelve a Superadministrador para gestionar locales.',
          'FORBIDDEN',
        );
        if (route === 'platform/view') return json(await store.platform(profile.id, 'view'));
        const actions: Record<string, string> = {
          'platform/businesses': 'business_create',
          'platform/branches': 'branch_create',
          'platform/branches/update': 'branch_update',
          'platform/invoices': 'invoice_create',
          'platform/payments': 'payment_create',
          'platform/invoices/void': 'invoice_void',
        };
        const action = actions[route];
        assert(action && req.method === 'POST', 'Ruta no disponible.');
        assert(
          isSuperAdmin || action === 'branch_create',
          'Solo el desarrollador puede realizar esta operación.',
          'FORBIDDEN',
        );
        let createdUser: string | undefined;
        try {
          const payload = { ...body };
          if (action === 'business_create' && !body.ownerId) {
            assert(
              typeof body.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email),
              'Correo inválido.',
            );
            assert(
              typeof body.password === 'string' && body.password.length >= 14 && body.password.length <= 200,
              'La contraseña debe tener entre 14 y 200 caracteres.',
            );
            assert(
              typeof body.ownerName === 'string' &&
                body.ownerName.trim().length > 0 &&
                body.ownerName.length <= 100,
              'Nombre del propietario inválido.',
            );
            assert(
              !(await store.superAdmin('reserved', { email: body.email }))?.reserved,
              'Este correo tiene un acceso privado reservado.',
              'FORBIDDEN',
            );
            createdUser = await store.createAuthUser(body.email.trim().toLowerCase(), body.password);
            payload.ownerId = createdUser;
          } else delete payload.ownerName;
          delete payload.password;
          delete payload.email;
          return json(await store.platform(profile.id, action, payload));
        } catch (error) {
          if (createdUser) await store.deleteAuthUser(createdUser);
          const e = error as Error & { code?: string };
          if (e.code === '23505') throw new DomainError('Ya existe un registro con esos datos.', 'CONFLICT');
          if (
            e.code === 'P0001' ||
            e.code === '42501' ||
            e.code === '23514' ||
            e.code === '22007' ||
            e.code === '22P02'
          )
            throw new DomainError(
              e.code === '23514' || e.code === '22P02' ? 'Revisa los valores del formulario.' : e.message,
              e.code === '42501' ? 'FORBIDDEN' : 'VALIDATION',
            );
          throw error;
        }
      }
      const requestedBranch = req.headers.get('x-branch-id');
      const knownDevice =
        !requestedBranch && req.headers.get('x-device-id')
          ? await store.security('device_lookup', { id: id(req.headers.get('x-device-id')) })
          : null;
      const branch =
        access.branches.find((b) => b.id === (requestedBranch ?? knownDevice?.branchId)) ??
        (!requestedBranch
          ? (access.branches.find((b) => b.id === access.legacyBranchId) ?? access.branches[0])
          : undefined);
      assert(branch, 'No tienes acceso a este local.', 'USER_REVOKED');
      store = store.forBranch(branch.id);
      const branchProfile = await store.profile(profile.id);
      assert(
        branchProfile?.active || isSuperAdmin,
        'El usuario no tiene acceso activo al local.',
        'USER_REVOKED',
      );
      profile = { ...profile, ...branchProfile, role: branchProfile?.role ?? branch.role };
      headers['X-Branch-Id'] = branch.id;
      headers['X-Legacy-Branch'] = String(branch.id === access.legacyBranchId);
      const previewRole = req.headers.get('x-preview-role');
      if (previewRole !== null) {
        assert(
          isSuperAdmin && ['admin', 'encargado', 'apoyo'].includes(previewRole),
          'Esta vista requiere el acceso privado de superadministrador.',
          'FORBIDDEN',
        );
        assert(
          ['snapshot', 'attachments/read', 'export', 'quote'].includes(route),
          'La vista de consulta no permite guardar cambios. Vuelve a Superadministrador para operar.',
          'FORBIDDEN',
        );
      }
      const admin = () =>
        assert(profile.role === 'admin', 'Esta operación requiere un administrador.', 'FORBIDDEN');
      if (route === 'devices/self') {
        admin();
        assert(!isSuperAdmin, 'Tu acceso de superadministrador no requiere registrar equipos.', 'FORBIDDEN');
        const previousId = req.headers.get('x-device-id');
        assert(
          !previousId || !(await store.devices()).some((d) => d.id === previousId && !d.active),
          'El dispositivo fue desactivado. Solicita su reactivación a un administrador.',
          'DEVICE_REVOKED',
        );
        assert(body.primary !== true, 'Propón la asignación como equipo principal después de registrarlo.');
        const token = randomToken();
        const d: DeviceSecret = {
          id: crypto.randomUUID(),
          userId: profile.id,
          name: String(body.name ?? 'Dispositivo administrador').slice(0, 80),
          active: true,
          primary: false,
          tokenHash: await sha256(token),
        };
        await store.saveDevice(d);
        await store.securityAudit(profile.id, d.id, 'register_device', d.name);
        return json({ deviceId: d.id, deviceToken: token });
      }
      const deviceId = req.headers.get('x-device-id'),
        deviceToken = req.headers.get('x-device-token');
      const allDevices = await store.devices();
      let device: DeviceSecret | undefined;
      if (isSuperAdmin) {
        // Use the verified Auth session for auditing, independently of POS hardware.
        assert(identity.sessionId, 'Vuelve a ingresar para completar tu sesión.', 'UNAUTHORIZED');
        const authSessionId = id(identity.sessionId, 'Sesión');
        const hash = await sha256(`${authSessionId}:${branch.id}`);
        const sessionId =
          branch.id === access.legacyBranchId
            ? authSessionId
            : `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        device = allDevices.find((x) => x.id === sessionId);
        if (!device) {
          device = {
            id: sessionId,
            userId: profile.id,
            name: 'Sesión privada de superadministrador',
            active: true,
            primary: false,
            tokenHash: await sha256(randomToken()),
          };
          await store.saveDevice(device);
          await store.securityAudit(
            profile.id,
            device.id,
            'superadmin_session',
            'Acceso privado con sesión verificada, sin equipo de caja.',
          );
        }
        assert(
          device.userId === profile.id && device.active && !device.primary,
          'La sesión privada no está disponible. Vuelve a ingresar.',
          'FORBIDDEN',
        );
      } else {
        device = allDevices.find(
          (x) => x.id === deviceId && (x.userId === profile.id || profile.role === 'admin'),
        );
        assert(
          device && deviceToken && constantEqual(await sha256(deviceToken), device.tokenHash),
          'Dispositivo desactivado o no registrado.',
          'DEVICE_REQUIRED',
        );
        assert(
          device.active,
          'El dispositivo fue desactivado. Solicita su reactivación a un administrador.',
          'DEVICE_REVOKED',
        );
      }
      const actor: Actor = {
        ...profile,
        branchId: branch.id,
        ...(isSuperAdmin ? { superAdmin: true } : {}),
        deviceId: device.id,
        primary: device.primary,
        online: true,
        aal: identity.aal,
      };
      const commitBusinessCommand = async (command: Command, context: Actor) => {
        const scope = counterScope(command);
        for (let attempt = 0; attempt < 5; attempt++) {
          databasePhase = 'load';
          const scoped = scope ? await store.loadCounter(scope) : undefined;
          const useScoped = scoped && scope && !counterNeedsFullState(scoped.state, scope);
          const loaded = useScoped
            ? { state: counterState(scoped.state), revision: scoped.revision }
            : await store.load();
          const discardedMessage = 'La operación quedó archivada por el cuadre de caja e inventario.';
          const discarded = loaded.state.requests.find(
            (request) =>
              request.id === command.id &&
              request.type === 'sync' &&
              request.by === context.id &&
              request.status === 'rejected' &&
              request.syncDiscardedThrough,
          );
          assert(!discarded, discardedMessage, 'SYNC_DISCARDED');
          const priorConflict = command.payload.syncAfterConflict;
          if (typeof priorConflict === 'string') {
            const orderId = syncOrderId(command);
            const priorReview = loaded.state.requests.find(
              (request) =>
                request.id === priorConflict && request.type === 'sync' && request.by === context.id,
            );
            const source = priorReview?.originalCommand;
            assert(
              source && orderId && syncOrderId(source) === orderId,
              'No se pudo comprobar la operación anterior. La operación se conserva para revisión.',
              'ORDER_DEPENDENCY_CONFLICT',
            );
            if (
              priorReview?.status === 'rejected' &&
              priorReview.syncDiscardedThrough &&
              source.deviceId === command.deviceId &&
              command.sequence > source.sequence &&
              Date.parse(command.at) <= Date.parse(priorReview.syncDiscardedThrough)
            )
              throw new DomainError(discardedMessage, 'SYNC_DISCARDED');
            throw new DomainError(
              'Esta operación se preparó después de un cambio que no se aplicó. Verifica el pedido y cualquier cobro o entrega antes de conciliar.',
              'ORDER_DEPENDENCY_CONFLICT',
            );
          }
          if (
            (command.type === 'submit_closing' && Number(command.payload.sent) > 0) ||
            (command.type === 'request_transfer' &&
              (context.role !== 'admin' || String(command.payload.from ?? '').startsWith('cash:')))
          ) {
            const destinationId =
              command.type === 'submit_closing' ? command.payload.locationId : command.payload.to;
            const destination = loaded.state.locations.find((item) => item.id === destinationId);
            const receiver = destination ? await store.profile(destination.custodianId) : undefined;
            assert(
              receiver?.active && receiver.role === 'admin',
              'Selecciona un destino a cargo de un administrador activo.',
            );
          }
          let approvalAccess: ApprovalAccess | undefined;
          if (command.type === 'change_access' || command.type === 'resolve_change') {
            const [profiles, devices] = await Promise.all([store.profiles(), store.devices()]);
            approvalAccess = { profiles, devices, privateOwnerId: ownerId };
          }
          const applied = applyCommand(loaded.state, command, context, now().toISOString(), approvalAccess);
          // Finaliza un cierre de contingencia cuando ya llegaron sus eventos anteriores.
          if (
            command.payload.offline === true &&
            command.type === 'count' &&
            command.payload.kind === 'closing'
          ) {
            const shift = applied.state.shifts.find((s) => s.closingCountId === applied.result.referenceId);
            if (shift) shift.status = 'closed';
          }
          try {
            const state = useScoped ? counterChanges(loaded.state, applied.state) : applied.state;
            databasePhase = 'commit';
            return await store.commit(loaded.revision, command, state, applied.result);
          } catch (error) {
            if (
              (error as { code?: string }).code !== '40001' &&
              !(error as Error).message.includes('REVISION_CONFLICT')
            )
              throw error;
          }
        }
        throw new DomainError('Hay otra operación en curso. Se reintentará sin duplicar.', 'RETRY_SYNC');
      };
      const updateAccess = async (payload: Record<string, unknown>) => {
        const command: Command = {
          id: crypto.randomUUID(),
          branchId: branch.id,
          type: 'change_access',
          actorId: actor.id,
          deviceId: actor.deviceId,
          at: now().toISOString(),
          configVersion: 1,
          sequence: 1,
          payload,
        };
        return commitBusinessCommand(command, actor);
      };
      const publicDevices = (all: DeviceSecret[]): Device[] =>
        all
          .filter((x) => x.userId !== ownerId)
          .filter((x) => profile.role === 'admin' || x.userId === profile.id)
          .map(({ tokenHash: _, ...d }) => d);
      if (route === 'snapshot') {
        databasePhase = 'snapshot';
        const since = url.searchParams.get('since');
        if (since !== null) {
          const revision = await store.revision();
          if (since === String(revision))
            return json({ unchanged: true, revision, actor, branch, access, serverAt: now().toISOString() });
        }
        const loaded = await store.load();
        const state = redactState(loaded.state, actor);
        const profiles = await store.profiles();
        if (
          actor.role === 'encargado' &&
          actor.primary &&
          state.shifts.some(
            (shift) =>
              (shift.deviceId === actor.deviceId && shift.status === 'open') ||
              (shift.cashierId === actor.id && shift.closingReview?.status === 'returned'),
          )
        ) {
          const admins = new Set(
            profiles
              .filter((person) => person.active && person.role === 'admin' && person.id !== actor.id)
              .map((person) => person.id),
          );
          state.transferDestinations = loaded.state.locations
            .filter((item) => item.active && admins.has(item.custodianId))
            .map(({ id, name, type, custodianId }) => ({
              id,
              name,
              custodian: profiles.find((person) => person.id === custodianId)?.name,
              needsEvidence: type === 'bank',
            }));
        }
        for (const summary of state.ownTurnSummary ?? []) {
          for (const handoff of summary.handoffs) {
            const recipient = loaded.state.transfers.find(
              (transfer) => transfer.id === handoff.id,
            )?.recipientId;
            handoff.custodian = profiles.find((person) => person.id === recipient)?.name;
          }
        }
        const sellers = new Set(state.orders.map((order) => order.sellerId));
        return json({
          branch,
          access,
          state,
          revision: loaded.revision,
          actor,
          profiles: profiles
            .filter((p) => isSuperAdmin || p.id !== ownerId)
            .filter((p) => actor.role === 'admin' || p.id === actor.id || sellers.has(p.id))
            .map((p) =>
              profile.role === 'admin' ? p : { id: p.id, name: p.name, role: p.role, active: p.active },
            ),
          devices: publicDevices(await store.devices()),
          serverAt: now().toISOString(),
        });
      }
      if (!['attachments/read', 'export', 'devices/self'].includes(route)) {
        assert(
          branch.status === 'active',
          'Este local no está activo. Puedes consultar su información y gestionar la solicitud en Locales y mensualidades.',
          'BRANCH_INACTIVE',
        );
      }
      if (route === 'closing-preview') {
        const loaded = await store.load();
        const shift = loaded.state.shifts.find((s) => s.id === body.shiftId);
        assert(shift && !loaded.state.settings[0].auditId, 'Turno no disponible o arqueo en curso.');
        assert(
          shift.status === 'open' && hasPermission(actor, 'shifts') && isShiftCashier(actor, shift),
          'Solo el responsable de la caja puede revisar su cierre abierto.',
          'FORBIDDEN',
        );
        if (body.visible === true) {
          assert(
            !shiftBlocksSales(shift) ||
              shift.blindClosing?.status === 'recount' ||
              (shift.blindClosing?.status === 'ready' && shift.blindClosing.countIds?.length === 1),
            'Completa el conteo de apertura.',
          );
          return json(visibleClosingPreview(loaded.state, shift));
        }
        admin();
        return json(closingPreview(loaded.state, shift.id));
      }
      if (route === 'quote') {
        await rate(`coupon-quote:${profile.id}`, 20, 60);
        const loaded = await store.load();
        const order = loaded.state.orders.find((o) => o.id === body.orderId && o.status === 'open');
        assert(order, 'Pedido no disponible.');
        const shift = loaded.state.shifts.find((x) => x.id === order.shiftId);
        assert(
          shift?.status === 'open' && hasPermission(actor, 'payments') && isShiftCashier(actor, shift),
          'Solo el encargado valida el cobro con turno abierto y permiso.',
          'FORBIDDEN',
        );
        assert(
          !shiftBlocksSales(shift) && !loaded.state.settings[0].auditId,
          'Completa el conteo pendiente antes de validar el cobro.',
          'SHIFT_COUNT',
        );
        assert(
          Array.isArray(body.codes) &&
            body.codes.length <= 10 &&
            body.codes.every(
              (code: unknown) => typeof code === 'string' && code.trim().length > 0 && code.length <= 80,
            ),
          'Cupones inválidos.',
        );
        const selectedPromotions = promotionSelection(body.promotionIds, body.counterPromotionId);
        const quote = quotePayment(
          loaded.state,
          order,
          now().toISOString(),
          true,
          body.codes,
          selectedPromotions,
        );
        return json({
          total: quote.total,
          lines: quote.lines,
          coupons: quote.coupons,
          applications: quote.applications,
          unusedCodes: quote.unusedCodes,
          configVersion: loaded.state.settings[0].version,
        });
      }
      if (route === 'users') {
        admin();
        assert(
          body.permissions === undefined,
          'Propón los permisos personalizados después de crear el usuario.',
        );
        assert(['admin', 'encargado', 'apoyo'].includes(body.role), 'Rol inválido.');
        assert(
          typeof body.name === 'string' && body.name.trim() && body.name.length <= 100,
          'Nombre inválido.',
        );
        assert(
          typeof body.username === 'string' && /^[a-z0-9.-]{3,30}$/.test(body.username),
          'El usuario debe tener 3–30 letras minúsculas, números, puntos o guiones.',
        );
        assert(
          !(await store.profiles()).some((p) => p.username === body.username),
          'Este usuario ya existe.',
        );
        if (body.role !== 'admin')
          assert(typeof body.pin === 'string' && /^\d{6}$/.test(body.pin), 'PIN de seis dígitos.');
        const email =
          body.role === 'admin' ? String(body.email) : `${crypto.randomUUID()}@staff.dexter.invalid`;
        assert(
          !(await store.superAdmin('reserved', { email }))?.reserved,
          'Este correo tiene un acceso privado reservado.',
          'FORBIDDEN',
        );
        const password = body.role === 'admin' ? String(body.password) : randomToken(32);
        assert(password.length >= 14, 'La contraseña debe tener al menos 14 caracteres.');
        const uid = await store.createAuthUser(email, password);
        try {
          await store.saveProfile({
            id: uid,
            name: body.name.trim(),
            username: body.username,
            role: body.role,
            active: body.role !== 'admin',
          });
        } catch (error) {
          await store.deleteAuthUser(uid);
          throw error;
        }
        if (body.role !== 'admin') {
          const salt = randomToken(16);
          await store.security('staff_set', { userId: uid, salt, hash: await pinHash(body.pin, salt) });
        }
        await store.securityAudit(profile.id, device.id, 'create_user', `${body.name} · ${body.role}`);
        const result =
          body.role === 'admin'
            ? await updateAccess({ kind: 'user', targetId: uid, active: true })
            : undefined;
        return json({ id: uid, result });
      }
      if (route === 'users/update') {
        admin();
        const target = await store.profile(id(body.userId));
        assert(target, 'Usuario desconocido.');
        assert(
          target.id !== ownerId,
          'El acceso privado de superadministrador no se modifica desde el equipo del negocio.',
          'FORBIDDEN',
        );
        const changesAccess =
          body.active !== undefined || body.role !== undefined || body.permissions !== undefined;
        if (body.pin !== undefined) {
          assert(!changesAccess, 'Cambia el PIN en una operación independiente.');
          assert(
            target.role !== 'admin' && typeof body.pin === 'string' && /^\d{6}$/.test(body.pin),
            'Solo empleados: PIN de seis dígitos.',
          );
          const salt = randomToken(16);
          await store.security('staff_set', { userId: target.id, salt, hash: await pinHash(body.pin, salt) });
          await store.securityAudit(profile.id, device.id, 'reset_pin', target.name);
        }
        const { active, role, permissions } = body;
        const result = changesAccess
          ? await updateAccess({ kind: 'user', targetId: target.id, active, role, permissions })
          : undefined;
        return json({ ok: true, result });
      }
      if (route === 'devices/invite') {
        admin();
        assert(body.primary !== true, 'Propón la asignación como equipo principal después de registrarlo.');
        const target = await store.profile(id(body.userId));
        assert(target?.active && target.role !== 'admin', 'Selecciona un empleado activo.');
        const token = randomToken(12);
        await store.security('enrollment_create', {
          hash: await sha256(token),
          userId: target.id,
          expiresAt: new Date(now().getTime() + 15 * 60000).toISOString(),
          primary: false,
        });
        await store.securityAudit(profile.id, device.id, 'invite_device', target.name);
        return json({ code: token, expiresInMinutes: 15 });
      }
      if (route === 'devices/update') {
        admin();
        const target = (await store.devices()).find((x) => x.id === body.deviceId);
        assert(target, 'Dispositivo desconocido.');
        assert(
          target.userId !== ownerId,
          'El acceso privado de superadministrador no se configura como equipo de caja.',
          'FORBIDDEN',
        );
        const result = await updateAccess({
          kind: 'device',
          targetId: target.id,
          active: body.active,
          primary: body.primary,
        });
        return json({ ok: true, result });
      }
      if (route === 'offline-authorizer') {
        admin();
        assert(device.primary, 'Habilita la contingencia presencialmente en el equipo de caja.');
        assert(
          typeof body.pin === 'string' && /^\d{6}$/.test(body.pin),
          'Usa un PIN de contingencia de seis dígitos.',
        );
        const token = randomToken(),
          key = crypto.randomUUID(),
          expiresAt = new Date(now().getTime() + 7 * 86400000).toISOString();
        await store.security('permit_create', {
          id: key,
          hash: await sha256(token),
          adminId: profile.id,
          deviceId: device.id,
          expiresAt,
        });
        await store.securityAudit(
          profile.id,
          device.id,
          'enable_offline_authorizer',
          'Permiso de apertura de contingencia, válido siete días.',
        );
        return json({
          id: key,
          branchId: branch.id,
          adminId: profile.id,
          name: profile.name,
          expiresAt,
          ...(await encryptPermit(body.pin, token)),
        });
      }
      if (route === 'commands') {
        assert(
          Array.isArray(body.commands) && body.commands.length > 0 && body.commands.length <= 50,
          'Lote de operaciones inválido.',
        );
        const results = [];
        for (const supplied of body.commands) {
          const command: Command = {
            id: supplied.id,
            branchId: branch.id,
            type: supplied.type,
            actorId: profile.id,
            deviceId: device.id,
            shiftId: supplied.shiftId,
            at: supplied.at,
            configVersion: supplied.configVersion,
            sequence: supplied.sequence,
            payload: supplied.payload ?? {},
          };
          assert(
            supplied.branchId ? supplied.branchId === branch.id : branch.id === access.legacyBranchId,
            'La operación pertenece a otro local.',
            'FORBIDDEN',
          );
          assert(
            supplied.actorId === profile.id && supplied.deviceId === device.id,
            'Autor de la operación inválido.',
            'FORBIDDEN',
          );
          try {
            if (actor.role !== 'admin') {
              assert(
                staffCommands.has(command.type),
                'Esta operación requiere un administrador.',
                'FORBIDDEN',
              );
              if (command.type === 'request_shift')
                assert(command.payload.offline !== true, 'La apertura requiere conexión.', 'ONLINE_REQUIRED');
            }
            if (['submit_blind_count', 'submit_blind_opening_audit'].includes(command.type))
              assert(command.payload.offline !== true, 'El conteo requiere conexión.', 'ONLINE_REQUIRED');
            const existing = await store.receipt(id(command.id));
            if (existing) {
              assert(existing.actorId === profile.id, 'Identificador de operación ocupado.', 'CONFLICT');
              results.push(existing.result);
              continue;
            }
            await rate(`commands:${profile.id}`, 1800, 60);
            if (command.type === 'issue_coupon') command.payload = { ...command.payload, code: couponCode() };
            let context = { ...actor };
            if (command.payload.offline === true) {
              context.online = false;
              if (command.type === 'authorize_shift') {
                const permit = await store.security('permit_validate', {
                  hash: await sha256(String(command.payload.offlinePermit ?? '')),
                  deviceId: device.id,
                  at: command.at,
                  commandId: command.id,
                });
                assert(permit?.adminId, 'La autorización offline no es válida.', 'FORBIDDEN');
                context.offlineAdminId = permit.adminId;
              }
            }
            if (
              command.type === 'redeem_coupon' ||
              (command.type === 'pay' && Array.isArray(command.payload.codes) && command.payload.codes.length)
            ) {
              assert(command.payload.offline !== true, 'El cupón no se puede canjear offline.');
              await rate(`coupon:${profile.id}`, 20, 60);
            }
            results.push(await commitBusinessCommand(command, context));
            if (context.offlineAdminId)
              await store.security('permit_use', {
                hash: await sha256(String(command.payload.offlinePermit)),
                commandId: command.id,
              });
          } catch (error) {
            const e = error as Error & { code?: string };
            if (e.code === 'RETRY_SYNC' || e.code === 'RATE_LIMIT' || isRetryableDatabaseCode(e.code))
              throw error;
            if (e instanceof DomainError && e.code === 'SYNC_DISCARDED') {
              results.push({
                id: command.id,
                status: 'conflict',
                code: e.code,
                message: e.message,
                finalRejection: true,
              });
              break;
            }
            const needsReview =
              (actor.role === 'admin' || e.code !== 'FORBIDDEN') &&
              (e.code === 'ORDER_VERSION_CONFLICT' ||
                e.code === 'ORDER_DEPENDENCY_CONFLICT' ||
                [
                  'create_order',
                  'update_order',
                  'deliver',
                  'pay',
                  'count',
                  'taste',
                  'update_tasting',
                  'remove_tasting',
                  'authorize_shift',
                  'replace_order',
                  'refund_order',
                  'receive_shipment',
                  'expense',
                  'execute_transfer',
                  'confirm_transfer',
                ].includes(command.type));
            if (needsReview) await store.security('sync_conflict', { command, message: e.message });
            const rejectedRecovery =
              command.type === 'record_employee_recovery' &&
              (error instanceof DomainError || e.code === '42501');
            const rejectedAudit =
              ['start_audit', 'finish_audit', 'adjust_count_inventory'].includes(command.type) &&
              error instanceof DomainError &&
              ['VALIDATION', 'FORBIDDEN', 'SHIFT_CLOSED'].includes(error.code);
            results.push({
              id: command.id,
              status: 'conflict',
              message:
                error instanceof DomainError || actor.role === 'admin'
                  ? e.message
                  : 'El servidor no pudo validar este registro.',
              code: e.code ?? 'VALIDATION',
              ...(needsReview ? { syncReview: true as const } : {}),
              ...(rejectedRecovery ||
              rejectedAudit ||
              (!needsReview &&
                error instanceof DomainError &&
                ['FORBIDDEN', 'VALIDATION', 'ONLINE_REQUIRED', 'CLOSING_CHANGED'].includes(error.code))
                ? { finalRejection: true }
                : {}),
            });
            break;
          }
        }
        return json({ results, serverAt: now().toISOString() });
      }
      if (route === 'attachments/upload') {
        const loaded = await store.load(),
          attachment = loaded.state.attachments.find((x) => x.id === body.id);
        assert(
          attachment && (attachment.by === profile.id || profile.role === 'admin'),
          'Foto no autorizada.',
          'FORBIDDEN',
        );
        if (attachment.status === 'uploaded') return json({ completed: true });
        const ext =
          attachment.mime === 'image/png' ? 'png' : attachment.mime === 'image/webp' ? 'webp' : 'jpg';
        return json(
          await store.signedUpload(`staging/${attachment.by}/${attachment.id}/${randomToken(16)}.${ext}`),
        );
      }
      if (route === 'attachments/complete') {
        const loaded = await store.load(),
          attachment = loaded.state.attachments.find((x) => x.id === body.id);
        assert(attachment && attachment.by === profile.id, 'Foto no autorizada.', 'FORBIDDEN');
        if (attachment.status === 'uploaded') return json({ ok: true });
        const ext =
            attachment.mime === 'image/png' ? 'png' : attachment.mime === 'image/webp' ? 'webp' : 'jpg',
          path = `${profile.id}/${attachment.id}.${ext}`,
          staging = String(body.path ?? '');
        assert(
          new RegExp(`^staging/${profile.id}/${attachment.id}/[a-f0-9]{32}\\.${ext}$`).test(staging),
          'Ruta de fotografía inválida.',
        );
        const blob = await store.download(staging);
        assert(blob.size > 0 && blob.size <= 3 * 1024 * 1024, 'Archivo inválido.');
        assert(blob.type === attachment.mime, 'El formato de la foto no coincide.');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        assert(
          (bytes[0] === 0xff && bytes[1] === 0xd8) ||
            (bytes[0] === 0x89 && bytes[1] === 0x50) ||
            (bytes[0] === 0x52 && bytes[1] === 0x49),
          'El archivo no es una imagen válida.',
        );
        const hash = await sha256(bytes);
        try {
          await store.finalizePhoto(staging, path);
        } catch (error) {
          const existing = await store.download(path);
          assert(
            (await sha256(new Uint8Array(await existing.arrayBuffer()))) === hash,
            'La evidencia definitiva ya existe con otro contenido.',
            'CONFLICT',
          );
        }
        await store.security('media_set', {
          id: attachment.id,
          path,
          size: blob.size,
          mime: blob.type,
          sha256: hash,
        });
        return json({ ok: true });
      }
      if (route === 'attachments/read') {
        const loaded = await store.load();
        const attachment = loaded.state.attachments.find((x) => x.id === url.searchParams.get('id'));
        assert(
          attachment?.path &&
            (profile.role === 'admin' ||
              attachment.by === profile.id ||
              loaded.state.flavors.some((f) => f.imageId === attachment.id)),
          'Foto no autorizada o pendiente de subir.',
          'FORBIDDEN',
        );
        return json({ url: await store.signedDownload(attachment.path) });
      }
      if (route === 'export') {
        admin();
        const { state } = await store.load();
        assert(
          !state.transfers.some(
            (transfer) => transfer.status === 'in_transit' && transfer.recipientId === actor.id,
          ),
          'Confirma tus recepciones pendientes antes de exportar los importes.',
        );
        return json({
          branch,
          state,
          profiles: (await store.profiles()).filter((p) => isSuperAdmin || p.id !== ownerId),
          devices: publicDevices(await store.devices()),
          exportedAt: now().toISOString(),
          schemaVersion: 2,
        });
      }
      if (route === 'notifications/retry') {
        admin();
        return json({ ok: true, message: 'Reintento solicitado.' });
      }
      return json({ error: 'Ruta no encontrada.' }, 404);
    } catch (error) {
      const e = error as Error & { code?: string };
      if (isRetryableDatabaseCode(e.code)) {
        console.warn('Temporary database failure', { code: e.code, phase: databasePhase });
        return json(
          {
            error: 'El servidor no respondió a tiempo. Los registros locales se conservan y se reintentarán.',
            code: 'RETRY_SYNC',
          },
          503,
        );
      }
      const statuses: Record<string, number> = {
        UNAUTHORIZED: 401,
        FORBIDDEN: 403,
        '42501': 403,
        DEVICE_REQUIRED: 403,
        DEVICE_REVOKED: 403,
        USER_REVOKED: 403,
        BRANCH_INACTIVE: 403,
        RATE_LIMIT: 429,
        CONFLICT: 409,
        RETRY_SYNC: 503,
      };
      const known = error instanceof DomainError;
      if (!known) console.error('Gateway failure', e.code ?? '', e.message);
      return json(
        {
          error: known ? e.message : 'No se pudo completar la operación. El registro local se conserva.',
          code: e.code ?? 'SERVER_ERROR',
        },
        known ? (statuses[e.code ?? ''] ?? 400) : 500,
      );
    }
  };
}

export async function dispatchNotifications(
  store: Backend,
  env: Record<string, string | undefined>,
  appUrl: string,
  legacy = true,
): Promise<void> {
  const notices = await store.security('notifications_claim');
  for (const n of notices) {
    try {
      const prefix = store.branchId
        ? `TELEGRAM_BRANCH_${store.branchId.replaceAll('-', '').toUpperCase()}`
        : 'TELEGRAM';
      const token = env[`${prefix}_BOT_TOKEN`] ?? (legacy ? env.TELEGRAM_BOT_TOKEN : undefined),
        chat =
          env[`${prefix}_${String(n.channel).toUpperCase()}_CHAT_ID`] ??
          (legacy ? env[`TELEGRAM_${String(n.channel).toUpperCase()}_CHAT_ID`] : undefined);
      assert(token && chat, 'Telegram pendiente de configuración.');
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: `Dexter’s · ${n.text}\nRegistro: ${n.id}\n${appUrl}` }),
        signal: AbortSignal.timeout(10000),
      });
      assert(response.ok, 'Telegram rechazó el aviso.');
      await store.security('notification_finish', { id: n.id, ok: true });
    } catch (error) {
      await store.security('notification_finish', {
        id: n.id,
        ok: false,
        error: (error as Error).message.slice(0, 300),
      });
    }
  }
}
