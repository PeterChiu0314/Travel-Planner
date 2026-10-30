-- B-4c: dormant receipt metadata + Storage intent/cleanup protocol.
-- No SQL function writes storage.objects; bytes are handled by Storage API only.
begin;
alter table app_private.budget_metadata_groups drop constraint budget_metadata_groups_group_key_check;
alter table app_private.budget_metadata_groups add constraint budget_metadata_groups_group_key_check check(group_key in('title','note','category','payer','links','pricing','payment','source','receipts'));
alter table app_private.budget_metadata_effects add column receipt_manifest jsonb;
create table app_private.budget_receipt_protocol(singleton boolean primary key default true check(singleton),enabled boolean not null default false,activated boolean not null default false,legacy_grants_expire_at timestamptz,storage_verified boolean not null default false,cleanup_worker_verified boolean not null default false,service_role_had_usage boolean not null default has_schema_privilege('service_role','app_private','usage'));
insert into app_private.budget_receipt_protocol(singleton,enabled,activated) values(true,false,false);
create function app_private.latch_budget_receipts() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.enabled and not old.enabled and (new.legacy_grants_expire_at is null or new.legacy_grants_expire_at>clock_timestamp() or not new.storage_verified or not new.cleanup_worker_verified or not exists(select 1 from storage.buckets where id='trip-attachments' and not public and file_size_limit=10485760 and allowed_mime_types @> array['image/jpeg','image/png','image/webp','application/pdf'])) then raise exception 'Receipt activation requires verified Storage API, durable worker and expired legacy upload grants' using errcode='55000';end if;
 new.activated:=old.activated or new.enabled;return new;end $$;
revoke all on function app_private.latch_budget_receipts() from public,anon,authenticated;
create trigger receipt_activation before update on app_private.budget_receipt_protocol for each row execute function app_private.latch_budget_receipts();
create trigger receipt_signal after update on app_private.budget_receipt_protocol for each row execute function app_private.signal_budget_metadata_protocol();
create table app_private.budget_receipt_intents(
 request_id uuid primary key,user_id uuid not null,session_id uuid not null,trip_id uuid not null,actual_id uuid not null,signature jsonb not null,
 action text not null check(action in('upload','delete','replace')),base_revision bigint not null,versions jsonb not null,
 attachment_id uuid,object_path text unique,file_name text,file_type text,file_size bigint,digest text,object_id uuid,
 old_receipt jsonb,old_object_id uuid,status text not null default 'pending' check(status in('pending','committed','aborted')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '20 minutes',result jsonb);
create index receipt_pending_expiry on app_private.budget_receipt_intents(expires_at) where status='pending';
create table app_private.budget_receipt_cleanup(
 id uuid primary key default gen_random_uuid(),request_id uuid,trip_id uuid not null,actual_id uuid not null,
 object_path text not null,object_id uuid not null,reason text not null,
 status text not null default 'waiting' check(status in('waiting','claimed','done','blocked')),attempts integer not null default 0,
 claim_token uuid,claim_until timestamptz,last_error text,created_at timestamptz not null default clock_timestamp(),unique(object_path,object_id));
create index receipt_cleanup_due on app_private.budget_receipt_cleanup(status,claim_until) where status in('waiting','claimed');
alter table app_private.budget_receipt_protocol enable row level security;
alter table app_private.budget_receipt_intents enable row level security;
alter table app_private.budget_receipt_cleanup enable row level security;
revoke all on app_private.budget_receipt_protocol,app_private.budget_receipt_intents,app_private.budget_receipt_cleanup from public,anon,authenticated;
create trigger receipt_intent_signal after insert or update or delete on app_private.budget_receipt_intents for each row execute function app_private.signal_budget_metadata_state();
create trigger receipt_cleanup_signal after insert or update or delete on app_private.budget_receipt_cleanup for each row execute function app_private.signal_budget_metadata_state();
insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) select 'actual',id,'receipts',trip_id from public.actual_expenses;

