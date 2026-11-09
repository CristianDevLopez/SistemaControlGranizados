-- Existing data stays in its original tables and is assigned to the principal branch.
-- Platform and branch RPCs remain service-only; authorization uses database membership.
create table private.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(btrim(name)) between 1 and 100),
  owner_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index businesses_owner_idx on private.businesses(owner_id);
create table private.branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references private.businesses(id),
  name text not null check(length(btrim(name)) between 1 and 100),
  address text not null default '' check(length(address)<=250),
  city text not null default '' check(length(city)<=100),
  status text not null default 'requested' check(status in ('requested','active','suspended','archived')),
  monthly_fee bigint check(monthly_fee between 0 and 1000000000),
  billing_start date,
  created_at timestamptz not null default now(),
  check(billing_start is null or monthly_fee is not null),
  unique(business_id,name)
);
create table private.installation (
  singleton boolean primary key default true check(singleton),
  legacy_branch_id uuid not null references private.branches(id)
);
create table private.branch_members (
  branch_id uuid not null references private.branches(id),
  user_id uuid not null references public.profiles(id),
  role text not null check(role in ('admin','encargado','apoyo')),
  active boolean not null default true,
  primary key(branch_id,user_id)
);
create index branch_members_user_idx on private.branch_members(user_id,branch_id) where active;
create table private.branch_runtime (
  branch_id uuid primary key references private.branches(id),
  revision bigint not null default 0
);
create table private.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references private.branches(id),
  period date not null check(extract(day from period)=1),
  amount bigint not null check(amount between 0 and 1000000000),
  due_date date not null,
  voided boolean not null default false,
  void_reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique(branch_id,period)
);
create table private.subscription_payments (
  id uuid primary key, -- client operation ID makes retries idempotent
  invoice_id uuid not null references private.subscription_invoices(id),
  amount bigint not null check(amount between 1 and 1000000000),
  paid_at date not null,
  reference text not null check(length(btrim(reference)) between 1 and 250),
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index subscription_payments_invoice_idx on private.subscription_payments(invoice_id);
create table private.platform_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  detail jsonb not null,
  created_at timestamptz not null default now()
);
create trigger immutable_event before update or delete on private.subscription_payments
  for each row execute function private.forbid_mutation();
create trigger immutable_event before update or delete on private.platform_audit
  for each row execute function private.forbid_mutation();

do $$ declare business uuid; branch uuid; begin
  insert into private.businesses(name,owner_id)
    select coalesce((select data->>'businessName' from public.settings limit 1),'Mi negocio'),
      (select id from public.profiles p where role='admin' and active
       and not exists(select 1 from private.superadmin_access a where a.user_id=p.id)
       order by created_at,id limit 1) returning id into business;
  insert into private.branches(business_id,name,city,status)
    values(business,'Local principal','Tarazá, Antioquia','active') returning id into branch;
  insert into private.installation(legacy_branch_id) values(branch);
  insert into private.branch_runtime(branch_id,revision) select branch,revision from private.runtime;
  insert into private.branch_members(branch_id,user_id,role,active)
    select branch,p.id,p.role,p.active from public.profiles p
    where not exists(select 1 from private.superadmin_access a where a.user_id=p.id);
end $$;

create function private.legacy_branch() returns uuid language sql stable security invoker set search_path='' as $$
  select legacy_branch_id from private.installation where singleton
$$;
create function private.is_developer(p_user uuid) returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from private.superadmin_access a join public.profiles p on p.id=a.user_id
    where a.user_id=p_user and p.active and p.role='admin')
$$;
create function private.branch_role(p_branch uuid,p_user uuid) returns text language sql stable security invoker set search_path='' as $$
  select case when private.is_developer(p_user) or b.owner_id=p_user then 'admin' else m.role end
  from private.branches l join private.businesses b on b.id=l.business_id
  join public.profiles p on p.id=p_user and p.active
  left join private.branch_members m on m.branch_id=l.id and m.user_id=p_user and m.active
  where l.id=p_branch and (private.is_developer(p_user) or b.owner_id=p_user or m.user_id is not null)
