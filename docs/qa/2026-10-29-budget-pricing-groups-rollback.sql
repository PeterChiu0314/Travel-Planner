begin;
do $$begin if app_private.budget_metadata_enabled() or exists(select 1 from app_private.budget_metadata_groups where expires_at>clock_timestamp()) or exists(select 1 from app_private.budget_metadata_effects) or exists(select 1 from app_private.budget_metadata_requests where result->>'group'='pricing') then raise exception 'Pricing used or active; forward repair required';end if;end $$;
drop function public.read_budget_metadata_snapshot_v3(uuid,uuid);
drop function app_private.read_budget_metadata_state_v3(uuid,uuid);

create or replace function app_private.budget_metadata_admission(
  p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_session_id uuid,p_token uuid,p_action text,
  p_base_revision bigint,p_epoch bigint,p_activity_seq bigint,p_dirty boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rec jsonb; held app_private.budget_metadata_groups; stamp timestamptz;
  activity_at timestamptz; next_seq bigint; deadline timestamptz;
begin
  if actor is null or p_trip_id is null or p_id is null or p_kind is null or p_kind not in ('budget','actual')
    or p_group is null or p_group not in ('title','note','category','payer','links') or (p_kind='actual' and p_group='links') or p_session_id is null or p_token is null
    or p_action is null or p_action not in ('acquire','renew','release')
    or p_activity_seq is null or p_activity_seq<0 or p_dirty is null then
    raise exception 'invalid_group_request' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  -- Exact release remains available to revoked members and while paused.
  if p_action='release' then
    update app_private.budget_metadata_groups set user_id=null,session_id=null,token_hash=null,expires_at=null,dirty=false
      where kind=p_kind and resource_id=p_id and group_key=p_group and trip_id=p_trip_id
      and user_id=actor and session_id=p_session_id and lease_epoch=p_epoch
      and token_hash=sha256(convert_to(p_token::text,'UTF8'));
    return jsonb_build_object('granted',true);
  end if;
  if not app_private.budget_metadata_enabled() then raise exception 'group_protocol_disabled' using errcode='55000'; end if;
  rec:=app_private.budget_metadata_record(p_kind,p_id);
  if rec is null or (rec->>'trip_id')::uuid<>p_trip_id or not app_private.can_edit_trip(p_trip_id,actor) then
    raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.trip_members where trip_id=p_trip_id and user_id=actor and status='approved' for share nowait;
  if not found then raise exception 'Forbidden' using errcode='42501'; end if;
  if not app_private.budget_metadata_supported(p_kind,p_id) then raise exception 'group_dependency_not_supported' using errcode='0A000'; end if;
  stamp:=clock_timestamp();
  if exists(select 1 from app_private.budget_edit_leases where kind=p_kind and resource_id=p_id and expires_at>stamp)
    or (nullif(rec->>'locked_by','') is not null and (rec->>'locked_at')::timestamptz>stamp-interval '7 minutes') then
    return jsonb_build_object('granted',false,'reason','legacy_locked'); end if;
  select * into held from app_private.budget_metadata_groups
    where kind=p_kind and resource_id=p_id and group_key=p_group and trip_id=p_trip_id and not is_deleted for update;
  if not found then raise exception 'group_state_missing' using errcode='40001'; end if;
  stamp:=clock_timestamp();
  if p_action='renew' then
    if held.user_id is distinct from actor or held.session_id is distinct from p_session_id
      or held.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8'))
      or held.lease_epoch is distinct from p_epoch or held.expires_at is null or held.expires_at<=stamp then
      return jsonb_build_object('granted',false,'reason','lease_lost'); end if;
  else
    if p_base_revision is null or held.revision<>p_base_revision then raise exception 'group_conflict' using errcode='40001'; end if;
    if held.expires_at>stamp and held.user_id is not null and (held.user_id is distinct from actor
      or held.session_id is distinct from p_session_id or held.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8'))) then
      return jsonb_build_object('granted',false,'reason','group_locked','owner_id',held.user_id,'expires_at',held.expires_at); end if;
    if held.expires_at is null or held.expires_at<=stamp or held.user_id is null then held.lease_epoch:=held.lease_epoch+1; end if;
  end if;
  if p_action='acquire' and (held.user_id is null or held.expires_at is null or held.expires_at<=stamp) then
    activity_at:=stamp; next_seq:=p_activity_seq;
  else
    activity_at:=case when p_activity_seq>held.activity_seq then stamp else held.last_activity_at end;
    next_seq:=greatest(p_activity_seq,held.activity_seq);
  end if;
  deadline:=activity_at+case when p_dirty then interval '10 minutes' else interval '2 minutes' end;
  if deadline<=stamp then return jsonb_build_object('granted',false,'reason','idle_expired'); end if;
  update app_private.budget_metadata_groups set user_id=actor,session_id=p_session_id,
    token_hash=sha256(convert_to(p_token::text,'UTF8')),lease_epoch=held.lease_epoch,
    expires_at=least(stamp+interval '7 minutes',deadline),activity_seq=next_seq,last_activity_at=activity_at,dirty=p_dirty
    where kind=p_kind and resource_id=p_id and group_key=p_group;
  return jsonb_build_object('granted',true,'revision',held.revision,'epoch',held.lease_epoch,
    'expires_at',least(stamp+interval '7 minutes',deadline),'value',app_private.budget_metadata_value(p_kind,p_id,p_group));
end $$;
create or replace function app_private.guard_budget_metadata_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_data jsonb; after_data jsonb; data jsonb; k text; active boolean; g text;
  effect app_private.budget_metadata_effects; held app_private.budget_metadata_groups;
begin
  if tg_op<>'INSERT' then before_data:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_data:=to_jsonb(new); end if;
  data:=coalesce(after_data,before_data); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  active:=app_private.budget_metadata_live(k,(data->>'id')::uuid);
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid()
    and user_id=auth.uid() and kind=k and resource_id=(data->>'id')::uuid;
  if found then
    select * into held from app_private.budget_metadata_groups where kind=k and resource_id=effect.resource_id and group_key=effect.group_key;
    if not app_private.budget_metadata_enabled() or tg_op<>'UPDATE' or effect.trip_id is distinct from (data->>'trip_id')::uuid
      or not app_private.can_edit_trip(effect.trip_id,auth.uid()) or held.lease_epoch<>effect.lease_epoch
      or held.user_id is distinct from auth.uid() or held.session_id is distinct from effect.session_id
      or held.expires_at is null or held.expires_at<=clock_timestamp() or held.revision<>effect.base_revision
      or not app_private.budget_metadata_supported(k,effect.resource_id)
      or (before_data-(case when effect.group_key='payer' then 'payer_id' else effect.group_key end)-'updated_at') is distinct from (after_data-(case when effect.group_key='payer' then 'payer_id' else effect.group_key end)-'updated_at')
      or after_data->(case when effect.group_key='payer' then 'payer_id' else effect.group_key end) is distinct from effect.value then
      raise exception 'invalid_group_effect' using errcode='55P03'; end if;
  elsif active then raise exception 'group_locked' using errcode='55P03';
  end if;
  -- New Actual links must not bypass a budget's metadata wildcard exclusion.
  if k='actual' then
    if (before_data->>'budget_item_id' is not null and app_private.budget_metadata_live('budget',(before_data->>'budget_item_id')::uuid))
      or (after_data->>'budget_item_id' is not null and app_private.budget_metadata_live('budget',(after_data->>'budget_item_id')::uuid)) then
      raise exception 'group_locked' using errcode='55P03'; end if;
  end if;
  foreach g in array (case when k='budget' then array['title','note','category','payer','links'] else array['title','note','category','payer'] end) loop
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
create or replace function app_private.guard_budget_metadata_children() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; k text; ids uuid[]; resource uuid; effect app_private.budget_metadata_effects; held app_private.budget_metadata_groups;
begin
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
  if not app_private.budget_metadata_undo_enabled() then return new; end if;
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current()
    and backend_id=pg_backend_pid() and user_id=new.user_id and request_id=new.request_id;
  if not found or effect.user_id is distinct from auth.uid() or effect.trip_id<>new.trip_id
    or effect.session_id<>new.session_id then raise exception 'invalid_undo_capture' using errcode='42501'; end if;
  if effect.group_key in ('category','payer','links') then return new;end if;
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
    rec:=app_private.budget_metadata_record(k,resource);trip:=(rec->>'trip_id')::uuid;
    if trip is null then select trip_id into trip from app_private.budget_metadata_groups where kind=k and resource_id=resource limit 1;end if;
    perform app_private.invalidate_budget_metadata_undo(trip,k,resource);
  end loop;
  return null;
end $$;
create or replace function public.patch_budget_metadata_group(
  p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_base_revision bigint,p_session_id uuid,p_token uuid,p_epoch bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare admission jsonb;
begin
  admission:=app_private.prepare_budget_metadata_patch(p_trip_id,p_kind,p_id,p_group,p_base_revision,p_session_id,p_token,p_epoch,p_patch,p_request_id);
  if (admission->>'replayed')::boolean then return admission->'result'; end if;
  if p_group='links' then
    if not (admission->>'noop')::boolean then
      delete from public.itinerary_budget_items where budget_item_id=p_id and itinerary_item_id not in(select v::uuid from jsonb_array_elements_text(admission->'value') v);
      insert into public.itinerary_budget_items(budget_item_id,itinerary_item_id)
        select p_id,v::uuid from jsonb_array_elements_text(admission->'value') v on conflict do nothing;
    end if;
  elsif not (admission->>'noop')::boolean then
    if p_kind='budget' then
      if p_group='title' then update public.budget_items set title=admission->>'value' where id=p_id and trip_id=p_trip_id;
      elsif p_group='category' then update public.budget_items set category=admission->>'value' where id=p_id and trip_id=p_trip_id;
      elsif p_group='payer' then update public.budget_items set payer_id=(admission->>'value')::uuid where id=p_id and trip_id=p_trip_id;
      else update public.budget_items set note=admission->>'value' where id=p_id and trip_id=p_trip_id; end if;
    else
      if p_group='title' then update public.actual_expenses set title=admission->>'value' where id=p_id and trip_id=p_trip_id;
      elsif p_group='category' then update public.actual_expenses set category=admission->>'value' where id=p_id and trip_id=p_trip_id;
      elsif p_group='payer' then update public.actual_expenses set payer_id=(admission->>'value')::uuid where id=p_id and trip_id=p_trip_id;
      else update public.actual_expenses set note=admission->>'value' where id=p_id and trip_id=p_trip_id; end if;
    end if;
    if not found then raise exception 'Record missing' using errcode='40001'; end if;
  end if;
  return app_private.finish_budget_metadata_patch();
end $$;
create or replace function app_private.keep_actual_twd_cost() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.twd_amount_source = 'legacy' and new.actual_twd_amount is null then new.actual_twd_amount := new.twd_amount; end if;
  if new.twd_amount_source in ('actual','legacy') then
    if new.actual_twd_amount is null then raise exception 'Actual TWD amount required' using errcode = '22023'; end if;
    new.twd_amount := new.actual_twd_amount;
  else new.actual_twd_amount := null; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at' - 'locked_at' - 'locked_by' - 'payment_origin')
    is distinct from (to_jsonb(old) - 'updated_at' - 'locked_at' - 'locked_by' - 'payment_origin') then new.payment_origin := 'manual'; end if;
  return new;
end $$;
create or replace function app_private.apply_trip_budget_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips; v_rate numeric; v_departed boolean;
begin
  if tg_op = 'UPDATE' and new.currency is not distinct from old.currency and new.amount is not distinct from old.amount
    and new.exchange_rate is not distinct from old.exchange_rate and new.twd_amount is not distinct from old.twd_amount
    and new.pricing_mode is not distinct from old.pricing_mode and new.unit_amount is not distinct from old.unit_amount then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.trip_id::text,0));
  select * into v_trip from public.trips where id = new.trip_id;
  v_departed := v_trip.status = 'settled' or v_trip.start_date::timestamp at time zone 'Asia/Taipei' <= clock_timestamp()
    or exists(select 1 from public.trip_budget_baselines where trip_id = new.trip_id and departure_at <= clock_timestamp());
  if tg_op = 'UPDATE' and v_departed and old.currency <> 'TWD' then
    raise exception '已出發的外幣預算保留原金額與匯率，只能修改名稱、備註等資訊。' using errcode = '22023';
  end if;
  if v_trip.budget_exchange_rates ? 'rates' and new.currency <> 'TWD' then
    v_rate := (v_trip.budget_exchange_rates->'rates'->>new.currency)::numeric;
    if v_rate is null or v_rate <= 0 then raise exception 'Missing trip currency rate' using errcode = '22023'; end if;
    new.exchange_rate := v_rate; new.twd_amount := round(new.amount*v_rate);
  end if;
  return new;
end $$;
create or replace function public.save_budget_workspace_record(
  p_trip_id uuid, p_kind text, p_id uuid, p_base_updated_at timestamptz, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_mode text := coalesce(p_payload->>'pricing_mode','split_total');
  v_currency text := upper(coalesce(nullif(btrim(p_payload->>'currency'),''),'TWD'));
  v_rate numeric;
  v_amount numeric;
  v_unit numeric;
  v_total_twd numeric;
  v_participants uuid[];
  v_links uuid[];
  v_shares jsonb := coalesce(p_payload->'shares','{}'::jsonb);
  v_payer uuid := nullif(p_payload->>'payer_id','')::uuid;
  v_source uuid := nullif(p_payload->>'budget_item_id','')::uuid;
  v_existing public.budget_items;
  v_actual public.actual_expenses;
  v_fixed_id uuid;
  v_user uuid;
  v_share numeric;
  v_title text := btrim(p_payload->>'title');
  v_category text := coalesce(nullif(btrim(p_payload->>'category'),''),'其他');
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id, auth.uid()) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if coalesce(p_kind,'') not in ('budget','actual') or v_mode not in ('per_person','split_total','custom') or coalesce(v_title,'') = '' then raise exception 'Invalid budget input' using errcode = '22023'; end if;
  if jsonb_typeof(p_payload->'participantIds') is distinct from 'array' then raise exception 'Participants required' using errcode = '22023'; end if;
  select array_agg(distinct value::uuid order by value::uuid) into v_participants from jsonb_array_elements_text(p_payload->'participantIds');
  if coalesce(cardinality(v_participants),0) = 0 or exists (
    select 1 from unnest(v_participants) u where not exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = u and m.status = 'approved')
  ) then raise exception 'Invalid participants' using errcode = '22023'; end if;
  if v_payer is not null and not exists (select 1 from public.trip_members where trip_id = p_trip_id and user_id = v_payer and status = 'approved') then raise exception 'Invalid payer' using errcode = '22023'; end if;
  if v_source is not null and not exists (select 1 from public.budget_items where id = v_source and trip_id = p_trip_id) then raise exception 'Invalid source budget' using errcode = '22023'; end if;
  select array_agg(distinct value::uuid) into v_links from jsonb_array_elements_text(coalesce(p_payload->'linkedItemIds','[]'::jsonb));
  if exists (select 1 from unnest(v_links) u where not exists (select 1 from public.itinerary_items where id = u and trip_id = p_trip_id)) then raise exception 'Invalid itinerary link' using errcode = '22023'; end if;
  v_rate := case when v_currency = 'TWD' then 1 else (p_payload->>'exchange_rate')::numeric end;
  if v_rate is null or v_rate <= 0 or v_rate <> round(v_rate,6) or v_rate >= 100000000 then raise exception 'Invalid exchange rate' using errcode = '22023'; end if;
  if v_mode = 'per_person' then
    v_unit := (p_payload->>'unit_amount')::numeric;
    if v_unit is null or v_unit < 0 or v_unit <> round(v_unit,2) then raise exception 'Invalid unit amount' using errcode = '22023'; end if;
    v_amount := v_unit * cardinality(v_participants);
  elsif v_mode = 'custom' then
    v_amount := 0;
    foreach v_user in array v_participants loop
      v_share := (v_shares->>v_user::text)::numeric;
      if v_share is null or v_share < 0 or v_share <> round(v_share,2) then raise exception 'Invalid member share' using errcode = '22023'; end if;
      v_amount := v_amount + v_share;
    end loop;
  else v_amount := (p_payload->>'amount')::numeric;
  end if;
  if v_amount is null or v_amount < 0 or v_amount <> round(v_amount,2) or v_amount >= 10000000000 then raise exception 'Invalid total amount' using errcode = '22023'; end if;
  v_total_twd := round(v_amount * v_rate);

  if p_kind = 'budget' then
    if p_id is not null then
      select * into v_existing from public.budget_items where id = p_id and trip_id = p_trip_id for update;
      if not found then raise exception 'Budget missing' using errcode = '40001'; end if;
      if p_base_updated_at is null or v_existing.updated_at <> p_base_updated_at then raise exception 'Budget changed' using errcode = '40001'; end if;
      if v_existing.locked_by is not null and v_existing.locked_by <> auth.uid() and v_existing.locked_at > clock_timestamp() - interval '7 minutes' then raise exception 'Budget locked' using errcode = '55P03'; end if;
    end if;
    insert into public.budget_items(id,trip_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,is_fixed,note)
    values(v_id,p_trip_id,v_category,nullif(btrim(p_payload->>'subcategory'),''),v_title,v_amount,v_currency,v_rate,v_total_twd,v_payer,v_mode,v_unit,case when v_mode = 'custom' then 'custom' else 'equal' end,coalesce((p_payload->>'is_fixed')::boolean,false),nullif(btrim(p_payload->>'note'),''))
    on conflict (id) do update set category = excluded.category, subcategory = excluded.subcategory,title = excluded.title,amount = excluded.amount,currency = excluded.currency,exchange_rate = excluded.exchange_rate,twd_amount = excluded.twd_amount,payer_id = excluded.payer_id,pricing_mode = excluded.pricing_mode,unit_amount = excluded.unit_amount,split_type = excluded.split_type,is_fixed = excluded.is_fixed,note = excluded.note;
    delete from public.budget_item_participants where budget_item_id = v_id;
    foreach v_user in array v_participants loop
      -- Only custom weights need persisted shares. Equal shares derive from
      -- total, including fractional original cents, without independent sums.
      insert into public.budget_item_participants(budget_item_id,user_id,share_amount) values (v_id,v_user,case when v_mode = 'custom' then (v_shares->>v_user::text)::numeric else null end);
    end loop;
    delete from public.itinerary_budget_items where budget_item_id = v_id;
    insert into public.itinerary_budget_items(budget_item_id,itinerary_item_id) select v_id,unnest(v_links);
    -- Fixed means create once, never overwrite an already edited actual.
    if coalesce((p_payload->>'is_fixed')::boolean,false) and not exists (select 1 from public.actual_expenses where budget_item_id = v_id) then
      v_fixed_id := gen_random_uuid();
      insert into public.actual_expenses(id,trip_id,budget_item_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,note)
      select v_fixed_id,trip_id,id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,note from public.budget_items where id = v_id;
      insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) select v_fixed_id,user_id,share_amount from public.budget_item_participants where budget_item_id = v_id;
      update public.budget_items set auto_created_actual_expense_id = v_fixed_id where id = v_id;
    end if;
    update public.budget_items set locked_by = null, locked_at = null where id = v_id and locked_by = auth.uid();
  else
    if p_id is not null then
      select * into v_actual from public.actual_expenses where id = p_id and trip_id = p_trip_id for update;
      if not found or p_base_updated_at is null or v_actual.updated_at <> p_base_updated_at then raise exception 'Expense changed' using errcode = '40001'; end if;
      if v_actual.locked_by is not null and v_actual.locked_by <> auth.uid() and v_actual.locked_at > clock_timestamp() - interval '7 minutes' then raise exception 'Expense locked' using errcode = '55P03'; end if;
    end if;
    insert into public.actual_expenses(id,trip_id,budget_item_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,paid_at,note)
    values(v_id,p_trip_id,v_source,v_category,nullif(btrim(p_payload->>'subcategory'),''),v_title,v_amount,v_currency,v_rate,v_total_twd,v_payer,v_mode,v_unit,case when v_mode = 'custom' then 'custom' else 'equal' end,coalesce(nullif(p_payload->>'paid_at','')::timestamptz,clock_timestamp()),nullif(btrim(p_payload->>'note'),''))
    on conflict (id) do update set budget_item_id = excluded.budget_item_id,category = excluded.category,subcategory = excluded.subcategory,title = excluded.title,amount = excluded.amount,currency = excluded.currency,exchange_rate = excluded.exchange_rate,twd_amount = excluded.twd_amount,payer_id = excluded.payer_id,pricing_mode = excluded.pricing_mode,unit_amount = excluded.unit_amount,split_type = excluded.split_type,paid_at = excluded.paid_at,note = excluded.note;
    delete from public.actual_expense_participants where actual_expense_id = v_id;
    foreach v_user in array v_participants loop
      insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) values (v_id,v_user,case when v_mode = 'custom' then (v_shares->>v_user::text)::numeric else null end);
    end loop;
    update public.actual_expenses set locked_by = null, locked_at = null where id = v_id and locked_by = auth.uid();
  end if;
  return jsonb_build_object('id',v_id);
