-- El período de ensayo conserva sus avisos para la consulta histórica.
-- Solo se excluyen de la cola de entrega del local correspondiente.
alter function public.dexter_branch_security(uuid,text,jsonb) set schema private;
alter function private.dexter_branch_security(uuid,text,jsonb) rename to branch_security_before_rehearsal;
revoke all on function private.branch_security_before_rehearsal(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.branch_security_before_rehearsal(uuid,text,jsonb) to service_role;

create function public.dexter_branch_security(p_branch uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cut timestamptz; result jsonb;
begin
  if p_action <> 'notifications_claim' then
    return private.branch_security_before_rehearsal(p_branch,p_action,p_payload);
  end if;
  select (data#>>'{rehearsalBaseline,at}')::timestamptz into cut
    from public.settings where branch_id=p_branch limit 1;
  insert into private.notification_dispatch(id)
    select id from public.notifications where branch_id=p_branch
      and (cut is null or (data->>'at')::timestamptz >= cut)
    on conflict(id) do nothing;
  with candidates as (
    select d.id from private.notification_dispatch d join public.notifications n on n.id=d.id
    where n.branch_id=p_branch and (cut is null or (n.data->>'at')::timestamptz >= cut)
      and d.status <> 'sent' and (d.lease_until is null or d.lease_until < now())
    order by d.attempts, d.id limit 20 for update of d skip locked
  ), claimed as (
    update private.notification_dispatch d set lease_until=now()+interval '2 minutes', attempts=d.attempts+1
    from candidates c where d.id=c.id returning d.id,d.attempts
  ) select coalesce(jsonb_agg(n.data || jsonb_build_object('attempts',c.attempts)),'[]') into result
    from claimed c join public.notifications n on n.id=c.id;
  return result;
end $$;
revoke all on function public.dexter_branch_security(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_branch_security(uuid,text,jsonb) to service_role;

create or replace function public.dexter_security(p_action text,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select public.dexter_branch_security(private.legacy_branch(),p_action,p_payload)
$$;
