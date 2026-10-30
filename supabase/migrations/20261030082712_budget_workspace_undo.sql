-- B-6. Extend the existing five-pointer Undo ledger; no second history system.
begin;
alter table app_private.budget_metadata_undo_protocol add column full_enabled boolean not null default false;
alter table app_private.budget_metadata_undo_operations drop constraint budget_metadata_undo_operations_group_key_check;
alter table app_private.budget_metadata_undo_operations add constraint budget_metadata_undo_operations_group_key_check check(group_key in('title','note','category','payer','links','pricing','lifecycle'));
alter table app_private.budget_metadata_undo_operations drop constraint budget_metadata_undo_operations_check;
alter table app_private.budget_metadata_undo_operations add constraint budget_metadata_undo_operations_check check(after_revision>=before_revision);
alter table app_private.budget_metadata_undo_lineage drop constraint budget_metadata_undo_lineage_group_key_check;
alter table app_private.budget_metadata_undo_lineage add constraint budget_metadata_undo_lineage_group_key_check check(group_key in('title','note','category','payer','links','pricing','lifecycle'));
alter table app_private.budget_metadata_undo_operations add column bundle jsonb,add column dependencies jsonb;
alter table app_private.budget_metadata_undo_stack add column expected_bundle jsonb;
alter table app_private.budget_metadata_effects add column undo_bundle jsonb;
create function app_private.workspace_undo_enabled() returns boolean language sql stable security definer set search_path='' as $$select enabled and full_enabled and app_private.budget_lifecycle_enabled() from app_private.budget_metadata_undo_protocol where singleton$$;
create function app_private.undo_group_value(k text,rid uuid,g text) returns jsonb language sql stable security definer set search_path='' as $$select case when g='pricing' then app_private.read_budget_pricing_value(k,rid)-'versions' when g='lifecycle' then app_private.budget_metadata_record(k,rid) else app_private.budget_metadata_value(k,rid,g) end$$;
create function app_private.undo_dependencies(k text,rid uuid,g text) returns jsonb language sql stable security definer set search_path='' as $$select case when g='pricing' then app_private.budget_pricing_versions(k,rid)-'targets' when g='lifecycle' then app_private.lifecycle_versions(k,rid) else '{}'::jsonb end$$;

-- Admission has locked the true targets. Capture authoritative narrow inputs
-- before any parent/child DML, including Participants and Links.
create function app_private.capture_workspace_undo_effect() returns trigger language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare targets jsonb;x jsonb;items jsonb:='[]';s app_private.budget_metadata_groups;l app_private.budget_metadata_undo_lineage;
begin
 if not app_private.workspace_undo_enabled() then return new;end if;
 if new.group_key in('title','note','category','payer','links','pricing') then
  targets:=coalesce(new.metadata_manifest,new.pricing_manifest,jsonb_build_array(jsonb_build_object('kind',new.kind,'id',new.resource_id)));
  for x in select v from jsonb_array_elements(targets) v order by v->>'kind',v->>'id' loop
   select * into s from app_private.budget_metadata_groups where kind=x->>'kind' and resource_id=(x->>'id')::uuid and group_key=new.group_key;
   select * into l from app_private.budget_metadata_undo_lineage where kind=s.kind and resource_id=s.resource_id and group_key=s.group_key;
   items:=items||jsonb_build_array(jsonb_build_object('kind',s.kind,'id',s.resource_id,'group',s.group_key,'before',app_private.undo_group_value(s.kind,s.resource_id,s.group_key),'before_revision',s.revision,'graph',(select graph_revision from app_private.budget_metadata_groups where kind=s.kind and resource_id=s.resource_id and group_key='pricing'),'predecessor',case when l.user_id=new.user_id and l.session_id=new.session_id and l.revision=s.revision then l.operation_id end));
  end loop;
  new.undo_bundle:=items;
 end if;return new;
end $$;
create trigger capture_workspace_undo before insert on app_private.budget_metadata_effects for each row execute function app_private.capture_workspace_undo_effect();

create function app_private.record_workspace_undo(e app_private.budget_metadata_effects,result jsonb) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare items jsonb:='[]';expected jsonb:='[]';x jsonb;v jsonb;s app_private.budget_metadata_groups;changed boolean:=false;deps jsonb;
begin
 if exists(select 1 from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid()) then return;end if;
 if e.lifecycle_manifest->>'action'='set_paid_at' then
  if e.lifecycle_manifest->'before'->'paid_at' is distinct from app_private.budget_metadata_record(e.kind,e.resource_id)->'paid_at' then delete from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id;end if;return;
 end if;
 if e.lifecycle_manifest->>'action'='create' then
  items:=jsonb_build_array(jsonb_build_object('kind',e.kind,'id',e.resource_id,'group','lifecycle','before','null'::jsonb,'after',app_private.budget_metadata_record(e.kind,e.resource_id),'before_revision',0,'revision',0,'graph',0,'predecessor',null));expected:=jsonb_build_array(jsonb_build_object('kind',e.kind,'id',e.resource_id,'group','lifecycle','revision',0,'graph',0));changed:=true;
 elsif e.undo_bundle is not null then
  for x in select v from jsonb_array_elements(e.undo_bundle) v loop
   select * into s from app_private.budget_metadata_groups where kind=x->>'kind' and resource_id=(x->>'id')::uuid and group_key=e.group_key;
   v:=app_private.undo_group_value(s.kind,s.resource_id,s.group_key);
   if x->'before' is distinct from v then changed:=true;end if;
   items:=items||jsonb_build_array(x||jsonb_build_object('after',v,'revision',s.revision));
   expected:=expected||jsonb_build_array(jsonb_build_object('kind',s.kind,'id',s.resource_id,'group',s.group_key,'revision',s.revision,'graph',x->'graph'));
  end loop;
 else return;end if;
 if not changed then return;end if;
 deps:=app_private.undo_dependencies(e.kind,e.resource_id,e.group_key);
 insert into app_private.budget_metadata_undo_operations(user_id,operation_id,trip_id,session_id,kind,resource_id,group_key,before_value,after_value,before_revision,after_revision,predecessor,bundle,dependencies)
 values(e.user_id,e.request_id,e.trip_id,e.session_id,e.kind,e.resource_id,e.group_key,(select t->'before' from jsonb_array_elements(items) t where t->>'kind'=e.kind and t->>'id'=e.resource_id::text),(select t->'after' from jsonb_array_elements(items) t where t->>'kind'=e.kind and t->>'id'=e.resource_id::text),e.base_revision,coalesce((result->>'revision')::bigint,0),null,items,deps);
 insert into app_private.budget_metadata_undo_stack(user_id,session_id,trip_id,operation_id,expected_revision,expected_bundle) values(e.user_id,e.session_id,e.trip_id,e.request_id,coalesce((result->>'revision')::bigint,0),expected);
 delete from app_private.budget_metadata_undo_stack where position in(select position from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id order by position desc offset 5);
 for x in select v from jsonb_array_elements(items) v loop
  insert into app_private.budget_metadata_undo_lineage values(x->>'kind',(x->>'id')::uuid,x->>'group',e.trip_id,e.user_id,e.session_id,e.request_id,(x->>'revision')::bigint)
  on conflict(kind,resource_id,group_key) do update set user_id=excluded.user_id,session_id=excluded.session_id,operation_id=excluded.operation_id,revision=excluded.revision;
 end loop;