$$;

-- UUIDs remain globally unique. Composite foreign keys prevent cross-branch references.
do $$ declare tab text; begin
  foreach tab in array array['settings','flavors','sizes','orders','payments','deliveries','stock','shifts','counts','shipments','receipts','expenses','locations','transfers','promotions','coupons','requests','goals','parameters','audit','notifications','packages','bags','attachments','outages','devices','command_receipts','order_lines'] loop
    execute format('alter table public.%I add column branch_id uuid not null default private.legacy_branch() references private.branches(id)',tab);
    execute format('create unique index %I on public.%I(branch_id,id)',tab||'_branch_id_idx',tab);
    if tab<>'devices' then
      execute format('create index %I on public.%I(branch_id,revision)',tab||'_branch_revision_idx',tab);
    end if;
  end loop;
end $$;
drop index public.one_primary_register;
create unique index one_primary_register on public.devices(branch_id) where is_primary and active;
drop index public.one_active_shift;
create unique index one_active_shift on public.shifts(branch_id) where data->>'status' in ('requested','open','provisional');
drop index public.unique_paper_folio;
create unique index unique_paper_folio on public.orders(branch_id,(data->>'paperFolio')) where data->>'origin'='paper';
alter table public.coupons drop constraint coupons_code_key;
create unique index coupons_branch_code_idx on public.coupons(branch_id,code);
alter table public.orders drop constraint orders_shift_id_fkey;
alter table public.orders add foreign key(branch_id,shift_id) references public.shifts(branch_id,id) deferrable initially deferred;
alter table public.payments drop constraint payments_order_id_fkey;
alter table public.payments add foreign key(branch_id,order_id) references public.orders(branch_id,id) deferrable initially deferred;
alter table public.deliveries drop constraint deliveries_order_id_fkey;
alter table public.deliveries add foreign key(branch_id,order_id) references public.orders(branch_id,id) deferrable initially deferred;
alter table public.receipts drop constraint receipts_shipment_id_fkey;
alter table public.receipts add foreign key(branch_id,shipment_id) references public.shipments(branch_id,id) deferrable initially deferred;
alter table public.order_lines drop constraint order_lines_order_id_fkey;
alter table public.order_lines add foreign key(branch_id,order_id) references public.orders(branch_id,id) deferrable initially deferred;
alter table public.command_receipts add foreign key(branch_id,device_id) references public.devices(branch_id,id) deferrable initially deferred;
alter table private.enrollments add column branch_id uuid not null default private.legacy_branch() references private.branches(id);
create index enrollments_branch_idx on private.enrollments(branch_id,user_id);

