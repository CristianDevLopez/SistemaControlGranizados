set local lock_timeout = '2s';

-- Browser operations use ISO UTC. The second index covers older imports with offsets.
create index dexter_audit_device_utc_idx on public.audit
  (branch_id, (data->>'deviceId'), (data->>'at') collate "C" desc)
  where data->>'eventId' is distinct from data->>'id'
    and (data->>'at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$';
create index dexter_audit_device_legacy_idx on public.audit (branch_id, (data->>'deviceId'))
  where data->>'eventId' is distinct from data->>'id'
    and (data->>'at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$';
create index dexter_audit_event_idx on public.audit (branch_id, (data->>'eventId'));
create index dexter_cash_payments_shift_idx on public.payments (branch_id, (data->>'shiftId'))
  where coalesce(data->>'method','cash') = 'cash';

-- A stable read uses one snapshot for both the revision and the rows the command will validate.
-- The existing commit RPC checks that revision and accepts only the changed rows in p_state.
create function public.dexter_branch_read_counter(p_branch uuid, p_scope jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with target_orders as (
    select o.* from public.orders o
    where o.branch_id = p_branch and (o.id = (p_scope->>'orderId')::uuid or o.id in (
      select l.order_id from jsonb_array_elements_text(p_scope->'lineIds') as input(id)
      join public.order_lines l on l.id = input.id::uuid and l.branch_id = p_branch
    ))
  ), target_shifts as (
    select s.* from public.shifts s
    where s.branch_id = p_branch and (
      s.data->>'status' = 'open' or s.id in (select shift_id from target_orders)
      or s.id in (select value::uuid from jsonb_array_elements_text(p_scope->'shiftIds'))
    )
  ), cash_shift as (
    select id::text as id, 'cash:' || id::text as drawer from target_shifts
    where data->>'status' = 'open' and p_scope->'checkout' = 'true'::jsonb
  ), utc_device_event as (
    select a.id, a.data, a.updated_at from public.audit a
    where a.branch_id = p_branch and a.data->>'deviceId' = p_scope->>'deviceId'
      and a.data->>'eventId' is distinct from a.data->>'id'
      and (a.data->>'at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      and pg_input_is_valid(a.data->>'at', 'timestamp with time zone')
    order by (a.data->>'at') collate "C" desc
    limit 1
  ), legacy_device_event as (
    select a.id, a.data, a.updated_at from public.audit a
    where a.branch_id = p_branch and a.data->>'deviceId' = p_scope->>'deviceId'
      and a.data->>'eventId' is distinct from a.data->>'id'
      and (a.data->>'at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      and pg_input_is_valid(a.data->>'at', 'timestamp with time zone')
    order by (a.data->>'at')::timestamptz desc
    limit 1
  ), last_device_event as (
    select e.* from (select * from utc_device_event union all select * from legacy_device_event) e
    order by (e.data->>'at')::timestamptz desc
    limit 1
  ), target_audit as (
    select id, data, updated_at from last_device_event
    union
    select a.id, a.data, a.updated_at from public.audit a
    where a.branch_id = p_branch and a.data->>'eventId' = p_scope->>'commandId'
  )
  select jsonb_build_object('revision', r.revision, 'state', jsonb_build_object(
    'settings', coalesce((select jsonb_agg(data order by updated_at,id) from public.settings where branch_id = p_branch), '[]'),
    'flavors', coalesce((select jsonb_agg(data order by updated_at,id) from public.flavors where branch_id = p_branch), '[]'),
    'sizes', coalesce((select jsonb_agg(data order by updated_at,id) from public.sizes where branch_id = p_branch), '[]'),
    'promotions', coalesce((select jsonb_agg(data order by updated_at,id) from public.promotions where branch_id = p_branch), '[]'),
    'parameters', coalesce((select jsonb_agg(data order by updated_at,id) from public.parameters
      where branch_id = p_branch and data->>'kind' = 'catalog' and data->'version' = p_scope->'configVersion'), '[]'),
    'orders', coalesce((select jsonb_agg(data order by updated_at,id) from target_orders), '[]'),
    'shifts', coalesce((select jsonb_agg(data order by updated_at,id) from target_shifts), '[]'),
    'audit', coalesce((select jsonb_agg(data order by updated_at,id) from target_audit), '[]'),
    'requests', coalesce((select jsonb_agg(data order by updated_at,id) from public.requests
      where branch_id = p_branch and (id = (p_scope->>'commandId')::uuid
        or (data->>'type' = 'difference' and data->>'referenceId' = p_scope->>'orderId'))), '[]'),
    'locations', coalesce((select jsonb_agg(data order by updated_at,id) from public.locations
      where branch_id = p_branch and id = (p_scope->>'accountId')::uuid), '[]'),
    'coupons', coalesce((select jsonb_agg(data order by updated_at,id) from public.coupons
      where branch_id = p_branch and code in (select value from jsonb_array_elements_text(p_scope->'codes'))), '[]'),
    'payments', coalesce((select jsonb_agg(p.data order by p.updated_at,p.id)
      from public.payments p join cash_shift s on p.data->>'shiftId' = s.id
      where p.branch_id = p_branch and coalesce(p.data->>'method','cash') = 'cash'), '[]'),
    'expenses', coalesce((select jsonb_agg(e.data order by e.updated_at,e.id)
      from public.expenses e join cash_shift s on e.data->>'shiftId' = s.id
      where e.branch_id = p_branch and e.data->>'source' = 'cash' and e.data->>'status' = 'approved'), '[]'),
    'transfers', coalesce((select jsonb_agg(t.data order by t.updated_at,t.id) from public.transfers t
      where t.branch_id = p_branch and exists (select 1 from cash_shift s where
        t.data->>'executionShiftId' = s.id or t.data->>'from' = s.drawer or t.data->>'to' = s.drawer)), '[]')
  )) from private.branch_runtime r where r.branch_id = p_branch;
$$;

revoke all on function public.dexter_branch_read_counter(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.dexter_branch_read_counter(uuid,jsonb) to service_role;