end $$;

create function app_private.workspace_undo_top(trip uuid,sid uuid,operation uuid default null) returns app_private.budget_metadata_undo_operations language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare top app_private.budget_metadata_undo_stack;op app_private.budget_metadata_undo_operations;x jsonb;g app_private.budget_metadata_groups;l app_private.budget_metadata_undo_lineage;item jsonb;targets jsonb;
begin
 if auth.uid() is null or sid is null or not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(trip::text,0));perform app_private.lifecycle_membership(trip);
 if not app_private.workspace_undo_enabled() then raise exception 'Undo protocol disabled' using errcode='55000';end if;
 select * into top from app_private.budget_metadata_undo_stack where user_id=auth.uid() and trip_id=trip and session_id=sid order by position desc limit 1 for update;
 if not found or operation is not null and top.operation_id<>operation then raise exception 'Undo target is not stack top' using errcode='40001';end if;
 select * into op from app_private.budget_metadata_undo_operations where user_id=auth.uid() and operation_id=top.operation_id;
 if op.bundle is null then raise exception 'Legacy Undo entry requires its original protocol' using errcode='0A000';end if;
 perform app_private.lock_budget_field_parents(trip,op.bundle);
 if app_private.undo_dependencies(op.kind,op.resource_id,op.group_key) is distinct from op.dependencies then raise exception 'Undo dependency changed' using errcode='40001';end if;
 if op.group_key='lifecycle' then
  if app_private.budget_metadata_record(op.kind,op.resource_id) is distinct from op.bundle->0->'after' then raise exception 'Placeholder has changed' using errcode='40001';end if;
  perform app_private.lifecycle_delete_plan(trip,op.kind,op.resource_id);
 elsif op.group_key in('title','note','category','payer') then
  targets:=app_private.budget_field_targets(op.kind,op.resource_id,op.group_key);
  if (select jsonb_agg(v order by v->>'kind',v->>'id') from jsonb_array_elements(targets) v) is distinct from (select jsonb_agg(jsonb_build_object('kind',x->>'kind','id',x->>'id') order by x->>'kind',x->>'id') from jsonb_array_elements(op.bundle) x) then raise exception 'Undo target graph changed' using errcode='40001';end if;
 end if;
 for x in select v from jsonb_array_elements(top.expected_bundle) v order by v->>'kind',v->>'id' loop
  select * into g from app_private.budget_metadata_groups where kind=x->>'kind' and resource_id=(x->>'id')::uuid and group_key=op.group_key for update;
  select * into l from app_private.budget_metadata_undo_lineage where kind=g.kind and resource_id=g.resource_id and group_key=g.group_key;
  select v into item from jsonb_array_elements(op.bundle) v where v->>'kind'=g.kind and v->>'id'=g.resource_id::text;
  if g.is_deleted or g.revision is distinct from (x->>'revision')::bigint or l.user_id is distinct from auth.uid() or l.session_id is distinct from sid or l.operation_id is distinct from op.operation_id or l.revision<>g.revision or op.group_key<>'lifecycle' and ((select graph_revision from app_private.budget_metadata_groups where kind=g.kind and resource_id=g.resource_id and group_key='pricing') is distinct from (x->>'graph')::bigint or app_private.undo_group_value(g.kind,g.resource_id,g.group_key) is distinct from item->'after') then raise exception 'Undo effect/lineage changed' using errcode='40001';end if;
 end loop;return op;
end $$;

create function app_private.workspace_undo_lease(trip uuid,sid uuid,operation uuid,token uuid,action text,epoch bigint) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op app_private.budget_metadata_undo_operations;r jsonb;versions jsonb;base bigint;
begin
 if action='release' then select * into op from app_private.budget_metadata_undo_operations where user_id=auth.uid() and operation_id=operation and session_id=sid and trip_id=trip;
 else op:=app_private.workspace_undo_top(trip,sid,operation);end if;
 if op.operation_id is null then raise exception 'Invalid Undo operation' using errcode='42501';end if;
 select revision into base from app_private.budget_metadata_groups where kind=op.kind and resource_id=op.resource_id and group_key=op.group_key;
 if op.group_key='lifecycle' then r:=public.budget_lifecycle_lease(trip,op.kind,op.resource_id,sid,token,action,(app_private.budget_metadata_record(op.kind,op.resource_id)->>'lifecycle_revision')::bigint,epoch,app_private.lifecycle_versions(op.kind,op.resource_id),'{"action":"delete"}');
 else versions:=case when op.group_key in('title','note','category','payer') then app_private.budget_field_versions(op.kind,op.resource_id,op.group_key) else null end;
  r:=public.budget_metadata_group_lease_v2(trip,op.kind,op.resource_id,op.group_key,sid,token,action,base,epoch,0,false,versions);
 end if;
 return r||jsonb_build_object('revision',0,'targets','[]'::jsonb,'value',jsonb_build_object('versions','{}'::jsonb,'effects','[]'::jsonb));
