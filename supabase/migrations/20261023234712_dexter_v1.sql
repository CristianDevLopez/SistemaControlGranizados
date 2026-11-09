-- Dexter's V1: a server-only command gateway. Browser roles cannot mutate business tables.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id), name text not null check(length(name) between 1 and 100),
  username text unique, role text not null check(role in ('admin','encargado','apoyo')), active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.devices (
  id uuid primary key, user_id uuid not null references public.profiles(id), name text not null,
  token_hash text not null, active boolean not null default true, is_primary boolean not null default false,
  last_seen timestamptz, created_at timestamptz not null default now()
);
create unique index one_primary_register on public.devices ((is_primary)) where is_primary and active;
create table private.staff_credentials (user_id uuid primary key references public.profiles(id), salt text not null, pin_hash text not null);
create table private.enrollments (id uuid primary key default gen_random_uuid(), token_hash text unique not null, user_id uuid not null references public.profiles(id), expires_at timestamptz not null, used_at timestamptz, is_primary boolean not null default false);
create table private.offline_permits (id uuid primary key, token_hash text unique not null, admin_id uuid not null references public.profiles(id), device_id uuid not null references public.devices(id), expires_at timestamptz not null, used_by uuid);
create table private.rate_limits (key text primary key, attempts integer not null default 1, window_start timestamptz not null default now());
create table private.setup_tokens (token_hash text primary key, used_at timestamptz);
create table private.media_uploads (attachment_id uuid primary key, path text not null, sha256 text not null, size bigint not null, mime text not null, uploaded_at timestamptz not null default now());
create table private.notification_dispatch (id uuid primary key, status text not null default 'pending', attempts integer not null default 0, lease_until timestamptz, last_error text);
create table private.runtime (id boolean primary key default true check(id), revision bigint not null default 0);
insert into private.runtime values (true,0);
create table public.command_receipts (id uuid primary key, actor_id uuid not null references public.profiles(id), device_id uuid not null references public.devices(id), command jsonb not null, result jsonb not null, revision bigint not null, received_at timestamptz not null default now());

do $$
declare kind text;
begin
  foreach kind in array array['settings','flavors','sizes','orders','payments','deliveries','stock','shifts','counts','shipments','receipts','expenses','locations','transfers','promotions','coupons','requests','goals','parameters','audit','notifications','packages','bags','attachments','outages'] loop
    execute format('create table public.%I (id uuid primary key, data jsonb not null check(data->>''id''=id::text), revision bigint not null default 0, updated_at timestamptz not null default now())',kind);
    execute format('alter table public.%I enable row level security',kind);
    execute format('create policy deny_direct_access on public.%I for all to anon, authenticated using (false) with check (false)',kind);
    execute format('revoke all on public.%I from public, anon, authenticated',kind);
    execute format('grant all on public.%I to service_role',kind);
    execute format('create index on public.%I (revision)',kind);
  end loop;
end $$;

create table public.order_lines (id uuid primary key, order_id uuid not null references public.orders(id) deferrable initially deferred, data jsonb not null, revision bigint not null);
alter table public.orders add column shift_id uuid generated always as ((data->>'shiftId')::uuid) stored references public.shifts(id) deferrable initially deferred;
alter table public.payments add column order_id uuid generated always as ((data->>'orderId')::uuid) stored references public.orders(id) deferrable initially deferred;
alter table public.deliveries add column order_id uuid generated always as ((data->>'orderId')::uuid) stored references public.orders(id) deferrable initially deferred;
alter table public.receipts add column shipment_id uuid generated always as ((data->>'shipmentId')::uuid) stored references public.shipments(id) deferrable initially deferred;
alter table public.coupons add column code text generated always as (data->>'code') stored unique;
alter table public.coupons add constraint coupon_status check(data->>'status' in ('issued','redeemed','cancelled'));
create unique index one_active_shift on public.shifts ((true)) where data->>'status' in ('requested','open','provisional');
create unique index unique_paper_folio on public.orders ((data->>'paperFolio')) where data->>'origin'='paper';

