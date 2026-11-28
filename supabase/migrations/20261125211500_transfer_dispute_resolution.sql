-- Ampliar la validación existente bajo el mismo bloqueo del commit, sin cambiar
-- registros del negocio, permisos de ejecución ni el resto de controles.
do $migration$
declare
  definition text;
  previous_guard text := $guard$  if operation='confirm_transfer' then
    select data into transfer_before from public.transfers
      where branch_id=p_branch and id=(payload->>'transferId')::uuid;
    if transfer_before->>'recipientId' is distinct from actor::text
      or transfer_before->>'status' is distinct from 'in_transit' then
      raise exception 'RECIPIENT_REQUIRED' using errcode='42501';
    end if;
  end if;$guard$;
  next_guard text := $guard$  if operation in ('confirm_transfer','cancel_transfer') then
    select data into transfer_before from public.transfers
      where branch_id=p_branch and id=(payload->>'transferId')::uuid;
    if operation='confirm_transfer' or transfer_before->>'status' in ('in_transit','disputed') then
      if transfer_before->>'recipientId' is distinct from actor::text
        or coalesce(transfer_before->>'status','') not in ('in_transit','disputed')
        or transfer_before->>'by'=actor::text
        or transfer_before->>'executedBy'=actor::text then
        raise exception 'RECIPIENT_REQUIRED' using errcode='42501';
      end if;
    end if;
  end if;$guard$;
begin
  select replace(pg_get_functiondef('public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb)'::regprocedure),chr(13),'')
    into definition;
  if strpos(definition,previous_guard)=0 then
    raise exception 'No se encontró la validación de recepción esperada';
  end if;
  execute replace(definition,previous_guard,next_guard);
end
$migration$;
