-- Las solicitudes usan el estado existente y los cambios se anexan a la tabla inmutable de auditoría.
revoke truncate on public.audit from service_role;

alter function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) set schema private;
alter function private.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) rename to branch_commit_before_change_approvals;

create function public.dexter_branch_commit(p_branch uuid,p_revision bigint,p_command jsonb,p_state jsonb,p_result jsonb)
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
begin
  select revision into revision_now from private.branch_runtime where branch_id=p_branch for update;
  select result into prior_result from public.command_receipts
    where branch_id=p_branch and id=(p_command->>'id')::uuid and actor_id=actor;
  if prior_result is not null then return prior_result; end if;
  if revision_now is distinct from p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;

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

  closing_adjustment := operation='approve_closing' and (
    p_result->'approvalPending'='true'::jsonb or exists(
      select 1 from jsonb_array_elements(p_state->'stock') s where s->>'eventId'=p_command->>'id'
    )
  );
  if operation in ('resolve_change','change_access','save_size','save_promotion','set_approval_requirement',
      'adjust_count_inventory','correct_inventory','initialize_stock') or closing_adjustment
    or (operation in ('open_package','open_bag') and payload->'correction'='true'::jsonb)
    or (operation='resolve_request' and payload->'approve'='true'::jsonb and exists(
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