do $$ declare tab text; begin
  foreach tab in array array['profiles','devices','command_receipts','order_lines'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('create policy deny_direct_access on public.%I for all to anon,authenticated using(false) with check(false)',tab);
    execute format('revoke all on public.%I from public,anon,authenticated',tab);
    execute format('grant all on public.%I to service_role',tab);
  end loop;
end $$;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;

create function private.forbid_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Immutable business event: append a correction instead'; end $$;
do $$ declare tab text; begin
  foreach tab in array array['payments','deliveries','stock','counts','receipts','parameters','audit','command_receipts'] loop
    execute format('create trigger immutable_event before update or delete on public.%I for each row execute function private.forbid_mutation()',tab);
  end loop;
end $$;

create function public.dexter_read_state() returns jsonb language plpgsql security invoker set search_path='' as $$
declare kind text; value jsonb; result jsonb:='{}'::jsonb; rev bigint;
begin
  select revision into rev from private.runtime where id;
  foreach kind in array array['settings','flavors','sizes','orders','payments','deliveries','stock','shifts','counts','shipments','receipts','expenses','locations','transfers','promotions','coupons','requests','goals','parameters','audit','notifications','packages','bags','attachments','outages'] loop
    execute format('select coalesce(jsonb_agg(data order by updated_at,id),''[]''::jsonb) from public.%I',kind) into value;
    result:=jsonb_set(result,array[kind],value);
  end loop;
  return jsonb_build_object('state',result,'revision',rev);
end $$;
revoke all on function public.dexter_read_state() from public,anon,authenticated;
grant execute on function public.dexter_read_state() to service_role;

create function public.dexter_commit(p_revision bigint,p_command jsonb,p_state jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
  if p_command->>'type' in ('pay','redeem_coupon','refund_order') and not exists(select 1 from public.devices d join public.shifts s on s.id=(p_command->>'shiftId')::uuid where d.id=device and d.is_primary and s.data->>'cashierId'=actor::text and s.data->>'deviceId'=device::text) then raise exception 'CASHIER_REQUIRED' using errcode='42501'; end if;
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

create function public.dexter_rate_limit(p_key text,p_limit integer default 5,p_seconds integer default 300) returns boolean language plpgsql security invoker set search_path='' as $$
declare attempts integer;
begin
  insert into private.rate_limits as r(key,attempts,window_start) values(p_key,1,now()) on conflict(key) do update set
    attempts=case when r.window_start<now()-make_interval(secs=>p_seconds) then 1 else r.attempts+1 end,
    window_start=case when r.window_start<now()-make_interval(secs=>p_seconds) then now() else r.window_start end returning r.attempts into attempts;
  return attempts<=p_limit;
end $$;
revoke all on function public.dexter_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.dexter_rate_limit(text,integer,integer) to service_role;

-- No private schema exposed through PostgREST. Narrow service-only bridge for security records.
create function public.dexter_security(p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; row_value record;
begin
  case p_action
    when 'revision' then select jsonb_build_object('revision',revision) into result from private.runtime where id;
    when 'device_primary' then
      perform 1 from private.runtime where id for update;
      if exists(select 1 from public.shifts where data->>'status' in ('open','requested','provisional')) then raise exception 'Cierra y sincroniza el turno antes de cambiar el equipo principal'; end if;
      if not exists(select 1 from public.devices where id=(p_payload->>'id')::uuid and active) then raise exception 'Dispositivo no disponible'; end if;
      update public.devices set is_primary=false where is_primary;
      update public.devices set is_primary=true where id=(p_payload->>'id')::uuid;
      update private.runtime set revision=revision+1 where id;result:='{}';
    when 'staff_get' then select to_jsonb(s)||jsonb_build_object('userId',s.user_id) into result from private.staff_credentials s join public.profiles p on p.id=s.user_id where lower(p.username)=lower(p_payload->>'username') and p.active;
    when 'staff_set' then insert into private.staff_credentials(user_id,salt,pin_hash) values((p_payload->>'userId')::uuid,p_payload->>'salt',p_payload->>'hash') on conflict(user_id) do update set salt=excluded.salt,pin_hash=excluded.pin_hash; result:='{}';
    when 'enrollment_create' then insert into private.enrollments(token_hash,user_id,expires_at,is_primary) values(p_payload->>'hash',(p_payload->>'userId')::uuid,(p_payload->>'expiresAt')::timestamptz,(p_payload->>'primary')::boolean);result:='{}';
    when 'enrollment_consume' then update private.enrollments set used_at=now() where token_hash=p_payload->>'hash' and user_id=(p_payload->>'userId')::uuid and used_at is null and expires_at>now() returning to_jsonb(enrollments.*) into result;
    when 'permit_create' then insert into private.offline_permits(id,token_hash,admin_id,device_id,expires_at) values((p_payload->>'id')::uuid,p_payload->>'hash',(p_payload->>'adminId')::uuid,(p_payload->>'deviceId')::uuid,(p_payload->>'expiresAt')::timestamptz);result:='{}';
    when 'permit_validate' then select jsonb_build_object('adminId',o.admin_id) into result from private.offline_permits o join public.profiles p on p.id=o.admin_id and p.active and p.role='admin' where o.token_hash=p_payload->>'hash' and o.device_id=(p_payload->>'deviceId')::uuid and o.expires_at>(p_payload->>'at')::timestamptz and (o.used_by is null or o.used_by=(p_payload->>'commandId')::uuid);
    when 'permit_use' then update private.offline_permits set used_by=(p_payload->>'commandId')::uuid where token_hash=p_payload->>'hash' and (used_by is null or used_by=(p_payload->>'commandId')::uuid);result:='{}';
    when 'setup' then update private.setup_tokens set used_at=now() where token_hash=p_payload->>'hash' and used_at is null and not exists(select 1 from public.profiles where role='admin') returning jsonb_build_object('ok',true) into result;
    when 'setup_check' then select jsonb_build_object('ok',true) into result from private.setup_tokens where token_hash=p_payload->>'hash' and used_at is null and not exists(select 1 from public.profiles where role='admin');
    when 'media_set' then insert into private.media_uploads(attachment_id,path,sha256,size,mime) values((p_payload->>'id')::uuid,p_payload->>'path',p_payload->>'sha256',(p_payload->>'size')::bigint,p_payload->>'mime') on conflict(attachment_id) do nothing;result:='{}';
    when 'media_list' then select coalesce(jsonb_agg(jsonb_build_object('id',attachment_id,'path',path,'sha256',sha256,'size',size,'mime',mime,'status','uploaded')),'[]'::jsonb) into result from private.media_uploads;
    when 'notifications_claim' then
      insert into private.notification_dispatch(id) select id from public.notifications on conflict(id) do nothing;
      with candidates as (select id from private.notification_dispatch where status<>'sent' and (lease_until is null or lease_until<now()) order by attempts limit 20 for update skip locked), claimed as (update private.notification_dispatch n set lease_until=now()+interval '2 minutes',attempts=n.attempts+1 from candidates c where n.id=c.id returning n.id,n.attempts)
      select coalesce(jsonb_agg(p.data||jsonb_build_object('attempts',c.attempts)),'[]'::jsonb) into result from claimed c join public.notifications p on p.id=c.id;
    when 'notification_finish' then update private.notification_dispatch set status=case when (p_payload->>'ok')::boolean then 'sent' else 'pending' end,last_error=p_payload->>'error',lease_until=case when (p_payload->>'ok')::boolean then null else now()+interval '5 minutes' end where id=(p_payload->>'id')::uuid;result:='{}';
    when 'notification_status' then select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'attempts',attempts,'lastError',last_error)),'[]'::jsonb) into result from private.notification_dispatch;
    else raise exception 'Unknown security action';
  end case;
  return result;
