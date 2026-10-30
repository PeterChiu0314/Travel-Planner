-- B-5: dormant placeholder/readiness and conservative lifecycle operations.
begin;
alter table public.budget_items add column record_status text not null default 'complete' check(record_status in('incomplete','complete')),add column pricing_ready boolean not null default true,add column lifecycle_revision bigint not null default 0,add column completed_at timestamptz;
alter table public.actual_expenses add column record_status text not null default 'complete' check(record_status in('incomplete','complete')),add column pricing_ready boolean not null default true,add column lifecycle_revision bigint not null default 0,add column completed_at timestamptz;
alter table public.actual_expenses alter column paid_at drop not null;
alter table public.actual_expenses add constraint actual_complete_payment_time check(record_status='incomplete' or paid_at is not null);
alter table public.budget_items add constraint budget_readiness_consistent check((record_status='incomplete' or pricing_ready) and lifecycle_revision>=0);
alter table public.actual_expenses add constraint actual_readiness_consistent check((record_status='incomplete' or pricing_ready) and lifecycle_revision>=0);
alter table app_private.budget_metadata_groups drop constraint budget_metadata_groups_group_key_check;
alter table app_private.budget_metadata_groups add constraint budget_metadata_groups_group_key_check check(group_key in('title','note','category','payer','links','pricing','payment','source','receipts','lifecycle'));
alter table app_private.budget_metadata_groups add column lifecycle_bundle jsonb;
alter table app_private.budget_metadata_effects add column lifecycle_manifest jsonb;
insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) select 'budget',id,'lifecycle',trip_id from public.budget_items union all select 'actual',id,'lifecycle',trip_id from public.actual_expenses;
create table app_private.budget_lifecycle_protocol(singleton boolean primary key default true check(singleton),enabled boolean not null default false,activated boolean not null default false);
insert into app_private.budget_lifecycle_protocol values(true,false,false);
alter table app_private.budget_lifecycle_protocol enable row level security;
revoke all on app_private.budget_lifecycle_protocol from public,anon,authenticated;
create function app_private.budget_lifecycle_enabled() returns boolean language sql stable security definer set search_path='' as $$select app_private.budget_finance_enabled() and enabled from app_private.budget_lifecycle_protocol where singleton$$;
create function app_private.budget_lifecycle_activated() returns boolean language sql stable security definer set search_path='' as $$select activated from app_private.budget_lifecycle_protocol where singleton$$;
create function app_private.latch_budget_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$begin new.activated:=old.activated or new.enabled;return new;end $$;
create trigger lifecycle_latch before update on app_private.budget_lifecycle_protocol for each row execute function app_private.latch_budget_lifecycle();
create trigger lifecycle_signal after update on app_private.budget_lifecycle_protocol for each row execute function app_private.signal_budget_metadata_protocol();
create function app_private.budget_complete(k text,rid uuid) returns boolean language sql stable security definer set search_path='' as $$select coalesce(case when k='budget' then (select record_status='complete' from public.budget_items where id=rid) when k='actual' then (select record_status='complete' from public.actual_expenses where id=rid) end,false)$$;
create function app_private.budget_lifecycle_effect(k text,rid uuid,action text default null) returns jsonb language sql stable security definer set search_path='' as $$select lifecycle_manifest from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id is not distinct from auth.uid() and kind=k and resource_id=rid and lifecycle_manifest is not null and (action is null or lifecycle_manifest->>'action'=action)$$;
create function app_private.lifecycle_membership(trip uuid) returns void language plpgsql security definer set search_path='' as $$begin
 perform app_private.budget_finance_membership(trip);perform 1 from app_private.budget_lifecycle_protocol where singleton for share nowait;
 if not app_private.budget_lifecycle_enabled() then raise exception 'Lifecycle protocol disabled' using errcode='55000';end if;
end $$;
create function app_private.lifecycle_versions(k text,rid uuid) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('lifecycle',(app_private.budget_metadata_record(k,rid)->>'lifecycle_revision')::bigint,'groups',coalesce(jsonb_agg(jsonb_build_object('group',group_key,'revision',revision,'graph',graph_revision) order by group_key),'[]')) from app_private.budget_metadata_groups where kind=k and resource_id=rid$$;
create function app_private.lifecycle_delete_plan(trip uuid,k text,rid uuid) returns void language plpgsql security definer set search_path='' as $$
declare r jsonb:=app_private.budget_metadata_record(k,rid);
begin
 if r is null or r->>'trip_id'<>trip::text then raise exception 'Resource missing' using errcode='42501';end if;
 if exists(select 1 from pg_catalog.pg_constraint c where c.contype='f' and c.confrelid=case when k='budget' then 'public.budget_items'::regclass else 'public.actual_expenses'::regclass end and c.conrelid<>all(case when k='budget' then array['public.budget_item_participants'::regclass,'public.itinerary_budget_items'::regclass,'public.actual_expenses'::regclass,'public.accommodations'::regclass] else array['public.actual_expense_participants'::regclass,'public.budget_items'::regclass] end)) then raise exception 'Unknown FK lifecycle dependency' using errcode='0A000';end if;
 if k='budget' then
  if (r->>'is_fixed')::boolean or r->>'auto_created_actual_expense_id' is not null or exists(select 1 from public.actual_expenses where budget_item_id=rid or budget_origin_id=rid) or exists(select 1 from public.accommodations where budget_item_id=rid) then raise exception 'Budget history source or FK dependency: deletion unsupported' using errcode='0A000';end if;
 else
  if r->>'budget_item_id' is not null or r->>'budget_origin_id' is not null or jsonb_array_length(r->'payment_history')>0 or exists(select 1 from public.budget_items where auto_created_actual_expense_id=rid) or r->>'payment_origin' is distinct from 'manual' then raise exception 'Actual source/history deletion unsupported' using errcode='0A000';end if;
  if exists(select 1 from public.attachments where target_type='actual_expense' and target_id=rid) or exists(select 1 from app_private.budget_receipt_intents where actual_id=rid and status='pending') or exists(select 1 from app_private.budget_receipt_cleanup where actual_id=rid and status<>'done') then raise exception 'Receipt lifecycle prevents deletion' using errcode='0A000';end if;
 end if;
end $$;
create function app_private.lifecycle_admission(trip uuid,k text,rid uuid,sid uuid,token uuid,action text,base bigint,epoch bigint,versions jsonb,intent jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare root app_private.budget_metadata_groups;g app_private.budget_metadata_groups;bundle jsonb;epochs jsonb:='[]';op text:=intent->>'action';r jsonb;
begin
 if auth.uid() is null or sid is null or token is null or k is null or k not in('budget','actual') or action is null or action not in('acquire','release','renew') then raise exception 'Invalid lifecycle admission' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(trip::text,0));select * into root from app_private.budget_metadata_groups where kind=k and resource_id=rid and group_key='lifecycle' and trip_id=trip for update;
 if action='release' then
  if root.user_id=auth.uid() and root.session_id=sid and root.token_hash=sha256(convert_to(token::text,'UTF8')) and root.lease_epoch=epoch then update app_private.budget_metadata_groups set user_id=null,session_id=null,token_hash=null,expires_at=null,lifecycle_bundle=null where kind=k and resource_id=rid and lifecycle_bundle=root.lifecycle_bundle and user_id=auth.uid() and session_id=sid and token_hash=root.token_hash;end if;
  return jsonb_build_object('granted',true);
 end if;
 perform app_private.lifecycle_membership(trip);perform app_private.lock_budget_field_parents(trip,jsonb_build_array(jsonb_build_object('kind',k,'id',rid)));r:=app_private.budget_metadata_record(k,rid);
 if op is null or op not in('delete','set_paid_at') or op='set_paid_at' and k<>'actual' then raise exception 'Invalid lifecycle intent' using errcode='22023';end if;
 if root.is_deleted or root.resource_id is null or base is distinct from (r->>'lifecycle_revision')::bigint or versions is distinct from app_private.lifecycle_versions(k,rid) then raise exception 'Lifecycle version changed' using errcode='40001';end if;
 if op='delete' then perform app_private.lifecycle_delete_plan(trip,k,rid);end if;
 if action='renew' and (root.user_id is distinct from auth.uid() or root.session_id is distinct from sid or root.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or root.lease_epoch is distinct from epoch or root.expires_at is null or root.expires_at<=clock_timestamp()) then return jsonb_build_object('granted',false);end if;
 for g in select * from app_private.budget_metadata_groups where kind=k and resource_id=rid and (op='delete' or group_key in('lifecycle','payment')) order by group_key for update loop
  if g.user_id is not null and g.expires_at>clock_timestamp() and (g.user_id is distinct from auth.uid() or g.session_id is distinct from sid or g.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or g.lifecycle_bundle->>'action' is distinct from op) then return jsonb_build_object('granted',false,'reason','group_locked');end if;
  if g.user_id is null or g.expires_at is null or g.expires_at<=clock_timestamp() then g.lease_epoch:=g.lease_epoch+1;end if;
  epochs:=epochs||jsonb_build_array(jsonb_build_object('group',g.group_key,'epoch',g.lease_epoch));
 end loop;
 bundle:=jsonb_build_object('action',op,'versions',versions,'epochs',epochs);
 update app_private.budget_metadata_groups s set user_id=auth.uid(),session_id=sid,token_hash=sha256(convert_to(token::text,'UTF8')),expires_at=clock_timestamp()+interval '7 minutes',lifecycle_bundle=bundle,lease_epoch=(x->>'epoch')::bigint from jsonb_array_elements(epochs) x where s.kind=k and s.resource_id=rid and s.group_key=x->>'group';
 return jsonb_build_object('granted',true,'epoch',(select x->'epoch' from jsonb_array_elements(epochs) x where x->>'group'='lifecycle'),'revision',base,'targets',epochs,'value',jsonb_build_object('exists',true,'versions',versions));
end $$;
create function public.budget_lifecycle_lease(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_revision bigint,p_epoch bigint,p_versions jsonb,p_intent jsonb) returns jsonb language sql security invoker set search_path='' as $$select app_private.lifecycle_admission(p_trip_id,p_kind,p_id,p_session_id,p_token,p_action,p_base_revision,p_epoch,p_versions,p_intent)$$;