create function private.create_branch(p_business uuid,p_name text,p_address text,p_city text) returns uuid language plpgsql security invoker set search_path='' as $$
declare branch uuid; key uuid; size jsonb;
begin
  insert into private.branches(business_id,name,address,city) values(p_business,btrim(p_name),coalesce(p_address,''),coalesce(p_city,'')) returning id into branch;
  insert into private.branch_runtime(branch_id) values(branch);
  key:=gen_random_uuid();
  insert into public.settings(branch_id,id,data) values(branch,key,jsonb_build_object(
    'id',key,'version',1,'cashLimit',500000,'expenseLimit',30000,'expenseCategories',jsonb_build_array('Insumos','Transporte','Aseo','Mantenimiento'),
    'courtesyQuota',3,'cupPackageUnits',20,'bagOunces',202.884136,'liquidTolerance',null,'syncWarningMinutes',120,'skipOpeningCount',false,
    'baseline',true,'businessName',(select name from private.businesses where id=p_business),'lastRetainedCash',null,'lastCountId',null,'inventoryInitialized',false));
  for size in select value from jsonb_array_elements('[
    {"name":"12 oz","ounces":12,"alcoholPrice":14000,"plainPrice":10000,"cups":1,"beers":0,"active":true,"rank":0},
    {"name":"16 oz","ounces":16,"alcoholPrice":17000,"plainPrice":12000,"cups":1,"beers":0,"active":true,"rank":1},
    {"name":"20 oz","ounces":20,"alcoholPrice":19500,"plainPrice":14500,"cups":1,"beers":0,"active":true,"rank":2},
    {"name":"24 oz","ounces":24,"alcoholPrice":23000,"plainPrice":17000,"cups":1,"beers":0,"active":true,"rank":3},
    {"name":"Nevera 3 litros","ounces":0,"alcoholPrice":null,"plainPrice":null,"cups":0,"beers":2,"active":false,"rank":4}
  ]'::jsonb) loop
    key:=gen_random_uuid();
    insert into public.sizes(branch_id,id,data) values(branch,key,size||jsonb_build_object('id',key));
  end loop;
  key:=gen_random_uuid();
  insert into public.parameters(branch_id,id,data) values(branch,key,jsonb_build_object('id',key,'by',(select owner_id from private.businesses where id=p_business),
    'at',now(),'kind','catalog','before',null,'version',1,'after',jsonb_build_object('sizes',(select jsonb_agg(data) from public.sizes where branch_id=branch),'flavors','[]'::jsonb,'promotions','[]'::jsonb)));
  return branch;
end $$;

