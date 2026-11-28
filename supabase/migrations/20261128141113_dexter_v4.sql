-- Archive the complete business state before converting units or retiring notices.
create table private.v4_rollout_backup (
  branch_id uuid primary key, backed_up_at timestamptz not null default now(), snapshot jsonb not null
);
revoke all on private.v4_rollout_backup from public,anon,authenticated;
grant select on private.v4_rollout_backup to service_role;
insert into private.v4_rollout_backup(branch_id,snapshot)
  select id,public.dexter_branch_read_state(id) from private.branches;

create table private.v4_notification_archive as
  select n.*,now() as archived_at from public.notifications n;
create table private.v4_notification_dispatch_archive as select * from private.notification_dispatch;
revoke all on private.v4_notification_dispatch_archive from public,anon,authenticated;
grant select on private.v4_notification_dispatch_archive to service_role;
revoke all on private.v4_notification_archive from public,anon,authenticated;
grant select on private.v4_notification_archive to service_role;
do $$ begin
  if (select count(*) from private.v4_notification_archive) <> (select count(*) from public.notifications)
  then raise exception 'The notification backup did not match the source'; end if;
end $$;
delete from private.notification_dispatch where id in(select id from private.v4_notification_archive);
delete from public.notifications where id in(select id from private.v4_notification_archive);

