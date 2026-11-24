-- Controles transaccionales del cierre v3 y sus operaciones de inventario.
create or replace function private.branch_commit_operational_controls(p_branch uuid,p_revision bigint,p_command jsonb,p_state jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=(p_command->>'actorId')::uuid; operation text:=p_command->>'type';
  payload jsonb:=coalesce(p_command->'payload','{}'::jsonb); role_name text; permission text; permissions jsonb;
  shift_ids text[]; related jsonb;
begin
  perform 1 from private.branch_runtime where branch_id=p_branch for update;
  -- Los recibos previos son inmutables y conservan su respuesta después del cierre/revocación.
  if exists(select 1 from public.command_receipts where branch_id=p_branch and id=(p_command->>'id')::uuid and actor_id=actor) then
    return private.branch_commit_validated_state(p_branch,p_revision,p_command,p_state,p_result);
  end if;
  role_name:=private.branch_role(p_branch,actor);
  permission:=case
    when operation in ('create_order','update_order','cancel_order','close_tastings') then 'orders'
    when operation in ('deliver','taste') then 'deliveries'
    when operation in ('pay','redeem_coupon','request_void','replace_order','refund_order','unpaid') then 'payments'
    when operation='expense' then 'expenses'
    when operation in ('open_package','open_bag','open_supply','exhaust_bag','receive_shipment','report_damage') then 'inventory'
    when operation in ('request_transfer','execute_transfer','confirm_transfer') then 'transfers'
    when operation in ('request_shift','count','finish_audit') then 'shifts' end;
  if role_name<>'admin' then
    select m.permissions into permissions from private.branch_members m where m.branch_id=p_branch and m.user_id=actor;
    if (role_name='apoyo' and permission in ('payments','expenses','transfers','shifts'))
      or permissions->permission='false'::jsonb then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
    shift_ids:=array[p_command->>'shiftId',payload->>'shiftId'];
    select data into related from public.orders where branch_id=p_branch and id::text=payload->>'orderId';
    shift_ids:=array_append(shift_ids,related->>'shiftId');
    select data into related from public.counts where branch_id=p_branch and id::text=payload->>'countId';
    shift_ids:=array_append(shift_ids,related->>'shiftId');
    select data into related from public.expenses where branch_id=p_branch and id::text=payload->>'expenseId';
    shift_ids:=array_append(shift_ids,related->>'shiftId');
    select data into related from public.transfers where branch_id=p_branch and id::text=payload->>'transferId';
    shift_ids:=shift_ids||array[related->>'shiftId',related->>'executionShiftId',
      case when related->>'from' like 'cash:%' then substr(related->>'from',6) end,
      case when related->>'to' like 'cash:%' then substr(related->>'to',6) end,
      case when payload->>'from' like 'cash:%' then substr(payload->>'from',6) end];
    if operation not in ('submit_closing','respond_closing') and exists(select 1 from public.shifts where branch_id=p_branch and id::text=any(shift_ids)
      and data->>'status' in ('closed','provisional')) then raise exception 'SHIFT_CLOSED' using errcode='42501'; end if;
    if permission is not null and operation<>'request_shift' and not exists(
      select 1 from public.shifts where branch_id=p_branch and data->>'status'='open') then
      raise exception 'SHIFT_CLOSED' using errcode='42501';
    end if;
  end if;
  return private.branch_commit_validated_state(p_branch,p_revision,p_command,p_state,p_result);
end $$;

create or replace function public.dexter_branch_commit(p_branch uuid,p_revision bigint,p_command jsonb,p_state jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  revision_now bigint;
  actor uuid := (p_command->>'actorId')::uuid;
  operation text := p_command->>'type';
  payload jsonb := p_command->'payload';
  prior_result jsonb;
  proposal_id uuid;
  pending jsonb;
  resolved jsonb;
  audit_event jsonb;
  registered_change jsonb;
  required_votes int;
  votes jsonb;
  target uuid;
  access_before jsonb;
  access_after jsonb;
  active_before jsonb;
  previous_primary text;
  closing_adjustment boolean;
  shift_before jsonb;
  transfer_before jsonb;
  closing_review_change boolean := false;
begin
  select revision into revision_now from private.branch_runtime where branch_id=p_branch for update;
  select result into prior_result from public.command_receipts
    where branch_id=p_branch and id=(p_command->>'id')::uuid and actor_id=actor;
  if prior_result is not null then return prior_result; end if;
  if revision_now is distinct from p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;

  if operation='request_shift' and exists(
    select 1 from public.shifts s where s.branch_id=p_branch
      and s.data#>>'{closingReview,status}' in ('pending','returned')
      and s.data->>'closingArchive' is null
      and (s.data->>'closedAt' >= (
        select data#>>'{rehearsalBaseline,at}' from public.settings where branch_id=p_branch limit 1
      ) or not exists (
        select 1 from public.settings where branch_id=p_branch and data#>>'{rehearsalBaseline,at}' is not null
      ))
  ) then raise exception 'CLOSING_REVIEW_REQUIRED' using errcode='42501'; end if;

  if operation='save_supply' or (operation='review_shift' and payload->>'action'='correct_opening') then
    if private.branch_role(p_branch,actor) is distinct from 'admin' or payload->'offline'='true'::jsonb then
      raise exception 'ADMIN_REQUIRED' using errcode='42501';
    end if;
  end if;

  if payload->'reviewClosing'='true'::jsonb then
    select data into shift_before from public.shifts where branch_id=p_branch and id::text=payload->>'shiftId';
    closing_review_change := private.branch_role(p_branch,actor)='admin'
      and payload->>'offline' is distinct from 'true'
      and shift_before#>>'{closingReview,status}'='pending'
      and shift_before->>'closingArchive' is null
      and ((operation in ('open_package','open_bag') and payload->'correction'='true'::jsonb)
        or (operation='resolve_request' and exists(
          select 1 from public.requests r where r.branch_id=p_branch and r.id::text=payload->>'requestId'
            and r.data->>'type'='damage' and r.data->>'status'='pending'
            and (r.data->>'referenceId'=payload->>'shiftId' or (
              r.data->>'referenceId' is null and r.data->>'at' between shift_before->>'openedAt' and shift_before->>'closedAt'
            ))
        )));
    if closing_review_change is distinct from true then raise exception 'CLOSING_REVIEW_REQUIRED' using errcode='42501'; end if;
  end if;

  if operation in ('submit_blind_count','submit_blind_opening_audit') and
    private.branch_role(p_branch,actor) is distinct from 'admin' and (
      private.branch_role(p_branch,actor) is distinct from 'encargado' or exists(
        select 1 from private.branch_members where branch_id=p_branch and user_id=actor
          and permissions->'shifts'='false'::jsonb
      )
    ) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  if operation in ('review_blind_opening','confirm_transfer','cancel_transfer') and
    (private.branch_role(p_branch,actor) is distinct from 'admin' or payload->'offline'='true'::jsonb)
    then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;

  if operation in ('return_closing','respond_closing','record_employee_recovery') then
    raise exception 'RETIRED_OPERATION' using errcode='42501';
  end if;
  if operation in ('approve_closing','submit_closing') then
    select data into shift_before from public.shifts
      where branch_id=p_branch and id=(payload->>'shiftId')::uuid;
    if operation='approve_closing' then
      if private.branch_role(p_branch,actor) is distinct from 'admin' then
        raise exception 'ADMIN_REQUIRED' using errcode='42501';
      end if;
    elsif shift_before->>'cashierId' is distinct from actor::text then
      raise exception 'CASHIER_REQUIRED' using errcode='42501';
    end if;
    if payload->>'offline'='true' then raise exception 'ONLINE_REQUIRED' using errcode='42501'; end if;
  end if;
  if operation='approve_closing' and shift_before->>'cashierId'=actor::text then
    raise exception 'OTHER_ADMIN_REQUIRED' using errcode='42501';
  end if;
  if operation='approve_closing' and shift_before->'closingFlow' is not null then
    if coalesce(shift_before#>>'{closingReview,status}','') not in ('pending','returned') then
      raise exception 'CLOSING_REVIEW_REQUIRED' using errcode='42501';
    end if;
  end if;
  if operation='confirm_transfer' then
    select data into transfer_before from public.transfers
      where branch_id=p_branch and id=(payload->>'transferId')::uuid;
    if transfer_before->>'recipientId' is distinct from actor::text
      or transfer_before->>'status' is distinct from 'in_transit' then
      raise exception 'RECIPIENT_REQUIRED' using errcode='42501';
    end if;
  end if;

  -- The employee count is immutable. A separate reviewed count retains the administrator's corrections.
  -- Manual stock changes and historical closings keep their existing approval path.
  closing_adjustment := operation='approve_closing' and shift_before->'closingFlow' is null and (
    p_result->'approvalPending'='true'::jsonb or exists(
      select 1 from jsonb_array_elements(p_state->'stock') s where s->>'eventId'=p_command->>'id'
    )
  );
  if operation in ('resolve_change','change_access','save_size','save_promotion','set_approval_requirement',
      'adjust_count_inventory','correct_inventory','initialize_stock') or closing_adjustment
    or (operation='configure' and payload->'reviewParameters'='true'::jsonb)
    or (not closing_review_change and operation in ('open_package','open_bag') and payload->'correction'='true'::jsonb)
    or (not closing_review_change and operation='resolve_request' and payload->'approve'='true'::jsonb and exists(
      select 1 from public.requests where branch_id=p_branch and id=(payload->>'requestId')::uuid
        and data->>'type'='damage'
    )) then
    if private.branch_role(p_branch,actor) is distinct from 'admin' or payload->'offline'='true'::jsonb then
      raise exception 'ADMIN_REQUIRED' using errcode='42501';
    end if;
    select event into audit_event from jsonb_array_elements(p_state->'audit') event
      where event->>'eventId'=p_command->>'id';
    registered_change := audit_event->'change';

    if operation='resolve_change' then
      proposal_id := (payload->>'requestId')::uuid;
      select data into pending from public.requests where branch_id=p_branch and id=proposal_id;
      select request into resolved from jsonb_array_elements(p_state->'requests') request
        where request->>'id'=proposal_id::text;
      if pending->>'type' is distinct from 'change' or pending->>'status' is distinct from 'pending'
        or resolved is null then raise exception 'Propuesta pendiente no disponible' using errcode='42501'; end if;

      if payload->'approve'='true'::jsonb then
        if pending->>'by'=actor::text or private.branch_role(p_branch,(pending->>'by')::uuid) is distinct from 'admin' then
          raise exception 'La aprobación requiere otro administrador activo' using errcode='42501';
        end if;
        required_votes := (pending#>>'{change,requiredApprovals}')::int;
        votes := resolved#>'{change,votes}';
        if required_votes is null or required_votes not in (1,2) or jsonb_typeof(votes) is distinct from 'array'
          or (select count(distinct vote->>'by') from jsonb_array_elements(votes) vote)<>jsonb_array_length(votes)
          or not exists(select 1 from jsonb_array_elements(votes) vote where vote->>'by'=actor::text)
          or exists(select 1 from jsonb_array_elements(votes) vote where vote->>'by'=pending->>'by'
            or private.branch_role(p_branch,(vote->>'by')::uuid) is distinct from 'admin'
            or (vote->>'by'<>actor::text and not (pending#>'{change,votes}' @> jsonb_build_array(vote)))) then
          raise exception 'Aprobaciones inválidas' using errcode='42501';
        end if;
        if jsonb_array_length(votes)>=required_votes then
          if resolved->>'status' is distinct from 'approved' or registered_change->'votes' is distinct from votes
            or registered_change->>'kind' is distinct from pending#>>'{change,command,type}'
            or registered_change#>>'{proposedBy,by}' is distinct from pending->>'by' then
            raise exception 'Falta el registro del cambio aprobado' using errcode='42501';
          end if;
          payload := pending#>'{change,command,payload}';
        elsif resolved->>'status' is distinct from 'pending' or registered_change is not null then
          raise exception 'Aún faltan aprobaciones' using errcode='42501';
        end if;
      elsif resolved->>'status' is distinct from 'rejected' or registered_change is not null then
        raise exception 'El rechazo no aplica el cambio' using errcode='42501';
      end if;
    elsif operation='change_access' and payload->'active'='false'::jsonb then
      if registered_change->>'kind' is distinct from 'change_access' then
        raise exception 'Falta el registro de la desactivación' using errcode='42501';
      end if;
    elsif p_result->'approvalPending' is distinct from 'true'::jsonb or registered_change is not null
      or not exists(select 1 from jsonb_array_elements(p_state->'requests') request
        where request->>'id'=p_command->>'id' and request->>'type'='change'
          and request->>'status'='pending' and request->>'by'=actor::text
          and request#>>'{change,command,type}'=operation) then
      raise exception 'El cambio requiere una propuesta y su aprobación' using errcode='42501';
    end if;
  end if;

  prior_result := private.branch_commit_before_change_approvals(p_branch,p_revision,p_command,p_state,p_result);

  if registered_change->>'kind'='change_access' then
    target := (payload->>'targetId')::uuid;
    access_before := registered_change->'before';
    access_after := registered_change->'after';
    if registered_change->>'access'='user' then
      if private.is_developer(target) or exists(
        select 1 from private.businesses b join private.branches l on l.business_id=b.id
          where l.id=p_branch and b.owner_id=target
      ) then raise exception 'El propietario conserva su acceso' using errcode='42501'; end if;
      select jsonb_build_object('role',m.role,'active',m.active and p.active,'permissions',m.permissions)
        into active_before from private.branch_members m join public.profiles p on p.id=m.user_id
        where m.branch_id=p_branch and m.user_id=target;
      if active_before is distinct from access_before then
        raise exception 'Los permisos del usuario cambiaron. Verifica el registro actual' using errcode='42501';
      end if;
      if operation='change_access' and (access_after->'active' is distinct from 'false'::jsonb
        or (access_before-'active') is distinct from (access_after-'active')) then
        raise exception 'Solo la desactivación se aplica inmediatamente' using errcode='42501';
      end if;
      if active_before->>'role'='admin' and (access_after->>'role'<>'admin' or access_after->'active'='false'::jsonb)
        and not exists(select 1 from public.profiles p where p.id<>target and private.branch_role(p_branch,p.id)='admin') then
        raise exception 'Debe quedar al menos un admin activo' using errcode='42501';
      end if;
      update private.branch_members set role=access_after->>'role',active=(access_after->>'active')::boolean,
        permissions=access_after->'permissions' where branch_id=p_branch and user_id=target;
    elsif registered_change->>'access'='device' then
      select jsonb_build_object('active',active,'primary',is_primary) into active_before
        from public.devices where branch_id=p_branch and id=target and not private.is_developer(user_id);
      if active_before is distinct from (access_before-'primaryDevice') then
        raise exception 'El estado del dispositivo cambió. Verifica el registro actual' using errcode='42501';
      end if;
      if operation='change_access' and (access_after->'active' is distinct from 'false'::jsonb
        or access_after->'primary' is distinct from 'false'::jsonb) then
        raise exception 'Solo la desactivación se aplica inmediatamente' using errcode='42501';
      end if;
      if access_after->'primary'='true'::jsonb and
        (access_before->'primary'='false'::jsonb or access_before->'active'='false'::jsonb) then
        select id::text into previous_primary from public.devices where branch_id=p_branch and active and is_primary;
        if previous_primary is distinct from access_before#>>'{primaryDevice,id}' then
          raise exception 'El equipo principal cambió desde la propuesta' using errcode='42501';
        end if;
        if exists(select 1 from public.shifts where branch_id=p_branch and data->>'status' in ('open','requested','provisional')) then
          raise exception 'Cierra y sincroniza el turno antes de cambiar el equipo principal' using errcode='42501';
        end if;
        update public.devices set is_primary=false where branch_id=p_branch and is_primary and id<>target;
      end if;
      update public.devices set active=(access_after->>'active')::boolean,is_primary=(access_after->>'primary')::boolean
        where branch_id=p_branch and id=target;
    else
      raise exception 'Tipo de acceso inválido' using errcode='42501';
    end if;
  end if;
  return prior_result;
end $$;

revoke all on function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) to service_role;