create function public.dexter_platform(p_actor uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare dev boolean; access jsonb; result jsonb; business uuid; branch uuid; target uuid; owner uuid;
  local private.branches%rowtype; invoice private.subscription_invoices%rowtype; paid bigint; amount bigint;
  start_date date; period_date date; status_name text; payment private.subscription_payments%rowtype;
begin
  if not exists(select 1 from public.profiles where id=p_actor and active) then raise exception 'Acceso no autorizado' using errcode='42501'; end if;
  dev:=private.is_developer(p_actor);
  if p_action in ('access','view') then
    select jsonb_build_object('developer',dev,'legacyBranchId',private.legacy_branch(),
      'businesses',(select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'ownerId',b.owner_id) order by b.created_at,b.id),'[]')
        from private.businesses b where dev or b.owner_id=p_actor),
      'branches',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'legacy',l.id=private.legacy_branch(),'businessId',l.business_id,'businessName',b.name,
        'name',l.name,'address',l.address,'city',l.city,'status',l.status,'monthlyFee',l.monthly_fee,'billingStart',l.billing_start,
        'role',private.branch_role(l.id,p_actor),'isOwner',b.owner_id=p_actor) order by l.created_at,l.id),'[]')
        from private.branches l join private.businesses b on b.id=l.business_id where private.branch_role(l.id,p_actor) is not null)) into access;
    if p_action='access' then return access; end if;
    return access||jsonb_build_object(
      'owners',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.role,'active',p.active)),'[]')
        from public.profiles p where dev and p.active and p.role='admin' and not private.is_developer(p.id)),
      'invoices',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'branchId',i.branch_id,'period',i.period,'amount',i.amount,
        'paid',(select coalesce(sum(sp.amount),0) from private.subscription_payments sp where sp.invoice_id=i.id),
        'dueDate',i.due_date,'voided',i.voided,'voidReason',i.void_reason) order by i.period desc,i.id),'[]')
        from private.subscription_invoices i join private.branches l on l.id=i.branch_id join private.businesses b on b.id=l.business_id
        where dev or b.owner_id=p_actor),
      'payments',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'invoiceId',p.invoice_id,'amount',p.amount,'paidAt',p.paid_at,'reference',p.reference,'by',p.recorded_by) order by p.created_at desc),'[]')
        from private.subscription_payments p join private.subscription_invoices i on i.id=p.invoice_id
        join private.branches l on l.id=i.branch_id join private.businesses b on b.id=l.business_id where dev or b.owner_id=p_actor));
  elsif p_action='bootstrap' then
    -- Only the first business administrator can claim the initially ownerless business.
    update private.businesses set owner_id=p_actor where owner_id is null
      and id=(select business_id from private.branches where id=private.legacy_branch())
      and exists(select 1 from public.profiles where id=p_actor and role='admin') and not dev;
    insert into private.branch_members(branch_id,user_id,role) values(private.legacy_branch(),p_actor,'admin') on conflict do nothing;
    return '{}'::jsonb;
  elsif p_action='business_create' then
    if not dev then raise exception 'Solo el desarrollador crea propietarios' using errcode='42501'; end if;
    owner:=(p_payload->>'ownerId')::uuid;
    if p_payload ? 'ownerName' then
      insert into public.profiles(id,name,role) values(owner,p_payload->>'ownerName','admin');
    end if;
    if not exists(select 1 from public.profiles where id=owner and active and role='admin') or private.is_developer(owner) then raise exception 'Propietario inválido'; end if;
    insert into private.businesses(name,owner_id) values(btrim(p_payload->>'name'),owner) returning id into business;
    branch:=private.create_branch(business,coalesce(nullif(btrim(p_payload->>'localName'),''),'Local principal'),p_payload->>'address',p_payload->>'city');
    result:=jsonb_build_object('id',business,'branchId',branch);
  elsif p_action='branch_create' then
    business:=(p_payload->>'businessId')::uuid;
    if not exists(select 1 from private.businesses where id=business and (dev or owner_id=p_actor)) then raise exception 'No puedes solicitar locales de este propietario' using errcode='42501'; end if;
    branch:=private.create_branch(business,p_payload->>'name',p_payload->>'address',p_payload->>'city');
    result:=jsonb_build_object('id',branch);
  elsif p_action='branch_update' then
    if not dev then raise exception 'Solo el desarrollador activa locales y configura tarifas' using errcode='42501'; end if;
    branch:=(p_payload->>'id')::uuid;
    perform 1 from private.branch_runtime where branch_id=branch for update;
    select * into local from private.branches where id=branch for update;
    if not found then raise exception 'Local desconocido'; end if;
    status_name:=coalesce(p_payload->>'status',local.status);
    if status_name not in ('requested','active','suspended','archived') then raise exception 'Estado inválido'; end if;
    if status_name in ('suspended','archived') and exists(select 1 from public.shifts where branch_id=branch and data->>'status' in ('requested','open','provisional')) then raise exception 'Cierra y sincroniza la caja antes de suspender o archivar el local'; end if;
    amount:=case when p_payload ? 'monthlyFee' then (p_payload->>'monthlyFee')::bigint else local.monthly_fee end;
    start_date:=case when p_payload ? 'billingStart' then nullif(p_payload->>'billingStart','')::date else local.billing_start end;
    if status_name='active' and (amount is null or start_date is null) then raise exception 'Configura la mensualidad y la fecha de inicio para activar el local'; end if;
    update private.branches set name=coalesce(nullif(btrim(p_payload->>'name'),''),name),address=coalesce(p_payload->>'address',address),city=coalesce(p_payload->>'city',city),
      status=status_name,monthly_fee=amount,billing_start=start_date where id=branch;
    update private.branch_runtime set revision=revision+1 where branch_id=branch;
    result:=jsonb_build_object('id',branch);
  elsif p_action='invoice_create' then
    if not dev then raise exception 'Solo el desarrollador registra mensualidades' using errcode='42501'; end if;
    branch:=(p_payload->>'branchId')::uuid;
    select * into local from private.branches where id=branch for update;
    if not found or local.billing_start is null or local.monthly_fee is null then raise exception 'Configura primero la tarifa y el inicio de cobro'; end if;
    period_date:=(p_payload->>'period')::date;
    if extract(day from period_date)<>1 or period_date<date_trunc('month',local.billing_start)::date then raise exception 'Periodo de cobro inválido'; end if;
    if (p_payload->>'dueDate')::date<period_date then raise exception 'El vencimiento no puede ser anterior al periodo'; end if;
    if local.status<>'active' then raise exception 'El local debe estar activo para registrar una mensualidad'; end if;
    -- One whole calendar month per branch; no implicit proration or automatic charges.
    insert into private.subscription_invoices(branch_id,period,amount,due_date,created_by)
      values(branch,period_date,local.monthly_fee,(p_payload->>'dueDate')::date,p_actor)
      on conflict(branch_id,period) do nothing returning id into target;
    if target is null then select id into target from private.subscription_invoices where branch_id=branch and period=period_date; end if;
    result:=jsonb_build_object('id',target);
  elsif p_action='payment_create' then
    if not dev then raise exception 'Solo el desarrollador registra pagos' using errcode='42501'; end if;
    target:=(p_payload->>'id')::uuid;
    select * into invoice from private.subscription_invoices where id=(p_payload->>'invoiceId')::uuid for update;
    if not found or invoice.voided then raise exception 'Mensualidad no disponible'; end if;
    amount:=(p_payload->>'amount')::bigint;
    select * into payment from private.subscription_payments where id=target;
    if found then
      if payment.invoice_id<>invoice.id or payment.amount<>amount or payment.reference<>btrim(p_payload->>'reference') or payment.paid_at<>(p_payload->>'paidAt')::date then raise exception 'Identificador de pago ya utilizado'; end if;
      return jsonb_build_object('id',target);
    end if;
    select coalesce(sum(p.amount),0) into paid from private.subscription_payments p where p.invoice_id=invoice.id;
    if amount<=0 or amount>invoice.amount-paid then raise exception 'El pago debe ser positivo y no superar el saldo pendiente'; end if;
    insert into private.subscription_payments(id,invoice_id,amount,paid_at,reference,recorded_by)
      values(target,invoice.id,amount,(p_payload->>'paidAt')::date,btrim(p_payload->>'reference'),p_actor);
    result:=jsonb_build_object('id',target);
  elsif p_action='invoice_void' then
    if not dev then raise exception 'Solo el desarrollador anula mensualidades' using errcode='42501'; end if;
    target:=(p_payload->>'id')::uuid;
    perform 1 from private.subscription_invoices where id=target for update;
    if not found then raise exception 'Mensualidad desconocida'; end if;
    if exists(select 1 from private.subscription_payments where invoice_id=target) then raise exception 'No se puede anular una mensualidad con pagos'; end if;
    if length(btrim(coalesce(p_payload->>'reason',''))) not between 3 and 500 then raise exception 'Indica el motivo de anulación'; end if;
    update private.subscription_invoices set voided=true,void_reason=btrim(p_payload->>'reason') where id=target;
    result:=jsonb_build_object('id',target);
  else raise exception 'Acción de plataforma desconocida';
  end if;
  insert into private.platform_audit(actor_id,action,detail) values(p_actor,p_action,p_payload-'password');
  return result;