-- Preserve reviewed historical losses and their already-applied compensations.
with reviewed as (
  select c.*,s.data as shift_data from public.counts c join public.shifts s
    on s.branch_id=c.branch_id and c.id::text=coalesce(s.data#>>'{closingReview,countId}',s.data->>'closingCountId')
    where s.data#>>'{closingReview,status}'='approved'
), entries as (
  select c.*,e.key as article,e.value as entry,
    case e.key when 'supply:gomas-gusanitos' then 100 when 'supply:cintas' then 520 when 'supply:bombones' then 48 when 'supply:minichicles' then 35 else 1 end as factor
  from reviewed c cross join lateral jsonb_each(coalesce(c.data->'inventoryDifferences','{}')) e
  where (e.value->>'quantity')::numeric<0
), imported as (
  select e.*,gen_random_uuid() as merma_id,
    coalesce((select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'by',o.data->>'by','at',o.data->>'at','kind','product',
      'quantity',(x->>'quantity')::numeric*e.factor,'amount',(x->>'quantity')::numeric*coalesce((e.entry->>'unitCost')::numeric,0),
      'notes','Compensación histórica ya contabilizada','from',o.id))
      from public.counts o cross join lateral jsonb_array_elements(coalesce(o.data#>array['inventoryDifferences',e.article,'compensation'],'[]')) x
      where o.branch_id=e.branch_id and x->>'countId'=e.id::text),'[]') as recoveries
  from entries e
)
insert into public.requests(id,branch_id,data)
select merma_id,branch_id,jsonb_build_object('id',merma_id,'type','difference','by',data->>'by','at',data->>'at','status','approved',
 'notes','Merma histórica conservada','merma',jsonb_build_object('type','Cierre','article',article,
 'quantity',-(entry->>'quantity')::numeric*factor,'unitCost',coalesce((entry->>'unitCost')::numeric,0)/factor,
 'saleValue',coalesce((entry->>'saleValue')::numeric,0),'shiftId',data->>'shiftId','sourceId',id,'emptyCup',true,
 'state',case when jsonb_array_length(recoveries)>0 then
   case when (select sum((r->>'quantity')::numeric) from jsonb_array_elements(recoveries) r)>=-(entry->>'quantity')::numeric*factor then 'reconciled' else 'partial' end else 'open' end,
 'recoveries',recoveries,'history',jsonb_build_array(jsonb_build_object('by','system','at',now(),'notes','Importada del reporte anterior. El inventario ya estaba ajustado.'))))
from imported;
with reviewed as (
  select c.*,s.data as shift_data from public.counts c join public.shifts s
    on s.branch_id=c.branch_id and c.id::text=coalesce(s.data#>>'{closingReview,countId}',s.data->>'closingCountId')
    where s.data#>>'{closingReview,status}'='approved' and (c.data->>'difference')::numeric<0
), imported as(select *,gen_random_uuid() as merma_id from reviewed)
insert into public.requests(id,branch_id,data)
select merma_id,branch_id,jsonb_build_object('id',merma_id,'type','difference','by',data->>'by','at',data->>'at','status','approved',
 'notes','Diferencia histórica de efectivo','merma',jsonb_build_object('type','Cierre','article','cash',
 'quantity',-(data->>'difference')::numeric,'unitCost',1,'saleValue',1,'shiftId',data->>'shiftId','sourceId',id,'state',case when coalesce((select sum((r->>'amount')::numeric) from jsonb_array_elements(coalesce(shift_data#>'{closingReview,recoveries}','[]')) r),0)>=-(data->>'difference')::numeric then 'reconciled' when jsonb_array_length(coalesce(shift_data#>'{closingReview,recoveries}','[]'))>0 then 'partial' else 'open' end,
 'recoveries',coalesce((select jsonb_agg(r||jsonb_build_object('kind','money','quantity',(r->>'amount')::numeric,'notes','Recuperación histórica'))
   from jsonb_array_elements(coalesce(shift_data#>'{closingReview,recoveries}','[]')) r),'[]'),
 'history',jsonb_build_array(jsonb_build_object('by','system','at',now(),'notes','Importada del cierre anterior sin alterar dinero ni inventario.'))))
from imported;

-- Quantities previously tracked as sealed candy bags become base units once.
with conversion as materialized (
select gen_random_uuid() as id,s.branch_id,s.id as settings_id,c.article,coalesce(b.balance,0)*(c.factor-1) as amount
from public.settings s cross join (values
  ('supply:gomas-gusanitos',100),('supply:cintas',520),('supply:bombones',48),('supply:minichicles',35)
) c(article,factor)
left join lateral(select data from public.counts where id::text=s.data#>>'{rehearsalBaseline,countId}' and branch_id=s.branch_id) baseline on true
left join lateral(select
  case when baseline.data->'items' ? c.article then coalesce((baseline.data#>>array['items',c.article])::numeric,0) +
    coalesce(sum((data->>'quantity')::numeric) filter(where (data->>'at')::timestamptz>(s.data#>>'{rehearsalBaseline,at}')::timestamptz and not(data->>'referenceId'=s.data#>>'{rehearsalBaseline,countId}' and data->>'reason'='audit_adjustment')),0)
  else sum((data->>'quantity')::numeric) end as balance
  from public.stock where branch_id=s.branch_id and data->>'article'=c.article) b on true
where coalesce(b.balance,0)<>0 and coalesce((s.data->>'v4Enabled')::boolean,false)=false
)
insert into public.stock(id,branch_id,data)
select id,branch_id,jsonb_build_object('id',id,'article',article,'quantity',amount,
  'reason','v4_candy_conversion','referenceId',settings_id,'at',now(),'by',settings_id,'eventId',gen_random_uuid())
from conversion;
update public.settings set data=data || jsonb_build_object('v4Enabled',true,'v4',jsonb_build_object(
  'candyConvertedAt',now(),'lowStockDays',3,'lossDays',30,'candyTolerance',0.1,
  'telegram',jsonb_build_object('groups',jsonb_build_array(jsonb_build_object('id','admins','name','Dexter’s · Admins','chatId','-5480458026')),'rules','{}'::jsonb,'dailyTime','22:00')
));
update public.promotions set data=jsonb_set(data,'{checkoutText}',to_jsonb('Verifica que la persona nos sigue en Instagram o en nuestras redes.'::text))
where not(data?'checkoutText');
update private.branch_runtime set revision=revision+1;

alter table private.notification_dispatch add column message_id bigint;
alter table private.notification_dispatch add column chat_id text;
alter table private.notification_dispatch add column sent_at timestamptz;
alter table private.notification_dispatch add column resolution_updated boolean not null default false;
alter table private.notification_dispatch add column resolution_event_id text;
alter table private.notification_dispatch add column resolution_reply_id bigint;
alter table private.notification_dispatch add column resolution_attempts integer not null default 0;
create table private.telegram_rate(chat_id text primary key,next_at timestamptz not null default now());
revoke all on private.telegram_rate from public,anon,authenticated;
grant all on private.telegram_rate to service_role;

alter function public.dexter_branch_security(uuid,text,jsonb) set schema private;
alter function private.dexter_branch_security(uuid,text,jsonb) rename to branch_security_before_v4;
create function public.dexter_branch_security(p_branch uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; item record; scheduled timestamptz;
begin
  if p_action='telegram_branches' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',branch_id,'legacy',branch_id=private.legacy_branch())),'[]') from public.settings where (data->>'v4Enabled')::boolean=true);
  elsif p_action='notifications_claim' then
    insert into private.notification_dispatch(id)
      select id from public.notifications where branch_id=p_branch on conflict do nothing;
    update private.notification_dispatch d set status='failed',last_error=coalesce(last_error,'Se agotaron los cinco intentos.')
      where d.id in(select id from public.notifications where branch_id=p_branch)
        and d.status='pending' and d.attempts>=5 and d.lease_until<now();
    with candidates as (
      select d.id, coalesce(n.data#>>'{resolved,eventId}','') as event_id from private.notification_dispatch d join public.notifications n on n.id=d.id
      where n.branch_id=p_branch and d.status='pending' and d.attempts<5
        and (n.data->>'at')::timestamptz >= coalesce((select (data#>>'{rehearsalBaseline,at}')::timestamptz from public.settings where branch_id=p_branch limit 1),'-infinity'::timestamptz)
        and (d.lease_until is null or d.lease_until<now())
      order by n.data->>'at',d.id limit 10 for update of d skip locked
    ), claimed as (
      update private.notification_dispatch d set lease_until=now()+interval '3 minutes',attempts=d.attempts+1
      from candidates c where d.id=c.id returning d.id,d.attempts
    ) select coalesce(jsonb_agg(n.data||jsonb_build_object('attempts',c.attempts)),'[]') into result
      from claimed c join public.notifications n on n.id=c.id;
    return result;
  elsif p_action='notification_finish' then
    update private.notification_dispatch d set
      status=case when (p_payload->>'ok')::boolean then 'sent' when d.attempts>=5 then 'failed' else 'pending' end,
      last_error=p_payload->>'error',
      lease_until=case when (p_payload->>'ok')::boolean then null else now()+make_interval(secs=>greatest(coalesce((p_payload->>'retryAfter')::integer,0),least(3600,30*power(2,d.attempts)::integer))) end,
      message_id=coalesce((p_payload->>'messageId')::bigint,d.message_id),chat_id=coalesce(p_payload->>'chatId',d.chat_id),
      sent_at=case when (p_payload->>'ok')::boolean then now() else d.sent_at end
      where d.id=(p_payload->>'id')::uuid and exists(select 1 from public.notifications n where n.id=d.id and n.branch_id=p_branch);
    if found then update private.branch_runtime set revision=revision+1 where branch_id=p_branch; end if;
    return '{}';
  elsif p_action='notification_defer' then
    update private.notification_dispatch d set attempts=greatest(0,attempts-1),lease_until=now()+interval '1 minute'
      where d.id=(p_payload->>'id')::uuid and d.id in(select id from public.notifications where branch_id=p_branch);
    return '{}';
  elsif p_action='notification_retry' then
    update private.notification_dispatch d set status=case when d.status='failed' then 'pending' else d.status end,attempts=case when d.status='failed' then 0 else d.attempts end,resolution_attempts=0,lease_until=null,last_error=null
      where (d.status='failed' or (d.status='sent' and not d.resolution_updated and d.resolution_attempts>=5)) and (p_payload->>'id' is null or d.id=(p_payload->>'id')::uuid)
        and d.id in(select id from public.notifications where branch_id=p_branch);
    if found then update private.branch_runtime set revision=revision+1 where branch_id=p_branch; end if;
    return '{}';
  elsif p_action='notification_status' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'status',case when d.status='sent' and not d.resolution_updated and d.resolution_attempts>=5 then 'failed' else d.status end,'attempts',d.attempts,'lastError',d.last_error,'messageId',d.message_id,'chatId',d.chat_id)),'[]')
      from private.notification_dispatch d join public.notifications n on n.id=d.id where n.branch_id=p_branch);
  elsif p_action='telegram_slot' then
    insert into private.telegram_rate(chat_id) values(p_payload->>'chatId') on conflict do nothing;
    select greatest(next_at,now()) into scheduled from private.telegram_rate where chat_id=p_payload->>'chatId' for update;
    if scheduled>now()+interval '30 seconds' then return jsonb_build_object('allowed',false); end if;
    update private.telegram_rate set next_at=scheduled+interval '3100 milliseconds' where chat_id=p_payload->>'chatId';
    return jsonb_build_object('allowed',true,'delayMs',greatest(0,extract(epoch from scheduled-now())*1000)::integer);
  elsif p_action='telegram_prepare' then
    for item in select value from jsonb_array_elements(coalesce(p_payload->'notices','[]')) loop
      insert into private.telegram_once(branch_id,dedup_key) values(p_branch,item.value->>'key') on conflict do nothing;
      if found then
        insert into public.notifications(id,branch_id,data)
        values((item.value->>'id')::uuid,p_branch,(item.value-'key')||jsonb_build_object('status','pending','attempts',0,'channel','mermas'));
      end if;
    end loop;
    update public.requests r set data=jsonb_set(jsonb_set(r.data,'{merma,state}','"lost"'),'{merma,history}',
      coalesce(r.data#>'{merma,history}','[]')||jsonb_build_array(jsonb_build_object('by','system','at',now(),'notes','Cerrada automáticamente por plazo vencido')))
      where branch_id=p_branch and data#>>'{merma,state}' in('open','partial') and not coalesce((data#>>'{merma,superseded}')::boolean,false)
        and (data->>'at')::timestamptz < now()-make_interval(days=>coalesce((select (data#>>'{v4,lossDays}')::integer from public.settings where branch_id=p_branch limit 1),30));
    delete from public.notifications n using private.notification_dispatch d where n.id=d.id and n.branch_id=p_branch and d.status='sent' and d.sent_at<now()-interval '90 days';
    delete from private.notification_dispatch d where not exists(select 1 from public.notifications n where n.id=d.id);
    update private.branch_runtime set revision=revision+1 where branch_id=p_branch;
    return '{}';
  elsif p_action='telegram_expired_photos' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id',u.attachment_id,'path',u.path)),'[]') from private.media_uploads u
      join public.attachments a on a.id=u.attachment_id and a.branch_id=p_branch
      where not exists(select 1 from public.expenses e where e.branch_id=p_branch and e.data->>'evidenceId'=u.attachment_id::text)
        and not exists(select 1 from public.shipments s where s.branch_id=p_branch and s.data->>'evidenceId'=u.attachment_id::text)
        and not exists(select 1 from public.transfers t where t.branch_id=p_branch and t.data->>'evidenceId'=u.attachment_id::text)
        and (
          exists(select 1 from public.requests r where r.branch_id=p_branch and r.data->>'type'='damage' and r.data->>'evidenceId'=u.attachment_id::text and (r.data->>'reviewedAt')::timestamptz<now()-interval '90 days')
          or exists(select 1 from public.receipts r cross join lateral jsonb_each(coalesce(r.data->'photos','{}')) ph
            where r.branch_id=p_branch and ph.value ? u.attachment_id::text and (r.data#>>array['reviewed',ph.key,'at'])::timestamptz<now()-interval '90 days')
        ));
  elsif p_action='telegram_photo_deleted' then
    delete from private.media_uploads where attachment_id=(p_payload->>'id')::uuid and attachment_id in(select id from public.attachments where branch_id=p_branch);
    update public.attachments set data=(data-'path')||jsonb_build_object('expiredAt',now(),'status','expired') where id=(p_payload->>'id')::uuid and branch_id=p_branch;
    return '{}';
  elsif p_action='telegram_resolutions' then
    with candidates as (
      select d.id, coalesce(n.data#>>'{resolved,eventId}','') as event_id from private.notification_dispatch d join public.notifications n on n.id=d.id
      where n.branch_id=p_branch and d.status='sent' and n.data?'resolved' and d.message_id is not null
        and (not d.resolution_updated or coalesce(d.resolution_event_id,'')<>coalesce(n.data#>>'{resolved,eventId}','')) and (d.resolution_attempts<5 or coalesce(d.resolution_event_id,'')<>coalesce(n.data#>>'{resolved,eventId}','')) and (d.lease_until is null or d.lease_until<now())
      limit 5 for update of d skip locked
    ), claimed as (
      update private.notification_dispatch d set lease_until=now()+interval '3 minutes',
        resolution_attempts=case when coalesce(d.resolution_event_id,'')<>c.event_id then 1 else d.resolution_attempts+1 end,
        resolution_updated=false,
        resolution_reply_id=case when coalesce(d.resolution_event_id,'')<>c.event_id then null else d.resolution_reply_id end,
        resolution_event_id=c.event_id
        from candidates c where d.id=c.id returning d.*
    ) select coalesce(jsonb_agg(n.data||jsonb_build_object('messageId',d.message_id,'chatId',d.chat_id,'replyId',case when coalesce(d.resolution_event_id,'')=coalesce(n.data#>>'{resolved,eventId}','') then d.resolution_reply_id else null end)),'[]') into result
      from claimed d join public.notifications n on n.id=d.id;
    return result;
  elsif p_action='telegram_resolution_finish' then
    update private.notification_dispatch d set resolution_updated=coalesce((p_payload->>'ok')::boolean,false),
      resolution_reply_id=coalesce((p_payload->>'replyId')::bigint,d.resolution_reply_id),
      resolution_event_id=case when (p_payload->>'ok')::boolean then p_payload->>'eventId' else d.resolution_event_id end,
      lease_until=case when (p_payload->>'ok')::boolean then null else now()+interval '5 minutes' end,
      last_error=p_payload->>'error'
      where d.id=(p_payload->>'id')::uuid and d.id in(select id from public.notifications where branch_id=p_branch);
    if found then update private.branch_runtime set revision=revision+1 where branch_id=p_branch; end if;
    return '{}';
  end if;
  return private.branch_security_before_v4(p_branch,p_action,p_payload);
end $$;
revoke all on function public.dexter_branch_security(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.dexter_branch_security(uuid,text,jsonb) to service_role;
revoke all on function private.branch_security_before_v4(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function private.branch_security_before_v4(uuid,text,jsonb) to service_role;
create table private.telegram_once(branch_id uuid not null,dedup_key text not null,primary key(branch_id,dedup_key));
revoke all on private.telegram_once from public,anon,authenticated;
grant all on private.telegram_once to service_role;

-- v4 campaigns are toggled directly by an online administrator; other changes keep their approvals.
do $migration$
declare definition text;
  prior_guard text := $guard$if operation in ('resolve_change','change_access','save_size','save_promotion','set_approval_requirement',
      'adjust_count_inventory','correct_inventory','initialize_stock') or closing_adjustment$guard$;
  next_guard text := $guard$if operation in ('resolve_change','change_access','save_size','set_approval_requirement',
      'adjust_count_inventory','correct_inventory','initialize_stock') or closing_adjustment
    or (operation='save_promotion' and not exists(select 1 from public.settings where branch_id=p_branch and data->>'v4Enabled'='true'))$guard$;
begin
  select replace(pg_get_functiondef('public.dexter_branch_commit(uuid,bigint,jsonb,jsonb,jsonb)'::regprocedure),chr(13),'') into definition;
  prior_guard := replace(prior_guard,chr(13),'');
  next_guard := replace(next_guard,chr(13),'');
  if strpos(definition,prior_guard)=0 then raise exception 'Expected campaign approval guard was not found'; end if;
  execute replace(definition,prior_guard,next_guard);
end $migration$;