-- Bind every persisted column, including timestamps: clients may call invoker prerequisites
-- directly, but cannot substitute a legacy form, payment history, or arbitrary defaults.
create function app_private.lifecycle_placeholder_row(trip uuid,k text,rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',rid,'trip_id',trip,'title','','note',null,'category','其他','subcategory',null,'amount',0,'twd_amount',0,'currency','TWD','exchange_rate',1,'payer_id',null,'pricing_mode','split_total','unit_amount',null,'split_type','equal','record_status','incomplete','pricing_ready',false,'lifecycle_revision',0,'completed_at',null,'locked_by',null,'locked_at',null,'created_at',transaction_timestamp(),'updated_at',transaction_timestamp())
 ||case when k='budget' then jsonb_build_object('is_fixed',false,'auto_created_actual_expense_id',null) else jsonb_build_object('budget_item_id',null,'budget_origin_id',null,'paid_at',null,'payment_active',false,'payment_origin','manual','payment_history','[]'::jsonb,'twd_amount_source','estimated','actual_twd_amount',null) end
$$;
create function app_private.prepare_budget_lifecycle(trip uuid,k text,rid uuid,sid uuid,token uuid,epoch bigint,base bigint,value jsonb,request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text:=value->>'action';signature jsonb;cached app_private.budget_metadata_requests;r jsonb;g app_private.budget_metadata_groups;root app_private.budget_metadata_groups;stamp timestamptz;new_id uuid;manifest jsonb;
begin
 if auth.uid() is null or not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if sid is null or request is null or k is null or op is null or op not in('create_budget','create_actual','delete','set_paid_at') or jsonb_typeof(value) is distinct from 'object' or value-array['action','paid_at','versions']<>'{}'::jsonb then raise exception 'Invalid lifecycle request' using errcode='22023';end if;
 if op like 'create_%' and (k<>'trip' or rid is distinct from trip) or op not like 'create_%' and k not in('budget','actual') then raise exception 'Invalid lifecycle target' using errcode='22023';end if;
 signature:=jsonb_build_object('protocol','budget-lifecycle','trip',trip,'kind',k,'id',rid,'session',sid,'base',base,'value',value);
 perform pg_advisory_xact_lock(hashtextextended(trip::text,0));if not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into cached from app_private.budget_metadata_requests where user_id=auth.uid() and request_id=request;
 if found then if cached.signature is distinct from signature or cached.trip_id<>trip or cached.session_id<>sid then raise exception 'request_mismatch' using errcode='22023';end if;return jsonb_build_object('replayed',true,'result',cached.result);end if;
 perform app_private.lifecycle_membership(trip);
 if op like 'create_%' then
  k:=case when op='create_budget' then 'budget' else 'actual' end;new_id:=gen_random_uuid();
  if exists(select 1 from app_private.budget_metadata_groups where kind=k and resource_id=new_id) then raise exception 'Identity already used' using errcode='40001';end if;
  manifest:=jsonb_build_object('action','create','kind',k,'id',new_id,'after',app_private.lifecycle_placeholder_row(trip,k,new_id));
 else
  perform app_private.lock_budget_field_parents(trip,jsonb_build_array(jsonb_build_object('kind',k,'id',rid)));r:=app_private.budget_metadata_record(k,rid);
  if value->'versions' is distinct from app_private.lifecycle_versions(k,rid) or base is distinct from (r->>'lifecycle_revision')::bigint then raise exception 'Lifecycle version changed' using errcode='40001';end if;
  select * into root from app_private.budget_metadata_groups where kind=k and resource_id=rid and group_key='lifecycle' for update;
  if root.user_id is distinct from auth.uid() or root.session_id is distinct from sid or token is null or root.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or root.lease_epoch is distinct from epoch or root.expires_at is null or root.expires_at<=clock_timestamp() or root.lifecycle_bundle->>'action' is distinct from op then raise exception 'Lifecycle lease lost' using errcode='55P03';end if;
  for g in select * from app_private.budget_metadata_groups where kind=k and resource_id=rid and (op='delete' or group_key in('lifecycle','payment')) order by group_key for update loop
   if g.user_id is distinct from auth.uid() or g.session_id is distinct from sid or g.token_hash is distinct from root.token_hash or g.expires_at is null or g.expires_at<=clock_timestamp() or g.lifecycle_bundle is distinct from root.lifecycle_bundle or not exists(select 1 from jsonb_array_elements(root.lifecycle_bundle->'epochs') x where x->>'group'=g.group_key and (x->>'epoch')::bigint=g.lease_epoch) then raise exception 'Incomplete lifecycle bundle' using errcode='55P03';end if;
  end loop;
  if op='delete' then
   perform app_private.lifecycle_delete_plan(trip,k,rid);
   if k='budget' then perform 1 from public.budget_item_participants where budget_item_id=rid order by user_id for update nowait;perform 1 from public.itinerary_budget_items where budget_item_id=rid order by id for update nowait;
   else perform 1 from public.actual_expense_participants where actual_expense_id=rid order by user_id for update nowait;end if;
  else
   if k<>'actual' or value->>'paid_at' is null or (value->>'paid_at')::timestamptz is null or not isfinite((value->>'paid_at')::timestamptz) then raise exception 'Payment time required' using errcode='22023';end if;
   if r->>'record_status'='complete' then raise exception 'Use Payment protocol for complete Actual' using errcode='55000';end if;
  end if;
  new_id:=rid;manifest:=jsonb_build_object('action',op,'kind',k,'id',rid,'before',r,'paid_at',value->'paid_at');
 end if;
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,lifecycle_manifest) values(txid_current(),pg_backend_pid(),auth.uid(),trip,k,new_id,'lifecycle',sid,request,coalesce(base,0),coalesce(epoch,0),value,signature,manifest);
 return jsonb_build_object('replayed',false,'kind',k,'id',new_id,'action',op,'paid_at',value->'paid_at');
end $$;
create function app_private.finish_budget_lifecycle() returns jsonb language plpgsql security definer set search_path='' as $$
declare e app_private.budget_metadata_effects;r jsonb;result jsonb;op text;
begin
 select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='lifecycle';if not found or not app_private.can_edit_trip(e.trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 op:=e.value->>'action';r:=app_private.budget_metadata_record(e.kind,e.resource_id);
 if op='delete' then
  if r is not null then raise exception 'Delete incomplete' using errcode='40001';end if;
  update app_private.budget_metadata_groups set is_deleted=true,revision=revision+1,lease_epoch=lease_epoch+1,user_id=null,session_id=null,token_hash=null,expires_at=null,lifecycle_bundle=null where kind=e.kind and resource_id=e.resource_id;
  delete from app_private.budget_metadata_undo_lineage where kind=e.kind and resource_id=e.resource_id;
  delete from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id;
 else
  if r is null or (op like 'create_%' and (r->>'record_status'<>'incomplete' or r->>'title'<>'' or (r->>'pricing_ready')::boolean or exists(select 1 from public.budget_item_participants where budget_item_id=e.resource_id) or exists(select 1 from public.actual_expense_participants where actual_expense_id=e.resource_id))) or (op='set_paid_at' and (r->>'paid_at')::timestamptz is distinct from (e.value->>'paid_at')::timestamptz) then raise exception 'Lifecycle effect incomplete' using errcode='40001';end if;
  if op like 'create_%' then
   insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) select e.kind,e.resource_id,g,e.trip_id from unnest(case when e.kind='budget' then array['title','note','category','payer','links','pricing','payment','source','lifecycle'] else array['title','note','category','payer','pricing','payment','source','receipts','lifecycle'] end) g on conflict do nothing;
  end if;
 end if;
 result:=jsonb_build_object('kind',case when op like 'create_%' then 'trip' else e.kind end,'id',case when op like 'create_%' then e.trip_id else e.resource_id end,'group','lifecycle','revision',coalesce((r->>'lifecycle_revision')::bigint,e.base_revision),'request_id',e.request_id,'created_id',case when op like 'create_%' then e.resource_id end,'created_kind',e.kind,'value',jsonb_build_object('exists',op<>'delete','versions',case when op like 'create_%' then '{}'::jsonb else app_private.lifecycle_versions(e.kind,e.resource_id) end),'undo_supported',false,'create_fence',case when op like 'create_%' then app_private.lifecycle_versions(e.kind,e.resource_id) end);
 insert into app_private.budget_metadata_requests values(e.user_id,e.request_id,e.trip_id,e.session_id,e.signature,result);
 delete from app_private.budget_metadata_effects where transaction_id=e.transaction_id and backend_id=e.backend_id;return result;
end $$;
create function public.mutate_budget_lifecycle(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_epoch bigint,p_base_revision bigint,p_value jsonb,p_request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb;rid uuid;
begin
 a:=app_private.prepare_budget_lifecycle(p_trip_id,p_kind,p_id,p_session_id,p_token,p_epoch,p_base_revision,p_value,p_request_id);if (a->>'replayed')::boolean then return a->'result';end if;rid:=(a->>'id')::uuid;
 if a->>'action' like 'create_%' then
  if a->>'kind'='budget' then insert into public.budget_items(id,trip_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id,record_status,pricing_ready) values(rid,p_trip_id,'','其他',0,0,'TWD',1,null,'incomplete',false);
  else insert into public.actual_expenses(id,trip_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id,paid_at,payment_active,payment_origin,twd_amount_source,record_status,pricing_ready) values(rid,p_trip_id,'','其他',0,0,'TWD',1,null,null,false,'manual','estimated','incomplete',false);end if;
 elsif a->>'action'='delete' then
  if a->>'kind'='budget' then delete from public.itinerary_budget_items where budget_item_id=rid;delete from public.budget_item_participants where budget_item_id=rid;delete from public.budget_items where id=rid and trip_id=p_trip_id;
  else delete from public.actual_expense_participants where actual_expense_id=rid;delete from public.actual_expenses where id=rid and trip_id=p_trip_id;end if;
 else update public.actual_expenses set paid_at=(a->>'paid_at')::timestamptz where id=rid and trip_id=p_trip_id;end if;
 return app_private.finish_budget_lifecycle();
end $$;
create function public.create_budget_workspace_placeholder(p_trip_id uuid,p_kind text,p_session_id uuid,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select public.mutate_budget_lifecycle(p_trip_id,'trip',p_trip_id,p_session_id,null,null,0,jsonb_build_object('action',case when p_kind='budget' then 'create_budget' when p_kind='actual' then 'create_actual' end,'versions','{}'::jsonb),p_request_id)$$;

create function app_private.validate_lifecycle_row(k text,rid uuid,b jsonb,a jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare e jsonb:=app_private.budget_lifecycle_effect(k,rid);op text;
begin
 if e is null then return false;end if;op:=e->>'action';
 if op='create' then
  if b is not null or a is distinct from e->'after' then raise exception 'Invalid placeholder effect' using errcode='42501';end if;
 elsif op='delete' then if a is not null or b is distinct from e->'before' then raise exception 'Invalid delete effect' using errcode='42501';end if;
 elsif op='set_paid_at' then
  if k<>'actual' or b is distinct from e->'before' or (b-array['paid_at','updated_at']) is distinct from (a-array['paid_at','updated_at']) or (a->>'paid_at')::timestamptz is distinct from (e->>'paid_at')::timestamptz then raise exception 'Invalid payment time effect' using errcode='42501';end if;
  if b->'paid_at' is distinct from a->'paid_at' then update app_private.budget_metadata_groups set revision=revision+1 where kind=k and resource_id=rid and group_key='payment';end if;
 elsif op='readiness' then
  if b is distinct from e->'before' or (b-array['record_status','pricing_ready','lifecycle_revision','completed_at','payment_active','updated_at']) is distinct from (a-array['record_status','pricing_ready','lifecycle_revision','completed_at','payment_active','updated_at']) or not(a @> (e->'fields')) then raise exception 'Invalid readiness effect' using errcode='42501';end if;
 else raise exception 'Invalid lifecycle effect' using errcode='42501';end if;return true;
end $$;
create function app_private.guard_lifecycle_write() returns trigger language plpgsql security definer set search_path='' as $$
declare k text:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;b jsonb;a jsonb;r jsonb;privileged boolean:=auth.uid() is null and current_setting('role') in('none','postgres','service_role');
begin
 if tg_op<>'INSERT' then b:=to_jsonb(old);end if;if tg_op<>'DELETE' then a:=to_jsonb(new);end if;r:=coalesce(a,b);
 if app_private.budget_lifecycle_effect(k,(r->>'id')::uuid) is not null then return coalesce(new,old);end if;
 if privileged then return coalesce(new,old);end if;
 if tg_op='UPDATE' and (b->'record_status',b->'pricing_ready',b->'lifecycle_revision',b->'completed_at') is distinct from (a->'record_status',a->'pricing_ready',a->'lifecycle_revision',a->'completed_at') then raise exception 'Readiness is database maintained' using errcode='42501';end if;
 if tg_op='INSERT' and app_private.budget_payment_effect(k,(r->>'id')::uuid) is null and (a->>'record_status'<>'complete' or not(a->>'pricing_ready')::boolean or (a->>'lifecycle_revision')::bigint<>0 or a->>'completed_at' is not null) then raise exception 'Use Lifecycle placeholder creation' using errcode='55000';end if;
 if not app_private.budget_lifecycle_activated() then return coalesce(new,old);end if;
 if tg_op='DELETE' or tg_op='INSERT' and app_private.budget_payment_effect(k,(r->>'id')::uuid) is null then raise exception 'Use Lifecycle protocol' using errcode='55000';end if;
 if tg_op='UPDATE' and b->>'record_status'='incomplete' and app_private.budget_pricing_effect(k,(r->>'id')::uuid) is null and app_private.budget_field_effect(k,(r->>'id')::uuid) is null then raise exception 'Incomplete requires validated group operation' using errcode='55000';end if;
 return coalesce(new,old);
end $$;
create trigger aa_lifecycle_write before insert or update or delete on public.budget_items for each row execute function app_private.guard_lifecycle_write();
create trigger aa_lifecycle_write before insert or update or delete on public.actual_expenses for each row execute function app_private.guard_lifecycle_write();
create function app_private.track_lifecycle_identity() returns trigger language plpgsql security definer set search_path='' as $$
declare k text:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
begin
 if tg_op='INSERT' then insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) values(k,new.id,'lifecycle',new.trip_id) on conflict do nothing;
 elsif app_private.budget_lifecycle_effect(k,old.id,'delete') is null then update app_private.budget_metadata_groups set is_deleted=true,revision=revision+1,lease_epoch=lease_epoch+1,user_id=null,session_id=null,token_hash=null,expires_at=null where kind=k and resource_id=old.id and group_key='lifecycle';end if;return null;
end $$;
create trigger zzzz_lifecycle_identity after insert or delete on public.budget_items for each row execute function app_private.track_lifecycle_identity();
create trigger zzzz_lifecycle_identity after insert or delete on public.actual_expenses for each row execute function app_private.track_lifecycle_identity();
create function app_private.reconcile_budget_readiness(k text,rid uuid) returns void language plpgsql security definer set search_path='' as $$
declare r jsonb;people jsonb;shares jsonb;ready boolean;complete boolean;fields jsonb;source text;rid_trip uuid;
begin
 r:=app_private.budget_metadata_record(k,rid);if r is null or r->>'record_status'='complete' and r->>'completed_at' is null then return;end if;
 rid_trip:=(r->>'trip_id')::uuid;perform pg_advisory_xact_lock(hashtextextended(rid_trip::text,0));
 if exists(select 1 from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid()) then raise exception 'Unfinished group before readiness' using errcode='40001';end if;
 if k='budget' then select jsonb_agg(user_id order by user_id),jsonb_object_agg(user_id,share_amount) into people,shares from public.budget_item_participants where budget_item_id=rid;
 else select jsonb_agg(user_id order by user_id),jsonb_object_agg(user_id,share_amount) into people,shares from public.actual_expense_participants where actual_expense_id=rid;end if;
 ready:=((r->>'pricing_ready')::boolean or coalesce((select revision>0 from app_private.budget_metadata_groups where kind=k and resource_id=rid and group_key='pricing'),false)) and coalesce(jsonb_array_length(people)>0,false) and not exists(select 1 from jsonb_array_elements_text(people) u where not exists(select 1 from public.trip_members where trip_id=rid_trip and user_id=u::uuid and status='approved'));
 if ready then perform app_private.calculate_budget_group_pricing(r||jsonb_build_object('participantIds',people,'shares',coalesce(shares,'{}')));end if;
 complete:=ready and coalesce(btrim(r->>'title'),'')<>'' and (k='budget' or r->>'paid_at' is not null);
 if r->>'record_status'='complete' then if not complete then raise exception 'Complete record cannot become invalid' using errcode='22023';end if;return;end if;
 if (r->>'pricing_ready')::boolean=ready and not complete then return;end if;
 fields:=jsonb_build_object('pricing_ready',ready,'record_status',case when complete then 'complete' else 'incomplete' end,'lifecycle_revision',(r->>'lifecycle_revision')::bigint+1,'completed_at',case when complete then to_jsonb(clock_timestamp()) else r->'completed_at' end);
 if k='actual' then fields:=fields||jsonb_build_object('payment_active',complete);end if;
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,lifecycle_manifest) values(txid_current(),pg_backend_pid(),auth.uid(),rid_trip,k,rid,'lifecycle',gen_random_uuid(),gen_random_uuid(),0,0,'{}','{}',jsonb_build_object('action','readiness','before',r,'fields',fields));
 if k='budget' then update public.budget_items set pricing_ready=ready,record_status=fields->>'record_status',lifecycle_revision=(fields->>'lifecycle_revision')::bigint,completed_at=(fields->>'completed_at')::timestamptz where id=rid;
 else update public.actual_expenses set pricing_ready=ready,record_status=fields->>'record_status',lifecycle_revision=(fields->>'lifecycle_revision')::bigint,completed_at=(fields->>'completed_at')::timestamptz,payment_active=complete where id=rid;end if;
 update app_private.budget_metadata_groups set revision=revision+1 where kind=k and resource_id=rid and group_key='lifecycle';
 delete from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid();
end $$;
create function app_private.budget_readiness_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;k text;rid uuid;
begin
 if tg_table_name in('budget_items','actual_expenses') then k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;rid:=(r->>'id')::uuid;
 else k:=case when tg_table_name='budget_item_participants' then 'budget' else 'actual' end;rid:=(r->>case when k='budget' then 'budget_item_id' else 'actual_expense_id' end)::uuid;end if;
 perform app_private.reconcile_budget_readiness(k,rid);return null;
end $$;
create constraint trigger zzz_readiness after insert or update on public.budget_items deferrable initially deferred for each row execute function app_private.budget_readiness_changed();
create constraint trigger zzz_readiness after insert or update on public.actual_expenses deferrable initially deferred for each row execute function app_private.budget_readiness_changed();
create constraint trigger zzz_readiness after insert or update or delete on public.budget_item_participants deferrable initially deferred for each row execute function app_private.budget_readiness_changed();
create constraint trigger zzz_readiness after insert or update or delete on public.actual_expense_participants deferrable initially deferred for each row execute function app_private.budget_readiness_changed();
create function app_private.guard_incomplete_child() returns trigger language plpgsql security definer set search_path='' as $$
declare k text:=case when tg_table_name='actual_expense_participants' then 'actual' else 'budget' end;r jsonb:=coalesce(to_jsonb(new),to_jsonb(old));rid uuid;
begin
 rid:=(r->>case when k='budget' then 'budget_item_id' else 'actual_expense_id' end)::uuid;
 if not app_private.budget_complete(k,rid) and app_private.budget_pricing_effect(k,rid) is null and app_private.budget_lifecycle_effect(k,rid,'delete') is null then raise exception 'Incomplete participants require validated Pricing' using errcode='55000';end if;
 return coalesce(new,old);
end $$;
create trigger aa_incomplete_child before insert or update or delete on public.budget_item_participants for each row execute function app_private.guard_incomplete_child();
create trigger aa_incomplete_child before insert or update or delete on public.actual_expense_participants for each row execute function app_private.guard_incomplete_child();
-- Existing definitions are integrated below; never edit old migrations.
create or replace function app_private.guard_budget_metadata_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_data jsonb; after_data jsonb; data jsonb; k text; active boolean; g text; independent_text boolean:=false;
  price jsonb; effect app_private.budget_metadata_effects; held app_private.budget_metadata_groups;
begin
  if tg_op<>'INSERT' then before_data:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_data:=to_jsonb(new); end if;
  data:=coalesce(after_data,before_data); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  if app_private.validate_lifecycle_row(k,(data->>'id')::uuid,before_data,after_data) then return null;end if;
  if app_private.validate_budget_field_parent(k,(data->>'id')::uuid,before_data,after_data) then return null;end if;
  if app_private.validate_budget_source_parent(k,(data->>'id')::uuid,before_data,after_data) then return null;end if;
  if app_private.validate_budget_payment_parent(k,(data->>'id')::uuid,before_data,after_data) then
    if tg_op='INSERT' then
      insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id)
       select k,(data->>'id')::uuid,x,(data->>'trip_id')::uuid from unnest(case when k='budget' then array['title','note','category','payer','links','pricing','payment'] else array['title','note','category','payer','pricing','payment'] end) x on conflict do nothing;
    end if;return null;
  end if;
  price:=app_private.budget_pricing_effect(k,(data->>'id')::uuid);
  if price is not null then
    select * into held from app_private.budget_metadata_groups where kind=k and resource_id=(data->>'id')::uuid and group_key='pricing';
    if tg_op<>'UPDATE' or held.user_id is distinct from auth.uid() or held.expires_at is null or held.expires_at<=clock_timestamp() or held.lease_epoch<>(price->>'epoch')::bigint or held.revision<>(price->>'base')::bigint
     or not app_private.budget_metadata_enabled() or not app_private.can_edit_trip((data->>'trip_id')::uuid,auth.uid())
     or (before_data-(array['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type','updated_at']||case when price->'fields'?'twd_amount_source' then array['twd_amount_source','actual_twd_amount'] else '{}'::text[] end)) is distinct from (after_data-(array['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type','updated_at']||case when price->'fields'?'twd_amount_source' then array['twd_amount_source','actual_twd_amount'] else '{}'::text[] end))
     or not(after_data @> (price->'fields')) then raise exception 'invalid_pricing_effect' using errcode='55P03';end if;return null;
  end if;
  active:=app_private.budget_metadata_live(k,(data->>'id')::uuid);
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid()
    and user_id=auth.uid() and kind=k and resource_id=(data->>'id')::uuid;
  if found then
    select * into held from app_private.budget_metadata_groups where kind=k and resource_id=effect.resource_id and group_key=effect.group_key;
    if not app_private.budget_metadata_enabled() or tg_op<>'UPDATE' or effect.trip_id is distinct from (data->>'trip_id')::uuid
      or not app_private.can_edit_trip(effect.trip_id,auth.uid()) or held.lease_epoch<>effect.lease_epoch
      or held.user_id is distinct from auth.uid() or held.session_id is distinct from effect.session_id
      or held.expires_at is null or held.expires_at<=clock_timestamp() or held.revision<>effect.base_revision
      or not app_private.budget_text_supported(k,effect.resource_id,effect.group_key)
      or (before_data-(case when effect.group_key='payer' then 'payer_id' else effect.group_key end)-'updated_at') is distinct from (after_data-(case when effect.group_key='payer' then 'payer_id' else effect.group_key end)-'updated_at')
      or after_data->(case when effect.group_key='payer' then 'payer_id' else effect.group_key end) is distinct from effect.value then
      raise exception 'invalid_group_effect' using errcode='55P03'; end if;
    independent_text:=k='actual' and effect.group_key in('title','note') and app_private.budget_source_enabled();
  elsif active then raise exception 'group_locked' using errcode='55P03';
  end if;
  -- New Actual links must not bypass a budget's metadata wildcard exclusion.
  if k='actual' and not independent_text then
    if (before_data->>'budget_item_id' is not null and app_private.budget_metadata_live('budget',(before_data->>'budget_item_id')::uuid))
      or (after_data->>'budget_item_id' is not null and app_private.budget_metadata_live('budget',(after_data->>'budget_item_id')::uuid)) then
      raise exception 'group_locked' using errcode='55P03'; end if;
  end if;
  foreach g in array (case when k='budget' then array['title','note','category','payer','links','pricing','payment'] else array['title','note','category','payer','pricing','payment'] end) loop
    if tg_op='INSERT' then
      insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) values(k,(data->>'id')::uuid,g,(data->>'trip_id')::uuid)
        on conflict(kind,resource_id,group_key) do update set is_deleted=false,trip_id=excluded.trip_id,revision=app_private.budget_metadata_groups.revision+1,
          lease_epoch=app_private.budget_metadata_groups.lease_epoch+1,user_id=null,session_id=null,token_hash=null,expires_at=null;
    elsif tg_op='DELETE' then
      update app_private.budget_metadata_groups set revision=revision+1,lease_epoch=lease_epoch+1,is_deleted=true,
        user_id=null,session_id=null,token_hash=null,expires_at=null where kind=k and resource_id=(data->>'id')::uuid and group_key=g;
    elsif before_data->(case when g='payer' then 'payer_id' else g end) is distinct from after_data->(case when g='payer' then 'payer_id' else g end) or before_data->>'trip_id' is distinct from after_data->>'trip_id' then
      update app_private.budget_metadata_groups set revision=revision+1,trip_id=(data->>'trip_id')::uuid
        where kind=k and resource_id=(data->>'id')::uuid and group_key=g;
    end if;
  end loop;
  return null;
