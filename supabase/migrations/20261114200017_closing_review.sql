-- El cuadre y sus revisiones se conservan como conteos inmutables en el JSONB existente.
-- Revalidar el rol de aprobación bajo el mismo bloqueo serializado que el commit.
alter function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) set schema private;
alter function private.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) rename to branch_commit_operational_controls;
revoke all on function private.branch_commit_operational_controls(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.branch_commit_operational_controls(uuid,bigint,jsonb,jsonb,jsonb) to service_role;

create function public.dexter_branch_commit(p_branch uuid,p_revision bigint,p_command jsonb,p_state jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from private.branch_runtime where branch_id=p_branch for update;
  if p_command->>'type'='approve_closing' and not exists(
    select 1 from public.command_receipts where branch_id=p_branch and id=(p_command->>'id')::uuid
      and actor_id=(p_command->>'actorId')::uuid
  ) then
    if private.branch_role(p_branch,(p_command->>'actorId')::uuid) is distinct from 'admin'
      or p_command#>>'{payload,offline}'='true' then
      raise exception 'ADMIN_REQUIRED' using errcode='42501';
    end if;
  end if;
  return private.branch_commit_operational_controls(p_branch,p_revision,p_command,p_state,p_result);
end $$;
revoke all on function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb) to service_role;

alter function public.dexter_commit(bigint,jsonb,jsonb,jsonb) set schema private;
alter function private.dexter_commit(bigint,jsonb,jsonb,jsonb) rename to commit_before_closing_review;
revoke all on function private.commit_before_closing_review(bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.commit_before_closing_review(bigint,jsonb,jsonb,jsonb) to service_role;
create function public.dexter_commit(p_revision bigint,p_command jsonb,p_state jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from private.runtime where id for update;
  if p_command->>'type'='approve_closing' and not exists(
    select 1 from public.command_receipts where id=(p_command->>'id')::uuid and actor_id=(p_command->>'actorId')::uuid
  ) then
    if not exists(select 1 from public.profiles where id=(p_command->>'actorId')::uuid and role='admin' and active)
      or p_command#>>'{payload,offline}'='true' then
      raise exception 'ADMIN_REQUIRED' using errcode='42501';
    end if;
  end if;
  return private.commit_before_closing_review(p_revision,p_command,p_state,p_result);
end $$;
revoke all on function public.dexter_commit(bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_commit(bigint,jsonb,jsonb,jsonb) to service_role;
