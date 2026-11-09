-- One private owner; business administrators cannot grant or change this access.
create table private.superadmin_access (
  singleton boolean primary key default true check(singleton),
  email text not null check(email = lower(btrim(email))),
  setup_hash text,
  expires_at timestamptz,
  user_id uuid unique references public.profiles(id),
  claimed_at timestamptz,
  constraint superadmin_access_state check (
    (user_id is null and setup_hash is not null and expires_at is not null and claimed_at is null)
    or (user_id is not null and setup_hash is null and expires_at is null and claimed_at is not null)
  )
);
alter table private.superadmin_access enable row level security;
revoke all on private.superadmin_access from public, anon, authenticated;
grant select, insert, update on private.superadmin_access to service_role;

create function public.dexter_superadmin(p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare access private.superadmin_access%rowtype;
begin
  if p_action = 'owner' then
    select * into access from private.superadmin_access where singleton;
    return jsonb_build_object('userId', access.user_id);
  elsif p_action = 'reserved' then
    return jsonb_build_object('reserved', exists (
      select 1 from private.superadmin_access
      where email = lower(btrim(p_payload->>'email'))
    ));
  elsif p_action = 'check' then
    select * into access from private.superadmin_access
    where singleton and user_id is null and setup_hash = p_payload->>'hash'
      and email = lower(btrim(p_payload->>'email')) and expires_at > now();
    if not found then return null; end if;
    return jsonb_build_object('email', access.email);
  elsif p_action = 'claim' then
    select * into access from private.superadmin_access where singleton for update;
    if not found or access.user_id is not null or access.setup_hash is distinct from p_payload->>'hash'
      or access.expires_at <= now() then return null; end if;
    -- Email and Auth ID come from the trusted gateway's checked reservation and createUser response.
    if lower(btrim(p_payload->>'email')) is distinct from access.email then return null; end if;
    insert into public.profiles(id, name, role, active)
      values ((p_payload->>'userId')::uuid, btrim(p_payload->>'name'), 'admin', true);
    update private.superadmin_access set user_id = (p_payload->>'userId')::uuid,
      claimed_at = now(), setup_hash = null, expires_at = null where singleton;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'Unknown superadmin action';
end $$;
revoke all on function public.dexter_superadmin(text, jsonb) from public, anon, authenticated;
grant execute on function public.dexter_superadmin(text, jsonb) to service_role;