end $$;

create or replace function app_private.prepare_budget_pricing_patch(p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_base_revision bigint,p_session_id uuid,p_token uuid,p_epoch bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();g app_private.budget_metadata_groups;h app_private.budget_metadata_groups;targets jsonb;target jsonb;rec jsonb;calc jsonb;normalized jsonb;signature jsonb;cached app_private.budget_metadata_requests;manifest jsonb:='[]';fields jsonb;trip public.trips;rate numeric;debit numeric;changed boolean:=false;ids uuid[];expected jsonb;current_value jsonb;
begin
 if actor is null or p_group is distinct from 'pricing' or not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_trip_id is null or p_id is null or p_request_id is null or p_session_id is null or p_kind is null or p_kind not in('budget','actual') or p_base_revision is null or p_base_revision<0 or jsonb_typeof(p_patch) is distinct from 'object' or p_patch-'pricing'<>'{}' or jsonb_typeof(p_patch->'pricing') is distinct from 'object'
 or (p_patch->'pricing')-array['pricing_mode','amount','unit_amount','currency','exchange_rate','participantIds','shares','versions']<>'{}'::jsonb then raise exception 'Invalid pricing patch' using errcode='22023';end if;
 calc:=app_private.calculate_budget_group_pricing(p_patch->'pricing');normalized:=(calc-'twd_amount'-'split_type')||jsonb_build_object('versions',p_patch->'pricing'->'versions');
 signature:=jsonb_build_object('protocol','pricing-prototype','trip',p_trip_id,'kind',p_kind,'id',p_id,'base',p_base_revision,'value',normalized,'session',p_session_id);
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 if not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into cached from app_private.budget_metadata_requests where user_id=actor and request_id=p_request_id;
 if found then if cached.signature<>signature or cached.trip_id<>p_trip_id or cached.session_id<>p_session_id then raise exception 'request_mismatch' using errcode='22023';end if;return jsonb_build_object('replayed',true,'result',cached.result);end if;
 if not app_private.budget_metadata_enabled() then raise exception 'group_protocol_disabled' using errcode='55000';end if;
 select * into trip from public.trips where id=p_trip_id for share nowait;
 targets:=app_private.budget_pricing_targets(p_kind,p_id);if targets is null then raise exception 'pricing_dependency_not_supported' using errcode='0A000';end if;
 select * into g from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and group_key='pricing' and trip_id=p_trip_id for update;
 expected:=app_private.budget_pricing_versions(p_kind,p_id);
 if p_patch->'pricing'->'versions' is distinct from expected or g.pricing_bundle->'versions' is distinct from expected then raise exception 'dependency_changed' using errcode='40001';end if;
 if g.revision<>p_base_revision then raise exception 'group_conflict' using errcode='40001';end if;
 if g.pricing_bundle->>'kind' is distinct from p_kind or g.pricing_bundle->>'id' is distinct from p_id::text then raise exception 'Incomplete pricing bundle' using errcode='55P03';end if;
 select array_agg(v::uuid order by v::uuid) into ids from jsonb_array_elements_text(calc->'participantIds') v;
 perform 1 from public.trip_members where trip_id=p_trip_id and user_id=any(array_append(ids,actor)) and status='approved' order by user_id for share nowait;
 if exists(select 1 from unnest(array_append(ids,actor)) u where not exists(select 1 from public.trip_members where trip_id=p_trip_id and user_id=u and status='approved')) then raise exception 'Invalid participants or membership revoked' using errcode='42501';end if;
 -- Current shared rate only for unlinked planning budgets; retained history keeps its saved currency/rate.
 if p_kind='budget' then
  rec:=app_private.budget_metadata_record(p_kind,p_id);
  if jsonb_array_length(targets)=1 and calc->>'currency'<>'TWD' then
   rate:=(trip.budget_exchange_rates->'rates'->>(calc->>'currency'))::numeric;
   if rate is null or rate<>(calc->>'exchange_rate')::numeric then raise exception 'Trip exchange rate changed or unavailable' using errcode='40001';end if;
  elsif jsonb_array_length(targets)>1 and (calc->>'currency' is distinct from rec->>'currency' or (calc->>'exchange_rate')::numeric is distinct from (rec->>'exchange_rate')::numeric) then raise exception 'Retained currency/rate is historical' using errcode='0A000';end if;
 end if;
 for target in select x from jsonb_array_elements(targets) x order by x->>'kind',x->>'id' loop
  if target->>'kind'='budget' then select to_jsonb(b) into rec from public.budget_items b where id=(target->>'id')::uuid and trip_id=p_trip_id for update nowait;
   perform 1 from public.budget_item_participants where budget_item_id=(target->>'id')::uuid order by user_id for update nowait;
  else select to_jsonb(a) into rec from public.actual_expenses a where id=(target->>'id')::uuid and trip_id=p_trip_id for update nowait;
   perform 1 from public.actual_expense_participants where actual_expense_id=(target->>'id')::uuid order by user_id for update nowait;
  end if;
  if rec is null then raise exception 'Resource changed' using errcode='40001';end if;
  select * into h from app_private.budget_metadata_groups where kind=target->>'kind' and resource_id=(target->>'id')::uuid and group_key='pricing' for update;
  if h.user_id is distinct from actor or h.session_id is distinct from p_session_id or p_token is null or h.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) or h.expires_at is null or h.expires_at<=clock_timestamp() or h.pricing_bundle is distinct from g.pricing_bundle
   or not exists(select 1 from jsonb_array_elements(g.pricing_bundle->'epochs') e where e->>'kind'=h.kind and e->>'id'=h.resource_id::text and (e->>'epoch')::bigint=h.lease_epoch)
   or (target->>'kind'=p_kind and target->>'id'=p_id::text and h.lease_epoch is distinct from p_epoch) then raise exception 'lease_lost or incomplete_bundle' using errcode='55P03';end if;
  if exists(select 1 from app_private.budget_edit_leases where kind=h.kind and resource_id=h.resource_id and expires_at>clock_timestamp()) or (rec->>'locked_by' is not null and (rec->>'locked_at')::timestamptz>clock_timestamp()-interval '7 minutes') then raise exception 'legacy_locked' using errcode='55P03';end if;
  fields:=calc-array['participantIds','shares'];
  if h.kind='actual' and rec->>'record_status'<>'incomplete' and rec->>'twd_amount_source' in('actual','legacy') then
   debit:=(rec->>'actual_twd_amount')::numeric;
   if debit is null or debit<>round(debit) or debit>0 and (calc->>'amount')::numeric=0 then raise exception 'Unsupported known debit allocation' using errcode='0A000';end if;
   if (p_kind='budget' or calc->>'currency'='TWD') and debit<>(calc->>'twd_amount')::numeric then raise exception 'Known actual debit cannot be repriced' using errcode='0A000';end if;
   fields:=fields||jsonb_build_object('twd_amount',debit);
  end if;
  if h.kind='actual' and rec->>'record_status'='incomplete' then fields:=fields||jsonb_build_object('twd_amount_source',case when calc->>'currency'='TWD' then 'actual' else 'estimated' end,'actual_twd_amount',case when calc->>'currency'='TWD' then calc->'twd_amount' else 'null'::jsonb end);end if;
  current_value:=app_private.read_budget_pricing_value(h.kind,h.resource_id)-'versions';
  if current_value is distinct from normalized-'versions' then changed:=true;end if;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('kind',h.kind,'id',h.resource_id,'before',rec,'fields',fields,'inputs',normalized-'versions','base',h.revision,'epoch',h.lease_epoch));
 end loop;
 -- Re-resolve after parent locking; an administrator/raw writer cannot alter the graph during waiting.
 if expected is distinct from app_private.budget_pricing_versions(p_kind,p_id) or targets is distinct from app_private.budget_pricing_targets(p_kind,p_id) then raise exception 'dependency_changed' using errcode='40001';end if;
 select jsonb_agg(x||jsonb_build_object('changed',changed)) into manifest from jsonb_array_elements(manifest) x;
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,pricing_manifest)
 values(txid_current(),pg_backend_pid(),actor,p_trip_id,p_kind,p_id,'pricing',p_session_id,p_request_id,p_base_revision,p_epoch,normalized,signature,manifest);
 return jsonb_build_object('replayed',false,'noop',not changed,'targets',manifest);
