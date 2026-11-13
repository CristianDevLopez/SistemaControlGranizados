-- Los permisos se consultan desde la base en cada solicitud, nunca desde user_metadata.
alter table public.profiles add column permissions jsonb not null default '{}'::jsonb
  check (jsonb_typeof(permissions) = 'object');
alter table private.branch_members add column permissions jsonb not null default '{}'::jsonb
  check (jsonb_typeof(permissions) = 'object');

create or replace function public.dexter_branch_profiles(p_branch uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'username',p.username,
    'role',coalesce(private.branch_role(p_branch,p.id),m.role),'active',p.active and coalesce(m.active,true),
    'permissions',coalesce(m.permissions,p.permissions,'{}'::jsonb)) order by p.created_at,p.id),'[]')
  from public.profiles p left join private.branch_members m on m.user_id=p.id and m.branch_id=p_branch
  where m.user_id is not null or private.branch_role(p_branch,p.id) is not null
$$;

create or replace function public.dexter_branch_profile_save(p_branch uuid,p_profile jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare target uuid:=(p_profile->>'id')::uuid;
begin
  if private.is_developer(target) then raise exception 'El acceso privado no se modifica desde el equipo del negocio'; end if;
  if exists(select 1 from private.businesses b join private.branches l on l.business_id=b.id where l.id=p_branch and b.owner_id=target)
    and ((p_profile->>'role')<>'admin' or (p_profile->>'active')::boolean is not true) then raise exception 'El propietario conserva su acceso de administrador'; end if;
  insert into public.profiles(id,name,username,role,active)
    values(target,p_profile->>'name',p_profile->>'username',p_profile->>'role',true)
    on conflict(id) do nothing;
  insert into private.branch_members(branch_id,user_id,role,active,permissions)
    values(p_branch,target,p_profile->>'role',(p_profile->>'active')::boolean,coalesce(p_profile->'permissions','{}'::jsonb))
    on conflict(branch_id,user_id) do update set role=excluded.role,active=excluded.active,
      permissions=case when p_profile ? 'permissions' then excluded.permissions else private.branch_members.permissions end;
  update private.branch_runtime set revision=revision+1 where branch_id=p_branch;
end $$;

-- Mantener las funciones exclusivamente en el gateway de servicio. Sin tablas nuevas expuestas.
revoke all on function public.dexter_branch_profiles(uuid), public.dexter_branch_profile_save(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_branch_profiles(uuid), public.dexter_branch_profile_save(uuid,jsonb) to service_role;
-- Imágenes, condiciones de cupones y cuadre viven en el JSONB versionado existente.

-- Revalidar bajo el mismo bloqueo de revisión: una revocación concurrente no puede
-- quedar anulada por el contexto que el gateway leyó antes del reintento.
alter function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) set schema private;
alter function private.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) rename to branch_commit_validated_state;
revoke all on function private.branch_commit_validated_state(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.branch_commit_validated_state(uuid,bigint,jsonb,jsonb,jsonb) to service_role;

create function public.dexter_branch_commit(p_branch uuid,p_revision bigint,p_command jsonb,p_state jsonb,p_result jsonb)
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
    when operation in ('open_package','open_bag','exhaust_bag','receive_shipment','report_damage') then 'inventory'
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
    if exists(select 1 from public.shifts where branch_id=p_branch and id::text=any(shift_ids)
      and data->>'status' in ('closed','provisional')) then raise exception 'SHIFT_CLOSED' using errcode='42501'; end if;
    if permission is not null and operation<>'request_shift' and not exists(
      select 1 from public.shifts where branch_id=p_branch and data->>'status'='open') then
      raise exception 'SHIFT_CLOSED' using errcode='42501';
    end if;
  end if;
  return private.branch_commit_validated_state(p_branch,p_revision,p_command,p_state,p_result);
end $$;
revoke all on function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) to service_role;