end $$;

create function public.dexter_branch_profiles(p_branch uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'username',p.username,'role',coalesce(private.branch_role(p_branch,p.id),m.role),'active',p.active and coalesce(m.active,true)) order by p.created_at,p.id),'[]')
  from public.profiles p left join private.branch_members m on m.user_id=p.id and m.branch_id=p_branch
  where m.user_id is not null or private.branch_role(p_branch,p.id) is not null
$$;
create function public.dexter_branch_profile_save(p_branch uuid,p_profile jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare target uuid:=(p_profile->>'id')::uuid;
begin
  if private.is_developer(target) then raise exception 'El acceso privado no se modifica desde el equipo del negocio'; end if;
  if exists(select 1 from private.businesses b join private.branches l on l.business_id=b.id where l.id=p_branch and b.owner_id=target)
    and ((p_profile->>'role')<>'admin' or (p_profile->>'active')::boolean is not true) then raise exception 'El propietario conserva su acceso de administrador'; end if;
  insert into public.profiles(id,name,username,role,active)
    values(target,p_profile->>'name',p_profile->>'username',p_profile->>'role',true)
    on conflict(id) do nothing;
  insert into private.branch_members(branch_id,user_id,role,active)
    values(p_branch,target,p_profile->>'role',(p_profile->>'active')::boolean)
    on conflict(branch_id,user_id) do update set role=excluded.role,active=excluded.active;
  update private.branch_runtime set revision=revision+1 where branch_id=p_branch;
end $$;

-- Protect every platform table and helper; browsers go through the authenticated gateway.
do $$ declare tab text; begin
  foreach tab in array array['businesses','branches','installation','branch_members','branch_runtime','subscription_invoices','subscription_payments','platform_audit'] loop
    execute format('alter table private.%I enable row level security',tab);
    execute format('revoke all on private.%I from public,anon,authenticated',tab);
    execute format('grant all on private.%I to service_role',tab);
  end loop;
end $$;
revoke all on function private.legacy_branch(),private.is_developer(uuid),private.branch_role(uuid,uuid),private.create_branch(uuid,text,text,text) from public,anon,authenticated;
grant execute on function private.legacy_branch(),private.is_developer(uuid),private.branch_role(uuid,uuid),private.create_branch(uuid,text,text,text) to service_role;
revoke all on function public.dexter_platform(uuid,text,jsonb),public.dexter_branch_profiles(uuid),public.dexter_branch_profile_save(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_platform(uuid,text,jsonb),public.dexter_branch_profiles(uuid),public.dexter_branch_profile_save(uuid,jsonb) to service_role;

create function public.dexter_branch_read_state(p_branch uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare kind text; value jsonb; result jsonb:='{}'::jsonb; rev bigint;
begin
  select revision into rev from private.branch_runtime where branch_id=p_branch;
  foreach kind in array array['settings','flavors','sizes','orders','payments','deliveries','stock','shifts','counts','shipments','receipts','expenses','locations','transfers','promotions','coupons','requests','goals','parameters','audit','notifications','packages','bags','attachments','outages'] loop
    execute format('select coalesce(jsonb_agg(data order by updated_at,id),''[]''::jsonb) from public.%I where branch_id=$1',kind) into value using p_branch;
    result:=jsonb_set(result,array[kind],value);
  end loop;
  return jsonb_build_object('state',result,'revision',rev);
end $$;

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
  if p_command->>'type' in ('record_paper','save_flavor','save_size','configure','initialize_stock','save_location','save_promotion','issue_coupon','save_goal','approve_expense','resolve_request','approve_payout','create_shipment','start_audit','finish_audit') and role_name<>'admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  -- The gateway validates the administrator's MFA before calling this service-only RPC.
  -- An online admin may collect only their own shift; offline staff still need its primary device.
  if p_command->>'type' in ('pay','redeem_coupon','refund_order') and not exists(
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

create function public.dexter_branch_security(p_branch uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; row_value record;
begin
  case p_action
    when 'revision' then select jsonb_build_object('revision',revision) into result from private.branch_runtime where branch_id=p_branch;
    when 'device_primary' then
      perform 1 from private.branch_runtime where branch_id=p_branch for update;
      if exists(select 1 from public.shifts where branch_id=p_branch and data->>'status' in ('open','requested','provisional')) then raise exception 'Cierra y sincroniza el turno antes de cambiar el equipo principal'; end if;
      if not exists(select 1 from public.devices where branch_id=p_branch and id=(p_payload->>'id')::uuid and active) then raise exception 'Dispositivo no disponible'; end if;
      update public.devices set is_primary=false where branch_id=p_branch and is_primary;
      update public.devices set is_primary=true where branch_id=p_branch and id=(p_payload->>'id')::uuid;
      update private.branch_runtime set revision=revision+1 where branch_id=p_branch;result:='{}';
    when 'staff_get' then select to_jsonb(s)||jsonb_build_object('userId',s.user_id) into result from private.staff_credentials s join public.profiles p on p.id=s.user_id where lower(p.username)=lower(p_payload->>'username') and p.active;
    when 'staff_set' then insert into private.staff_credentials(user_id,salt,pin_hash) values((p_payload->>'userId')::uuid,p_payload->>'salt',p_payload->>'hash') on conflict(user_id) do update set salt=excluded.salt,pin_hash=excluded.pin_hash; result:='{}';
    when 'enrollment_create' then insert into private.enrollments(branch_id,token_hash,user_id,expires_at,is_primary) values(p_branch,p_payload->>'hash',(p_payload->>'userId')::uuid,(p_payload->>'expiresAt')::timestamptz,(p_payload->>'primary')::boolean);result:='{}';
    when 'enrollment_consume' then update private.enrollments set used_at=now() where token_hash=p_payload->>'hash' and user_id=(p_payload->>'userId')::uuid and used_at is null and expires_at>now() returning to_jsonb(enrollments.*) into result;
    when 'permit_create' then insert into private.offline_permits(id,token_hash,admin_id,device_id,expires_at) values((p_payload->>'id')::uuid,p_payload->>'hash',(p_payload->>'adminId')::uuid,(p_payload->>'deviceId')::uuid,(p_payload->>'expiresAt')::timestamptz);result:='{}';
    when 'permit_validate' then select jsonb_build_object('adminId',o.admin_id) into result from private.offline_permits o join public.profiles p on p.id=o.admin_id and p.active join public.devices d on d.id=o.device_id and d.branch_id=p_branch and d.active where private.branch_role(p_branch,p.id)='admin' and o.token_hash=p_payload->>'hash' and o.device_id=(p_payload->>'deviceId')::uuid and o.expires_at>(p_payload->>'at')::timestamptz and (o.used_by is null or o.used_by=(p_payload->>'commandId')::uuid);
    when 'permit_use' then update private.offline_permits set used_by=(p_payload->>'commandId')::uuid where token_hash=p_payload->>'hash' and (used_by is null or used_by=(p_payload->>'commandId')::uuid);result:='{}';
    when 'setup' then update private.setup_tokens set used_at=now() where token_hash=p_payload->>'hash' and used_at is null and not exists(select 1 from public.profiles where role='admin') returning jsonb_build_object('ok',true) into result;
    when 'setup_check' then select jsonb_build_object('ok',true) into result from private.setup_tokens where token_hash=p_payload->>'hash' and used_at is null and not exists(select 1 from public.profiles where role='admin');
    when 'media_set' then insert into private.media_uploads(attachment_id,path,sha256,size,mime) values((p_payload->>'id')::uuid,p_payload->>'path',p_payload->>'sha256',(p_payload->>'size')::bigint,p_payload->>'mime') on conflict(attachment_id) do nothing;result:='{}';
    when 'media_list' then select coalesce(jsonb_agg(jsonb_build_object('id',attachment_id,'path',path,'sha256',sha256,'size',size,'mime',mime,'status','uploaded')),'[]'::jsonb) into result from private.media_uploads where attachment_id in(select id from public.attachments where branch_id=p_branch);
    when 'notifications_claim' then
      insert into private.notification_dispatch(id) select id from public.notifications where branch_id=p_branch on conflict(id) do nothing;
      with candidates as (select id from private.notification_dispatch where id in(select id from public.notifications where branch_id=p_branch) and status<>'sent' and (lease_until is null or lease_until<now()) order by attempts limit 20 for update skip locked), claimed as (update private.notification_dispatch n set lease_until=now()+interval '2 minutes',attempts=n.attempts+1 from candidates c where n.id=c.id returning n.id,n.attempts)
      select coalesce(jsonb_agg(p.data||jsonb_build_object('attempts',c.attempts)),'[]'::jsonb) into result from claimed c join public.notifications p on p.id=c.id;
    when 'notification_finish' then update private.notification_dispatch set status=case when (p_payload->>'ok')::boolean then 'sent' else 'pending' end,last_error=p_payload->>'error',lease_until=case when (p_payload->>'ok')::boolean then null else now()+interval '5 minutes' end where id=(p_payload->>'id')::uuid;result:='{}';
    when 'notification_status' then select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'attempts',attempts,'lastError',last_error)),'[]'::jsonb) into result from private.notification_dispatch where id in(select id from public.notifications where branch_id=p_branch);
    when 'device_lookup' then select to_jsonb(d)||jsonb_build_object('branchId',d.branch_id) into result from public.devices d where id=(p_payload->>'id')::uuid;
    else raise exception 'Unknown security action';
  end case;
  return result;
end $$;

create function public.dexter_branch_conflict(p_branch uuid,p_command jsonb,p_message text) returns void language plpgsql security invoker set search_path='' as $$
declare key uuid:=(p_command->>'id')::uuid;rev bigint;added integer;
begin
 select revision into rev from private.branch_runtime where branch_id=p_branch for update;
 insert into public.requests(id,branch_id,data,revision)values(key,p_branch,jsonb_build_object('id',key,'type','sync','by',p_command->>'actorId','at',now(),'status','pending','referenceId',key,'notes',left(p_message,1500),'originalCommand',p_command #- '{payload,offlinePermit}'),rev+1)on conflict(id)do nothing;
 get diagnostics added=row_count;
 if added>0 then update private.branch_runtime set revision=rev+1 where branch_id=p_branch;end if;
end $$;

create function public.dexter_branch_audit(p_branch uuid,p_actor uuid,p_device uuid,p_action text,p_detail text)returns void language plpgsql security invoker set search_path='' as $$
declare key uuid:=gen_random_uuid();rev bigint;
begin
 select revision into rev from private.branch_runtime where branch_id=p_branch for update;
 insert into public.audit(id,branch_id,data,revision)values(key,p_branch,jsonb_build_object('id',key,'eventId',key,'by',p_actor,'deviceId',p_device,'at',now(),'receivedAt',now(),'action',p_action,'detail',p_detail),rev+1);
 update private.branch_runtime set revision=rev+1 where branch_id=p_branch;
end $$;


-- Compatibility bridges are restricted to the migrated principal branch, never all branches.
create or replace function public.dexter_read_state() returns jsonb language sql security invoker set search_path='' as $$ select public.dexter_branch_read_state(private.legacy_branch()) $$;
create or replace function public.dexter_commit(p_revision bigint,p_command jsonb,p_state jsonb,p_result jsonb) returns jsonb language sql security invoker set search_path='' as $$ select public.dexter_branch_commit(private.legacy_branch(),p_revision,p_command,p_state,p_result) $$;
create or replace function public.dexter_security(p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select public.dexter_branch_security(private.legacy_branch(),p_action,p_payload) $$;
create or replace function public.dexter_record_conflict(p_command jsonb,p_message text) returns void language sql security invoker set search_path='' as $$ select public.dexter_branch_conflict(private.legacy_branch(),p_command,p_message) $$;
create or replace function public.dexter_security_audit(p_actor uuid,p_device uuid,p_action text,p_detail text) returns void language sql security invoker set search_path='' as $$ select public.dexter_branch_audit(private.legacy_branch(),p_actor,p_device,p_action,p_detail) $$;
revoke all on function public.dexter_branch_read_state(uuid),public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb),public.dexter_branch_security(uuid,text,jsonb),public.dexter_branch_conflict(uuid,jsonb,text),public.dexter_branch_audit(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.dexter_branch_read_state(uuid),public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb),public.dexter_branch_security(uuid,text,jsonb),public.dexter_branch_conflict(uuid,jsonb,text),public.dexter_branch_audit(uuid,uuid,uuid,text,text) to service_role;