end $$;

create or replace function public.patch_budget_pricing_group(p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_base_revision bigint,p_session_id uuid,p_token uuid,p_epoch bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare admission jsonb;t jsonb;v jsonb;rid uuid;
begin
 admission:=app_private.prepare_budget_pricing_patch(p_trip_id,p_kind,p_id,p_group,p_base_revision,p_session_id,p_token,p_epoch,p_patch,p_request_id);
 if (admission->>'replayed')::boolean then return admission->'result';end if;
 if not(admission->>'noop')::boolean then
  for t in select x from jsonb_array_elements(admission->'targets') x loop
   rid:=(t->>'id')::uuid;v:=t->'fields';
   if t->>'kind'='budget' then
    update public.budget_items b set amount=(v->>'amount')::numeric,unit_amount=(v->>'unit_amount')::numeric,currency=v->>'currency',exchange_rate=(v->>'exchange_rate')::numeric,twd_amount=(v->>'twd_amount')::numeric,pricing_mode=v->>'pricing_mode',split_type=v->>'split_type'
     where id=rid and trip_id=p_trip_id and not(to_jsonb(b) @> v);
    delete from public.budget_item_participants where budget_item_id=rid and not(user_id::text in(select jsonb_array_elements_text(t->'inputs'->'participantIds')));
    insert into public.budget_item_participants(budget_item_id,user_id,share_amount) select rid,u::uuid,case when t->'inputs'->>'pricing_mode'='custom' then (t->'inputs'->'shares'->>u)::numeric end from jsonb_array_elements_text(t->'inputs'->'participantIds') u
     on conflict(budget_item_id,user_id) do update set share_amount=excluded.share_amount where public.budget_item_participants.share_amount is distinct from excluded.share_amount;
   else
    update public.actual_expenses a set twd_amount_source=coalesce(v->>'twd_amount_source',a.twd_amount_source),actual_twd_amount=case when v?'actual_twd_amount' then (v->>'actual_twd_amount')::numeric else a.actual_twd_amount end,amount=(v->>'amount')::numeric,unit_amount=(v->>'unit_amount')::numeric,currency=v->>'currency',exchange_rate=(v->>'exchange_rate')::numeric,twd_amount=(v->>'twd_amount')::numeric,pricing_mode=v->>'pricing_mode',split_type=v->>'split_type'
     where id=rid and trip_id=p_trip_id and not(to_jsonb(a) @> v);
    delete from public.actual_expense_participants where actual_expense_id=rid and not(user_id::text in(select jsonb_array_elements_text(t->'inputs'->'participantIds')));
    insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) select rid,u::uuid,case when t->'inputs'->>'pricing_mode'='custom' then (t->'inputs'->'shares'->>u)::numeric end from jsonb_array_elements_text(t->'inputs'->'participantIds') u
     on conflict(actual_expense_id,user_id) do update set share_amount=excluded.share_amount where public.actual_expense_participants.share_amount is distinct from excluded.share_amount;
   end if;
  end loop;
 end if;
 return app_private.finish_budget_pricing_patch();
end $$;

