-- Dormant schema-v2 category/payer/links slice. Linked financial graphs fail closed.
begin;
alter table app_private.budget_metadata_groups drop constraint budget_metadata_groups_group_key_check;
alter table app_private.budget_metadata_groups add constraint budget_metadata_groups_group_key_check check(group_key in ('title','note','category','payer','links'));
insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id)
select 'budget',id,g,trip_id from public.budget_items cross join unnest(array['category','payer','links']) g
union all select 'actual',id,g,trip_id from public.actual_expenses cross join unnest(array['category','payer']) g;

create function app_private.budget_metadata_value(p_kind text,p_id uuid,p_group text) returns jsonb
language sql stable security definer set search_path='' as $$
select case when p_group='links' then coalesce((select jsonb_agg(l.itinerary_item_id order by l.itinerary_item_id) from public.itinerary_budget_items l where l.budget_item_id=p_id),'[]'::jsonb)
else app_private.budget_metadata_record(p_kind,p_id)->(case when p_group='payer' then 'payer_id' else p_group end) end
$$;
revoke all on function app_private.budget_metadata_value(text,uuid,text) from public,anon,authenticated;
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
create or replace function app_private.prepare_budget_metadata_patch(
  p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_base_revision bigint,p_session_id uuid,p_token uuid,p_epoch bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rec jsonb; held app_private.budget_metadata_groups;
  signature jsonb; cached app_private.budget_metadata_requests; value jsonb;
begin
  if actor is null or not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_trip_id is null or p_id is null or p_kind is null or p_kind not in ('budget','actual')
    or p_group is null or p_group not in ('title','note','category','payer','links') or (p_kind='actual' and p_group='links') or p_request_id is null or p_session_id is null
    or p_base_revision is null or p_base_revision<0 or jsonb_typeof(p_patch) is distinct from 'object'
    or not(p_patch ? p_group) or p_patch - p_group <> '{}'::jsonb then
    raise exception 'invalid_group_patch' using errcode='22023'; end if;
  if p_group in ('title','note','category') then
    if jsonb_typeof(p_patch->p_group) is distinct from 'string' and not(p_group='note' and p_patch->p_group='null'::jsonb) then raise exception 'invalid_group_value' using errcode='22023';end if;
    if p_group in ('title','category') and btrim(p_patch->>p_group)='' then raise exception 'Value required' using errcode='22023';end if;
    value:=case when p_group='note' then coalesce(to_jsonb(nullif(btrim(p_patch->>p_group),'')),'null'::jsonb) else to_jsonb(btrim(p_patch->>p_group)) end;
  elsif p_group='payer' then
    if p_patch->p_group='null'::jsonb then value:='null';
    elsif jsonb_typeof(p_patch->p_group)='string' then value:=to_jsonb((p_patch->>p_group)::uuid);
    else raise exception 'invalid_payer' using errcode='22023';end if;
  else
    if jsonb_typeof(p_patch->p_group) is distinct from 'array' then raise exception 'invalid_links' using errcode='22023';end if;
    if exists(select 1 from jsonb_array_elements(p_patch->p_group) e where jsonb_typeof(e)<>'string') then raise exception 'invalid_links' using errcode='22023';end if;
    select coalesce(jsonb_agg(id order by id),'[]') into value from (select distinct v::uuid id from jsonb_array_elements_text(p_patch->p_group) v) ids;
  end if;
  signature:=jsonb_build_object('protocol','metadata-prototype','trip',p_trip_id,'kind',p_kind,'id',p_id,
    'group',p_group,'base',p_base_revision,'value',value,'session',p_session_id);
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  if not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into cached from app_private.budget_metadata_requests where user_id=actor and request_id=p_request_id;
  if found then
    if cached.signature<>signature or cached.trip_id<>p_trip_id or cached.session_id<>p_session_id then
      raise exception 'request_mismatch' using errcode='22023'; end if;
    return jsonb_build_object('replayed',true,'result',cached.result);
  end if;
  if not app_private.budget_metadata_enabled() then raise exception 'group_protocol_disabled' using errcode='55000'; end if;
  -- Legacy/raw SQL can lock the parent BEFORE entering its trigger's trip
  -- lock. Never hold our trip lock while waiting for that parent: it creates
  -- a trip-lock -> row-lock -> trip-lock cycle. Fail atomically with 55P03;
  -- the caller can retry the same request after the other transaction ends.
  if p_kind='budget' then
    select to_jsonb(b) into rec from public.budget_items b where b.id=p_id and b.trip_id=p_trip_id for update nowait;
  else
    select to_jsonb(a) into rec from public.actual_expenses a where a.id=p_id and a.trip_id=p_trip_id for update nowait;
  end if;
  if rec is null or (rec->>'trip_id')::uuid<>p_trip_id then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.trip_members where trip_id=p_trip_id and user_id=actor and status='approved' for share nowait;
  if not found then raise exception 'Forbidden' using errcode='42501'; end if;
  if not app_private.budget_metadata_supported(p_kind,p_id) then raise exception 'group_dependency_not_supported' using errcode='0A000'; end if;
  if exists(select 1 from app_private.budget_edit_leases where kind=p_kind and resource_id=p_id and expires_at>clock_timestamp())
    or (nullif(rec->>'locked_by','') is not null and (rec->>'locked_at')::timestamptz>clock_timestamp()-interval '7 minutes') then
    raise exception 'legacy_locked' using errcode='55P03'; end if;
  select * into held from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and group_key=p_group and trip_id=p_trip_id for update;
  if not found or held.is_deleted or held.user_id is distinct from actor or held.session_id is distinct from p_session_id
    or p_token is null or held.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8'))
    or held.lease_epoch is distinct from p_epoch or held.expires_at is null or held.expires_at<=clock_timestamp() then
    raise exception 'lease_lost' using errcode='55P03'; end if;
  if held.revision<>p_base_revision then raise exception 'group_conflict' using errcode='40001'; end if;
  if p_group='payer' and value<>'null'::jsonb then
    perform 1 from public.trip_members where trip_id=p_trip_id and user_id=(value#>>'{}')::uuid and status='approved' for share nowait;
    if not found then raise exception 'invalid_payer' using errcode='22023';end if;
  elsif p_group='links' then
    -- A raw legacy UPDATE/DELETE may already own a child row before entering
    -- its trip-lock trigger. Never wait for that row while holding trip lock.
    perform 1 from public.itinerary_budget_items where budget_item_id=p_id order by itinerary_item_id for update nowait;
    perform 1 from public.itinerary_items where trip_id=p_trip_id and id in(select v::uuid from jsonb_array_elements_text(value) v) order by id for share nowait;
    if (select count(*) from public.itinerary_items where trip_id=p_trip_id and id in(select v::uuid from jsonb_array_elements_text(value) v))<>jsonb_array_length(value) then raise exception 'invalid_links' using errcode='22023';end if;
  end if;
  insert into app_private.budget_metadata_effects values(txid_current(),pg_backend_pid(),actor,p_trip_id,p_kind,p_id,p_group,
    p_session_id,p_request_id,p_base_revision,p_epoch,value,signature);
  return jsonb_build_object('replayed',false,'value',value,'noop',app_private.budget_metadata_value(p_kind,p_id,p_group) is not distinct from value);
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
create function app_private.track_budget_metadata_links() returns trigger
language plpgsql security definer set search_path='' as $$
declare resource uuid; ids uuid[]; effect app_private.budget_metadata_effects;
begin
  if tg_op='INSERT' then ids:=array[new.budget_item_id];elsif tg_op='DELETE' then ids:=array[old.budget_item_id];else ids:=array[old.budget_item_id,new.budget_item_id];end if;
  for resource in select distinct x from unnest(ids) x order by x loop
    select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and kind='budget' and resource_id=resource and group_key='links';
    update app_private.budget_metadata_groups set revision=case when effect.request_id is not null then effect.base_revision+1 else revision+1 end
      where kind='budget' and resource_id=resource and group_key='links';
  end loop;return null;
end $$;
revoke all on function app_private.track_budget_metadata_links() from public,anon,authenticated;
create trigger zz_budget_metadata_links_version after insert or update or delete on public.itinerary_budget_items for each row execute function app_private.track_budget_metadata_links();
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
create function app_private.read_budget_metadata_state_v2(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with allowed as materialized (
    select p_trip_id id where auth.uid() is not null
      and app_private.can_read_trip(p_trip_id,auth.uid())
  ), resources as materialized (
    select 'budget'::text kind,b.id,b.trip_id,b.title,b.note,b.category,b.payer_id,
      app_private.budget_metadata_supported('budget',b.id) supported
      from public.budget_items b join allowed t on b.trip_id=t.id
    union all
    select 'actual',a.id,a.trip_id,a.title,a.note,a.category,a.payer_id,
      app_private.budget_metadata_supported('actual',a.id)
      from public.actual_expenses a join allowed t on a.trip_id=t.id
  ), states as materialized (
    select r.kind,r.id,r.trip_id,r.supported,k.group_key,
      app_private.budget_metadata_value(r.kind,r.id,k.group_key) value,
      g.revision,g.lease_epoch epoch,
      coalesce(not g.is_deleted and g.user_id is not null and g.expires_at>statement_timestamp()
        and app_private.can_edit_trip(r.trip_id,g.user_id),false) held,
      g.user_id,g.session_id,g.expires_at
    from resources r cross join unnest(case when r.kind='budget' then array['title','note','category','payer','links'] else array['title','note','category','payer'] end) k(group_key)
    left join app_private.budget_metadata_groups g on g.kind=r.kind and g.resource_id=r.id
      and g.group_key=k.group_key and g.trip_id=r.trip_id and not g.is_deleted
  ), records as (
    select kind,id,trip_id,bool_and(supported) supported,
      bool_and(revision is not null) state_ready,
      jsonb_agg(jsonb_build_object('group',group_key,'value',value,'revision',revision,'epoch',epoch,
        'held',held,'owner_id',case when held then user_id end,
        'own_session',coalesce(held and user_id=auth.uid() and session_id=p_session_id,false),
        'expires_at',case when held then expires_at end) order by group_key) groups
    from states group by kind,id,trip_id
  )
  select jsonb_build_object('protocol',jsonb_build_object('name','metadata-prototype','schemaVersion',2,
      'enabled',app_private.budget_metadata_enabled(),'complete',false,'groups',jsonb_build_array('title','note','category','payer','links')),
    'records',coalesce((select jsonb_agg(to_jsonb(r) order by r.kind,r.id) from records r),'[]'),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('kind',s.kind,'resource_id',s.id,
      'group_key',s.group_key,'user_id',s.user_id,'expires_at',s.expires_at,'mode','edit',
      'own_session',coalesce(s.user_id=auth.uid() and s.session_id=p_session_id,false),
      'selected_at',null) order by s.kind,s.id,s.group_key) from states s where s.held),'[]'))
  from allowed