create function app_private.receipts_enabled() returns boolean language sql stable security definer set search_path='' as $$select app_private.budget_metadata_enabled() and enabled from app_private.budget_receipt_protocol where singleton$$;
create function app_private.receipts_activated() returns boolean language sql stable security definer set search_path='' as $$select activated from app_private.budget_receipt_protocol where singleton$$;
create function app_private.receipt_versions(rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('source',coalesce((select revision from app_private.budget_metadata_groups where kind='actual' and resource_id=r.id and group_key='source'),0),'payment',coalesce((select revision from app_private.budget_metadata_groups where kind='actual' and resource_id=r.id and group_key='payment'),0),'graph',coalesce((select graph_revision from app_private.budget_metadata_groups where kind='actual' and resource_id=r.id and group_key='pricing'),0),'current',r.budget_item_id,'origin',r.budget_origin_id,'budget_graph',coalesce((select graph_revision from app_private.budget_metadata_groups where kind='budget' and resource_id=r.budget_item_id and group_key='pricing'),0)) from public.actual_expenses r where r.id=rid
$$;
create function app_private.receipt_value(rid uuid) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('ids',coalesce((select jsonb_agg(id order by id) from public.attachments where target_type='actual_expense' and target_id=rid),'[]'),'versions',app_private.receipt_versions(rid))$$;
create function app_private.receipt_effect() returns jsonb language sql stable security definer set search_path='' as $$select receipt_manifest from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='receipts'$$;
revoke all on function app_private.receipts_enabled(),app_private.receipts_activated(),app_private.receipt_versions(uuid),app_private.receipt_value(uuid),app_private.receipt_effect() from public,anon,authenticated;

create function app_private.receipt_authority(trip uuid,rid uuid,sid uuid,token uuid,epoch bigint,base bigint,versions jsonb) returns void language plpgsql security definer set search_path='' as $$
declare g app_private.budget_metadata_groups;r public.actual_expenses;
begin
 if auth.uid() is null or not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(trip::text,0));
 perform 1 from public.trip_members where trip_id=trip and user_id=auth.uid() for share nowait;
 if not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if not app_private.receipts_enabled() then raise exception 'Receipt protocol disabled' using errcode='55000';end if;
 perform 1 from app_private.budget_receipt_protocol where singleton for share nowait;
 select * into r from public.actual_expenses where id=rid and trip_id=trip for update nowait;
 if not found then raise exception 'Actual missing' using errcode='42501';end if;
 if app_private.budget_payment_targets('actual',rid) is null then raise exception 'Receipt payment graph unsupported' using errcode='0A000';end if;
 if r.budget_item_id is not null then perform 1 from public.budget_items where id=r.budget_item_id and trip_id=trip for update nowait;if not found then raise exception 'Source missing' using errcode='40001';end if;end if;
 if versions is distinct from app_private.receipt_versions(rid) then raise exception 'Receipt dependency changed; keep file and reconfirm' using errcode='40001';end if;
 select * into g from app_private.budget_metadata_groups where kind='actual' and resource_id=rid and group_key='receipts' for update;
 if g.is_deleted or g.revision is distinct from base then raise exception 'Receipt version changed' using errcode='40001';end if;
 if sid is null or token is null or g.user_id is distinct from auth.uid() or g.session_id is distinct from sid or g.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or g.lease_epoch is distinct from epoch or g.expires_at is null or g.expires_at<=clock_timestamp() then raise exception 'Receipt lease lost' using errcode='55P03';end if;
 if exists(select 1 from app_private.budget_edit_leases where kind='actual' and resource_id=rid and expires_at>clock_timestamp()) or r.locked_by is not null and r.locked_at>clock_timestamp()-interval '7 minutes' then raise exception 'Legacy editor active' using errcode='55P03';end if;