create or replace function app_private.finish_budget_pricing_patch() returns jsonb
language plpgsql security definer set search_path='' as $$
declare e app_private.budget_metadata_effects;t jsonb;rec jsonb;changed boolean:=false;v jsonb;result jsonb;g app_private.budget_metadata_groups;bundle jsonb;
begin
 select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='pricing';
 if not found or not app_private.can_edit_trip(e.trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 for t in select x from jsonb_array_elements(e.pricing_manifest) x loop
  rec:=app_private.budget_metadata_record(t->>'kind',(t->>'id')::uuid);
  if rec is null or (rec-(array['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type','updated_at']||case when t->'fields'?'twd_amount_source' then array['twd_amount_source','actual_twd_amount'] else '{}'::text[] end)) is distinct from ((t->'before')-(array['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type','updated_at']||case when t->'fields'?'twd_amount_source' then array['twd_amount_source','actual_twd_amount'] else '{}'::text[] end))
   or not(rec @> (t->'fields')) or (app_private.read_budget_pricing_value(t->>'kind',(t->>'id')::uuid)-'versions') is distinct from t->'inputs' then raise exception 'Incomplete pricing effect' using errcode='40001';end if;
 end loop;
 -- No-op is determined against pre-write inputs, recorded by the invoker before DML.
 changed:=coalesce((e.pricing_manifest->0->>'changed')::boolean,false);
 if changed then
  for t in select x from jsonb_array_elements(e.pricing_manifest) x loop
   update app_private.budget_metadata_groups set revision=(t->>'base')::bigint+1 where kind=t->>'kind' and resource_id=(t->>'id')::uuid and group_key='pricing';
   delete from app_private.budget_metadata_undo_lineage where kind=t->>'kind' and resource_id=(t->>'id')::uuid;
  end loop;
  delete from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id;
 end if;
 select * into g from app_private.budget_metadata_groups where kind=e.kind and resource_id=e.resource_id and group_key='pricing';
 v:=app_private.read_budget_pricing_value(e.kind,e.resource_id);bundle:=jsonb_set(g.pricing_bundle,'{versions}',v->'versions');
 update app_private.budget_metadata_groups set dirty=false,pricing_bundle=bundle,expires_at=least(expires_at,last_activity_at+interval '2 minutes') where group_key='pricing' and trip_id=e.trip_id and pricing_bundle=g.pricing_bundle;
 result:=jsonb_build_object('id',e.resource_id,'kind',e.kind,'group','pricing','value',v,'revision',g.revision,'request_id',e.request_id,'undo_supported',false);
 insert into app_private.budget_metadata_requests(user_id,request_id,trip_id,session_id,signature,result) values(e.user_id,e.request_id,e.trip_id,e.session_id,e.signature,result);
 delete from app_private.budget_metadata_effects where transaction_id=e.transaction_id and backend_id=e.backend_id;return result;
end $$;

create or replace function app_private.keep_actual_twd_cost() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if app_private.budget_lifecycle_effect('actual',new.id) is not null then return new;end if;
  if app_private.budget_field_effect('actual',new.id) is not null then return new;end if;
  if app_private.budget_source_effect('actual',new.id) is not null then return new;end if;
  if app_private.budget_source_enabled() and exists(select 1 from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and kind='actual' and resource_id=new.id and group_key in('title','note')) then return new;end if;
  if app_private.budget_payment_effect('actual',new.id) is not null then return new;end if;
  if new.twd_amount_source = 'legacy' and new.actual_twd_amount is null then new.actual_twd_amount := new.twd_amount; end if;
  if new.twd_amount_source in ('actual','legacy') then
    if new.actual_twd_amount is null then raise exception 'Actual TWD amount required' using errcode = '22023'; end if;
    new.twd_amount := new.actual_twd_amount;
  else new.actual_twd_amount := null; end if;
  if tg_op = 'UPDATE' and app_private.budget_pricing_effect('actual',new.id) is null and (to_jsonb(new) - 'updated_at' - 'locked_at' - 'locked_by' - 'payment_origin')
    is distinct from (to_jsonb(old) - 'updated_at' - 'locked_at' - 'locked_by' - 'payment_origin') then new.payment_origin := 'manual'; end if;
  return new;
end $$;

create or replace function app_private.guard_budget_edit_lease() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_data jsonb; new_data jsonb; k text; ids uuid[]:='{}'; resource uuid;
  context_kind text:=current_setting('app.budget_edit_kind',true);
  context_id text:=current_setting('app.budget_edit_id',true);
  sid uuid:=nullif(current_setting('app.budget_edit_session',true),'')::uuid;
  token uuid:=nullif(current_setting('app.budget_edit_token',true),'')::uuid;
begin
 if tg_op='DELETE' and tg_table_name in('budget_item_participants','itinerary_budget_items','actual_expense_participants') and app_private.budget_lifecycle_effect(case when tg_table_name='actual_expense_participants' then 'actual' else 'budget' end,case when tg_table_name='actual_expense_participants' then (to_jsonb(old)->>'actual_expense_id')::uuid else (to_jsonb(old)->>'budget_item_id')::uuid end,'delete') is not null then return old;end if;
 if tg_table_name in('budget_items','actual_expenses') and app_private.budget_lifecycle_effect(case when tg_table_name='budget_items' then 'budget' else 'actual' end,(coalesce(to_jsonb(new),to_jsonb(old))->>'id')::uuid) is not null then return coalesce(new,old);end if;
  if tg_table_name='attachments' and app_private.receipt_effect() is not null then return coalesce(new,old);end if;
  if tg_op<>'INSERT' then old_data:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then new_data:=to_jsonb(new); end if;
  if tg_table_name in ('budget_items','actual_expenses') then
    k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
    ids:=array[coalesce(old_data->>'id',new_data->>'id')::uuid];
  elsif tg_table_name in ('budget_item_participants','itinerary_budget_items') then
    k:='budget'; ids:=array[(old_data->>'budget_item_id')::uuid,(new_data->>'budget_item_id')::uuid];
  elsif tg_table_name='actual_expense_participants' then
    k:='actual'; ids:=array[(old_data->>'actual_expense_id')::uuid,(new_data->>'actual_expense_id')::uuid];
  else
    k:='actual';
    if old_data->>'target_type'='actual_expense' then ids:=array_append(ids,(old_data->>'target_id')::uuid); end if;
    if new_data->>'target_type'='actual_expense' then ids:=array_append(ids,(new_data->>'target_id')::uuid); end if;
  end if;
  for resource in select distinct x from unnest(ids) x where x is not null order by x loop
    perform app_private.assert_budget_edit_lease(k,resource,false,
      case when context_kind=k and context_id=resource::text then sid else null end,
      case when context_kind=k and context_id=resource::text then token else null end);
  end loop;
  if tg_op='DELETE' then return old; end if; return new;
end $$;

create or replace function app_private.guard_budget_metadata_children() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; k text; ids uuid[]; resource uuid; price jsonb; effect app_private.budget_metadata_effects; held app_private.budget_metadata_groups;
begin
 if tg_op='DELETE' and tg_table_name in('budget_item_participants','itinerary_budget_items','actual_expense_participants') and app_private.budget_lifecycle_effect(case when tg_table_name='actual_expense_participants' then 'actual' else 'budget' end,case when tg_table_name='actual_expense_participants' then (to_jsonb(old)->>'actual_expense_id')::uuid else (to_jsonb(old)->>'budget_item_id')::uuid end,'delete') is not null then return old;end if;
 if tg_table_name in('budget_items','actual_expenses') and app_private.budget_lifecycle_effect(case when tg_table_name='budget_items' then 'budget' else 'actual' end,(coalesce(to_jsonb(new),to_jsonb(old))->>'id')::uuid) is not null then return coalesce(new,old);end if;
  if tg_table_name='attachments' and app_private.receipt_effect() is not null then return coalesce(new,old);end if;
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  if tg_table_name in ('budget_item_participants','itinerary_budget_items') then
    k:='budget'; ids:=array[(b->>'budget_item_id')::uuid,(a->>'budget_item_id')::uuid];
  elsif tg_table_name='actual_expense_participants' then
    k:='actual'; ids:=array[(b->>'actual_expense_id')::uuid,(a->>'actual_expense_id')::uuid];
  else
    k:='actual'; ids:='{}';
    if b->>'target_type'='actual_expense' then ids:=array_append(ids,(b->>'target_id')::uuid); end if;
    if a->>'target_type'='actual_expense' then ids:=array_append(ids,(a->>'target_id')::uuid); end if;
  end if;
  for resource in select distinct x from unnest(ids) x where x is not null order by x loop
    if tg_table_name='actual_expense_participants' and app_private.budget_source_effect(k,resource) is not null then
      if tg_op='DELETE' then
        if exists(select 1 from jsonb_array_elements(app_private.budget_source_effect(k,resource)->'people_rows') x where x->>'user_id'=b->>'user_id') then raise exception 'invalid_source_participant_delete' using errcode='55P03';end if;
      elsif not exists(select 1 from jsonb_array_elements(app_private.budget_source_effect(k,resource)->'people_rows') x where x=a) then raise exception 'invalid_source_participant_effect' using errcode='55P03';end if;
      continue;
    end if;
    if tg_table_name='actual_expense_participants' and app_private.budget_payment_effect(k,resource) is not null then
      if tg_op<>'INSERT' or not app_private.budget_payment_enabled() or not exists(select 1 from app_private.budget_metadata_effects e cross join lateral jsonb_array_elements(e.payment_manifest->'people') p
       where e.transaction_id=txid_current() and e.backend_id=pg_backend_pid() and e.user_id=auth.uid() and e.group_key='payment' and p=a)
       then raise exception 'invalid_payment_participant_effect' using errcode='55P03';end if;
      continue;
    end if;
    if tg_table_name in ('budget_item_participants','actual_expense_participants') then
      price:=app_private.budget_pricing_effect(k,resource);
      if price is not null then
        select * into held from app_private.budget_metadata_groups where kind=k and resource_id=resource and group_key='pricing';
        if held.user_id is distinct from auth.uid() or held.expires_at is null or held.expires_at<=clock_timestamp() or held.lease_epoch<>(price->>'epoch')::bigint or held.revision<>(price->>'base')::bigint
          or not app_private.can_edit_trip(held.trip_id,auth.uid()) or not app_private.budget_metadata_enabled()
          or (tg_op='UPDATE' and (b->'user_id',b->'budget_item_id',b->'actual_expense_id') is distinct from (a->'user_id',a->'budget_item_id',a->'actual_expense_id'))
          or (tg_op='DELETE' and (price->'inputs'->'participantIds') ? (b->>'user_id'))
          or (tg_op<>'DELETE' and (not((price->'inputs'->'participantIds') ? (a->>'user_id')) or (a->'share_amount') is distinct from case when price->'inputs'->>'pricing_mode'='custom' then price->'inputs'->'shares'->(a->>'user_id') else 'null'::jsonb end)) then raise exception 'invalid_pricing_participant_effect' using errcode='55P03';end if;
        continue;
      end if;
    end if;
    if tg_table_name='itinerary_budget_items' then
      select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and kind=k and resource_id=resource and group_key='links';
      if found then
        select * into held from app_private.budget_metadata_groups where kind=k and resource_id=resource and group_key='links';
        if tg_op='UPDATE' or not app_private.budget_metadata_enabled() or not app_private.can_edit_trip(effect.trip_id,auth.uid()) or not app_private.budget_metadata_supported(k,resource)
          or held.user_id is distinct from auth.uid() or held.session_id is distinct from effect.session_id or held.lease_epoch<>effect.lease_epoch or held.expires_at<=clock_timestamp()
          or held.revision not in(effect.base_revision,effect.base_revision+1)
          or (tg_op='INSERT' and not(effect.value ? (a->>'itinerary_item_id')))
          or (tg_op='DELETE' and effect.value ? (b->>'itinerary_item_id')) then raise exception 'invalid_link_effect' using errcode='55P03';end if;
        continue;
      end if;
    end if;
    if app_private.budget_metadata_live(k,resource) then raise exception 'group_locked' using errcode='55P03'; end if;
  end loop;
  if tg_op='DELETE' then return old; end if; return new;
end $$;

create or replace function app_private.capture_budget_metadata_undo_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; rec jsonb; k text; linked uuid; effect app_private.budget_metadata_effects;
begin
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  rec:=coalesce(a,b); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  if app_private.budget_lifecycle_effect(k,(rec->>'id')::uuid) is not null then return null;end if;
  if app_private.budget_field_effect(k,(rec->>'id')::uuid) is not null and exists(select 1 from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and jsonb_array_length(metadata_manifest)>1) then return null;end if;
  if app_private.budget_source_effect(k,(rec->>'id')::uuid) is not null then return null;end if;
  if app_private.budget_payment_effect(k,(rec->>'id')::uuid) is not null then return null;end if;
  if app_private.budget_pricing_effect(k,(rec->>'id')::uuid) is not null then return null;end if;
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current()
    and backend_id=pg_backend_pid() and user_id=auth.uid() and kind=k and resource_id=(rec->>'id')::uuid;
  if found and effect.group_key in ('category','payer','links') then return null; end if;
  if found and tg_op='UPDATE' then
    if app_private.budget_metadata_undo_enabled() and b->effect.group_key is distinct from a->effect.group_key then
      update app_private.budget_metadata_effects set undo_before_value=b->effect.group_key
        where transaction_id=effect.transaction_id and backend_id=effect.backend_id;
    end if;
  elsif tg_op<>'UPDATE' or (b-'updated_at'-'locked_by'-'locked_at') is distinct from (a-'updated_at'-'locked_by'-'locked_at') then
    -- Legacy operations carry no trustworthy origin-tab ID: conservatively
    -- clear this actor's trip stacks, and fence this record for every actor.
    perform app_private.invalidate_budget_metadata_undo((rec->>'trip_id')::uuid,k,(rec->>'id')::uuid);
    if b->>'trip_id' is distinct from a->>'trip_id' and b is not null then
      perform app_private.invalidate_budget_metadata_undo((b->>'trip_id')::uuid,k,(b->>'id')::uuid);
    end if;
    if k='actual' then
      for linked in select distinct x from unnest(array[(b->>'budget_item_id')::uuid,(a->>'budget_item_id')::uuid,
        (b->>'budget_origin_id')::uuid,(a->>'budget_origin_id')::uuid]) x where x is not null order by x loop
        perform app_private.invalidate_budget_metadata_undo((rec->>'trip_id')::uuid,'budget',linked);
        if b->>'trip_id' is distinct from a->>'trip_id' and b is not null then
          perform app_private.invalidate_budget_metadata_undo((b->>'trip_id')::uuid,'budget',linked);
        end if;
      end loop;
    end if;
  end if;
  return null;
end $$;

create or replace function app_private.record_budget_metadata_undo() returns trigger
language plpgsql security definer set search_path='' as $$
declare effect app_private.budget_metadata_effects; intent app_private.budget_metadata_undo_intents;
  op app_private.budget_metadata_undo_operations; lineage app_private.budget_metadata_undo_lineage;
  expected bigint; previous uuid; changed boolean; result jsonb;
begin
 if exists(select 1 from app_private.budget_metadata_effects e where e.transaction_id=txid_current() and e.backend_id=pg_backend_pid() and e.user_id=auth.uid() and (e.lifecycle_manifest is not null or exists(select 1 from jsonb_array_elements(e.metadata_manifest) x where x->'before'->>'record_status'='incomplete'))) then return new;end if;
  if exists(select 1 from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and (group_key='rates' or jsonb_array_length(metadata_manifest)>1)) then return new;end if;
  if not app_private.budget_metadata_undo_enabled() then return new; end if;
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current()
    and backend_id=pg_backend_pid() and user_id=new.user_id and request_id=new.request_id;
  if not found or effect.user_id is distinct from auth.uid() or effect.trip_id<>new.trip_id
    or effect.session_id<>new.session_id then raise exception 'invalid_undo_capture' using errcode='42501'; end if;
  if effect.group_key in ('category','payer','links','pricing','payment','source','receipts') then return new;end if;
  changed:=(new.result->>'revision')::bigint=effect.base_revision+1;
  select * into intent from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid();
  if found then
    select * into op from app_private.budget_metadata_undo_operations where user_id=intent.user_id and operation_id=intent.operation_id;
    select expected_revision into expected from app_private.budget_metadata_undo_stack where user_id=intent.user_id
      and session_id=intent.session_id and trip_id=intent.trip_id and operation_id=intent.operation_id;
    if not changed or intent.request_id<>new.request_id or intent.user_id<>new.user_id or intent.trip_id<>new.trip_id
      or intent.session_id<>new.session_id or op.kind<>effect.kind or op.resource_id<>effect.resource_id
      or op.group_key<>effect.group_key or expected is distinct from effect.base_revision
      or effect.undo_before_value is distinct from op.after_value or effect.value is distinct from op.before_value then
      raise exception 'invalid_undo_effect' using errcode='40001'; end if;
    if exists(select 1 from app_private.budget_metadata_undo_stack s join app_private.budget_metadata_undo_operations prior
      on prior.user_id=s.user_id and prior.operation_id=s.operation_id
      where s.user_id=op.user_id and s.session_id=op.session_id and s.trip_id=op.trip_id and s.operation_id=op.predecessor
        and (s.expected_revision<>op.before_revision or prior.after_value is distinct from op.before_value
          or prior.kind<>op.kind or prior.resource_id<>op.resource_id or prior.group_key<>op.group_key)) then
      raise exception 'undo_predecessor_conflict' using errcode='40001'; end if;
    delete from app_private.budget_metadata_undo_stack where user_id=intent.user_id and session_id=intent.session_id
      and trip_id=intent.trip_id and operation_id=intent.operation_id;
    -- Advance only the proven predecessor of this exact group. Interleaved
    -- unrelated groups keep their expected revisions and normal stack order.
    update app_private.budget_metadata_undo_stack set expected_revision=(new.result->>'revision')::bigint
      where user_id=op.user_id and session_id=op.session_id and trip_id=op.trip_id
        and operation_id=op.predecessor and expected_revision=op.before_revision;
    update app_private.budget_metadata_undo_lineage set operation_id=op.predecessor,revision=(new.result->>'revision')::bigint
      where kind=op.kind and resource_id=op.resource_id and group_key=op.group_key;
    result:=new.result||jsonb_build_object('undo_of',op.operation_id);
    insert into app_private.budget_metadata_undo_receipts values(new.user_id,new.request_id,new.trip_id,new.session_id,op.operation_id,result);
    delete from app_private.budget_metadata_undo_intents where transaction_id=intent.transaction_id and backend_id=intent.backend_id;
  elsif changed then
    if effect.undo_before_value is null then raise exception 'missing_undo_before_image' using errcode='40001'; end if;
    -- The existing patch RPC canonicalizes text. An old noncanonical image
    -- cannot be restored byte-for-byte through it, so keep it out of Undo.
    if effect.group_key='title' and coalesce(btrim(effect.undo_before_value#>>'{}'),'')=''
      or effect.undo_before_value is distinct from (case when effect.group_key='title'
      then to_jsonb(btrim(effect.undo_before_value#>>'{}'))
      else coalesce(to_jsonb(nullif(btrim(effect.undo_before_value#>>'{}'),'')),'null'::jsonb) end) then
      perform app_private.invalidate_budget_metadata_undo(effect.trip_id,effect.kind,effect.resource_id);
      return new;
    end if;
    select * into lineage from app_private.budget_metadata_undo_lineage where kind=effect.kind
      and resource_id=effect.resource_id and group_key=effect.group_key;
    if found and lineage.user_id=effect.user_id and lineage.session_id=effect.session_id and lineage.revision=effect.base_revision then
      previous:=lineage.operation_id;
    end if;
    insert into app_private.budget_metadata_undo_operations values(effect.user_id,effect.request_id,effect.trip_id,effect.session_id,
      effect.kind,effect.resource_id,effect.group_key,effect.undo_before_value,effect.value,effect.base_revision,
      (new.result->>'revision')::bigint,previous);
    insert into app_private.budget_metadata_undo_stack(user_id,session_id,trip_id,operation_id,expected_revision)
      values(effect.user_id,effect.session_id,effect.trip_id,effect.request_id,(new.result->>'revision')::bigint);
    delete from app_private.budget_metadata_undo_stack where position in (
      select position from app_private.budget_metadata_undo_stack where user_id=effect.user_id and session_id=effect.session_id
        and trip_id=effect.trip_id order by position desc offset 5);
    insert into app_private.budget_metadata_undo_lineage values(effect.kind,effect.resource_id,effect.group_key,effect.trip_id,
      effect.user_id,effect.session_id,effect.request_id,(new.result->>'revision')::bigint)
      on conflict(kind,resource_id,group_key) do update set trip_id=excluded.trip_id,user_id=excluded.user_id,
        session_id=excluded.session_id,operation_id=excluded.operation_id,revision=excluded.revision;
  end if;
  return new;
end $$;

create or replace function app_private.guard_budget_metadata_undo_boundary() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; rec jsonb; k text; ids uuid[]; resource uuid; trip uuid;
begin
 if exists(select 1 from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and lifecycle_manifest is not null) then return null;end if;
  if exists(select 1 from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='rates') then return null;end if;
  if app_private.receipt_effect() is not null then return null;end if;
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  if tg_op='UPDATE' and b is not distinct from a then return null; end if;
  if tg_table_name='itinerary_budget_items' and exists(select 1 from app_private.budget_metadata_effects e where e.transaction_id=txid_current() and e.backend_id=pg_backend_pid() and e.user_id=auth.uid() and e.kind='budget' and e.group_key='links'
    and e.resource_id=coalesce((a->>'budget_item_id')::uuid,(b->>'budget_item_id')::uuid)) then return null;end if;
  if tg_table_name='trip_members' then
    rec:=coalesce(a,b);
    if tg_op<>'UPDATE' or (b->'role',b->'status',b->'user_id',b->'trip_id') is distinct from (a->'role',a->'status',a->'user_id',a->'trip_id') then
      delete from app_private.budget_metadata_undo_stack where trip_id=(rec->>'trip_id')::uuid and user_id=(rec->>'user_id')::uuid;
      if b is not null then delete from app_private.budget_metadata_undo_stack where trip_id=(b->>'trip_id')::uuid and user_id=(b->>'user_id')::uuid; end if;
    end if; return null;
  elsif tg_table_name='trips' then
    if (b->'budget_exchange_rates',b->'start_date',b->'end_date') is distinct from (a->'budget_exchange_rates',a->'start_date',a->'end_date') then
      perform app_private.invalidate_budget_metadata_undo((a->>'id')::uuid);
    end if; return null;
  end if;
  if tg_table_name in ('budget_item_participants','itinerary_budget_items') then
    k:='budget';ids:=array[(b->>'budget_item_id')::uuid,(a->>'budget_item_id')::uuid];
  elsif tg_table_name='actual_expense_participants' then
    k:='actual';ids:=array[(b->>'actual_expense_id')::uuid,(a->>'actual_expense_id')::uuid];
  else
    k:='actual';ids:='{}';
    if b->>'target_type'='actual_expense' then ids:=array_append(ids,(b->>'target_id')::uuid);end if;
    if a->>'target_type'='actual_expense' then ids:=array_append(ids,(a->>'target_id')::uuid);end if;
  end if;
  for resource in select distinct x from unnest(ids) x where x is not null order by x loop
    if app_private.budget_source_effect(k,resource) is not null then continue;end if;
    if app_private.budget_payment_effect(k,resource) is not null or app_private.budget_pricing_effect(k,resource) is not null then continue;end if;
    rec:=app_private.budget_metadata_record(k,resource);trip:=(rec->>'trip_id')::uuid;
    if trip is null then select trip_id into trip from app_private.budget_metadata_groups where kind=k and resource_id=resource limit 1;end if;
    perform app_private.invalidate_budget_metadata_undo(trip,k,resource);
  end loop;
  return null;
end $$;

create or replace function app_private.guard_budget_finance_boundary() returns trigger language plpgsql security definer set search_path='' as $$
declare k text;x jsonb;e app_private.budget_metadata_effects;
begin
 if tg_table_name in('budget_items','actual_expenses') and app_private.budget_lifecycle_effect(case when tg_table_name='budget_items' then 'budget' else 'actual' end,new.id) is not null then return new;end if;
 if not app_private.budget_finance_activated() then return new;end if;
 if tg_table_name='trips' then
  if new.budget_exchange_rates is distinct from old.budget_exchange_rates then
   select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='rates';
   if not found or e.trip_id<>new.id or e.rates_manifest->'quote' is distinct from new.budget_exchange_rates then raise exception 'Use atomic rates protocol' using errcode='55000';end if;
  end if;
 else
  k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  if (new.title,new.note,new.category,new.payer_id) is distinct from (old.title,old.note,old.category,old.payer_id) and app_private.budget_field_effect(k,new.id) is null and app_private.budget_source_effect(k,new.id) is null and app_private.budget_payment_effect(k,new.id) is null then raise exception 'Use field bundle protocol' using errcode='55000';end if;
 end if;return new;
end $$;

create or replace function app_private.budget_field_targets(k text,rid uuid,g text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=app_private.budget_metadata_record(k,rid);targets jsonb;
begin
 if r->>'record_status'='incomplete' and g in('title','note','category','payer') then return jsonb_build_array(jsonb_build_object('kind',k,'id',rid));end if;
 if r is null or g is null or g not in('title','note','category','payer') then return null;end if;
 if k='actual' then
  if g in('title','note') and app_private.budget_source_enabled() or app_private.budget_payment_targets(k,rid) is not null then return jsonb_build_array(jsonb_build_object('kind',k,'id',rid));end if;return null;
 end if;
 if k<>'budget' or (r->>'is_fixed')::boolean then return null;end if;
 targets:=app_private.budget_payment_targets(k,rid);
 if targets is null or jsonb_array_length(targets)>2 then return null;end if;
 return targets;
end $$;

create or replace function app_private.budget_payment_targets(k text,rid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=app_private.budget_metadata_record(k,rid); rows jsonb;source public.budget_items;
begin
 if r is not null and r->>'record_status'='incomplete' then return null;end if;
 if r is null then return null;end if;
 if k='actual' then
  if r->>'budget_item_id' is null then
   if r->>'budget_origin_id' is not null or r->>'payment_origin' is distinct from 'manual' then return null;end if;
  else
   select * into source from public.budget_items where id=(r->>'budget_item_id')::uuid and trip_id=(r->>'trip_id')::uuid;
   if not found or source.is_fixed or r->>'budget_origin_id' is not null and r->>'budget_origin_id'<>r->>'budget_item_id' then return null;end if;
  end if;
  return jsonb_build_array(jsonb_build_object('kind',k,'id',rid));
 end if;
 if k<>'budget' or (r->>'is_fixed')::boolean then return null;end if;
 if exists(select 1 from public.actual_expenses a where (a.budget_item_id=rid or a.budget_origin_id=rid) and
  (a.trip_id<>(r->>'trip_id')::uuid or a.budget_item_id is distinct from rid or a.budget_origin_id is not null and a.budget_origin_id<>rid or a.payment_origin not in('manual','budget_toggle'))) then return null;end if;
 if r->>'auto_created_actual_expense_id' is not null and not exists(select 1 from public.actual_expenses where id=(r->>'auto_created_actual_expense_id')::uuid and budget_item_id=rid) then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('kind','actual','id',id) order by id),'[]') into rows from public.actual_expenses where budget_item_id=rid;
 return jsonb_build_array(jsonb_build_object('kind','budget','id',rid))||rows;
end $$;

create or replace function app_private.prepare_budget_payment(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_epoch bigint,p_base_revision bigint,p_value jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();g app_private.budget_metadata_groups;h app_private.budget_metadata_groups;cached app_private.budget_metadata_requests;signature jsonb;targets jsonb;deps jsonb;d jsonb;r jsonb;after_row jsonb;parents jsonb:='[]';people jsonb:='[]';ids uuid[];calc jsonb;form jsonb;budget public.budget_items;stamp timestamptz:=clock_timestamp();created uuid;changed boolean:=false;action text;value jsonb:=p_value;manifest jsonb;
begin
 if actor is null or not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_id is null or p_session_id is null or p_request_id is null or p_base_revision is null or p_base_revision<0 or p_kind is null or p_kind not in('budget','actual') or jsonb_typeof(value) is distinct from 'object' or value-array['action','paid_at','versions']<>'{}' then raise exception 'Invalid payment intent' using errcode='22023';end if;
 action:=value->>'action';if action is null or p_kind='budget' and action not in('paid','unpaid') or p_kind='actual' and action<>'set_paid_at' or p_kind='budget' and value ? 'paid_at' then raise exception 'Invalid payment action' using errcode='22023';end if;
 if p_kind='actual' then if nullif(value->>'paid_at','') is null or not isfinite((value->>'paid_at')::timestamptz) then raise exception 'Invalid paid_at' using errcode='22023';end if;value:=jsonb_set(value,'{paid_at}',to_jsonb((value->>'paid_at')::timestamptz));end if;
 signature:=jsonb_build_object('protocol','payment-v2','trip',p_trip_id,'kind',p_kind,'id',p_id,'session',p_session_id,'base',p_base_revision,'value',value);
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 if not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into cached from app_private.budget_metadata_requests where user_id=actor and request_id=p_request_id;
 if found then if cached.signature<>signature or cached.trip_id<>p_trip_id or cached.session_id<>p_session_id then raise exception 'request_mismatch' using errcode='22023';end if;return jsonb_build_object('replayed',true,'result',cached.result);end if;
 if not app_private.budget_payment_enabled() then raise exception 'payment_protocol_disabled' using errcode='55000';end if;
 perform 1 from public.trips where id=p_trip_id for share nowait;
 perform 1 from public.trip_members where trip_id=p_trip_id and user_id=actor for share nowait;
 select * into g from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and trip_id=p_trip_id and group_key='payment' for update;
 targets:=app_private.budget_payment_targets(p_kind,p_id);deps:=app_private.budget_payment_dependencies(p_kind,p_id,action);
 if targets is null then raise exception 'payment_dependency_not_supported' using errcode='0A000';end if;
 if g.payment_bundle->>'intent' is distinct from action or (select jsonb_agg(x-array['epoch'] order by x->>'kind',x->>'id',x->>'group') from jsonb_array_elements(g.payment_bundle->'epochs') x) is distinct from deps then raise exception 'payment_intent_changed' using errcode='40001';end if;
 if g.revision is distinct from p_base_revision or value->'versions' is distinct from app_private.budget_payment_value(p_kind,p_id)->'versions' or g.payment_bundle->'versions' is distinct from value->'versions' then raise exception 'payment_dependency_changed' using errcode='40001';end if;
 for d in select x from jsonb_array_elements(deps) x loop
  if d->>'kind'='budget' then perform 1 from public.budget_items where id=(d->>'id')::uuid and trip_id=p_trip_id for update nowait;perform 1 from public.budget_item_participants where budget_item_id=(d->>'id')::uuid order by user_id for share nowait;
  else perform 1 from public.actual_expenses where id=(d->>'id')::uuid and trip_id=p_trip_id for update nowait;perform 1 from public.actual_expense_participants where actual_expense_id=(d->>'id')::uuid order by user_id for share nowait;end if;
  select * into h from app_private.budget_metadata_groups where kind=d->>'kind' and resource_id=(d->>'id')::uuid and group_key=d->>'group' for update;
  r:=app_private.budget_metadata_record(h.kind,h.resource_id);
  if h.user_id is distinct from actor or h.session_id is distinct from p_session_id or p_token is null or h.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) or h.expires_at is null or h.expires_at<=clock_timestamp() or h.payment_bundle is distinct from g.payment_bundle
   or not exists(select 1 from jsonb_array_elements(g.payment_bundle->'epochs') e where e->>'kind'=h.kind and e->>'id'=h.resource_id::text and e->>'group'=h.group_key and (e->>'epoch')::bigint=h.lease_epoch)
   or exists(select 1 from app_private.budget_edit_leases where kind=h.kind and resource_id=h.resource_id and expires_at>clock_timestamp()) or r->>'locked_by' is not null and (r->>'locked_at')::timestamptz>clock_timestamp()-interval '7 minutes' then raise exception 'payment_lease_lost' using errcode='55P03';end if;
 end loop;
 if g.user_id is distinct from actor or g.session_id is distinct from p_session_id or g.lease_epoch is distinct from p_epoch or g.payment_bundle->>'id' is distinct from p_id::text or g.payment_bundle->>'kind' is distinct from p_kind then raise exception 'payment_lease_lost' using errcode='55P03';end if;
 if targets is distinct from app_private.budget_payment_targets(p_kind,p_id) or value->'versions' is distinct from app_private.budget_payment_value(p_kind,p_id)->'versions' then raise exception 'payment_dependency_changed' using errcode='40001';end if;
 for d in select x from jsonb_array_elements(targets) x loop
  r:=app_private.budget_metadata_record(d->>'kind',(d->>'id')::uuid);after_row:=r;
  if d->>'kind'='actual' then
   if p_kind='actual' then after_row:=r||jsonb_build_object('paid_at',value->'paid_at');else after_row:=r||jsonb_build_object('payment_active',action='paid');end if;
  end if;
  if after_row is distinct from r then changed:=true;end if;
  parents:=parents||jsonb_build_array(d||jsonb_build_object('before',r,'after',after_row));
 end loop;
 if p_kind='budget' and action='paid' and jsonb_array_length(targets)=1 then
  select * into budget from public.budget_items where id=p_id;
  if coalesce(btrim(budget.title),'')='' then raise exception 'Committed budget title incomplete' using errcode='22023';end if;
  form:=app_private.read_budget_pricing_value('budget',p_id);calc:=app_private.calculate_budget_group_pricing(form);
  if (calc->>'amount')::numeric<>budget.amount or (calc->>'twd_amount')::numeric<>budget.twd_amount or calc->>'pricing_mode'<>budget.pricing_mode or calc->>'split_type'<>budget.split_type then raise exception 'Committed budget pricing incomplete' using errcode='22023';end if;
  select array_agg(x::uuid order by x::uuid) into ids from jsonb_array_elements_text(form->'participantIds') x;
  perform 1 from public.trip_members where trip_id=p_trip_id and user_id=any(array_append(ids,budget.payer_id)) order by user_id for share nowait;
  if exists(select 1 from unnest(array_append(ids,budget.payer_id)) u where u is not null and not exists(select 1 from public.trip_members where trip_id=p_trip_id and user_id=u and status='approved')) then raise exception 'Invalid payment members' using errcode='42501';end if;
  created:=gen_random_uuid();changed:=true;
  after_row:=to_jsonb(jsonb_populate_record(null::public.actual_expenses,jsonb_build_object('id',created,'trip_id',p_trip_id,'budget_item_id',p_id,'budget_origin_id',p_id,
   'category',budget.category,'subcategory',budget.subcategory,'title',budget.title,'note',budget.note,'amount',budget.amount,'currency',budget.currency,'exchange_rate',budget.exchange_rate,'twd_amount',budget.twd_amount,'payer_id',budget.payer_id,
   'pricing_mode',budget.pricing_mode,'unit_amount',budget.unit_amount,'split_type',budget.split_type,'payment_origin','budget_toggle','payment_active',true,'payment_history','[]'::jsonb,'record_status','complete','pricing_ready',true,'lifecycle_revision',0,'completed_at',stamp,
   'twd_amount_source',case when budget.currency='TWD' then 'actual' else 'estimated' end,'actual_twd_amount',case when budget.currency='TWD' then budget.twd_amount else null end,'paid_at',stamp,'created_at',stamp,'updated_at',stamp)));
  parents:=jsonb_set(parents,'{0,after}',parents->0->'after'||jsonb_build_object('auto_created_actual_expense_id',created))||jsonb_build_array(jsonb_build_object('kind','actual','id',created,'before',null,'after',after_row));
  select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'actual_expense_id',created,'user_id',user_id,'share_amount',share_amount,'created_at',stamp) order by user_id) into people from public.budget_item_participants where budget_item_id=p_id;
 end if;
 manifest:=jsonb_build_object('parents',parents,'people',people,'created',created,'changed',changed,'dependencies',deps,'versions',value->'versions');
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,payment_manifest)
 values(txid_current(),pg_backend_pid(),actor,p_trip_id,p_kind,p_id,'payment',p_session_id,p_request_id,p_base_revision,p_epoch,value,signature,manifest);
 return jsonb_build_object('replayed',false,'manifest',manifest);
end $$;

create or replace function app_private.guard_legacy_budget_metadata_lease() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.expires_at>clock_timestamp() and app_private.budget_metadata_record(new.kind,new.resource_id)->>'record_status'='incomplete' then raise exception 'Incomplete uses group leases only' using errcode='55000';end if;
  if new.expires_at>clock_timestamp() and app_private.budget_metadata_live(new.kind,new.resource_id) then
    raise exception 'group_locked' using errcode='55P03'; end if;
  return new;
end $$;

create or replace function app_private.read_budget_pricing_value(k text,rid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with rec as(select app_private.budget_metadata_record(k,rid) r),people as(
 select user_id,share_amount from public.budget_item_participants where k='budget' and budget_item_id=rid union all select user_id,share_amount from public.actual_expense_participants where k='actual' and actual_expense_id=rid)
 select jsonb_build_object('pricing_mode',r->'pricing_mode','amount',case when r->>'record_status'='incomplete' and not(r->>'pricing_ready')::boolean and app_private.budget_pricing_effect(k,rid) is null then to_jsonb(''::text) else r->'amount' end,'unit_amount',r->'unit_amount','currency',r->'currency','exchange_rate',r->'exchange_rate',
 'participantIds',coalesce((select jsonb_agg(user_id order by user_id) from people),'[]'),
 'shares',case when r->>'pricing_mode'='custom' then coalesce((select jsonb_object_agg(user_id,share_amount) from people),'{}') else '{}'::jsonb end,
 'versions',app_private.budget_pricing_versions(k,rid)) from rec
$$;

create or replace function app_private.budget_source_plan(trip uuid,rid uuid,action text,destination uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=app_private.budget_metadata_record('actual',rid);a jsonb;source public.budget_items;t public.trips;old_id uuid;origin uuid;budgets uuid[];bid uuid;
 before_people jsonb;after_people jsonb;form jsonb;calc jsonb;changed_groups text[]:='{}';targets jsonb;checks jsonb;retained jsonb;versions jsonb;topology boolean;changed boolean;ids uuid[];
begin
 if not app_private.budget_complete('actual',rid) or destination is not null and not app_private.budget_complete('budget',destination) then raise exception 'Incomplete source or Actual' using errcode='55000';end if;
 if r is null or (r->>'trip_id')::uuid is distinct from trip then raise exception 'Source resource missing' using errcode='42501';end if;
 if action is null or action not in('relink_only','apply_source_data') or action='apply_source_data' and destination is null then raise exception 'Invalid Source intent' using errcode='22023';end if;
 old_id:=(r->>'budget_item_id')::uuid;origin:=(r->>'budget_origin_id')::uuid;
 if r->>'payment_origin' not in('manual','budget_toggle') or old_id is null and r->>'payment_origin'<>'manual' then raise exception 'source_provenance_unsupported' using errcode='0A000';end if;
 if old_id is not null and origin is not null and old_id<>origin then raise exception 'source_origin_mismatch' using errcode='0A000';end if;
 if old_id is distinct from destination and origin is not null and destination is not null then raise exception 'historical_origin_relink_requires_product_contract' using errcode='0A000';end if;
 if old_id is null and origin is not null and destination is not null then raise exception 'origin_only_requires_product_contract' using errcode='0A000';end if;
 select array_agg(distinct x order by x) into budgets from unnest(array[old_id,destination]) x where x is not null;
 foreach bid in array coalesce(budgets,'{}') loop
  select * into source from public.budget_items where id=bid and trip_id=trip;
  if not found or source.is_fixed then raise exception 'source_budget_missing_fixed_or_cross_trip' using errcode='0A000';end if;
  if app_private.budget_payment_targets('budget',bid) is null then raise exception 'source_payment_graph_unsupported' using errcode='0A000';end if;
  if old_id is distinct from destination and source.auto_created_actual_expense_id=rid then raise exception 'generated_backlink_detach_requires_product_contract' using errcode='0A000';end if;
 end loop;
 select * into t from public.trips where id=trip;
 if old_id is distinct from destination and t.status='settled' then raise exception 'settled_source_change_unsupported' using errcode='0A000';end if;
 a:=r||jsonb_build_object('budget_item_id',destination,'budget_origin_id',case when old_id is distinct from destination and origin is null and destination is not null then destination else origin end);
 select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'share_amount',share_amount) order by user_id),'[]') into before_people from public.actual_expense_participants where actual_expense_id=rid;
 after_people:=before_people;
 if action='apply_source_data' then
  select * into source from public.budget_items where id=destination and trip_id=trip;
  if t.status='settled' or (r->>'currency'<>'TWD' or source.currency<>'TWD') and (t.start_date is null or t.start_date::timestamp at time zone 'Asia/Taipei'<=statement_timestamp()) then raise exception 'historical_source_application_unsupported' using errcode='0A000';end if;
  form:=app_private.read_budget_pricing_value('budget',destination);calc:=app_private.calculate_budget_group_pricing(form);
  if btrim(source.title)='' or btrim(source.category)='' or (calc->>'amount')::numeric<>source.amount or (calc->>'twd_amount')::numeric<>source.twd_amount or calc->>'pricing_mode'<>source.pricing_mode or calc->>'split_type'<>source.split_type then raise exception 'Source committed pricing incomplete' using errcode='22023';end if;
  select array_agg(x::uuid order by x::uuid) into ids from jsonb_array_elements_text(form->'participantIds') x;
  if exists(select 1 from unnest(array_append(ids,source.payer_id)) u where u is not null and not exists(select 1 from public.trip_members where trip_id=trip and user_id=u and status='approved')) then raise exception 'Source member invalid' using errcode='42501';end if;
  if r->>'twd_amount_source' in('actual','legacy') and (r->>'actual_twd_amount' is null or (r->>'actual_twd_amount')::numeric<>(calc->>'twd_amount')::numeric) then raise exception 'Known actual debit cannot be revalued by Source' using errcode='22023';end if;
  a:=a||jsonb_build_object('title',source.title,'category',source.category,'note',source.note,'payer_id',source.payer_id,
   'amount',calc->'amount','unit_amount',calc->'unit_amount','currency',source.currency,'exchange_rate',calc->'exchange_rate','twd_amount',calc->'twd_amount','pricing_mode',calc->'pricing_mode','split_type',calc->'split_type');
  select jsonb_agg(jsonb_build_object('user_id',u,'share_amount',case when calc->>'pricing_mode'='custom' then calc->'shares'->u::text else 'null'::jsonb end) order by u) into after_people from unnest(ids) u;
  if (r->'amount',r->'unit_amount',r->'currency',r->'exchange_rate',r->'twd_amount',r->'pricing_mode',r->'split_type') is distinct from (a->'amount',a->'unit_amount',a->'currency',a->'exchange_rate',a->'twd_amount',a->'pricing_mode',a->'split_type') or before_people is distinct from after_people then changed_groups:=array_append(changed_groups,'pricing');end if;
  if r->'payer_id' is distinct from a->'payer_id' then changed_groups:=array_append(changed_groups,'payer');end if;
  if r->'title' is distinct from a->'title' then changed_groups:=array_append(changed_groups,'title');end if;
  if r->'category' is distinct from a->'category' then changed_groups:=array_append(changed_groups,'category');end if;
  if r->'note' is distinct from a->'note' then changed_groups:=array_append(changed_groups,'note');end if;
 end if;
 topology:=(r->'budget_item_id',r->'budget_origin_id') is distinct from (a->'budget_item_id',a->'budget_origin_id');changed:=topology or cardinality(changed_groups)>0;
 select jsonb_agg(jsonb_build_object('kind',k,'id',id,'group',g) order by k,id,g) into targets from (
  select 'actual' k,rid id,unnest(array_prepend('source',changed_groups)) g
  union select 'budget',unnest(budgets),'payment' where topology) keys;
 select coalesce(jsonb_agg(jsonb_build_object('kind',g.kind,'id',g.resource_id,'group',g.group_key,'revision',g.revision,'graph',g.graph_revision) order by g.kind,g.resource_id,g.group_key),'[]') into checks from app_private.budget_metadata_groups g where
  (g.kind='actual' and g.resource_id=rid and g.group_key=any(case when action='apply_source_data' then array['source','pricing','payer','payment','title','category','note'] else array['source','pricing','payer','payment'] end))
  or (g.kind='budget' and g.resource_id=any(budgets) and g.group_key=any(case when action='apply_source_data' and g.resource_id=destination then array['pricing','payer','payment','title','category','note'] else array['pricing','payer','payment'] end));
 select coalesce(jsonb_agg(jsonb_build_object('budget_id',b,'actuals',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'current',x.budget_item_id,'origin',x.budget_origin_id,'provenance',x.payment_origin) order by x.id),'[]') from public.actual_expenses x where x.budget_item_id=b or x.budget_origin_id=b)) order by b),'[]') into retained from unnest(budgets) b;
 select jsonb_build_object('rates',v.rates,'members',v.members,'checks',checks,'retained',retained) into versions from app_private.budget_pricing_trip_versions v where v.trip_id=trip;
 return jsonb_build_object('id',rid,'kind','actual','action',action,'budget_id',destination,'before',r,'after',a,'people_before',before_people,'people_after',after_people,'groups',to_jsonb(changed_groups),'budgets',to_jsonb(coalesce(budgets,'{}')),'topology',topology,'changed',changed,'targets',targets,'versions',versions);
end $$;

create or replace function app_private.budget_rates_plan(trip uuid,value jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.trips;b public.budget_items;quote jsonb;manifest jsonb:='[]';inputs jsonb;calc jsonb;ids jsonb;shares jsonb;rate numeric;
begin
 select * into t from public.trips where id=trip;
 if not found or t.start_date is null or t.start_date::timestamp at time zone 'Asia/Taipei'<=statement_timestamp() or t.status='settled' or exists(select 1 from public.trip_budget_baselines where trip_id=trip and departure_at<=statement_timestamp()) then raise exception '只有行前規劃可更新旅程預算匯率。' using errcode='22023';end if;
 if (value->>'initialize')::boolean and t.budget_exchange_rates?'rates' then return jsonb_build_object('noop',true,'quote',t.budget_exchange_rates,'targets','[]'::jsonb);end if;
 quote:=app_private.budget_rate_quote(value->'quote');
 if t.budget_exchange_rates?'rates' then if app_private.budget_rate_quote(t.budget_exchange_rates) is not distinct from quote then return jsonb_build_object('noop',true,'quote',t.budget_exchange_rates,'targets','[]'::jsonb);end if;end if;
 for b in select * from public.budget_items where trip_id=trip and record_status='complete' and currency<>'TWD' order by id loop
  -- Any retained identity, including inactive and origin-only, keeps its history.
  if exists(select 1 from public.actual_expenses where budget_item_id=b.id or budget_origin_id=b.id) then continue;end if;
  if b.auto_created_actual_expense_id is not null then raise exception 'Unresolved retained backlink' using errcode='0A000';end if;
  rate:=(quote->'rates'->>b.currency)::numeric;if rate is null then raise exception 'Missing currency quote' using errcode='22023';end if;
  if rate=b.exchange_rate and round(b.amount*rate)=b.twd_amount then continue;end if;
  if b.is_fixed then raise exception 'Fixed pricing cannot be repriced' using errcode='0A000';end if;
  select coalesce(jsonb_agg(user_id order by user_id),'[]'),coalesce(jsonb_object_agg(user_id,share_amount),'{}') into ids,shares from public.budget_item_participants where budget_item_id=b.id;
  -- Preserve the existing legacy no-join participant fallback, without creating joins.
  if jsonb_array_length(ids)=0 then select jsonb_agg(user_id order by user_id) into ids from public.trip_members where trip_id=trip and status='approved';end if;
  if exists(select 1 from jsonb_array_elements_text(ids) u where not exists(select 1 from public.trip_members where trip_id=trip and user_id=u::uuid and status='approved')) then raise exception 'Participant revoked' using errcode='42501';end if;
  inputs:=jsonb_build_object('pricing_mode',b.pricing_mode,'amount',b.amount,'unit_amount',b.unit_amount,'currency',b.currency,'exchange_rate',rate,'participantIds',ids,'shares',case when b.pricing_mode='custom' then shares else '{}'::jsonb end);
  calc:=app_private.calculate_budget_group_pricing(inputs);
  if (calc->>'amount')::numeric is distinct from b.amount or (calc->>'unit_amount')::numeric is distinct from b.unit_amount or calc->>'split_type' is distinct from b.split_type then raise exception 'Inconsistent pricing inputs' using errcode='0A000';end if;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('kind','budget','id',b.id,'before',to_jsonb(b),'fields',calc-array['participantIds','shares'],'inputs',inputs));
 end loop;
 return jsonb_build_object('noop',false,'quote',quote,'targets',manifest);
end $$;

create or replace function app_private.guard_receipt_metadata() returns trigger language plpgsql security definer set search_path='' as $$
declare b jsonb;a jsonb;e jsonb:=app_private.receipt_effect();d jsonb;
begin
 if tg_op<>'DELETE' and new.target_type='actual_expense' and not app_private.budget_complete('actual',new.target_id) then raise exception 'Incomplete Actual cannot accept Receipt' using errcode='55000';end if;
 if tg_op<>'INSERT' then b:=to_jsonb(old);end if;if tg_op<>'DELETE' then a:=to_jsonb(new);end if;d:=coalesce(a,b);
 if (a->>'target_type'='actual_expense' or b->>'target_type'='actual_expense') and app_private.receipts_activated() then
  if not app_private.receipts_enabled() or e is null or tg_op='UPDATE' or tg_op='INSERT' and a is distinct from e->'new' or tg_op='DELETE' and b is distinct from e->'old' then raise exception 'Receipt protocol required' using errcode='55000';end if;
 end if;
 if a is not null and app_private.receipt_path_protected('trip-attachments',a->>'file_url') and a->>'target_type'<>'actual_expense' then raise exception 'Receipt object cannot be aliased to another workspace' using errcode='55000';end if;
 return coalesce(new,old);
end $$;

create or replace function app_private.refresh_budget_baseline(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_cutoff timestamptz;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found or v_trip.start_date is null or v_trip.status = 'settled' then return; end if;
  v_cutoff := v_trip.start_date::timestamp at time zone 'Asia/Taipei';
  if clock_timestamp() >= v_cutoff then return; end if;
  if exists (select 1 from public.trip_budget_baselines where trip_id = p_trip_id and departure_at <= clock_timestamp()) then return; end if;
  insert into public.trip_budget_baselines(trip_id, departure_at, captured_at, payload)
  values (p_trip_id, v_cutoff, clock_timestamp(), jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(b) - 'locked_at' - 'locked_by' order by b.created_at, b.id) from public.budget_items b where b.trip_id = p_trip_id and b.record_status='complete'), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(to_jsonb(p) order by p.user_id) from public.budget_item_participants p join public.budget_items b on b.id = p.budget_item_id where b.trip_id = p_trip_id and b.record_status='complete'), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.itinerary_budget_items l join public.budget_items b on b.id = l.budget_item_id where b.trip_id = p_trip_id and b.record_status='complete'), '[]'::jsonb),
    'itinerary', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'day_index', i.day_index) order by i.id) from public.itinerary_items i where i.trip_id = p_trip_id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', m.display_name) order by m.user_id) from public.trip_members m where m.trip_id = p_trip_id and m.status = 'approved'), '[]'::jsonb)
  ))
  on conflict (trip_id) do update set departure_at = excluded.departure_at, captured_at = excluded.captured_at, payload = excluded.payload
  where public.trip_budget_baselines.departure_at > clock_timestamp();