$$;
revoke all on function app_private.read_budget_metadata_state_v2(uuid,uuid) from public,anon;
grant execute on function app_private.read_budget_metadata_state_v2(uuid,uuid) to authenticated;
create function public.read_budget_metadata_snapshot_v2(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with financial as materialized (
    select public.read_budget_snapshot(p_trip_id) data
  ), metadata as materialized (
    select app_private.read_budget_metadata_state_v2(p_trip_id,p_session_id) data
  ), legacy as materialized (
    select public.read_budget_collaboration(p_trip_id,p_session_id) data
  ), entries as materialized (
    select e.value from legacy l cross join lateral jsonb_array_elements(l.data->'entries') e
      where (e.value->>'expires_at')::timestamptz>statement_timestamp()
    union all
    select e.value from metadata m cross join lateral jsonb_array_elements(m.data->'entries') e
  )
  select f.data || jsonb_build_object('metadataProtocol',m.data->'protocol','metadataRecords',m.data->'records',
    'serverNow',statement_timestamp(),
    'collaborationRevision',coalesce((select s.revision from public.budget_collaboration_signals s where s.trip_id=p_trip_id),0),
    'nextRefreshAt',(select min((value->>'expires_at')::timestamptz) from entries),
    'collaboration',l.data || jsonb_build_object('groupProtocol','metadata-prototype',
      'serverNow',statement_timestamp(),'entries',coalesce((select jsonb_agg(value order by value->>'kind',
        value->>'resource_id',value->>'group_key',value->>'user_id',value->>'mode') from entries),'[]')))
  from financial f cross join metadata m cross join legacy l
  where f.data is not null and m.data is not null and l.data is not null
$$;
revoke all on function public.read_budget_metadata_snapshot_v2(uuid,uuid) from public,anon;
grant execute on function public.read_budget_metadata_snapshot_v2(uuid,uuid) to authenticated;

create or replace function app_private.read_budget_metadata_groups(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with rec as (select app_private.budget_metadata_record(p_kind,p_id) data), allowed as (
    select data from rec where auth.uid() is not null and (data->>'trip_id')::uuid=p_trip_id and app_private.can_read_trip(p_trip_id,auth.uid())
  ) select jsonb_build_object('protocol','metadata-prototype','enabled',app_private.budget_metadata_enabled(),
    'id',p_id,'tripId',p_trip_id,'supported',app_private.budget_metadata_supported(p_kind,p_id),
    'groups',(select jsonb_agg(jsonb_build_object('group',g.group_key,'revision',g.revision,'value',a.data->g.group_key,
      'epoch',g.lease_epoch,'held',g.user_id is not null and g.expires_at>current_timestamp and app_private.can_edit_trip(g.trip_id,g.user_id),
      'owner_id',case when g.expires_at>current_timestamp and app_private.can_edit_trip(g.trip_id,g.user_id) then g.user_id end,
      'own_session',coalesce(g.user_id=auth.uid() and g.session_id=p_session_id and g.expires_at>current_timestamp and app_private.can_edit_trip(g.trip_id,g.user_id),false),
      'expires_at',g.expires_at) order by g.group_key) from app_private.budget_metadata_groups g
      where g.trip_id=p_trip_id and g.kind=p_kind and g.resource_id=p_id and not g.is_deleted and g.group_key in ('title','note'))) from allowed a
$$;
commit;