end $$;
revoke all on function public.dexter_security(text,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_security(text,jsonb) to service_role;

-- Initial catalog: real prices, no fabricated flavors, transactions or users.
insert into public.settings(id,data) values('00000000-0000-4000-8000-000000000001','{"id":"00000000-0000-4000-8000-000000000001","version":1,"cashLimit":500000,"expenseLimit":30000,"expenseCategories":["Insumos","Transporte","Aseo","Mantenimiento"],"courtesyQuota":3,"cupPackageUnits":20,"bagOunces":202.884136,"liquidTolerance":null,"syncWarningMinutes":120,"skipOpeningCount":false,"baseline":true,"businessName":"Dexter’s Granizados","lastRetainedCash":null,"lastCountId":null}');
insert into public.sizes(id,data) select (v->>'id')::uuid,v from jsonb_array_elements('[
{"id":"00000000-0000-4000-8000-000000000012","name":"12 oz","ounces":12,"alcoholPrice":14000,"plainPrice":10000,"cups":1,"beers":0,"active":true,"rank":0},
{"id":"00000000-0000-4000-8000-000000000016","name":"16 oz","ounces":16,"alcoholPrice":17000,"plainPrice":12000,"cups":1,"beers":0,"active":true,"rank":1},
{"id":"00000000-0000-4000-8000-000000000020","name":"20 oz","ounces":20,"alcoholPrice":19500,"plainPrice":14500,"cups":1,"beers":0,"active":true,"rank":2},
{"id":"00000000-0000-4000-8000-000000000024","name":"24 oz","ounces":24,"alcoholPrice":23000,"plainPrice":17000,"cups":1,"beers":0,"active":true,"rank":3},
{"id":"00000000-0000-4000-8000-000000003000","name":"Nevera 3 litros","ounces":0,"alcoholPrice":null,"plainPrice":null,"cups":0,"beers":2,"active":false,"rank":4}
]'::jsonb) as v;
insert into public.parameters(id,data) select '00000000-0000-4000-8000-000000000002',jsonb_build_object('id','00000000-0000-4000-8000-000000000002','by',null,'at',now(),'kind','catalog','before',null,'after',jsonb_build_object('sizes',(select jsonb_agg(data) from public.sizes),'flavors','[]'::jsonb,'promotions','[]'::jsonb),'version',1);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('evidence','evidence',false,3145728,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- No browser storage policies: authorized signed upload/download URLs are issued by the gateway.
