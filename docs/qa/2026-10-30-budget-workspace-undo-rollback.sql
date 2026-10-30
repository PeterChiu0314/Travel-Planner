begin;do $$begin if exists(select 1 from app_private.budget_metadata_undo_protocol where full_enabled) or exists(select 1 from app_private.budget_metadata_undo_operations where bundle is not null) then raise exception 'Full Undo used: forward repair only';end if;end $$;drop trigger capture_workspace_undo on app_private.budget_metadata_effects;
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
  if x->'before'->field is distinct from x->'value' then changed:=true;if jsonb_array_length(e.metadata_manifest)>1 then delete from app_private.budget_metadata_undo_lineage where kind=x->>'kind' and resource_id=(x->>'id')::uuid and group_key=e.group_key;end if;end if;
 end loop;
 versions:=app_private.budget_field_versions(e.kind,e.resource_id,e.group_key);
 update app_private.budget_metadata_groups set metadata_bundle=jsonb_set(metadata_bundle,'{versions}',versions),dirty=false,expires_at=least(expires_at,last_activity_at+interval '2 minutes') where trip_id=e.trip_id and group_key=e.group_key and metadata_bundle=(select metadata_bundle from app_private.budget_metadata_groups where kind=e.kind and resource_id=e.resource_id and group_key=e.group_key);
 select revision into rev from app_private.budget_metadata_groups where kind=e.kind and resource_id=e.resource_id and group_key=e.group_key;
 result:=jsonb_build_object('id',e.resource_id,'kind',e.kind,'group',e.group_key,'value',e.value,'revision',rev,'versions',versions,'effects',effects,'request_id',e.request_id,'undo_supported',false,'undo_reason',case when jsonb_array_length(e.metadata_manifest)>1 then 'mirrored_text_not_supported' end);
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

create or replace function app_private.finish_budget_lifecycle() returns jsonb language plpgsql security definer set search_path='' as $$
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

create or replace function app_private.prepare_budget_field(trip uuid,k text,rid uuid,g text,base bigint,sid uuid,token uuid,epoch bigint,patch jsonb,request uuid,versions jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare value jsonb;signature jsonb;cached app_private.budget_metadata_requests;root app_private.budget_metadata_groups;held app_private.budget_metadata_groups;targets jsonb;x jsonb;manifest jsonb:='[]';r jsonb;
begin
 if auth.uid() is null or not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if trip is null or rid is null or k is null or k not in('budget','actual') or g is null or g not in('title','note','category','payer') or base is null or base<0 or sid is null or request is null or jsonb_typeof(patch) is distinct from 'object' or not(patch?g) or patch-g<>'{}'::jsonb then raise exception 'Invalid field patch' using errcode='22023';end if;
 if g='payer' then
  if patch->g='null'::jsonb then value:='null';elsif jsonb_typeof(patch->g)='string' then value:=to_jsonb((patch->>g)::uuid);else raise exception 'Invalid payer' using errcode='22023';end if;
 else
  if jsonb_typeof(patch->g) is distinct from 'string' and not(g='note' and patch->g='null'::jsonb) or g in('title','category') and btrim(patch->>g)='' then raise exception 'Invalid field value' using errcode='22023';end if;
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
 if exists(select 1 from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid()) and jsonb_array_length(targets)>1 then raise exception 'Mirrored text Undo not supported; neither endpoint changed' using errcode='0A000';end if;
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
  delete from app_private.budget_metadata_undo_stack where trip_id=p_trip and user_id=auth.uid();
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
    'revision',rev,'updated_at',rec->'updated_at','request_id',effect.request_id,'undo_supported',false);
  insert into app_private.budget_metadata_requests values(effect.user_id,effect.request_id,effect.trip_id,effect.session_id,effect.signature,result);
  -- Successful autosave retains this exact lease. UI/idle release is separate.
  update app_private.budget_metadata_groups set dirty=false,
    expires_at=least(expires_at,last_activity_at+interval '2 minutes')
    where kind=effect.kind and resource_id=effect.resource_id and group_key=effect.group_key;
  delete from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid();
  return result;
end $$;

drop function public.read_budget_metadata_snapshot_v10(uuid,uuid);
drop function app_private.read_workspace_undo(uuid,uuid);
drop function public.undo_budget_workspace(uuid,uuid,uuid,uuid,bigint,uuid);
drop function app_private.finish_workspace_inverse(uuid,uuid,uuid,uuid);
drop function app_private.workspace_inverse_manifest();
drop function app_private.prepare_workspace_inverse(uuid,uuid,uuid,uuid,uuid,bigint);
drop function public.budget_workspace_undo_lease(uuid,uuid,uuid,uuid,text,bigint);
drop function app_private.workspace_undo_lease(uuid,uuid,uuid,uuid,text,bigint);
drop function app_private.workspace_undo_top(uuid,uuid,uuid);
drop function app_private.record_workspace_undo(app_private.budget_metadata_effects,jsonb);
drop function app_private.capture_workspace_undo_effect();
drop function app_private.undo_dependencies(text,uuid,text);
drop function app_private.undo_group_value(text,uuid,text);
drop function app_private.workspace_undo_enabled();
alter table app_private.budget_metadata_effects drop column undo_bundle;alter table app_private.budget_metadata_undo_stack drop column expected_bundle;alter table app_private.budget_metadata_undo_operations drop column bundle,drop column dependencies;alter table app_private.budget_metadata_undo_protocol drop column full_enabled;alter table app_private.budget_metadata_undo_operations drop constraint budget_metadata_undo_operations_group_key_check,drop constraint budget_metadata_undo_operations_check;alter table app_private.budget_metadata_undo_operations add constraint budget_metadata_undo_operations_group_key_check check(group_key in('title','note')),add constraint budget_metadata_undo_operations_check check(after_revision=before_revision+1);alter table app_private.budget_metadata_undo_lineage drop constraint budget_metadata_undo_lineage_group_key_check;alter table app_private.budget_metadata_undo_lineage add constraint budget_metadata_undo_lineage_group_key_check check(group_key in('title','note'));commit;
