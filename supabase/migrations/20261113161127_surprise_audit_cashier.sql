-- Admin selects the audit; the responsible cashier submits it through the service-only gateway.
create or replace function public.dexter_branch_commit(p_branch uuid,p_revision bigint,p_command jsonb,p_state jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare rev bigint; previous jsonb; kind text; item jsonb; existing jsonb; line jsonb; actor uuid; device uuid; role_name text; immutable boolean;
begin
  actor:=(p_command->>'actorId')::uuid; device:=(p_command->>'deviceId')::uuid;
  select revision into rev from private.branch_runtime where branch_id=p_branch for update;
  select result into previous from public.command_receipts where branch_id=p_branch and id=(p_command->>'id')::uuid and actor_id=actor;
  if previous is not null then return previous; end if;
  if rev<>p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  select private.branch_role(p_branch,actor) into role_name;
  if not exists(select 1 from private.branches where id=p_branch and status='active') then raise exception 'El local no está activo' using errcode='42501'; end if;
  if p_command ? 'branchId' and (p_command->>'branchId')::uuid<>p_branch then raise exception 'Local de operación inválido' using errcode='42501'; end if;
  if role_name is null or not exists(select 1 from public.devices where branch_id=p_branch and id=device and active and (user_id=actor or role_name='admin')) then raise exception 'USER_OR_DEVICE_DISABLED' using errcode='42501'; end if;
  if p_command->>'type' in ('record_paper','save_flavor','save_size','configure','initialize_stock','save_location','save_promotion','issue_coupon','save_goal','approve_expense','resolve_request','approve_payout','create_shipment','start_audit') and role_name<>'admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  -- The gateway validates the administrator's MFA before calling this service-only RPC.
  -- An online admin may collect only their own shift; offline staff still need its primary device.
  if p_command->>'type' in ('pay','redeem_coupon','refund_order','finish_audit') and not exists(
    select 1 from public.devices d
    join public.shifts s on s.id=(p_command->>'shiftId')::uuid
    where d.branch_id=p_branch and s.branch_id=p_branch and d.id=device and d.active
      and s.data->>'status'='open'
      and s.data->>'cashierId'=actor::text
      and (
        (d.is_primary and s.data->>'deviceId'=device::text)
        or (role_name='admin' and (p_command#>>'{payload,offline}') is distinct from 'true')
      )
  ) then raise exception 'CASHIER_REQUIRED' using errcode='42501'; end if;
  -- Only the cashier of this open shift may submit the active audit, online.
  if p_command->>'type'='finish_audit' and (
    (p_command#>>'{payload,offline}')='true'
    or (p_command#>>'{payload,shiftId}') is distinct from (p_command->>'shiftId')
    or not exists(
      select 1 from public.settings s where s.branch_id=p_branch
        and s.data->>'auditId'=p_command#>>'{payload,auditId}'
        and (s.data->'auditRequest' is null or s.data->'auditRequest'='null'::jsonb
          or s.data#>>'{auditRequest,shiftId}'=p_command->>'shiftId')
    )
  ) then raise exception 'ACTIVE_AUDIT_REQUIRED' using errcode='42501'; end if;
  rev:=rev+1;
  foreach kind in array array['settings','flavors','sizes','orders','payments','deliveries','stock','shifts','counts','shipments','receipts','expenses','locations','transfers','promotions','coupons','requests','goals','parameters','audit','notifications','packages','bags','attachments','outages'] loop
    immutable:=kind=any(array['payments','deliveries','stock','counts','receipts','parameters','audit']);
    for item in select value from jsonb_array_elements(coalesce(p_state->kind,'[]'::jsonb)) loop
      execute format('select exists(select 1 from public.%I where id=$1 and branch_id<>$2)',kind) into immutable using (item->>'id')::uuid,p_branch;
      if immutable then raise exception 'Identificador de otro local' using errcode='42501'; end if;
      immutable:=kind=any(array['payments','deliveries','stock','counts','receipts','parameters','audit']);
      if immutable then
        execute format('select data from public.%I where branch_id=$2 and id=$1',kind) into existing using (item->>'id')::uuid,p_branch;
        if existing is not null and existing<>item then raise exception 'IMMUTABLE_EVENT_CHANGED: %',kind; end if;
        execute format('insert into public.%I(id,data,revision,branch_id) values($1,$2,$3,$4) on conflict(id) do nothing',kind) using (item->>'id')::uuid,item,rev,p_branch;
      else
        execute format('insert into public.%I(id,data,revision,branch_id) values($1,$2,$3,$4) on conflict(id) do update set data=excluded.data,revision=excluded.revision,updated_at=now() where %I.data is distinct from excluded.data',kind,kind) using (item->>'id')::uuid,item,rev,p_branch;
      end if;
      if kind='orders' then
        for line in select value from jsonb_array_elements(coalesce(item->'lines','[]'::jsonb)) loop
          if exists(select 1 from public.order_lines where id=(line->>'id')::uuid and (branch_id<>p_branch or order_id<>(item->>'id')::uuid)) then raise exception 'Línea de otro pedido o local'; end if;
          insert into public.order_lines(id,order_id,data,revision,branch_id) values((line->>'id')::uuid,(item->>'id')::uuid,line,rev,p_branch)
          on conflict(id) do update set data=excluded.data,revision=excluded.revision where order_lines.data is distinct from excluded.data;
        end loop;
      end if;
    end loop;
  end loop;
  update private.branch_runtime set revision=rev where branch_id=p_branch;
  p_result:=p_result||jsonb_build_object('revision',rev);
  insert into public.command_receipts(id,actor_id,device_id,command,result,revision,branch_id) values((p_command->>'id')::uuid,actor,device,p_command,p_result,rev,p_branch);
  return p_result;
end $$;
revoke all on function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) to service_role;