end $$;
create function public.budget_workspace_undo_lease(p_trip_id uuid,p_session_id uuid,p_operation_id uuid,p_token uuid,p_action text,p_epoch bigint) returns jsonb language sql security invoker set search_path='' as $$select app_private.workspace_undo_lease(p_trip_id,p_session_id,p_operation_id,p_token,p_action,p_epoch)$$;

-- Full inverse dispatch and ledger integration are appended below.
create function app_private.prepare_workspace_inverse(trip uuid,sid uuid,operation uuid,request uuid,token uuid,epoch bigint) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op app_private.budget_metadata_undo_operations;cached app_private.budget_metadata_undo_receipts;r jsonb;v jsonb;base bigint;versions jsonb;
begin
 if auth.uid() is null or not app_private.can_edit_trip(trip,auth.uid()) or sid is null or request is null then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(trip::text,0));
 if not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into cached from app_private.budget_metadata_undo_receipts where user_id=auth.uid() and request_id=request;
 if found then if cached.session_id<>sid or cached.trip_id<>trip or cached.operation_id<>operation then raise exception 'request_mismatch' using errcode='22023';end if;return jsonb_build_object('replayed',true,'result',cached.result);end if;
 if exists(select 1 from app_private.budget_metadata_requests where user_id=auth.uid() and request_id=request) then raise exception 'request_mismatch' using errcode='22023';end if;
 op:=app_private.workspace_undo_top(trip,sid,operation);
 insert into app_private.budget_metadata_undo_intents values(txid_current(),pg_backend_pid(),auth.uid(),trip,sid,operation,request);
 select revision into base from app_private.budget_metadata_groups where kind=op.kind and resource_id=op.resource_id and group_key=op.group_key;
 select x->'before' into v from jsonb_array_elements(op.bundle) x where x->>'kind'=op.kind and x->>'id'=op.resource_id::text;
 if op.group_key='lifecycle' then r:=app_private.prepare_budget_lifecycle(trip,op.kind,op.resource_id,sid,token,epoch,(app_private.budget_metadata_record(op.kind,op.resource_id)->>'lifecycle_revision')::bigint,jsonb_build_object('action','delete','versions',app_private.lifecycle_versions(op.kind,op.resource_id)),request);
 elsif op.group_key='pricing' then
  versions:=app_private.budget_pricing_versions(op.kind,op.resource_id);
  r:=app_private.prepare_budget_pricing_patch(trip,op.kind,op.resource_id,'pricing',base,sid,token,epoch,jsonb_build_object('pricing',v||jsonb_build_object('versions',versions)),request);
 elsif op.group_key in('title','note','category','payer') then
  versions:=app_private.budget_field_versions(op.kind,op.resource_id,op.group_key);
  r:=app_private.prepare_budget_field(trip,op.kind,op.resource_id,op.group_key,base,sid,token,epoch,jsonb_build_object(op.group_key,v),request,versions);
 else r:=app_private.prepare_budget_metadata_patch(trip,op.kind,op.resource_id,op.group_key,base,sid,token,epoch,jsonb_build_object(op.group_key,v),request);
 end if;
 return r||jsonb_build_object('kind',op.kind,'id',op.resource_id,'group',op.group_key);
end $$;

