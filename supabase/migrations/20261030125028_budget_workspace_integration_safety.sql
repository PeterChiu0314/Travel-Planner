-- B-7: forward-only cascade fences, scoped receipt worker and trusted byte verification.
begin;
-- The legacy immutable request ledger already has no client grants. Also
-- protect it with RLS, consistently with every other private protocol table.
alter table app_private.budget_workspace_requests enable row level security;
alter table app_private.budget_receipt_protocol add column content_worker_verified boolean not null default false;
create or replace function app_private.latch_budget_receipts() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.enabled and not old.enabled and (new.legacy_grants_expire_at is null or new.legacy_grants_expire_at>clock_timestamp()
  or not new.storage_verified or not new.cleanup_worker_verified or not new.content_worker_verified
  or not exists(select 1 from storage.buckets where id='trip-attachments' and not public and file_size_limit=10485760 and allowed_mime_types @> array['image/jpeg','image/png','image/webp','application/pdf'])) then
  raise exception 'Receipt activation requires verified HTTP, scoped content worker, cleanup and expired legacy upload grants' using errcode='55000';end if;
 new.activated:=old.activated or new.enabled;return new;end $$;

-- This role is a server identity, never a browser user, and does not inherit
-- authenticated/service_role/BYPASSRLS. Storage sees only exact durable claims.
create role budget_receipt_worker nologin noinherit nobypassrls;
grant usage on schema public,app_private,storage to budget_receipt_worker;
grant select on storage.buckets to budget_receipt_worker;
grant select,delete on storage.objects to budget_receipt_worker;
do $$declare r text;begin
 foreach r in array array['authenticator','supabase_storage_admin'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('grant budget_receipt_worker to %I',r);end if;
 end loop;
end $$;

alter table app_private.budget_receipt_intents add column verified_object_id uuid,add column verified_at timestamptz,
 add column verification_token uuid,add column verification_until timestamptz,add column verification_attempts integer not null default 0,
 add column verification_retry_at timestamptz,add column verification_error text;

create function app_private.receipt_worker_object_allowed(path text,object uuid,operation text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare h jsonb:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
begin
 if current_setting('role')<>'budget_receipt_worker' then return false;end if;
 if operation='read' and exists(select 1 from app_private.budget_receipt_intents i where i.request_id=(h->>'x-receipt-worker-job')::uuid
  and i.object_path=path and i.object_id=object and i.status='pending' and i.expires_at>statement_timestamp()
  and i.verification_until>statement_timestamp() and i.verification_token=(h->>'x-receipt-worker-token')::uuid) then return true;end if;
 return exists(select 1 from app_private.budget_receipt_cleanup c where c.id=(h->>'x-receipt-worker-job')::uuid
  and c.object_path=path and c.object_id=object and c.status='claimed' and c.claim_actor is null
  and c.claim_until>statement_timestamp() and c.claim_token=(h->>'x-receipt-worker-token')::uuid
  and not exists(select 1 from public.attachments a where a.file_url=path));
exception when invalid_text_representation then return false;
end $$;
revoke all on function app_private.receipt_worker_object_allowed(text,uuid,text) from public,anon,authenticated;
grant execute on function app_private.receipt_worker_object_allowed(text,uuid,text) to budget_receipt_worker;
create policy "Receipt worker scoped read" on storage.objects for select to budget_receipt_worker
 using(bucket_id='trip-attachments' and app_private.receipt_worker_object_allowed(name,id,'read'));
create policy "Receipt worker scoped delete" on storage.objects for delete to budget_receipt_worker
 using(bucket_id='trip-attachments' and app_private.receipt_worker_object_allowed(name,id,'delete'));
create policy "Receipt worker bucket" on storage.buckets for select to budget_receipt_worker using(id='trip-attachments');

create function public.claim_budget_receipt_verification() returns jsonb language plpgsql security invoker set search_path='' as $$
begin return app_private.claim_receipt_verification();end $$;
create function app_private.claim_receipt_verification() returns jsonb language plpgsql security definer set search_path='' as $$
declare i app_private.budget_receipt_intents;o storage.objects;
begin
 if current_setting('role')<>'budget_receipt_worker' then raise exception 'Worker only' using errcode='42501';end if;
 select x.* into i from app_private.budget_receipt_intents x where x.status='pending' and x.action<>'delete'
  and x.expires_at>clock_timestamp() and (x.verification_until is null or x.verification_until<clock_timestamp())
  and (x.verification_retry_at is null or x.verification_retry_at<=clock_timestamp())
  and exists(select 1 from storage.objects s where s.bucket_id='trip-attachments' and s.name=x.object_path
    and (x.verified_object_id is distinct from s.id or x.verified_at is null))
  order by x.created_at,x.request_id for update skip locked limit 1;
 if not found then return null;end if;
 select * into o from storage.objects where bucket_id='trip-attachments' and name=i.object_path;
 update app_private.budget_receipt_intents set object_id=o.id,verified_object_id=null,verified_at=null,
  verification_token=gen_random_uuid(),verification_until=clock_timestamp()+interval '2 minutes',
  verification_attempts=verification_attempts+1 where request_id=i.request_id returning * into i;
 return jsonb_build_object('id',i.request_id,'path',i.object_path,'object_id',o.id,'token',i.verification_token,
  'size',i.file_size,'type',i.file_type,'digest',i.digest);
end $$;
create function app_private.finish_receipt_verification(job uuid,token uuid,object uuid,digest text,size bigint,mime text,error text) returns boolean
language plpgsql security definer set search_path='' as $$
declare i app_private.budget_receipt_intents;
begin
 if current_setting('role')<>'budget_receipt_worker' then raise exception 'Worker only' using errcode='42501';end if;
 select * into i from app_private.budget_receipt_intents where request_id=job for update;
 if i.request_id is null or i.verification_token is distinct from token or i.verification_until<=clock_timestamp()
  or i.status<>'pending' or i.expires_at<=clock_timestamp() then raise exception 'Verification claim lost' using errcode='42501';end if;
 if error is null and i.object_id=object and i.digest=digest and i.file_size=size and i.file_type=mime
  and exists(select 1 from storage.objects s where s.id=object and s.bucket_id='trip-attachments' and s.name=i.object_path
   and (s.metadata->>'size')::bigint=size and s.metadata->>'mimetype'=mime) then
  update app_private.budget_receipt_intents set verified_object_id=object,verified_at=clock_timestamp(),verification_error=null,
   verification_token=null,verification_until=null,verification_retry_at=null where request_id=job;return true;
 end if;
 update app_private.budget_receipt_intents set verified_object_id=null,verified_at=null,verification_token=null,verification_until=null,
  verification_error=left(coalesce(error,'Receipt content or identity mismatch'),300),verification_retry_at=clock_timestamp()+interval '1 minute'
  where request_id=job;return false;
end $$;
create function public.finish_budget_receipt_verification(p_job_id uuid,p_token uuid,p_object_id uuid,p_digest text,p_size bigint,p_type text,p_error text)
returns boolean language sql security invoker set search_path='' as $$select app_private.finish_receipt_verification(p_job_id,p_token,p_object_id,p_digest,p_size,p_type,p_error)$$;
revoke all on function public.claim_budget_receipt_verification(),app_private.claim_receipt_verification(),
 public.finish_budget_receipt_verification(uuid,uuid,uuid,text,bigint,text,text),app_private.finish_receipt_verification(uuid,uuid,uuid,text,bigint,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.claim_budget_receipt_verification(),app_private.claim_receipt_verification(),
 public.finish_budget_receipt_verification(uuid,uuid,uuid,text,bigint,text,text),app_private.finish_receipt_verification(uuid,uuid,uuid,text,bigint,text,text)
 to budget_receipt_worker;
revoke all on function public.sweep_budget_receipts(),app_private.sweep_receipts(),public.claim_budget_receipt_worker(),app_private.worker_claim_receipt()
 from service_role;
grant execute on function public.sweep_budget_receipts(),app_private.sweep_receipts(),public.claim_budget_receipt_worker(),app_private.worker_claim_receipt(),
 public.finish_budget_receipt_cleanup(uuid,uuid,text),app_private.finish_receipt_cleanup(uuid,uuid,text) to budget_receipt_worker;

-- External parent deletion never impersonates a workspace lifecycle manifest.
-- Budget Links do not mirror to Actual. A safe single retained graph may
-- change/Undo its own itinerary IDs without editing financial/history rows.
create or replace function app_private.budget_text_supported(k text,rid uuid,g text) returns boolean language sql stable security definer set search_path='' as $$
 select (app_private.budget_source_enabled() and k='actual' and g in('title','note') and exists(select 1 from public.actual_expenses where id=rid))
  or app_private.budget_metadata_supported(k,rid)
  or app_private.budget_payment_enabled() and k='budget' and g in('title','note') and exists(select 1 from public.budget_items where id=rid and not is_fixed)
  or app_private.budget_finance_enabled() and k='budget' and g='links'
   and exists(select 1 from public.budget_items where id=rid and not is_fixed)
   and jsonb_array_length(app_private.budget_payment_targets(k,rid)) between 1 and 2
$$;
do $$declare body text;begin
 body:=pg_get_functiondef('app_private.guard_budget_metadata_children()'::regprocedure);
 if position('not app_private.budget_metadata_supported(k,resource)' in body)=0 then raise exception 'Unknown Links child guard shape';end if;
 execute replace(body,'not app_private.budget_metadata_supported(k,resource)','not app_private.budget_text_supported(k,resource,''links'')');
 body:=pg_get_functiondef('app_private.read_budget_metadata_state_v3(uuid,uuid)'::regprocedure);
 if position('else r.supported end group_supported' in body)=0 then raise exception 'Unknown Links Snapshot shape';end if;
 execute replace(body,'else r.supported end group_supported','when k.group_key=''links'' then app_private.budget_text_supported(r.kind,r.id,''links'') else r.supported end group_supported');
end $$;

-- Old whole-form clients get a clear protocol error before legacy pricing or
-- participant validation, while an exact already-committed receipt can replay.
create function app_private.legacy_budget_blocked(trip uuid) returns boolean language sql stable security definer set search_path='' as $$
 select app_private.can_edit_trip(trip,auth.uid()) and (app_private.budget_finance_activated() or app_private.budget_lifecycle_activated() or app_private.receipts_activated())
$$;
create function app_private.replay_legacy_budget(trip uuid,k text,rid uuid,base timestamptz,payload jsonb,request uuid,v integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare sig text;r app_private.budget_workspace_requests;
begin
 if auth.uid() is null or not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if v=3 then sig:=md5(jsonb_build_object('v',3,'kind',k,'id',rid,'base',base,'payload',payload)::text);
 else sig:=md5(jsonb_build_object('kind',k,'id',rid,'base',base,'payload',payload)::text);end if;
 select * into r from app_private.budget_workspace_requests where user_id=auth.uid() and request_id=request;
 if found then
  if r.trip_id is distinct from trip or r.signature is distinct from sig then raise exception 'Request content changed' using errcode='22023';end if;
  return r.result;
 end if;
 raise exception 'Budget group protocol required; refresh this client' using errcode='55000';
end $$;
revoke all on function app_private.legacy_budget_blocked(uuid),app_private.replay_legacy_budget(uuid,text,uuid,timestamptz,jsonb,uuid,integer) from public,anon;
grant execute on function app_private.legacy_budget_blocked(uuid),app_private.replay_legacy_budget(uuid,text,uuid,timestamptz,jsonb,uuid,integer) to authenticated;
do $$declare name text;f regprocedure;body text;gate text;ver text;req text;begin
 foreach name in array array['save_budget_workspace_record','save_budget_workspace_record_v2','save_budget_workspace_record_v3','save_budget_workspace_record_v4'] loop
  f:=case when name='save_budget_workspace_record' then 'public.save_budget_workspace_record(uuid,text,uuid,timestamptz,jsonb)'::regprocedure
   when name='save_budget_workspace_record_v4' then 'public.save_budget_workspace_record_v4(uuid,text,uuid,timestamptz,jsonb,uuid,uuid,uuid)'::regprocedure
   when name='save_budget_workspace_record_v3' then 'public.save_budget_workspace_record_v3(uuid,text,uuid,timestamptz,jsonb,uuid)'::regprocedure
   else 'public.save_budget_workspace_record_v2(uuid,text,uuid,timestamptz,jsonb,uuid)'::regprocedure end;
  req:=case when name='save_budget_workspace_record' then 'null::uuid' else 'p_request_id' end;
  ver:=case when name='save_budget_workspace_record_v3' then '3' when name='save_budget_workspace_record_v4' then 'case when p_kind=''budget'' and coalesce((p_payload->>''unified_planning'')::boolean,false) then 3 else 2 end' else '2' end;
  gate:='IF app_private.legacy_budget_blocked(p_trip_id) THEN RETURN app_private.replay_legacy_budget(p_trip_id,p_kind,p_id,p_base_updated_at,p_payload,'||req||','||ver||'); END IF;';
  body:=pg_get_functiondef(f);
  if body !~ E'(?i)\nbegin\\s*\n' then raise exception 'Unknown legacy function shape: %',f;end if;
  execute regexp_replace(body,E'(?i)\nbegin\\s*\n',E'\nBEGIN\n'||gate||E'\n');
 end loop;
 -- Do not let direct invoker prerequisite calls fabricate new old-ledger rows.
 body:=pg_get_functiondef('app_private.budget_workspace_request(uuid,uuid,text,text,uuid)'::regprocedure);
 if position('if p_record is null then return null; end if;' in body)=0 then raise exception 'Unknown old request ledger shape';end if;
 body:=replace(body,'if p_record is null then return null; end if;',
  'if p_record is null then return null; end if; if app_private.legacy_budget_blocked(p_trip) then raise exception ''Budget group protocol required'' using errcode=''55000'';end if;');
 execute body;
end $$;

-- Legacy child guards only fenced active leases. After activation even an
-- otherwise valid raw share/link change must have the exact existing effect.
create function app_private.guard_budget_group_children_required() returns trigger language plpgsql security definer set search_path='' as $$
declare b jsonb;a jsonb;k text;rid uuid;ids uuid[];
begin
 if not (app_private.budget_finance_activated() or app_private.budget_lifecycle_activated() or app_private.receipts_activated()) then return coalesce(new,old);end if;
 -- The database owner can seed/repair in an audited DBA transaction. API
 -- authenticator, service_role, worker and independent LOGINs never take this.
 if auth.uid() is null and session_user=(select pg_get_userbyid(datdba) from pg_database where datname=current_database()) then return coalesce(new,old);end if;
 if tg_op<>'INSERT' then b:=to_jsonb(old);end if;if tg_op<>'DELETE' then a:=to_jsonb(new);end if;
 k:=case when tg_table_name='actual_expense_participants' then 'actual' else 'budget' end;
 ids:=case when k='actual' then array[(b->>'actual_expense_id')::uuid,(a->>'actual_expense_id')::uuid] else array[(b->>'budget_item_id')::uuid,(a->>'budget_item_id')::uuid] end;
 for rid in select distinct id from unnest(ids) id where id is not null order by id loop
  if tg_op='DELETE' and app_private.budget_lifecycle_effect(k,rid,'delete') is not null then continue;end if;
  if tg_table_name='itinerary_budget_items' then
   if exists(select 1 from app_private.budget_metadata_effects e where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and kind='budget' and resource_id=rid and group_key='links') then continue;end if;
  else
   if app_private.budget_pricing_effect(k,rid) is not null then continue;end if;
   if k='actual' and (app_private.budget_payment_effect(k,rid) is not null or app_private.budget_source_effect(k,rid) is not null) then continue;end if;
  end if;
  raise exception 'Budget group effect required for participant or link write' using errcode='55000';
 end loop;
 return coalesce(new,old);
end $$;
revoke all on function app_private.guard_budget_group_children_required() from public,anon,authenticated,service_role,budget_receipt_worker;
create trigger a_group_effect_required before insert or update or delete on public.budget_item_participants for each row execute function app_private.guard_budget_group_children_required();
create trigger a_group_effect_required before insert or update or delete on public.actual_expense_participants for each row execute function app_private.guard_budget_group_children_required();
create trigger a_group_effect_required before insert or update or delete on public.itinerary_budget_items for each row execute function app_private.guard_budget_group_children_required();

create or replace function app_private.guard_legacy_budget_metadata_lease() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.expires_at>clock_timestamp() and (app_private.budget_finance_activated() or app_private.budget_lifecycle_activated() or app_private.receipts_activated()) then
  raise exception 'Budget group protocol required; refresh this client' using errcode='55000';
 end if;
 if new.expires_at>clock_timestamp() and app_private.budget_metadata_record(new.kind,new.resource_id)->>'record_status'='incomplete' then raise exception 'Incomplete uses group leases only' using errcode='55000';end if;
 if new.expires_at>clock_timestamp() and app_private.budget_metadata_live(new.kind,new.resource_id) then raise exception 'group_locked' using errcode='55P03';end if;
 return new;
end $$;

-- A separate future archival/delete protocol must enumerate bytes, history,
-- baselines and participants first. No GUC/client flag bypass is provided.
create function app_private.guard_budget_external_parent() returns trigger language plpgsql security definer set search_path='' as $$
declare protected boolean:=false;
begin
 if not (app_private.budget_finance_activated() or app_private.budget_lifecycle_activated() or app_private.receipts_activated()) then return old;end if;
 if tg_table_name='trips' then
  protected:=exists(select 1 from public.budget_items where trip_id=old.id)
   or exists(select 1 from public.actual_expenses where trip_id=old.id)
   or exists(select 1 from public.trip_budget_baselines where trip_id=old.id)
   or exists(select 1 from app_private.budget_receipt_intents where trip_id=old.id)
   or exists(select 1 from app_private.budget_receipt_cleanup where trip_id=old.id);
 elsif tg_table_name='itinerary_items' then
  protected:=exists(select 1 from public.itinerary_budget_items where itinerary_item_id in(old.id,old.from_item_id,old.to_item_id));
 elsif tg_table_name='accommodations' then protected:=old.budget_item_id is not null;
 elsif tg_table_schema='auth' and tg_table_name='users' then
  protected:=exists(select 1 from public.trips where owner_id=old.id)
   or exists(select 1 from public.budget_items where payer_id=old.id)
   or exists(select 1 from public.actual_expenses where payer_id=old.id)
   or exists(select 1 from public.budget_item_participants where user_id=old.id)
   or exists(select 1 from public.actual_expense_participants where user_id=old.id)
   or exists(select 1 from app_private.budget_receipt_intents where user_id=old.id)
   or exists(select 1 from public.attachments where target_type='actual_expense' and uploaded_by=old.id)
   or exists(select 1 from public.trip_members m where m.user_id=old.id and
    (exists(select 1 from public.budget_items where trip_id=m.trip_id) or exists(select 1 from public.actual_expenses where trip_id=m.trip_id)));
 end if;
 if protected then raise exception 'Budget dependencies prevent parent deletion' using errcode='0A000',
  detail='BUDGET_PARENT_DELETE_BLOCKED',hint='預算協作資料仍有財務、來源、收據或分攤相依；目前不支援連帶刪除，所有資料已保留。';end if;
 return old;
end $$;
revoke all on function app_private.guard_budget_external_parent() from public,anon,authenticated,service_role;
create trigger a_budget_parent_delete before delete on public.trips for each row execute function app_private.guard_budget_external_parent();
create trigger a_budget_parent_delete before delete on public.itinerary_items for each row execute function app_private.guard_budget_external_parent();
create trigger a_budget_parent_delete before delete on public.accommodations for each row execute function app_private.guard_budget_external_parent();
create trigger a_budget_parent_delete before delete on auth.users for each row execute function app_private.guard_budget_external_parent();

create or replace function app_private.prepare_receipt(trip uuid,rid uuid,sid uuid,token uuid,epoch bigint,base bigint,value jsonb,request uuid,phase text) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if i.verified_object_id is distinct from o.id or i.verified_at is null then raise exception 'Receipt content verification pending; original receipt preserved' using errcode='55000',hint='RECEIPT_VERIFICATION_PENDING';end if;
  newrow.id:=i.attachment_id;newrow.trip_id:=trip;newrow.target_type:='actual_expense';newrow.target_id:=rid;newrow.file_name:=i.file_name;newrow.file_url:=i.object_path;newrow.file_type:=i.file_type;newrow.file_size:=i.file_size;newrow.uploaded_by:=auth.uid();newrow.created_at:=clock_timestamp();
 end if;
 manifest:=jsonb_build_object('old',i.old_receipt,'new',case when newrow.id is not null then to_jsonb(newrow) end);
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,receipt_manifest) values(txid_current(),pg_backend_pid(),auth.uid(),trip,'actual',rid,'receipts',sid,request,base,epoch,value,signature,manifest);
 return jsonb_build_object('replayed',false,'manifest',manifest);
end $$;
create or replace function app_private.receipt_inspect(trip uuid,rid uuid,sid uuid,request uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare i app_private.budget_receipt_intents;o storage.objects;
begin
 if not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into i from app_private.budget_receipt_intents where request_id=request and user_id=auth.uid() and session_id=sid and trip_id=trip and actual_id=rid;if not found then return null;end if;
 select * into o from storage.objects where bucket_id='trip-attachments' and name=i.object_path;
 return jsonb_build_object('request_id',request,'status',i.status,'path',i.object_path,'attachment_id',i.attachment_id,'object_id',o.id,'object_ready',o.id is not null,'object_verified',o.id is not null and i.verified_object_id=o.id and i.verified_at is not null,'verification_error',i.verification_error,'result',i.result,'old_receipt',i.old_receipt,'cleanup_pending',exists(select 1 from app_private.budget_receipt_cleanup where request_id=request and status<>'done'));
end $$;
create or replace function app_private.sweep_receipts() returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if current_setting('role')<>'budget_receipt_worker' then raise exception 'Worker only' using errcode='42501';end if;
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
create or replace function app_private.worker_claim_receipt() returns jsonb language plpgsql security definer set search_path='' as $$
declare c app_private.budget_receipt_cleanup;
begin
 if current_setting('role')<>'budget_receipt_worker' then raise exception 'Worker only' using errcode='42501';end if;
 select * into c from app_private.budget_receipt_cleanup where status='waiting' or status='claimed' and claim_until<clock_timestamp() order by created_at,id for update skip locked limit 1;if not found then return null;end if;
 if exists(select 1 from public.attachments where file_url=c.object_path) or exists(select 1 from storage.objects where bucket_id='trip-attachments' and name=c.object_path and id<>c.object_id) then update app_private.budget_receipt_cleanup set status='blocked',last_error='Object identity or reference changed' where id=c.id;return null;end if;
 update app_private.budget_receipt_cleanup set status='claimed',claim_actor=null,claim_session=null,claim_epoch=null,claim_hash=null,claim_versions=null,claim_token=gen_random_uuid(),claim_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1 where id=c.id returning * into c;return jsonb_build_object('id',c.id,'path',c.object_path,'object_id',c.object_id,'token',c.claim_token);
end $$;
create or replace function app_private.finish_receipt_cleanup(job uuid,token uuid,error text) returns boolean language plpgsql security definer set search_path='' as $$
declare c app_private.budget_receipt_cleanup;
begin
 select * into c from app_private.budget_receipt_cleanup where id=job for update;
 if c.claim_token is distinct from token or c.status<>'claimed' or c.claim_until<=clock_timestamp() or c.claim_actor is null and current_setting('role')<>'budget_receipt_worker' or c.claim_actor is not null and c.claim_actor is distinct from auth.uid() then raise exception 'Cleanup claim lost' using errcode='42501';end if;
 if error is null and not exists(select 1 from storage.objects where bucket_id='trip-attachments' and name=c.object_path) then update app_private.budget_receipt_cleanup set status='done',claim_token=null,claim_until=null,last_error=null where id=job;return true;end if;
 update app_private.budget_receipt_cleanup set status='waiting',claim_token=null,claim_until=null,last_error=left(coalesce(error,'Object still present'),300) where id=job;return false;
end $$;

-- One transaction avoids the legacy browser's delete-transports-then-parent
-- partial failure. Parent triggers also fence old clients at their first delete.
create function public.delete_itinerary_item_budget_safe(p_trip_id uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='3s' set statement_timeout='10s' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.trip_members where trip_id=p_trip_id and user_id=auth.uid() and status='approved' and role in('owner','editor')) then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 perform 1 from public.itinerary_items where id=p_id and trip_id=p_trip_id for update nowait;
 if not found then raise exception 'Itinerary item unavailable' using errcode='40001';end if;
 delete from public.itinerary_items where trip_id=p_trip_id and (from_item_id=p_id or to_item_id=p_id);
 delete from public.itinerary_items where trip_id=p_trip_id and id=p_id;
 return jsonb_build_object('deleted',p_id);
end $$;
revoke all on function public.delete_itinerary_item_budget_safe(uuid,uuid) from public,anon;
grant execute on function public.delete_itinerary_item_budget_safe(uuid,uuid) to authenticated;
-- Empty trips must retain an array through every Snapshot version.
-- Activation/Pause must also drain legacy/raw statements, not just RPCs that
-- already lock protocol rows. Shared table locks coexist for normal writers;
-- the operator's EXCLUSIVE NOWAIT lock fails until those transactions finish.
create function app_private.fence_budget_protocol_transition() returns trigger language plpgsql security definer set search_path='' as $$
begin
 lock table app_private.budget_metadata_protocol,app_private.budget_finance_protocol,app_private.budget_payment_protocol,
  app_private.budget_source_protocol,app_private.budget_receipt_protocol,app_private.budget_lifecycle_protocol,
  app_private.budget_metadata_undo_protocol in row share mode nowait;
 return null;
end $$;
revoke all on function app_private.fence_budget_protocol_transition() from public,anon,authenticated,service_role,budget_receipt_worker;
do $$declare name text;begin
 foreach name in array array['budget_items','actual_expenses','budget_item_participants','actual_expense_participants','itinerary_budget_items','attachments'] loop
  execute format('create trigger a_budget_protocol_transition before insert or update or delete on public.%I for each statement execute function app_private.fence_budget_protocol_transition()',name);
 end loop;
 foreach name in array array['trips','itinerary_items','accommodations','trip_members'] loop
  execute format('create trigger a_budget_protocol_transition before update or delete on public.%I for each statement execute function app_private.fence_budget_protocol_transition()',name);
 end loop;
end $$;
create trigger a_budget_protocol_transition before delete on auth.users for each statement execute function app_private.fence_budget_protocol_transition();
create or replace function public.read_budget_metadata_snapshot_v8(p_trip_id uuid,p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with f as materialized(select public.read_budget_metadata_snapshot_v7(p_trip_id,p_session_id) v),p as materialized(select app_private.read_budget_finance_state(p_trip_id,p_session_id) v)
 select f.v||jsonb_build_object('metadataProtocol',jsonb_set(f.v->'metadataProtocol','{schemaVersion}','8'),'financeProtocol',p.v->'protocol','ratesRecords',p.v->'ratesRecords','metadataRecords',
 coalesce((select jsonb_agg(r||jsonb_build_object('groups',(select jsonb_agg(g||case when g->>'group' in('title','note','category','payer') then (p.v->'fields'->((r->>'kind')||':'||(r->>'id'))->(g->>'group'))-case when (p.v->'protocol'->>'enabled')::boolean then '' else 'supported' end else '{}'::jsonb end order by gn) from jsonb_array_elements(r->'groups') with ordinality gs(g,gn))) order by rn) from jsonb_array_elements(f.v->'metadataRecords') with ordinality rs(r,rn)),'[]'::jsonb)) from f cross join p where f.v is not null and p.v is not null
$$;
commit;
