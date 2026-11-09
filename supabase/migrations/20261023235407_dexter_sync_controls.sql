-- Server-only persistence for rejected offline operations and access administration.
create index enrollments_user_idx on private.enrollments(user_id);
create index permits_admin_idx on private.offline_permits(admin_id);
create index permits_device_idx on private.offline_permits(device_id);
create index command_actor_idx on public.command_receipts(actor_id);
create index command_device_idx on public.command_receipts(device_id);
create index deliveries_order_idx on public.deliveries(order_id);
create index devices_user_idx on public.devices(user_id);
create index lines_order_idx on public.order_lines(order_id);
create index orders_shift_idx on public.orders(shift_id);
create index payments_order_idx on public.payments(order_id);
create index receipts_shipment_idx on public.receipts(shipment_id);

create function public.dexter_record_conflict(p_command jsonb,p_message text) returns void language plpgsql security invoker set search_path='' as $$
declare key uuid:=(p_command->>'id')::uuid;rev bigint;added integer;
begin
 select revision into rev from private.runtime where id for update;
 insert into public.requests(id,data,revision)values(key,jsonb_build_object('id',key,'type','sync','by',p_command->>'actorId','at',now(),'status','pending','referenceId',key,'notes',left(p_message,1500),'originalCommand',p_command #- '{payload,offlinePermit}'),rev+1)on conflict(id)do nothing;
 get diagnostics added=row_count;
 if added>0 then update private.runtime set revision=rev+1 where id;end if;
end $$;
revoke all on function public.dexter_record_conflict(jsonb,text) from public,anon,authenticated;
grant execute on function public.dexter_record_conflict(jsonb,text) to service_role;

create function public.dexter_security_audit(p_actor uuid,p_device uuid,p_action text,p_detail text)returns void language plpgsql security invoker set search_path='' as $$
declare key uuid:=gen_random_uuid();rev bigint;
begin
 select revision into rev from private.runtime where id for update;
 insert into public.audit(id,data,revision)values(key,jsonb_build_object('id',key,'eventId',key,'by',p_actor,'deviceId',p_device,'at',now(),'receivedAt',now(),'action',p_action,'detail',p_detail),rev+1);
 update private.runtime set revision=rev+1 where id;
end $$;
revoke all on function public.dexter_security_audit(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.dexter_security_audit(uuid,uuid,text,text) to service_role;