end;
$$;
drop trigger zzz_pricing_budget on public.budget_items;
drop trigger zzz_pricing_actual on public.actual_expenses;
drop trigger zzz_pricing_people on public.budget_item_participants;
drop trigger zzz_pricing_actual_people on public.actual_expense_participants;
drop trigger zzz_pricing_trip on public.trips;
drop trigger zzz_pricing_member on public.trip_members;
drop function app_private.track_budget_pricing_versions();
drop function public.patch_budget_pricing_group(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid);
drop function app_private.prepare_budget_pricing_patch(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid);
drop function app_private.finish_budget_pricing_patch();
drop function app_private.budget_pricing_effect(text,uuid);
drop function app_private.budget_pricing_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean);
drop function app_private.read_budget_pricing_value(text,uuid);
drop function app_private.budget_pricing_versions(text,uuid);
drop function app_private.budget_pricing_targets(text,uuid);
drop function app_private.calculate_budget_group_pricing(jsonb);
delete from app_private.budget_metadata_groups where group_key='pricing';
alter table app_private.budget_metadata_groups drop constraint budget_metadata_groups_group_key_check;
alter table app_private.budget_metadata_groups add constraint budget_metadata_groups_group_key_check check(group_key in ('title','note','category','payer','links'));
alter table app_private.budget_metadata_groups drop column graph_revision,drop column pricing_bundle;
alter table app_private.budget_metadata_effects drop column pricing_manifest;
drop table app_private.budget_pricing_trip_versions;
commit;
