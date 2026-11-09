-- Allow an authenticated administrator to operate their own cash shift without promoting a device.
create or replace function public.dexter_commit(p_revision bigint,p_command jsonb,p_state jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare rev bigint; previous jsonb; kind text; item jsonb; existing jsonb; line jsonb; actor uuid; device uuid; role_name text; immutable boolean;
begin
  actor:=(p_command->>'actorId')::uuid; device:=(p_command->>'deviceId')::uuid;
  select revision into rev from private.runtime where id for update;
  select result into previous from public.command_receipts where id=(p_command->>'id')::uuid and actor_id=actor;
  if previous is not null then return previous; end if;
  if rev<>p_revision then raise exception 'REVISION_CONFLICT' using errcode='40001'; end if;
  select role into role_name from public.profiles where id=actor and active;
  if role_name is null or not exists(select 1 from public.devices where id=device and active and (user_id=actor or role_name='admin')) then raise exception 'USER_OR_DEVICE_DISABLED' using errcode='42501'; end if;
  if p_command->>'type' in ('record_paper','save_flavor','save_size','configure','initialize_stock','save_location','save_promotion','issue_coupon','save_goal','approve_expense','resolve_request','approve_payout','create_shipment','start_audit','finish_audit') and role_name<>'admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  -- The gateway validates the administrator's MFA before calling this service-only RPC.
  -- An online admin may collect only their own shift; offline staff still need its primary device.
  if p_command->>'type' in ('pay','redeem_coupon','refund_order') and not exists(
    select 1 from public.devices d
    join public.shifts s on s.id=(p_command->>'shiftId')::uuid
    where d.id=device and d.active
      and s.data->>'status'='open'
      and s.data->>'cashierId'=actor::text
      and (
        (d.is_primary and s.data->>'deviceId'=device::text)
        or (role_name='admin' and (p_command#>>'{payload,offline}') is distinct from 'true')
      )
  ) then raise exception 'CASHIER_REQUIRED' using errcode='42501'; end if;
  rev:=rev+1;
  foreach kind in array array['settings','flavors','sizes','orders','payments','deliveries','stock','shifts','counts','shipments','receipts','expenses','locations','transfers','promotions','coupons','requests','goals','parameters','audit','notifications','packages','bags','attachments','outages'] loop
    immutable:=kind=any(array['payments','deliveries','stock','counts','receipts','parameters','audit']);
    for item in select value from jsonb_array_elements(coalesce(p_state->kind,'[]'::jsonb)) loop
      if immutable then
        execute format('select data from public.%I where id=$1',kind) into existing using (item->>'id')::uuid;
        if existing is not null and existing<>item then raise exception 'IMMUTABLE_EVENT_CHANGED: %',kind; end if;
        execute format('insert into public.%I(id,data,revision) values($1,$2,$3) on conflict(id) do nothing',kind) using (item->>'id')::uuid,item,rev;
      else
        execute format('insert into public.%I(id,data,revision) values($1,$2,$3) on conflict(id) do update set data=excluded.data,revision=excluded.revision,updated_at=now() where %I.data is distinct from excluded.data',kind,kind) using (item->>'id')::uuid,item,rev;
      end if;
      if kind='orders' then
        for line in select value from jsonb_array_elements(coalesce(item->'lines','[]'::jsonb)) loop
          insert into public.order_lines(id,order_id,data,revision) values((line->>'id')::uuid,(item->>'id')::uuid,line,rev)
          on conflict(id) do update set data=excluded.data,revision=excluded.revision where order_lines.data is distinct from excluded.data;
        end loop;
      end if;
    end loop;
  end loop;
  update private.runtime set revision=rev where id;
  p_result:=p_result||jsonb_build_object('revision',rev);
  insert into public.command_receipts(id,actor_id,device_id,command,result,revision) values((p_command->>'id')::uuid,actor,device,p_command,p_result,rev);
  return p_result;
end $$;
revoke all on function public.dexter_commit(bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_commit(bigint,jsonb,jsonb,jsonb) to service_role;