end;
$$;

create function app_private.read_budget_lifecycle_state(trip uuid,sid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when auth.uid() is null or not app_private.can_read_trip(trip,auth.uid()) then null else jsonb_build_object('protocol',jsonb_build_object('name','budget-lifecycle','schemaVersion',1,'enabled',app_private.budget_lifecycle_enabled()),'records',jsonb_build_array(jsonb_build_object('kind','trip','id',trip,'trip_id',trip,'revision',0,'supported',true,'value',jsonb_build_object('exists',true,'versions','{}'::jsonb)))||coalesce((select jsonb_agg(jsonb_build_object('kind',g.kind,'id',g.resource_id,'trip_id',trip,'revision',coalesce((app_private.budget_metadata_record(g.kind,g.resource_id)->>'lifecycle_revision')::bigint,g.revision),'supported',not g.is_deleted,'value',jsonb_build_object('exists',not g.is_deleted,'versions',app_private.lifecycle_versions(g.kind,g.resource_id))) order by g.kind,g.resource_id) from app_private.budget_metadata_groups g where g.trip_id=trip and group_key='lifecycle'),'[]')) end
$$;
create function public.read_budget_metadata_snapshot_v9(p_trip_id uuid,p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with f as materialized(select public.read_budget_metadata_snapshot_v8(p_trip_id,p_session_id) v),l as materialized(select app_private.read_budget_lifecycle_state(p_trip_id,p_session_id) v)
 select f.v||jsonb_build_object('metadataProtocol',jsonb_set(f.v->'metadataProtocol','{schemaVersion}','9'),'lifecycleProtocol',l.v->'protocol','lifecycleRecords',l.v->'records') from f cross join l where f.v is not null and l.v is not null
$$;
revoke all on function app_private.budget_lifecycle_enabled() from public,anon,authenticated;
revoke all on function app_private.budget_lifecycle_activated() from public,anon,authenticated;
revoke all on function app_private.latch_budget_lifecycle() from public,anon,authenticated;
revoke all on function app_private.budget_complete(text,uuid) from public,anon,authenticated;
revoke all on function app_private.budget_lifecycle_effect(text,uuid,text) from public,anon,authenticated;
revoke all on function app_private.lifecycle_membership(uuid) from public,anon,authenticated;
revoke all on function app_private.lifecycle_versions(text,uuid) from public,anon,authenticated;
revoke all on function app_private.lifecycle_delete_plan(uuid,text,uuid) from public,anon,authenticated;
revoke all on function app_private.lifecycle_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function app_private.lifecycle_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb) to authenticated;
revoke all on function public.budget_lifecycle_lease(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.budget_lifecycle_lease(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb) to authenticated;
revoke all on function app_private.lifecycle_placeholder_row(uuid,text,uuid) from public,anon,authenticated;
revoke all on function app_private.prepare_budget_lifecycle(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) from public,anon,authenticated;
grant execute on function app_private.prepare_budget_lifecycle(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) to authenticated;
revoke all on function app_private.finish_budget_lifecycle() from public,anon,authenticated;
grant execute on function app_private.finish_budget_lifecycle() to authenticated;
revoke all on function public.mutate_budget_lifecycle(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.mutate_budget_lifecycle(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) to authenticated;
revoke all on function public.create_budget_workspace_placeholder(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_budget_workspace_placeholder(uuid,text,uuid,uuid) to authenticated;
revoke all on function app_private.validate_lifecycle_row(text,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function app_private.guard_lifecycle_write() from public,anon,authenticated;
revoke all on function app_private.track_lifecycle_identity() from public,anon,authenticated;
revoke all on function app_private.reconcile_budget_readiness(text,uuid) from public,anon,authenticated;
revoke all on function app_private.budget_readiness_changed() from public,anon,authenticated;
revoke all on function app_private.guard_incomplete_child() from public,anon,authenticated;
revoke all on function app_private.read_budget_lifecycle_state(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.read_budget_lifecycle_state(uuid,uuid) to authenticated;
revoke all on function public.read_budget_metadata_snapshot_v9(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_budget_metadata_snapshot_v9(uuid,uuid) to authenticated;
commit;