-- Restore each endpoint's own prior value. The existing prepare validates the
-- lease and financial graph; this step binds the per-target manifest to the
-- immutable operation, recalculates pricing and rechecks prior Participants.
create function app_private.workspace_inverse_manifest() returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op app_private.budget_metadata_undo_operations;i app_private.budget_metadata_undo_intents;e app_private.budget_metadata_effects;x jsonb;prior jsonb;v jsonb;calc jsonb;fields jsonb;items jsonb:='[]';debit numeric;u uuid;
begin
 select * into i from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid();
 select * into op from app_private.budget_metadata_undo_operations where user_id=i.user_id and operation_id=i.operation_id;
 select * into e from app_private.budget_metadata_effects where transaction_id=i.transaction_id and backend_id=i.backend_id and request_id=i.request_id and user_id=i.user_id;
 if e.request_id is null or op.bundle is null then raise exception 'Invalid inverse intent' using errcode='42501';end if;
 for x in select t from jsonb_array_elements(coalesce(e.metadata_manifest,e.pricing_manifest,'[]')) t loop
  select t into prior from jsonb_array_elements(op.bundle) t where t->>'kind'=x->>'kind' and t->>'id'=x->>'id';v:=prior->'before';
  if prior is null then raise exception 'Inverse target mismatch' using errcode='40001';end if;
  if e.group_key='pricing' then
   calc:=app_private.calculate_budget_group_pricing(v);fields:=calc-array['participantIds','shares'];
   for u in select t::uuid from jsonb_array_elements_text(calc->'participantIds') t order by t loop
    perform 1 from public.trip_members where trip_id=e.trip_id and user_id=u and status='approved' for share nowait;
    if not found then raise exception 'Undo member revoked' using errcode='42501';end if;
   end loop;
   if x->>'kind'='actual' and x->'before'->>'record_status'<>'incomplete' and x->'before'->>'twd_amount_source' in('actual','legacy') then
    debit:=(x->'before'->>'actual_twd_amount')::numeric;
    if debit is null or debit<>round(debit) or debit>0 and (calc->>'amount')::numeric=0 or (op.kind='budget' or calc->>'currency'='TWD') and debit<>(calc->>'twd_amount')::numeric then raise exception 'Undo cannot change known debit' using errcode='0A000';end if;
    fields:=fields||jsonb_build_object('twd_amount',debit);
   elsif x->>'kind'='actual' and x->'before'->>'record_status'='incomplete' then
    fields:=fields||jsonb_build_object('twd_amount_source',case when calc->>'currency'='TWD' then 'actual' else 'estimated' end,'actual_twd_amount',case when calc->>'currency'='TWD' then calc->'twd_amount' else 'null'::jsonb end);
   end if;
   if (calc->>'currency',calc->>'exchange_rate') is distinct from (x->'inputs'->>'currency',x->'inputs'->>'exchange_rate') then raise exception 'Undo cannot restore a stale currency or rate' using errcode='40001';end if;
   x:=x||jsonb_build_object('fields',fields,'inputs',v,'changed',true);
  else
   if op.group_key in('title','category') and coalesce(btrim(v#>>'{}'),'')='' and (op.group_key='category' or x->'before'->>'record_status'='complete') then raise exception 'Undo would invalidate a complete endpoint' using errcode='22023';end if;
   if op.group_key in('title','category') and v is distinct from to_jsonb(btrim(v#>>'{}')) or op.group_key='note' and v is distinct from coalesce(to_jsonb(nullif(btrim(v#>>'{}'),'')),'null'::jsonb) then raise exception 'Historical noncanonical text cannot be restored through narrow contract' using errcode='0A000';end if;
   if op.group_key='payer' and v<>'null'::jsonb then perform 1 from public.trip_members where trip_id=e.trip_id and user_id=(v#>>'{}')::uuid and status='approved' for share nowait;if not found then raise exception 'Undo payer revoked' using errcode='42501';end if;end if;
   x:=x||jsonb_build_object('value',v);
  end if;items:=items||jsonb_build_array(x);
 end loop;
 if e.group_key='pricing' then update app_private.budget_metadata_effects set pricing_manifest=items where transaction_id=i.transaction_id and backend_id=i.backend_id;
 elsif e.metadata_manifest is not null then update app_private.budget_metadata_effects set metadata_manifest=items where transaction_id=i.transaction_id and backend_id=i.backend_id;end if;
 return jsonb_build_object('targets',items,'value',e.value);
end $$;

create function app_private.finish_workspace_inverse(trip uuid,sid uuid,operation uuid,request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare op app_private.budget_metadata_undo_operations;ptr app_private.budget_metadata_undo_stack;x jsonb;p jsonb;next_op app_private.budget_metadata_undo_operations;prior_ptr app_private.budget_metadata_undo_stack;s app_private.budget_metadata_groups;result jsonb;expected jsonb;
begin
 if not exists(select 1 from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and trip_id=trip and session_id=sid and operation_id=operation and request_id=request) then raise exception 'Invalid inverse intent' using errcode='42501';end if;
 select * into op from app_private.budget_metadata_undo_operations where user_id=auth.uid() and operation_id=operation;
 select * into ptr from app_private.budget_metadata_undo_stack where user_id=auth.uid() and session_id=sid and trip_id=trip order by position desc limit 1 for update;
 if ptr.operation_id is distinct from operation then raise exception 'Inverse target changed' using errcode='40001';end if;
 for x in select v from jsonb_array_elements(op.bundle) v loop
  if op.group_key='lifecycle' then
   if app_private.budget_metadata_record(op.kind,op.resource_id) is not null then raise exception 'Placeholder inverse not committed' using errcode='40001';end if;
  elsif app_private.undo_group_value(x->>'kind',(x->>'id')::uuid,op.group_key) is distinct from x->'before' then raise exception 'Incomplete inverse effect' using errcode='40001';end if;
  select * into s from app_private.budget_metadata_groups where kind=x->>'kind' and resource_id=(x->>'id')::uuid and group_key=op.group_key;
  -- Only the exact proven predecessor receives this inverse revision. Graph,
  -- rates, member and all unrelated expected versions remain untouched.
  if x->>'predecessor' is not null then
   select * into next_op from app_private.budget_metadata_undo_operations where user_id=auth.uid() and operation_id=(x->>'predecessor')::uuid;
   select * into prior_ptr from app_private.budget_metadata_undo_stack where user_id=auth.uid() and session_id=sid and trip_id=trip and operation_id=next_op.operation_id;
   if found then
    select v into p from jsonb_array_elements(next_op.bundle) v where v->>'kind'=x->>'kind' and v->>'id'=x->>'id' and v->>'group'=op.group_key;
    if p->'after' is distinct from x->'before' or not exists(select 1 from jsonb_array_elements(prior_ptr.expected_bundle) v where v->>'kind'=x->>'kind' and v->>'id'=x->>'id' and v->>'group'=op.group_key and (v->>'revision')::bigint=(x->>'before_revision')::bigint and v->'graph'=x->'graph') then raise exception 'Inverse predecessor lineage conflict' using errcode='40001';end if;
    select jsonb_agg(case when v->>'kind'=s.kind and v->>'id'=s.resource_id::text and v->>'group'=s.group_key then v||jsonb_build_object('revision',s.revision) else v end) into expected from jsonb_array_elements(prior_ptr.expected_bundle) v;
    update app_private.budget_metadata_undo_stack set expected_bundle=expected,expected_revision=case when next_op.kind=s.kind and next_op.resource_id=s.resource_id then s.revision else expected_revision end where position=prior_ptr.position;
   end if;
  end if;
  update app_private.budget_metadata_undo_lineage set operation_id=(x->>'predecessor')::uuid,revision=s.revision where kind=s.kind and resource_id=s.resource_id and group_key=s.group_key;
 end loop;
 delete from app_private.budget_metadata_undo_stack where position=ptr.position;
 result:=jsonb_build_object('kind','trip','id',trip,'group','undo','revision',0,'request_id',request,'undo_of',operation,'value',jsonb_build_object('versions','{}'::jsonb,'effects',(select jsonb_agg(jsonb_build_object('kind',g.kind,'id',g.resource_id,'group',g.group_key,'revision',g.revision,'deleted',g.is_deleted)) from app_private.budget_metadata_groups g join jsonb_array_elements(op.bundle) t on g.kind=t->>'kind' and g.resource_id=(t->>'id')::uuid and g.group_key=t->>'group')));
 insert into app_private.budget_metadata_undo_receipts values(auth.uid(),request,trip,sid,operation,result);
 delete from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid();return result;
end $$;










-- Generated integration of existing narrow writers follows.
create or replace function app_private.record_budget_metadata_undo() returns trigger
language plpgsql security definer set search_path='' as $$
declare effect app_private.budget_metadata_effects; intent app_private.budget_metadata_undo_intents;
  op app_private.budget_metadata_undo_operations; lineage app_private.budget_metadata_undo_lineage;
  expected bigint; previous uuid; changed boolean; result jsonb;
begin
 if app_private.workspace_undo_enabled() then
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=new.user_id and request_id=new.request_id;
  if effect.request_id is null or effect.session_id<>new.session_id or effect.trip_id<>new.trip_id or effect.user_id is distinct from auth.uid() then raise exception 'Invalid full Undo capture' using errcode='42501';end if;
  perform app_private.record_workspace_undo(effect,new.result);return new;
 end if;
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

create or replace function app_private.capture_budget_metadata_undo_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; rec jsonb; k text; linked uuid; effect app_private.budget_metadata_effects;
begin
 if app_private.workspace_undo_enabled() and exists(select 1 from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid()) then return null;end if;
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

create or replace function app_private.finish_budget_field() returns jsonb language plpgsql security definer set search_path='' as $$
declare e app_private.budget_metadata_effects;x jsonb;r jsonb;rev bigint;effects jsonb:='[]';versions jsonb;result jsonb;changed boolean:=false;field text;
begin
 select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid();
 if not found or e.metadata_manifest is null or not app_private.can_edit_trip(e.trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 field:=case when e.group_key='payer' then 'payer_id' else e.group_key end;
 for x in select v from jsonb_array_elements(e.metadata_manifest) v loop
  r:=app_private.budget_metadata_record(x->>'kind',(x->>'id')::uuid);select revision into rev from app_private.budget_metadata_groups where kind=x->>'kind' and resource_id=(x->>'id')::uuid and group_key=e.group_key;
  if r is null or r->field is distinct from x->'value' or (r-field-'updated_at') is distinct from ((x->'before')-field-'updated_at') or rev<>((x->>'base')::bigint+case when x->'before'->field is distinct from x->'value' then 1 else 0 end) then raise exception 'Incomplete field bundle' using errcode='40001';end if;
  effects:=effects||jsonb_build_array(jsonb_build_object('kind',x->>'kind','id',x->>'id','group',e.group_key,'revision',rev));
  if x->'before'->field is distinct from x->'value' then changed:=true;if not app_private.workspace_undo_enabled() and jsonb_array_length(e.metadata_manifest)>1 then delete from app_private.budget_metadata_undo_lineage where kind=x->>'kind' and resource_id=(x->>'id')::uuid and group_key=e.group_key;end if;end if;
 end loop;
 versions:=app_private.budget_field_versions(e.kind,e.resource_id,e.group_key);
 update app_private.budget_metadata_groups set metadata_bundle=jsonb_set(metadata_bundle,'{versions}',versions),dirty=false,expires_at=least(expires_at,last_activity_at+interval '2 minutes') where trip_id=e.trip_id and group_key=e.group_key and metadata_bundle=(select metadata_bundle from app_private.budget_metadata_groups where kind=e.kind and resource_id=e.resource_id and group_key=e.group_key);
 select revision into rev from app_private.budget_metadata_groups where kind=e.kind and resource_id=e.resource_id and group_key=e.group_key;
 result:=jsonb_build_object('id',e.resource_id,'kind',e.kind,'group',e.group_key,'value',e.value,'revision',rev,'versions',versions,'effects',effects,'request_id',e.request_id,'undo_supported',app_private.workspace_undo_enabled() and changed,'undo_reason',case when not app_private.workspace_undo_enabled() and jsonb_array_length(e.metadata_manifest)>1 then 'mirrored_text_not_supported' end);
 insert into app_private.budget_metadata_requests values(e.user_id,e.request_id,e.trip_id,e.session_id,e.signature,result);
 delete from app_private.budget_metadata_effects where transaction_id=e.transaction_id and backend_id=e.backend_id;return result;
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
   if not app_private.workspace_undo_enabled() then delete from app_private.budget_metadata_undo_lineage where kind=t->>'kind' and resource_id=(t->>'id')::uuid;end if;
  end loop;
  if not app_private.workspace_undo_enabled() then delete from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id;end if;
 end if;
 select * into g from app_private.budget_metadata_groups where kind=e.kind and resource_id=e.resource_id and group_key='pricing';
 v:=app_private.read_budget_pricing_value(e.kind,e.resource_id);bundle:=jsonb_set(g.pricing_bundle,'{versions}',v->'versions');
 update app_private.budget_metadata_groups set dirty=false,pricing_bundle=bundle,expires_at=least(expires_at,last_activity_at+interval '2 minutes') where group_key='pricing' and trip_id=e.trip_id and pricing_bundle=g.pricing_bundle;
 result:=jsonb_build_object('id',e.resource_id,'kind',e.kind,'group','pricing','value',v,'revision',g.revision,'request_id',e.request_id,'undo_supported',app_private.workspace_undo_enabled() and changed);
 insert into app_private.budget_metadata_requests(user_id,request_id,trip_id,session_id,signature,result) values(e.user_id,e.request_id,e.trip_id,e.session_id,e.signature,result);
 delete from app_private.budget_metadata_effects where transaction_id=e.transaction_id and backend_id=e.backend_id;return result;
end $$;

create or replace function app_private.finish_budget_lifecycle() returns jsonb language plpgsql security definer set search_path='' as $$
declare e app_private.budget_metadata_effects;r jsonb;result jsonb;op text;
begin
 select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='lifecycle';if not found or not app_private.can_edit_trip(e.trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 op:=e.value->>'action';r:=app_private.budget_metadata_record(e.kind,e.resource_id);
 if op='delete' then
  if r is not null then raise exception 'Delete incomplete' using errcode='40001';end if;
  update app_private.budget_metadata_groups set is_deleted=true,revision=revision+1,lease_epoch=lease_epoch+1,user_id=null,session_id=null,token_hash=null,expires_at=null,lifecycle_bundle=null where kind=e.kind and resource_id=e.resource_id;
  delete from app_private.budget_metadata_undo_lineage where kind=e.kind and resource_id=e.resource_id;
  if not exists(select 1 from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=e.user_id) then delete from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id;end if;
 else
  if r is null or (op like 'create_%' and (r->>'record_status'<>'incomplete' or r->>'title'<>'' or (r->>'pricing_ready')::boolean or exists(select 1 from public.budget_item_participants where budget_item_id=e.resource_id) or exists(select 1 from public.actual_expense_participants where actual_expense_id=e.resource_id))) or (op='set_paid_at' and (r->>'paid_at')::timestamptz is distinct from (e.value->>'paid_at')::timestamptz) then raise exception 'Lifecycle effect incomplete' using errcode='40001';end if;
  if op like 'create_%' then
   insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) select e.kind,e.resource_id,g,e.trip_id from unnest(case when e.kind='budget' then array['title','note','category','payer','links','pricing','payment','source','lifecycle'] else array['title','note','category','payer','pricing','payment','source','receipts','lifecycle'] end) g on conflict do nothing;
  end if;
 end if;
 result:=jsonb_build_object('kind',case when op like 'create_%' then 'trip' else e.kind end,'id',case when op like 'create_%' then e.trip_id else e.resource_id end,'group','lifecycle','revision',coalesce((r->>'lifecycle_revision')::bigint,e.base_revision),'request_id',e.request_id,'created_id',case when op like 'create_%' then e.resource_id end,'created_kind',e.kind,'value',jsonb_build_object('exists',op<>'delete','versions',case when op like 'create_%' then '{}'::jsonb else app_private.lifecycle_versions(e.kind,e.resource_id) end),'undo_supported',app_private.workspace_undo_enabled() and op like 'create_%','create_fence',case when op like 'create_%' then app_private.lifecycle_versions(e.kind,e.resource_id) end);
 insert into app_private.budget_metadata_requests values(e.user_id,e.request_id,e.trip_id,e.session_id,e.signature,result);
 delete from app_private.budget_metadata_effects where transaction_id=e.transaction_id and backend_id=e.backend_id;return result;
end $$;

create or replace function app_private.prepare_budget_field(trip uuid,k text,rid uuid,g text,base bigint,sid uuid,token uuid,epoch bigint,patch jsonb,request uuid,versions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare value jsonb;signature jsonb;cached app_private.budget_metadata_requests;root app_private.budget_metadata_groups;held app_private.budget_metadata_groups;targets jsonb;x jsonb;manifest jsonb:='[]';r jsonb;
begin
 if auth.uid() is null or not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if trip is null or rid is null or k is null or k not in('budget','actual') or g is null or g not in('title','note','category','payer') or base is null or base<0 or sid is null or request is null or jsonb_typeof(patch) is distinct from 'object' or not(patch?g) or patch-g<>'{}'::jsonb then raise exception 'Invalid field patch' using errcode='22023';end if;
 if g='payer' then
  if patch->g='null'::jsonb then value:='null';elsif jsonb_typeof(patch->g)='string' then value:=to_jsonb((patch->>g)::uuid);else raise exception 'Invalid payer' using errcode='22023';end if;
 else
  if jsonb_typeof(patch->g) is distinct from 'string' and not(g='note' and patch->g='null'::jsonb) or g in('title','category') and btrim(patch->>g)='' and not(g='title' and app_private.workspace_undo_enabled() and app_private.budget_metadata_record(k,rid)->>'record_status'='incomplete' and exists(select 1 from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid())) then raise exception 'Invalid field value' using errcode='22023';end if;
  value:=case when g='note' then coalesce(to_jsonb(nullif(btrim(patch->>g),'')),'null'::jsonb) else to_jsonb(btrim(patch->>g)) end;
 end if;
 signature:=jsonb_build_object('protocol','metadata-prototype','trip',trip,'kind',k,'id',rid,'group',g,'base',base,'value',value,'session',sid);
 perform pg_advisory_xact_lock(hashtextextended(trip::text,0));
 if not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into cached from app_private.budget_metadata_requests where user_id=auth.uid() and request_id=request;
 if found then if cached.signature<>signature or cached.trip_id<>trip or cached.session_id<>sid then raise exception 'request_mismatch' using errcode='22023';end if;return jsonb_build_object('replayed',true,'result',cached.result);end if;
 perform app_private.budget_finance_membership(trip);targets:=app_private.budget_field_targets(k,rid,g);
 if targets is null then raise exception 'Field dependency unsupported' using errcode='0A000';end if;
 perform app_private.lock_budget_field_parents(trip,targets);
 select * into root from app_private.budget_metadata_groups where kind=k and resource_id=rid and group_key=g and trip_id=trip for update;
 if root.revision is distinct from base or versions is distinct from app_private.budget_field_versions(k,rid,g) or root.metadata_bundle->'versions' is distinct from versions then raise exception 'Field dependency changed' using errcode='40001';end if;
 if root.lease_epoch is distinct from epoch or root.metadata_bundle->>'kind' is distinct from k or root.metadata_bundle->>'id' is distinct from rid::text then raise exception 'Field bundle lost' using errcode='55P03';end if;
 if not app_private.workspace_undo_enabled() and exists(select 1 from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid()) and jsonb_array_length(targets)>1 then raise exception 'Mirrored text Undo not supported; neither endpoint changed' using errcode='0A000';end if;
 if g='payer' and value<>'null'::jsonb then perform 1 from public.trip_members where trip_id=trip and user_id=(value#>>'{}')::uuid and status='approved' for share nowait;if not found then raise exception 'Invalid payer' using errcode='22023';end if;end if;
 for x in select v from jsonb_array_elements(targets) v order by v->>'kind',v->>'id' loop
  select * into held from app_private.budget_metadata_groups where kind=x->>'kind' and resource_id=(x->>'id')::uuid and group_key=g for update;
  if held.user_id is distinct from auth.uid() or held.session_id is distinct from sid or token is null or held.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or held.expires_at is null or held.expires_at<=clock_timestamp() or held.metadata_bundle is distinct from root.metadata_bundle or held.is_deleted or not exists(select 1 from jsonb_array_elements(root.metadata_bundle->'epochs') e where e->>'kind'=held.kind and e->>'id'=held.resource_id::text and (e->>'epoch')::bigint=held.lease_epoch) then raise exception 'Field lease lost' using errcode='55P03';end if;
  r:=app_private.budget_metadata_record(held.kind,held.resource_id);manifest:=manifest||jsonb_build_array(jsonb_build_object('kind',held.kind,'id',held.resource_id,'group',g,'before',r,'base',held.revision,'epoch',held.lease_epoch,'value',value));
 end loop;
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,metadata_manifest) values(txid_current(),pg_backend_pid(),auth.uid(),trip,k,rid,g,sid,request,base,epoch,value,signature,manifest);
 return jsonb_build_object('replayed',false,'targets',manifest);
end $$;

create or replace function app_private.prepare_budget_metadata_undo(p_trip uuid,p_session uuid,p_operation uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); op app_private.budget_metadata_undo_operations;
  top_row app_private.budget_metadata_undo_stack; lineage app_private.budget_metadata_undo_lineage;
  receipt app_private.budget_metadata_undo_receipts;
begin
  if actor is null or not app_private.can_edit_trip(p_trip,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_trip is null or p_session is null or p_operation is null or p_request is null then raise exception 'invalid_undo_request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip::text,0));
  if not app_private.can_edit_trip(p_trip,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.trip_members where trip_id=p_trip and user_id=actor and status='approved' for share nowait;
  if not found then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into receipt from app_private.budget_metadata_undo_receipts where user_id=actor and request_id=p_request;
  if found then
    if receipt.trip_id<>p_trip or receipt.session_id<>p_session or receipt.operation_id<>p_operation then
      raise exception 'request_mismatch' using errcode='22023'; end if;
    return jsonb_build_object('replayed',true,'result',receipt.result);
  end if;
  if not app_private.budget_metadata_undo_enabled() or not app_private.budget_metadata_enabled() then
    raise exception 'undo_protocol_disabled' using errcode='55000'; end if;
  if exists(select 1 from app_private.budget_metadata_requests where user_id=actor and request_id=p_request) then
    raise exception 'request_mismatch' using errcode='22023'; end if;
  select * into top_row from app_private.budget_metadata_undo_stack where user_id=actor and session_id=p_session
    and trip_id=p_trip order by position desc limit 1 for update;
  if not found or top_row.operation_id<>p_operation then raise exception 'undo_target_not_top' using errcode='40001'; end if;
  select * into op from app_private.budget_metadata_undo_operations where user_id=actor and operation_id=p_operation;
  select * into lineage from app_private.budget_metadata_undo_lineage where kind=op.kind and resource_id=op.resource_id and group_key=op.group_key;
  if not found or lineage.user_id<>actor or lineage.session_id<>p_session or lineage.operation_id is distinct from p_operation
    or lineage.revision<>top_row.expected_revision then raise exception 'undo_lineage_conflict' using errcode='40001'; end if;
  if op.bundle is not null then raise exception 'Use full workspace Undo protocol' using errcode='0A000';end if;
  insert into app_private.budget_metadata_undo_intents values(txid_current(),pg_backend_pid(),actor,p_trip,p_session,p_operation,p_request);
  return jsonb_build_object('replayed',false,'kind',op.kind,'id',op.resource_id,'group',op.group_key,
    'base',top_row.expected_revision,'patch',jsonb_build_object(op.group_key,op.before_value));
end $$;

create or replace function app_private.invalidate_budget_metadata_undo(p_trip uuid,p_kind text default null,p_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_trip is null then return; end if;
  if not exists(select 1 from app_private.budget_metadata_undo_lineage where trip_id=p_trip)
    and not exists(select 1 from app_private.budget_metadata_undo_stack where trip_id=p_trip) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip::text,0));
  if not app_private.workspace_undo_enabled() then delete from app_private.budget_metadata_undo_stack where trip_id=p_trip and user_id=auth.uid();end if;
  delete from app_private.budget_metadata_undo_lineage where trip_id=p_trip
    and (p_kind is null or kind=p_kind and resource_id=p_id);
end $$;

create or replace function app_private.finish_budget_metadata_patch() returns jsonb
language plpgsql security definer set search_path='' as $$
declare effect app_private.budget_metadata_effects; rec jsonb; rev bigint; result jsonb;
begin
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid();
  if not found or not app_private.can_edit_trip(effect.trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  rec:=app_private.budget_metadata_record(effect.kind,effect.resource_id);
  select revision into rev from app_private.budget_metadata_groups where kind=effect.kind and resource_id=effect.resource_id and group_key=effect.group_key;
  if rec is null or app_private.budget_metadata_value(effect.kind,effect.resource_id,effect.group_key) is distinct from effect.value or rev not in (effect.base_revision,effect.base_revision+1) then
    raise exception 'group_effect_not_committed' using errcode='40001'; end if;
  result:=jsonb_build_object('id',effect.resource_id,'kind',effect.kind,'group',effect.group_key,'value',effect.value,
    'revision',rev,'updated_at',rec->'updated_at','request_id',effect.request_id,'undo_supported',app_private.workspace_undo_enabled() and rev>effect.base_revision);
  insert into app_private.budget_metadata_requests values(effect.user_id,effect.request_id,effect.trip_id,effect.session_id,effect.signature,result);
  -- Successful autosave retains this exact lease. UI/idle release is separate.
  update app_private.budget_metadata_groups set dirty=false,
    expires_at=least(expires_at,last_activity_at+interval '2 minutes')
    where kind=effect.kind and resource_id=effect.resource_id and group_key=effect.group_key;
  delete from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid();
  return result;
end $$;

create function public.undo_budget_workspace(p_trip_id uuid,p_session_id uuid,p_operation_id uuid,p_token uuid,p_epoch bigint,p_request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
#variable_conflict use_column
declare admission jsonb;x jsonb;t jsonb;v jsonb;rid uuid;grp text;ignored jsonb;
begin
 admission:=app_private.prepare_workspace_inverse(p_trip_id,p_session_id,p_operation_id,p_request_id,p_token,p_epoch);
 if coalesce((admission->>'replayed')::boolean,false) then return admission->'result';end if;grp:=admission->>'group';
 if grp='lifecycle' then
  rid:=(admission->>'id')::uuid;
  if admission->>'kind'='budget' then delete from public.itinerary_budget_items where budget_item_id=rid;delete from public.budget_item_participants where budget_item_id=rid;delete from public.budget_items where id=rid and trip_id=p_trip_id;
  else delete from public.actual_expense_participants where actual_expense_id=rid;delete from public.actual_expenses where id=rid and trip_id=p_trip_id;end if;
  ignored:=app_private.finish_budget_lifecycle();
 elsif grp in('title','note','category','payer') then
  admission:=app_private.workspace_inverse_manifest();
 for x in select v from jsonb_array_elements(admission->'targets') v loop
  rid:=(x->>'id')::uuid;
  if x->'before'->(case when grp='payer' then 'payer_id' else grp end) is not distinct from x->'value' then continue;end if;
  if x->>'kind'='budget' then
   if grp='title' then update public.budget_items set title=x->>'value' where id=rid and trip_id=p_trip_id;
   elsif grp='note' then update public.budget_items set note=x->>'value' where id=rid and trip_id=p_trip_id;
   elsif grp='category' then update public.budget_items set category=x->>'value' where id=rid and trip_id=p_trip_id;
   else update public.budget_items set payer_id=(x->>'value')::uuid where id=rid and trip_id=p_trip_id;end if;
  else
   if grp='title' then update public.actual_expenses set title=x->>'value' where id=rid and trip_id=p_trip_id;
   elsif grp='note' then update public.actual_expenses set note=x->>'value' where id=rid and trip_id=p_trip_id;
   elsif grp='category' then update public.actual_expenses set category=x->>'value' where id=rid and trip_id=p_trip_id;
   else update public.actual_expenses set payer_id=(x->>'value')::uuid where id=rid and trip_id=p_trip_id;end if;
  end if;
  if not found then raise exception 'Resource changed' using errcode='40001';end if;
 end loop;
  ignored:=app_private.finish_budget_field();
 elsif grp='pricing' then
  admission:=app_private.workspace_inverse_manifest();
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
  ignored:=app_private.finish_budget_pricing_patch();
 else
  -- Existing Links writer independently validates same-trip references/lease.
  -- Prepare already created its effect; execute its exact narrow DML here.
  rid:=(admission->>'id')::uuid;v:=admission->'value';
  delete from public.itinerary_budget_items where budget_item_id=rid and not(itinerary_item_id::text in(select jsonb_array_elements_text(v)));
  insert into public.itinerary_budget_items(budget_item_id,itinerary_item_id) select rid,u::uuid from jsonb_array_elements_text(v) u on conflict(budget_item_id,itinerary_item_id) do nothing;
  ignored:=app_private.finish_budget_metadata_patch();
 end if;
 return app_private.finish_workspace_inverse(p_trip_id,p_session_id,p_operation_id,p_request_id);
end $$;

create function app_private.read_workspace_undo(trip uuid,sid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if auth.uid() is null or not app_private.can_read_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if app_private.can_edit_trip(trip,auth.uid()) then r:=app_private.read_budget_metadata_undo(trip,sid);else r:='{"count":0,"top":null}'::jsonb;end if;
 return jsonb_build_object('kind','trip','id',trip,'trip_id',trip,'revision',0,'value',jsonb_build_object('versions','{}'::jsonb,'enabled',app_private.workspace_undo_enabled(),'count',r->'count','top',r->'top','effects',coalesce((select jsonb_agg(jsonb_build_object('kind',g.kind,'id',g.resource_id,'group',g.group_key,'revision',g.revision,'deleted',g.is_deleted) order by g.kind,g.resource_id,g.group_key) from app_private.budget_metadata_groups g where g.trip_id=trip),'[]'::jsonb)));
end $$;
create function public.read_budget_metadata_snapshot_v10(p_trip_id uuid,p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with f as materialized(select public.read_budget_metadata_snapshot_v9(p_trip_id,p_session_id) v),u as materialized(select app_private.read_workspace_undo(p_trip_id,p_session_id) v)
 select f.v||jsonb_build_object('metadataProtocol',jsonb_set(f.v->'metadataProtocol','{schemaVersion}','10'),'undoRecords',jsonb_build_array(u.v)) from f cross join u where f.v is not null and u.v is not null
$$;
revoke all on function app_private.workspace_undo_enabled() from public,anon,authenticated;
revoke all on function app_private.undo_group_value(text,uuid,text) from public,anon,authenticated;
revoke all on function app_private.undo_dependencies(text,uuid,text) from public,anon,authenticated;
revoke all on function app_private.capture_workspace_undo_effect() from public,anon,authenticated;
revoke all on function app_private.record_workspace_undo(app_private.budget_metadata_effects,jsonb) from public,anon,authenticated;
revoke all on function app_private.workspace_undo_top(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function app_private.workspace_undo_lease(uuid,uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function app_private.workspace_undo_lease(uuid,uuid,uuid,uuid,text,bigint) to authenticated;
revoke all on function public.budget_workspace_undo_lease(uuid,uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.budget_workspace_undo_lease(uuid,uuid,uuid,uuid,text,bigint) to authenticated;
revoke all on function app_private.prepare_workspace_inverse(uuid,uuid,uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function app_private.prepare_workspace_inverse(uuid,uuid,uuid,uuid,uuid,bigint) to authenticated;
revoke all on function app_private.workspace_inverse_manifest() from public,anon,authenticated;
grant execute on function app_private.workspace_inverse_manifest() to authenticated;
revoke all on function app_private.finish_workspace_inverse(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.finish_workspace_inverse(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function public.undo_budget_workspace(uuid,uuid,uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.undo_budget_workspace(uuid,uuid,uuid,uuid,bigint,uuid) to authenticated;
revoke all on function app_private.read_workspace_undo(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.read_workspace_undo(uuid,uuid) to authenticated;
revoke all on function public.read_budget_metadata_snapshot_v10(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_budget_metadata_snapshot_v10(uuid,uuid) to authenticated;
commit;