end $$;
revoke all on function app_private.receipt_authority(uuid,uuid,uuid,uuid,bigint,bigint,jsonb) from public,anon,authenticated;
create function public.budget_receipts_lease(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_revision bigint,p_epoch bigint,p_versions jsonb,p_intent jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$begin return app_private.receipt_admission(p_trip_id,p_kind,p_id,p_session_id,p_token,p_action,p_base_revision,p_epoch,p_versions);end $$;
create function app_private.receipt_admission(trip uuid,kind text,rid uuid,sid uuid,token uuid,action text,base bigint,epoch bigint,versions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare g app_private.budget_metadata_groups;r public.actual_expenses;
begin
 if auth.uid() is null or kind is distinct from 'actual' or sid is null or token is null or action is null or action not in('acquire','renew','release') then raise exception 'Invalid receipt lease' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(trip::text,0));
 select * into g from app_private.budget_metadata_groups where budget_metadata_groups.kind='actual' and resource_id=rid and group_key='receipts' and trip_id=trip for update;
 if action='release' then
  if g.user_id=auth.uid() and g.session_id=sid and g.token_hash=sha256(convert_to(token::text,'UTF8')) and g.lease_epoch=epoch then update app_private.budget_metadata_groups set user_id=null,session_id=null,token_hash=null,expires_at=null where budget_metadata_groups.kind='actual' and resource_id=rid and group_key='receipts';end if;return jsonb_build_object('granted',true);
 end if;
 if not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if not app_private.receipts_enabled() then raise exception 'Receipt disabled' using errcode='55000';end if;
 perform 1 from public.trip_members where trip_id=trip and user_id=auth.uid() for share nowait;
 perform 1 from app_private.budget_receipt_protocol where singleton for share nowait;
 if not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into r from public.actual_expenses where id=rid and trip_id=trip for update nowait;if not found then raise exception 'Actual missing' using errcode='42501';end if;
 if app_private.budget_payment_targets('actual',rid) is null then raise exception 'Receipt payment graph unsupported' using errcode='0A000';end if;
 if g.is_deleted or g.revision is distinct from base or versions is distinct from app_private.receipt_versions(rid) then raise exception 'Receipt dependencies changed' using errcode='40001';end if;
 if exists(select 1 from app_private.budget_edit_leases where budget_edit_leases.kind='actual' and resource_id=rid and expires_at>clock_timestamp()) or r.locked_by is not null and r.locked_at>clock_timestamp()-interval '7 minutes' then return jsonb_build_object('granted',false);end if;
 if g.user_id is not null and g.expires_at>clock_timestamp() and app_private.can_edit_trip(trip,g.user_id) and (g.user_id is distinct from auth.uid() or g.session_id is distinct from sid or g.token_hash is distinct from sha256(convert_to(token::text,'UTF8'))) then return jsonb_build_object('granted',false);end if;
 if action='renew' and (g.user_id is distinct from auth.uid() or g.session_id is distinct from sid or g.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or g.lease_epoch is distinct from epoch or g.expires_at is null or g.expires_at<=clock_timestamp()) then return jsonb_build_object('granted',false);end if;
 update app_private.budget_metadata_groups set lease_epoch=lease_epoch+case when user_id is null or expires_at is null or expires_at<=clock_timestamp() or not app_private.can_edit_trip(trip,user_id) then 1 else 0 end,user_id=auth.uid(),session_id=sid,token_hash=sha256(convert_to(token::text,'UTF8')),expires_at=clock_timestamp()+interval '7 minutes' where budget_metadata_groups.kind='actual' and resource_id=rid and group_key='receipts' returning * into g;
 return jsonb_build_object('granted',true,'revision',g.revision,'epoch',g.lease_epoch,'targets',jsonb_build_array(jsonb_build_object('kind','actual','id',rid,'group','receipts','epoch',g.lease_epoch)),'value',app_private.receipt_value(rid));
end $$;
revoke all on function app_private.receipt_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb) from public,anon;
grant execute on function app_private.receipt_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb) to authenticated;
revoke all on function public.budget_receipts_lease(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.budget_receipts_lease(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb) to authenticated;

create function app_private.receipt_inspect(trip uuid,rid uuid,sid uuid,request uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i app_private.budget_receipt_intents;o storage.objects;
begin
 if not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into i from app_private.budget_receipt_intents where request_id=request and user_id=auth.uid() and session_id=sid and trip_id=trip and actual_id=rid;if not found then return null;end if;
 select * into o from storage.objects where bucket_id='trip-attachments' and name=i.object_path;
 return jsonb_build_object('request_id',request,'status',i.status,'path',i.object_path,'attachment_id',i.attachment_id,'object_id',o.id,'object_ready',o.id is not null,'result',i.result,'old_receipt',i.old_receipt,'cleanup_pending',exists(select 1 from app_private.budget_receipt_cleanup where request_id=request and status<>'done'));
end $$;
create function public.read_budget_receipt_operation(p_trip_id uuid,p_id uuid,p_session_id uuid,p_request_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select app_private.receipt_inspect(p_trip_id,p_id,p_session_id,p_request_id)$$;
revoke all on function app_private.receipt_inspect(uuid,uuid,uuid,uuid),public.read_budget_receipt_operation(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function app_private.receipt_inspect(uuid,uuid,uuid,uuid),public.read_budget_receipt_operation(uuid,uuid,uuid,uuid) to authenticated;

create function app_private.abandon_receipt(trip uuid,rid uuid,sid uuid,token uuid,epoch bigint,base bigint,versions jsonb,request uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare i app_private.budget_receipt_intents;
begin
 perform app_private.receipt_authority(trip,rid,sid,token,epoch,base,versions);
 select * into i from app_private.budget_receipt_intents where request_id=request and user_id=auth.uid() and session_id=sid and trip_id=trip and actual_id=rid for update;
 if not found or i.status='committed' then return false;end if;
 update app_private.budget_receipt_intents set status='aborted' where request_id=request;
 insert into app_private.budget_receipt_cleanup(request_id,trip_id,actual_id,object_path,object_id,reason) select request,trip,rid,name,id,'explicit abandon' from storage.objects where bucket_id='trip-attachments' and name=i.object_path on conflict do nothing;return true;
end $$;
create function public.abandon_budget_receipt(p_trip_id uuid,p_id uuid,p_session_id uuid,p_token uuid,p_epoch bigint,p_base_revision bigint,p_versions jsonb,p_request_id uuid) returns boolean language sql security invoker set search_path='' as $$select app_private.abandon_receipt(p_trip_id,p_id,p_session_id,p_token,p_epoch,p_base_revision,p_versions,p_request_id)$$;
revoke all on function app_private.abandon_receipt(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid),public.abandon_budget_receipt(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) from public,anon;
grant execute on function app_private.abandon_receipt(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid),public.abandon_budget_receipt(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) to authenticated;

create function app_private.prepare_receipt(trip uuid,rid uuid,sid uuid,token uuid,epoch bigint,base bigint,value jsonb,request uuid,phase text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i app_private.budget_receipt_intents;signature jsonb;o storage.objects;old public.attachments;manifest jsonb;newrow public.attachments;
begin
 if auth.uid() is null or not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if request is null or jsonb_typeof(value) is distinct from 'object' or phase is null or phase not in('begin','commit','abort') or value-array['action','old_id','file','versions']<>'{}' or value->>'action' is null or value->>'action' not in('upload','delete','replace') then raise exception 'Invalid receipt intent' using errcode='22023';end if;
 signature:=jsonb_build_object('trip',trip,'id',rid,'session',sid,'base',base,'value',value);
 perform pg_advisory_xact_lock(hashtextextended(trip::text,0));
 select * into i from app_private.budget_receipt_intents where request_id=request for update;
 if found then
  if i.user_id is distinct from auth.uid() or i.signature is distinct from signature then raise exception 'Receipt request mismatch' using errcode='22023';end if;
  if i.status='committed' then return jsonb_build_object('replayed',true,'result',i.result);end if;
  if i.status='aborted' then raise exception 'Upload expired or abandoned; original receipts preserved' using errcode='55000';end if;
 end if;
 perform app_private.receipt_authority(trip,rid,sid,token,epoch,base,value->'versions');
 if i.request_id is null then
  if exists(select 1 from app_private.budget_metadata_requests where user_id=auth.uid() and request_id=request) then raise exception 'Request already belongs to another operation' using errcode='22023';end if;
  if phase<>'begin' then raise exception 'Begin intent first' using errcode='22023';end if;
  if value->>'action' in('replace','delete') then
   select * into old from public.attachments where id=(value->>'old_id')::uuid and trip_id=trip and target_type='actual_expense' and target_id=rid for update nowait;if not found then raise exception 'Receipt changed' using errcode='40001';end if;
   select * into o from storage.objects where bucket_id='trip-attachments' and name=old.file_url;if not found then raise exception 'Original object unavailable; no deletion performed' using errcode='40001';end if;
  elsif value->>'old_id' is not null then raise exception 'Unexpected old receipt' using errcode='22023';end if;
  if value->>'action'<>'delete' and not coalesce(jsonb_typeof(value->'file')='object' and (value->'file')-array['name','type','size','digest']='{}' and length(value->'file'->>'name') between 1 and 255 and (value->'file'->>'size')::bigint between 1 and 10485760 and value->'file'->>'type' in('image/jpeg','image/png','image/webp','application/pdf') and value->'file'->>'digest' ~ '^[a-f0-9]{64}$',false) then raise exception 'Invalid receipt file' using errcode='22023';end if;
  i.attachment_id:=case when value->>'action'<>'delete' then gen_random_uuid() end;
  insert into app_private.budget_receipt_intents(request_id,user_id,session_id,trip_id,actual_id,signature,action,base_revision,versions,attachment_id,object_path,file_name,file_type,file_size,digest,old_receipt,old_object_id)
  values(request,auth.uid(),sid,trip,rid,signature,value->>'action',base,value->'versions',i.attachment_id,case when i.attachment_id is not null then 'trips/'||trip||'/attachments/actual_expense/'||rid||'/receipts/'||i.attachment_id||'/'||request||'/file' end,value->'file'->>'name',value->'file'->>'type',(value->'file'->>'size')::bigint,value->'file'->>'digest',case when old.id is not null then to_jsonb(old) end,o.id) returning * into i;
 end if;
 if phase='begin' then return jsonb_build_object('replayed',true,'result',app_private.receipt_inspect(trip,rid,sid,request));end if;
 if i.expires_at<=clock_timestamp() then raise exception 'Receipt intent expired' using errcode='55000';end if;
 if phase='abort' then
  update app_private.budget_receipt_intents set status='aborted' where request_id=request;
  insert into app_private.budget_receipt_cleanup(request_id,trip_id,actual_id,object_path,object_id,reason) select request,trip,rid,name,id,'abandoned upload' from storage.objects where bucket_id='trip-attachments' and name=i.object_path on conflict do nothing;
  return jsonb_build_object('replayed',true,'result',jsonb_build_object('aborted',true));
 end if;
 if i.old_receipt is not null and (select to_jsonb(x) from public.attachments x where id=(i.old_receipt->>'id')::uuid) is distinct from i.old_receipt then raise exception 'Original receipt changed' using errcode='40001';end if;
 if i.action<>'delete' then
  select * into o from storage.objects where bucket_id='trip-attachments' and name=i.object_path;
  if not found or (o.metadata->>'size')::bigint is distinct from i.file_size or o.metadata->>'mimetype' is distinct from i.file_type then raise exception 'Uploaded object not confirmed' using errcode='40001';end if;
  newrow.id:=i.attachment_id;newrow.trip_id:=trip;newrow.target_type:='actual_expense';newrow.target_id:=rid;newrow.file_name:=i.file_name;newrow.file_url:=i.object_path;newrow.file_type:=i.file_type;newrow.file_size:=i.file_size;newrow.uploaded_by:=auth.uid();newrow.created_at:=clock_timestamp();
 end if;
 manifest:=jsonb_build_object('old',i.old_receipt,'new',case when newrow.id is not null then to_jsonb(newrow) end);
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,receipt_manifest) values(txid_current(),pg_backend_pid(),auth.uid(),trip,'actual',rid,'receipts',sid,request,base,epoch,value,signature,manifest);
 return jsonb_build_object('replayed',false,'manifest',manifest);
end $$;
create function app_private.finish_receipt() returns jsonb language plpgsql security definer set search_path='' as $$
declare e app_private.budget_metadata_effects;i app_private.budget_receipt_intents;receipt_result jsonb;revision bigint;
begin
 select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='receipts';if not found then raise exception 'Receipt effect missing' using errcode='42501';end if;
 perform app_private.receipt_authority(e.trip_id,e.resource_id,e.session_id,nullif(current_setting('app.receipt_token',true),'')::uuid,e.lease_epoch,e.base_revision,e.value->'versions');
 if e.receipt_manifest->'new'<>'null'::jsonb and (select to_jsonb(x) from public.attachments x where id=(e.receipt_manifest->'new'->>'id')::uuid) is distinct from e.receipt_manifest->'new' or e.receipt_manifest->'old'<>'null'::jsonb and exists(select 1 from public.attachments where id=(e.receipt_manifest->'old'->>'id')::uuid) then raise exception 'Incomplete receipt metadata' using errcode='40001';end if;
 select * into i from app_private.budget_receipt_intents where request_id=e.request_id;
 if i.old_receipt is not null then insert into app_private.budget_receipt_cleanup(request_id,trip_id,actual_id,object_path,object_id,reason) values(i.request_id,i.trip_id,i.actual_id,i.old_receipt->>'file_url',i.old_object_id,i.action) on conflict do nothing;end if;
 update app_private.budget_metadata_groups g set revision=g.revision+1 where kind='actual' and resource_id=e.resource_id and group_key='receipts' returning g.revision into revision;
 receipt_result:=jsonb_build_object('id',e.resource_id,'kind','actual','group','receipts','request_id',e.request_id,'revision',revision,'value',app_private.receipt_value(e.resource_id),'undo_supported',false);
 update app_private.budget_receipt_intents set status='committed',result=receipt_result,object_id=(select id from storage.objects where bucket_id='trip-attachments' and name=i.object_path) where request_id=e.request_id;
 insert into app_private.budget_metadata_requests(user_id,request_id,trip_id,session_id,signature,result) values(e.user_id,e.request_id,e.trip_id,e.session_id,e.signature,receipt_result);
 delete from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id;
 delete from app_private.budget_metadata_effects where transaction_id=e.transaction_id and backend_id=e.backend_id;return receipt_result;
end $$;
revoke all on function app_private.prepare_receipt(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid,text),app_private.finish_receipt() from public,anon;
grant execute on function app_private.prepare_receipt(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid,text),app_private.finish_receipt() to authenticated;
create function public.mutate_budget_receipts(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_epoch bigint,p_base_revision bigint,p_value jsonb,p_request_id uuid,p_phase text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p jsonb;r public.attachments;
begin
 if p_kind is distinct from 'actual' then raise exception 'Invalid receipt kind' using errcode='22023';end if;
 p:=app_private.prepare_receipt(p_trip_id,p_id,p_session_id,p_token,p_epoch,p_base_revision,p_value,p_request_id,p_phase);if (p->>'replayed')::boolean then return p->'result';end if;
 perform set_config('app.receipt_token',p_token::text,true);
 if p->'manifest'->'new'<>'null'::jsonb then r:=jsonb_populate_record(null::public.attachments,p->'manifest'->'new');insert into public.attachments select(r).*;end if;
 if p->'manifest'->'old'<>'null'::jsonb then delete from public.attachments where id=(p->'manifest'->'old'->>'id')::uuid;end if;
 return app_private.finish_receipt();
end $$;
revoke all on function public.mutate_budget_receipts(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid,text) from public,anon;
grant execute on function public.mutate_budget_receipts(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid,text) to authenticated;

alter table app_private.budget_receipt_cleanup add column claim_actor uuid,add column claim_session uuid,add column claim_epoch bigint,add column claim_hash bytea,add column claim_versions jsonb;
create function app_private.receipt_path_protected(bucket text,path text) returns boolean language sql stable security definer set search_path='' as $$
 select bucket='trip-attachments' and (path ~ '^trips/[^/]+/attachments/actual_expense/[^/]+/receipts/' or app_private.receipts_activated() and (path ~ '^trips/[^/]+/attachments/actual_expense/' or exists(select 1 from public.attachments where target_type='actual_expense' and file_url=path)) or exists(select 1 from app_private.budget_receipt_intents where object_path=path) or exists(select 1 from app_private.budget_receipt_cleanup where object_path=path))
$$;
create function app_private.receipt_storage_allowed(bucket text,path text,operation text,object uuid,metadata jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
declare headers jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;g app_private.budget_metadata_groups;i app_private.budget_receipt_intents;c app_private.budget_receipt_cleanup;
 sid uuid;token uuid;epoch bigint;request uuid;
begin
 if not app_private.receipt_path_protected(bucket,path) then return true;end if;
 if auth.uid() is null then return false;end if;
 if operation='read' and exists(select 1 from public.attachments a where a.file_url=path and a.target_type='actual_expense' and app_private.can_read_trip(a.trip_id,auth.uid()) and exists(select 1 from public.actual_expenses where id=a.target_id and trip_id=a.trip_id)) then return true;end if;
 if operation='read' and exists(select 1 from app_private.budget_receipt_cleanup cleanup_row join app_private.budget_receipt_intents intent_row on intent_row.request_id=cleanup_row.request_id where cleanup_row.object_path=path and cleanup_row.object_id=object and cleanup_row.status<>'done' and intent_row.status='committed' and intent_row.old_receipt->>'file_url'=path and app_private.can_read_trip(cleanup_row.trip_id,auth.uid())) then return true;end if;
 if not app_private.receipts_enabled() or operation='update' then return false;end if;
 -- Signed-upload tokens, copy/move, resumable and S3 writes cannot extend a
 -- short-lived receipt capability. Only the standard authenticated upload and
 -- exact cleanup DELETE APIs are admitted; unknown backend versions fail closed.
 if operation='upload' and coalesce(current_setting('storage.operation',true),'') not in('storage.object.upload','object.upload') then return false;end if;
 if operation='delete' and coalesce(current_setting('storage.operation',true),'') not in('storage.object.delete','storage.object.delete_many','object.delete','object.delete_many') then return false;end if;
 sid:=(headers->>'x-receipt-session')::uuid;token:=(headers->>'x-receipt-token')::uuid;epoch:=(headers->>'x-receipt-epoch')::bigint;request:=(headers->>'x-receipt-request')::uuid;
 if sid is null or token is null or epoch is null or request is null then return false;end if;
 if operation in('upload','read') then
  select * into i from app_private.budget_receipt_intents where request_id=request and object_path=path and user_id=auth.uid() and session_id=sid and status='pending' and expires_at>statement_timestamp();
  if found and app_private.can_edit_trip(i.trip_id,auth.uid()) and i.versions=app_private.receipt_versions(i.actual_id) then
   select * into g from app_private.budget_metadata_groups where kind='actual' and resource_id=i.actual_id and group_key='receipts';
   if g.user_id=auth.uid() and g.session_id=sid and g.token_hash=sha256(convert_to(token::text,'UTF8')) and g.lease_epoch=epoch and g.revision=i.base_revision and g.expires_at>statement_timestamp() then return operation='read' or (metadata->>'size' is null or (metadata->>'size')::bigint=i.file_size) and (metadata->>'mimetype' is null or metadata->>'mimetype'=i.file_type);end if;
  end if;
 end if;
 if operation in('delete','read') then
  select * into c from app_private.budget_receipt_cleanup where id=request and object_path=path and object_id=object and status='claimed' and claim_until>statement_timestamp() and claim_token=(headers->>'x-receipt-cleanup')::uuid and claim_actor=auth.uid() and claim_session=sid and claim_epoch=epoch and claim_hash=sha256(convert_to(token::text,'UTF8'));
  if found and not exists(select 1 from public.attachments where file_url=path) and app_private.can_edit_trip(c.trip_id,auth.uid()) and c.claim_versions=app_private.receipt_versions(c.actual_id) then
   select * into g from app_private.budget_metadata_groups where kind='actual' and resource_id=c.actual_id and group_key='receipts';return g.user_id=auth.uid() and g.session_id=sid and g.token_hash=c.claim_hash and g.lease_epoch=epoch and g.expires_at>statement_timestamp();
  end if;
 end if;return false;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $$;
revoke all on function app_private.receipt_path_protected(text,text),app_private.receipt_storage_allowed(text,text,text,uuid,jsonb) from public,anon;
grant execute on function app_private.receipt_path_protected(text,text),app_private.receipt_storage_allowed(text,text,text,uuid,jsonb) to authenticated;
-- RESTRICTIVE policies intersect every existing permissive path, including old clients.
create policy "Receipt read boundary" on storage.objects as restrictive for select to authenticated using(app_private.receipt_storage_allowed(bucket_id,name,'read',id,metadata));
create policy "Receipt upload boundary" on storage.objects as restrictive for insert to authenticated with check(app_private.receipt_storage_allowed(bucket_id,name,'upload',id,metadata));
create policy "Receipt overwrite boundary" on storage.objects as restrictive for update to authenticated using(app_private.receipt_storage_allowed(bucket_id,name,'update',id,metadata)) with check(app_private.receipt_storage_allowed(bucket_id,name,'update',id,metadata));
create policy "Receipt delete boundary" on storage.objects as restrictive for delete to authenticated using(app_private.receipt_storage_allowed(bucket_id,name,'delete',id,metadata));

create function app_private.claim_receipt_cleanup(trip uuid,rid uuid,sid uuid,token uuid,epoch bigint,base bigint,versions jsonb,request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c app_private.budget_receipt_cleanup;
begin
 perform app_private.receipt_authority(trip,rid,sid,token,epoch,base,versions);
 select * into c from app_private.budget_receipt_cleanup where trip_id=trip and actual_id=rid and request_id=request and (status='waiting' or status='claimed' and claim_until<clock_timestamp()) order by created_at,id for update skip locked limit 1;
 if not found then return null;end if;
 if exists(select 1 from public.attachments where file_url=c.object_path) or exists(select 1 from storage.objects where bucket_id='trip-attachments' and name=c.object_path and id<>c.object_id) then update app_private.budget_receipt_cleanup set status='blocked',last_error='Object identity or reference changed' where id=c.id;return null;end if;
 update app_private.budget_receipt_cleanup set status='claimed',claim_actor=auth.uid(),claim_session=sid,claim_epoch=epoch,claim_hash=sha256(convert_to(token::text,'UTF8')),claim_versions=versions,claim_token=gen_random_uuid(),claim_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1 where id=c.id returning * into c;
 return jsonb_build_object('id',c.id,'path',c.object_path,'object_id',c.object_id,'token',c.claim_token);
end $$;
create function public.claim_budget_receipt_cleanup(p_trip_id uuid,p_id uuid,p_session_id uuid,p_token uuid,p_epoch bigint,p_base_revision bigint,p_versions jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select app_private.claim_receipt_cleanup(p_trip_id,p_id,p_session_id,p_token,p_epoch,p_base_revision,p_versions,p_request_id)$$;
create function app_private.finish_receipt_cleanup(job uuid,token uuid,error text) returns boolean language plpgsql security definer set search_path='' as $$
declare c app_private.budget_receipt_cleanup;
begin
 select * into c from app_private.budget_receipt_cleanup where id=job for update;
 if c.claim_token is distinct from token or c.status<>'claimed' or c.claim_until<=clock_timestamp() or c.claim_actor is null and current_setting('role')<>'service_role' or c.claim_actor is not null and c.claim_actor is distinct from auth.uid() then raise exception 'Cleanup claim lost' using errcode='42501';end if;
 if error is null and not exists(select 1 from storage.objects where bucket_id='trip-attachments' and name=c.object_path) then update app_private.budget_receipt_cleanup set status='done',claim_token=null,claim_until=null,last_error=null where id=job;return true;end if;
 update app_private.budget_receipt_cleanup set status='waiting',claim_token=null,claim_until=null,last_error=left(coalesce(error,'Object still present'),300) where id=job;return false;
end $$;
create function public.finish_budget_receipt_cleanup(p_job_id uuid,p_token uuid,p_error text) returns boolean language sql security invoker set search_path='' as $$select app_private.finish_receipt_cleanup(p_job_id,p_token,p_error)$$;
revoke all on function app_private.claim_receipt_cleanup(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid),public.claim_budget_receipt_cleanup(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid),app_private.finish_receipt_cleanup(uuid,uuid,text),public.finish_budget_receipt_cleanup(uuid,uuid,text) from public,anon;
grant execute on function app_private.claim_receipt_cleanup(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid),public.claim_budget_receipt_cleanup(uuid,uuid,uuid,uuid,bigint,bigint,jsonb,uuid),app_private.finish_receipt_cleanup(uuid,uuid,text),public.finish_budget_receipt_cleanup(uuid,uuid,text) to authenticated;
grant execute on function app_private.finish_receipt_cleanup(uuid,uuid,text),public.finish_budget_receipt_cleanup(uuid,uuid,text) to service_role;

create function app_private.sweep_receipts() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if current_setting('role')<>'service_role' then raise exception 'Worker only' using errcode='42501';end if;
 update app_private.budget_receipt_intents set status='aborted' where status='pending' and expires_at<=clock_timestamp();
 -- Never delete an object merely because a browser failed. Expire its persisted
 -- intent first; lock-free Storage inserts subsequently fail their RLS check.
 insert into app_private.budget_receipt_cleanup(request_id,trip_id,actual_id,object_path,object_id,reason)
 select i.request_id,i.trip_id,i.actual_id,o.name,o.id,'expired upload' from app_private.budget_receipt_intents i join storage.objects o on o.bucket_id='trip-attachments' and o.name=i.object_path where i.status='aborted' and not exists(select 1 from public.attachments where file_url=o.name) on conflict do nothing;
 -- Legacy canonical Actual orphans only. Malformed/other-workspace objects are
 -- never guessed or deleted; exact Storage IDs are retained in the journal.
 insert into app_private.budget_receipt_cleanup(trip_id,actual_id,object_path,object_id,reason)
 select split_part(o.name,'/',2)::uuid,split_part(o.name,'/',5)::uuid,o.name,o.id,'orphan inventory' from storage.objects o where app_private.receipts_activated() and o.bucket_id='trip-attachments' and o.name ~ '^trips/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/attachments/actual_expense/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/.+' and o.metadata->>'size' is not null and not exists(select 1 from public.attachments where file_url=o.name) and not exists(select 1 from app_private.budget_receipt_intents where object_path=o.name and status='pending') on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;
create function public.sweep_budget_receipts() returns integer language sql security invoker set search_path='' as $$select app_private.sweep_receipts()$$;
create function app_private.worker_claim_receipt() returns jsonb language plpgsql security definer set search_path='' as $$
declare c app_private.budget_receipt_cleanup;
begin
 if current_setting('role')<>'service_role' then raise exception 'Worker only' using errcode='42501';end if;
 select * into c from app_private.budget_receipt_cleanup where status='waiting' or status='claimed' and claim_until<clock_timestamp() order by created_at,id for update skip locked limit 1;if not found then return null;end if;
 if exists(select 1 from public.attachments where file_url=c.object_path) or exists(select 1 from storage.objects where bucket_id='trip-attachments' and name=c.object_path and id<>c.object_id) then update app_private.budget_receipt_cleanup set status='blocked',last_error='Object identity or reference changed' where id=c.id;return null;end if;
 update app_private.budget_receipt_cleanup set status='claimed',claim_actor=null,claim_session=null,claim_epoch=null,claim_hash=null,claim_versions=null,claim_token=gen_random_uuid(),claim_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1 where id=c.id returning * into c;return jsonb_build_object('id',c.id,'path',c.object_path,'object_id',c.object_id,'token',c.claim_token);
end $$;
create function public.claim_budget_receipt_worker() returns jsonb language sql security invoker set search_path='' as $$select app_private.worker_claim_receipt()$$;
revoke all on function app_private.sweep_receipts(),public.sweep_budget_receipts(),app_private.worker_claim_receipt(),public.claim_budget_receipt_worker() from public,anon,authenticated;
grant execute on function app_private.sweep_receipts(),public.sweep_budget_receipts(),app_private.worker_claim_receipt(),public.claim_budget_receipt_worker() to service_role;
grant usage on schema app_private to service_role;

create function app_private.guard_receipt_metadata() returns trigger language plpgsql security definer set search_path='' as $$
declare b jsonb;a jsonb;e jsonb:=app_private.receipt_effect();d jsonb;
begin
 if tg_op<>'INSERT' then b:=to_jsonb(old);end if;if tg_op<>'DELETE' then a:=to_jsonb(new);end if;d:=coalesce(a,b);
 if (a->>'target_type'='actual_expense' or b->>'target_type'='actual_expense') and app_private.receipts_activated() then
  if not app_private.receipts_enabled() or e is null or tg_op='UPDATE' or tg_op='INSERT' and a is distinct from e->'new' or tg_op='DELETE' and b is distinct from e->'old' then raise exception 'Receipt protocol required' using errcode='55000';end if;
 end if;
 if a is not null and app_private.receipt_path_protected('trip-attachments',a->>'file_url') and a->>'target_type'<>'actual_expense' then raise exception 'Receipt object cannot be aliased to another workspace' using errcode='55000';end if;
 return coalesce(new,old);
end $$;
create trigger zz_receipt_metadata before insert or update or delete on public.attachments for each row execute function app_private.guard_receipt_metadata();
create function app_private.track_receipts() returns trigger language plpgsql security definer set search_path='' as $$
declare b jsonb;a jsonb;rid uuid;
begin
 if tg_op<>'INSERT' then b:=to_jsonb(old);end if;if tg_op<>'DELETE' then a:=to_jsonb(new);end if;
 if tg_table_name='actual_expenses' then
  rid:=coalesce((a->>'id')::uuid,(b->>'id')::uuid);
  if tg_op='DELETE' and app_private.receipts_activated() and (exists(select 1 from public.attachments where target_type='actual_expense' and target_id=rid) or exists(select 1 from app_private.budget_receipt_intents where actual_id=rid and status='pending')) then raise exception 'Receipt-bearing Actual lifecycle not enabled' using errcode='55000';end if;
  if tg_op='INSERT' then insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) values('actual',rid,'receipts',(a->>'trip_id')::uuid) on conflict(kind,resource_id,group_key) do update set is_deleted=false,revision=budget_metadata_groups.revision+1,lease_epoch=budget_metadata_groups.lease_epoch+1,user_id=null,session_id=null,token_hash=null,expires_at=null;end if;
  if tg_op='DELETE' then update app_private.budget_metadata_groups set is_deleted=true,revision=revision+1,lease_epoch=lease_epoch+1,user_id=null,session_id=null,token_hash=null,expires_at=null where kind='actual' and resource_id=rid and group_key='receipts';end if;
 elsif app_private.receipt_effect() is null then
  for rid in select distinct (d->>'target_id')::uuid from unnest(array[a,b]) d where d->>'target_type'='actual_expense' loop update app_private.budget_metadata_groups set revision=revision+1 where kind='actual' and resource_id=rid and group_key='receipts';end loop;
 end if;return null;
end $$;
create trigger zzzzz_receipt_actual after insert or delete on public.actual_expenses for each row execute function app_private.track_receipts();
create trigger zzzzz_receipt_attachment after insert or update or delete on public.attachments for each row execute function app_private.track_receipts();
revoke all on function app_private.guard_receipt_metadata(),app_private.track_receipts() from public,anon,authenticated;

create function app_private.receipt_projection(trip uuid,sid uuid) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('protocol',jsonb_build_object('name','budget-receipts','schemaVersion',1,'enabled',app_private.receipts_enabled()),'records',coalesce(jsonb_agg(jsonb_build_object('kind','actual','id',a.id,'trip_id',trip,'supported',not g.is_deleted and app_private.budget_payment_targets('actual',a.id) is not null,'revision',g.revision,'epoch',g.lease_epoch,'value',app_private.receipt_value(a.id),'held',coalesce(g.user_id is not null and g.expires_at>statement_timestamp(),false),'owner_id',case when g.expires_at>statement_timestamp() then g.user_id end,'own_session',coalesce(g.user_id=auth.uid() and g.session_id=sid and g.expires_at>statement_timestamp(),false),'cleanup_receipts',coalesce((select jsonb_agg(i.old_receipt order by c.created_at,c.id) from app_private.budget_receipt_cleanup c join app_private.budget_receipt_intents i on i.request_id=c.request_id join storage.objects o on o.bucket_id='trip-attachments' and o.name=c.object_path and o.id=c.object_id where c.actual_id=a.id and c.status<>'done' and i.status='committed' and i.old_receipt is not null),'[]'),'cleanup_pending',exists(select 1 from app_private.budget_receipt_cleanup where actual_id=a.id and status<>'done')) order by a.id),'[]'),
 'entries',coalesce(jsonb_agg(jsonb_build_object('kind','actual','resource_id',a.id,'group_key','receipts','user_id',g.user_id,'mode','edit','expires_at',g.expires_at,'own_session',g.user_id=auth.uid() and g.session_id=sid)) filter(where g.user_id is not null and g.expires_at>statement_timestamp()),'[]'),
 'nextRefreshAt',min(g.expires_at) filter(where g.user_id is not null and g.expires_at>statement_timestamp())) from public.actual_expenses a join app_private.budget_metadata_groups g on g.kind='actual' and g.resource_id=a.id and g.group_key='receipts' where a.trip_id=trip and app_private.can_read_trip(trip,auth.uid())
$$;
create function public.read_budget_metadata_snapshot_v7(p_trip_id uuid,p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with f as materialized(select public.read_budget_metadata_snapshot_v6(p_trip_id,p_session_id) v),r as materialized(select app_private.receipt_projection(p_trip_id,p_session_id) v) select f.v||jsonb_build_object('metadataProtocol',jsonb_set(f.v->'metadataProtocol','{schemaVersion}','7'),'receiptProtocol',r.v->'protocol','receiptRecords',r.v->'records','collaboration',jsonb_set(f.v->'collaboration','{entries}',(f.v->'collaboration'->'entries')||(r.v->'entries')),'nextRefreshAt',least((f.v->>'nextRefreshAt')::timestamptz,(r.v->>'nextRefreshAt')::timestamptz)) from f cross join r where f.v is not null
$$;
revoke all on function app_private.receipt_projection(uuid,uuid),public.read_budget_metadata_snapshot_v7(uuid,uuid) from public,anon;
grant execute on function app_private.receipt_projection(uuid,uuid),public.read_budget_metadata_snapshot_v7(uuid,uuid) to authenticated;
-- Receipt integration definitions
create or replace function app_private.guard_budget_edit_lease() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_data jsonb; new_data jsonb; k text; ids uuid[]:='{}'; resource uuid;
  context_kind text:=current_setting('app.budget_edit_kind',true);
  context_id text:=current_setting('app.budget_edit_id',true);
  sid uuid:=nullif(current_setting('app.budget_edit_session',true),'')::uuid;
  token uuid:=nullif(current_setting('app.budget_edit_token',true),'')::uuid;
begin
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
create or replace function app_private.guard_budget_metadata_undo_boundary() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; rec jsonb; k text; ids uuid[]; resource uuid; trip uuid;
begin
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
create or replace function app_private.record_budget_metadata_undo() returns trigger
language plpgsql security definer set search_path='' as $$
declare effect app_private.budget_metadata_effects; intent app_private.budget_metadata_undo_intents;
  op app_private.budget_metadata_undo_operations; lineage app_private.budget_metadata_undo_lineage;
  expected bigint; previous uuid; changed boolean; result jsonb;
begin
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
create or replace function app_private.guard_budget_metadata_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_data jsonb; after_data jsonb; data jsonb; k text; active boolean; g text; independent_text boolean:=false;
  price jsonb; effect app_private.budget_metadata_effects; held app_private.budget_metadata_groups;
begin
  if tg_op<>'INSERT' then before_data:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_data:=to_jsonb(new); end if;
  data:=coalesce(after_data,before_data); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
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
     or (before_data-array['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type','updated_at']) is distinct from (after_data-array['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type','updated_at'])
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
commit;
