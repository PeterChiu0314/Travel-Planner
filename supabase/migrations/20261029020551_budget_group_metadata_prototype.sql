-- Issue #15 local metadata vertical slice. Dormant by default; NOT a rollout.
-- Only title/note on unlinked budgets and standalone manual Actuals are supported.
begin;

create table app_private.budget_metadata_protocol (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into app_private.budget_metadata_protocol values(true,false);
create table app_private.budget_metadata_groups (
  kind text not null check(kind in ('budget','actual')),
  resource_id uuid not null, group_key text not null check(group_key in ('title','note')),
  trip_id uuid not null references public.trips(id) on delete cascade,
  revision bigint not null default 0 check(revision>=0),
  lease_epoch bigint not null default 0 check(lease_epoch>=0),
  is_deleted boolean not null default false,
  user_id uuid references auth.users(id) on delete set null,
  session_id uuid, token_hash bytea, expires_at timestamptz,
  activity_seq bigint not null default 0 check(activity_seq>=0),
  last_activity_at timestamptz, dirty boolean not null default false,
  primary key(kind,resource_id,group_key)
);
create index budget_metadata_groups_trip on app_private.budget_metadata_groups(trip_id);
create table app_private.budget_metadata_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null, trip_id uuid not null references public.trips(id) on delete cascade,
  session_id uuid not null, signature jsonb not null, result jsonb not null,
  primary key(user_id,request_id)
);
-- A private, transaction-bound exact effect, never a caller-controlled GUC.
create table app_private.budget_metadata_effects (
  transaction_id bigint not null, backend_id integer not null,
  user_id uuid not null, trip_id uuid not null, kind text not null,
  resource_id uuid not null, group_key text not null, session_id uuid not null,
  request_id uuid not null, base_revision bigint not null, lease_epoch bigint not null,
  value jsonb not null, signature jsonb not null,
  primary key(transaction_id,backend_id)
);
alter table app_private.budget_metadata_protocol enable row level security;
alter table app_private.budget_metadata_groups enable row level security;
alter table app_private.budget_metadata_requests enable row level security;
alter table app_private.budget_metadata_effects enable row level security;
revoke all on app_private.budget_metadata_protocol,app_private.budget_metadata_groups,
  app_private.budget_metadata_requests,app_private.budget_metadata_effects from public,anon,authenticated;

insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id)
select 'budget',b.id,g,b.trip_id from public.budget_items b cross join unnest(array['title','note']) g
union all select 'actual',a.id,g,a.trip_id from public.actual_expenses a cross join unnest(array['title','note']) g;

create function app_private.budget_metadata_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select enabled from app_private.budget_metadata_protocol where singleton),false)
$$;
revoke all on function app_private.budget_metadata_enabled() from public,anon,authenticated;

create function app_private.budget_metadata_record(p_kind text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rec jsonb;
begin
  if p_kind='budget' then select to_jsonb(b) into rec from public.budget_items b where id=p_id;
  elsif p_kind='actual' then select to_jsonb(a) into rec from public.actual_expenses a where id=p_id;
  else raise exception 'invalid_group_kind' using errcode='22023'; end if;
  return rec;
end $$;
revoke all on function app_private.budget_metadata_record(text,uuid) from public,anon,authenticated;

create function app_private.budget_metadata_supported(p_kind text,p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select case when p_kind='budget' then exists(select 1 from public.budget_items b where b.id=p_id and not b.is_fixed
    and b.auto_created_actual_expense_id is null and not exists(select 1 from public.actual_expenses a where a.budget_item_id=b.id))
  else exists(select 1 from public.actual_expenses a where a.id=p_id and a.budget_item_id is null and a.payment_origin='manual') end
$$;
revoke all on function app_private.budget_metadata_supported(text,uuid) from public,anon,authenticated;

create function app_private.budget_metadata_live(p_kind text,p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from app_private.budget_metadata_groups g where g.kind=p_kind and g.resource_id=p_id
    and not g.is_deleted and g.user_id is not null and g.expires_at>clock_timestamp())
$$;
revoke all on function app_private.budget_metadata_live(text,uuid) from public,anon,authenticated;

create function app_private.budget_metadata_admission(
  p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_session_id uuid,p_token uuid,p_action text,
  p_base_revision bigint,p_epoch bigint,p_activity_seq bigint,p_dirty boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rec jsonb; held app_private.budget_metadata_groups; stamp timestamptz;
  activity_at timestamptz; next_seq bigint; deadline timestamptz;
begin
  if actor is null or p_trip_id is null or p_id is null or p_kind is null or p_kind not in ('budget','actual')
    or p_group is null or p_group not in ('title','note') or p_session_id is null or p_token is null
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
  perform 1 from public.trip_members where trip_id=p_trip_id and user_id=actor and status='approved' for share;
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
    'expires_at',least(stamp+interval '7 minutes',deadline),'value',rec->p_group);
end $$;
revoke all on function app_private.budget_metadata_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean) from public,anon;
grant execute on function app_private.budget_metadata_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean) to authenticated;
create function public.budget_metadata_group_lease(
  p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_session_id uuid,p_token uuid,p_action text,
  p_base_revision bigint default null,p_epoch bigint default null,p_activity_seq bigint default 0,p_dirty boolean default false)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.budget_metadata_admission(p_trip_id,p_kind,p_id,p_group,p_session_id,p_token,p_action,p_base_revision,p_epoch,p_activity_seq,p_dirty)
$$;
revoke all on function public.budget_metadata_group_lease(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean) from public,anon;
grant execute on function public.budget_metadata_group_lease(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean) to authenticated;

-- Existing whole-record admission is a wildcard against every new group.
create function app_private.guard_legacy_budget_metadata_lease() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.expires_at>clock_timestamp() and app_private.budget_metadata_live(new.kind,new.resource_id) then
    raise exception 'group_locked' using errcode='55P03'; end if;
  return new;
end $$;
revoke all on function app_private.guard_legacy_budget_metadata_lease() from public,anon,authenticated;
create trigger budget_metadata_legacy_guard before insert or update on app_private.budget_edit_leases
for each row execute function app_private.guard_legacy_budget_metadata_lease();

create function app_private.prepare_budget_metadata_patch(
  p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_base_revision bigint,p_session_id uuid,p_token uuid,p_epoch bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rec jsonb; held app_private.budget_metadata_groups;
  signature jsonb; cached app_private.budget_metadata_requests; value jsonb;
begin
  if actor is null or not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_trip_id is null or p_id is null or p_kind is null or p_kind not in ('budget','actual')
    or p_group is null or p_group not in ('title','note') or p_request_id is null or p_session_id is null
    or p_base_revision is null or p_base_revision<0 or jsonb_typeof(p_patch) is distinct from 'object'
    or not(p_patch ? p_group) or p_patch - p_group <> '{}'::jsonb then
    raise exception 'invalid_group_patch' using errcode='22023'; end if;
  if jsonb_typeof(p_patch->p_group) is distinct from 'string'
    and not(p_group='note' and p_patch->p_group='null'::jsonb) then raise exception 'invalid_group_value' using errcode='22023'; end if;
  if p_group='title' and btrim(p_patch->>p_group)='' then raise exception 'Title required' using errcode='22023'; end if;
  value:=case when p_group='title' then to_jsonb(btrim(p_patch->>p_group)) else coalesce(to_jsonb(nullif(btrim(p_patch->>p_group),'')),'null'::jsonb) end;
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
  perform 1 from public.trip_members where trip_id=p_trip_id and user_id=actor and status='approved' for share;
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
  insert into app_private.budget_metadata_effects values(txid_current(),pg_backend_pid(),actor,p_trip_id,p_kind,p_id,p_group,
    p_session_id,p_request_id,p_base_revision,p_epoch,value,signature);
  return jsonb_build_object('replayed',false,'value',value,'noop',rec->p_group is not distinct from value);
end $$;
revoke all on function app_private.prepare_budget_metadata_patch(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid) from public,anon;
grant execute on function app_private.prepare_budget_metadata_patch(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid) to authenticated;

create function app_private.finish_budget_metadata_patch() returns jsonb
language plpgsql security definer set search_path='' as $$
declare effect app_private.budget_metadata_effects; rec jsonb; rev bigint; result jsonb;
begin
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid();
  if not found or not app_private.can_edit_trip(effect.trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  rec:=app_private.budget_metadata_record(effect.kind,effect.resource_id);
  select revision into rev from app_private.budget_metadata_groups where kind=effect.kind and resource_id=effect.resource_id and group_key=effect.group_key;
  if rec is null or rec->effect.group_key is distinct from effect.value or rev not in (effect.base_revision,effect.base_revision+1) then
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
revoke all on function app_private.finish_budget_metadata_patch() from public,anon;
grant execute on function app_private.finish_budget_metadata_patch() to authenticated;

create function public.patch_budget_metadata_group(
  p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_base_revision bigint,p_session_id uuid,p_token uuid,p_epoch bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare admission jsonb;
begin
  admission:=app_private.prepare_budget_metadata_patch(p_trip_id,p_kind,p_id,p_group,p_base_revision,p_session_id,p_token,p_epoch,p_patch,p_request_id);
  if (admission->>'replayed')::boolean then return admission->'result'; end if;
  if not (admission->>'noop')::boolean then
    if p_kind='budget' then
      if p_group='title' then update public.budget_items set title=admission->>'value' where id=p_id and trip_id=p_trip_id;
      else update public.budget_items set note=admission->>'value' where id=p_id and trip_id=p_trip_id; end if;
    else
      if p_group='title' then update public.actual_expenses set title=admission->>'value' where id=p_id and trip_id=p_trip_id;
      else update public.actual_expenses set note=admission->>'value' where id=p_id and trip_id=p_trip_id; end if;
    end if;
    if not found then raise exception 'Record missing' using errcode='40001'; end if;
  end if;
  return app_private.finish_budget_metadata_patch();
end $$;
revoke all on function public.patch_budget_metadata_group(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid) from public,anon;
grant execute on function public.patch_budget_metadata_group(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid) to authenticated;

-- Validate the final row after every BEFORE trigger, and track legacy metadata
-- revisions even while the experiment is dormant. Never UPDATE financial rows.
create function app_private.guard_budget_metadata_row() returns trigger
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
      or (before_data-effect.group_key-'updated_at') is distinct from (after_data-effect.group_key-'updated_at')
      or after_data->effect.group_key is distinct from effect.value then
      raise exception 'invalid_group_effect' using errcode='55P03'; end if;
  elsif active then raise exception 'group_locked' using errcode='55P03';
  end if;
  -- New Actual links must not bypass a budget's metadata wildcard exclusion.
  if k='actual' then
    if (before_data->>'budget_item_id' is not null and app_private.budget_metadata_live('budget',(before_data->>'budget_item_id')::uuid))
      or (after_data->>'budget_item_id' is not null and app_private.budget_metadata_live('budget',(after_data->>'budget_item_id')::uuid)) then
      raise exception 'group_locked' using errcode='55P03'; end if;
  end if;
  foreach g in array array['title','note'] loop
    if tg_op='INSERT' then
      insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) values(k,(data->>'id')::uuid,g,(data->>'trip_id')::uuid)
        on conflict(kind,resource_id,group_key) do update set is_deleted=false,trip_id=excluded.trip_id,revision=app_private.budget_metadata_groups.revision+1,
          lease_epoch=app_private.budget_metadata_groups.lease_epoch+1,user_id=null,session_id=null,token_hash=null,expires_at=null;
    elsif tg_op='DELETE' then
      update app_private.budget_metadata_groups set revision=revision+1,lease_epoch=lease_epoch+1,is_deleted=true,
        user_id=null,session_id=null,token_hash=null,expires_at=null where kind=k and resource_id=(data->>'id')::uuid and group_key=g;
    elsif before_data->g is distinct from after_data->g or before_data->>'trip_id' is distinct from after_data->>'trip_id' then
      update app_private.budget_metadata_groups set revision=revision+1,trip_id=(data->>'trip_id')::uuid
        where kind=k and resource_id=(data->>'id')::uuid and group_key=g;
    end if;
  end loop;
  return null;
end $$;
revoke all on function app_private.guard_budget_metadata_row() from public,anon,authenticated;
create trigger budget_metadata_row_guard after insert or update or delete on public.budget_items for each row execute function app_private.guard_budget_metadata_row();
create trigger actual_metadata_row_guard after insert or update or delete on public.actual_expenses for each row execute function app_private.guard_budget_metadata_row();

create function app_private.guard_budget_metadata_children() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; k text; ids uuid[]; resource uuid;
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
    if app_private.budget_metadata_live(k,resource) then raise exception 'group_locked' using errcode='55P03'; end if;
  end loop;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function app_private.guard_budget_metadata_children() from public,anon,authenticated;
create trigger budget_metadata_people_guard before insert or update or delete on public.budget_item_participants for each row execute function app_private.guard_budget_metadata_children();
create trigger actual_metadata_people_guard before insert or update or delete on public.actual_expense_participants for each row execute function app_private.guard_budget_metadata_children();
create trigger budget_metadata_links_guard before insert or update or delete on public.itinerary_budget_items for each row execute function app_private.guard_budget_metadata_children();
create trigger budget_metadata_receipts_guard before insert or update or delete on public.attachments for each row execute function app_private.guard_budget_metadata_children();

-- A caller cannot commit a prepared effect without completing its guarded RPC.
create function app_private.assert_budget_metadata_effect_finished() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from app_private.budget_metadata_effects where transaction_id=new.transaction_id and backend_id=new.backend_id) then
    raise exception 'unfinished_group_patch' using errcode='40001'; end if;
  return null;
end $$;
revoke all on function app_private.assert_budget_metadata_effect_finished() from public,anon,authenticated;
create constraint trigger budget_metadata_effect_finished after insert on app_private.budget_metadata_effects
deferrable initially deferred for each row execute function app_private.assert_budget_metadata_effect_finished();

create function app_private.read_budget_metadata_groups(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid)
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
      where g.trip_id=p_trip_id and g.kind=p_kind and g.resource_id=p_id and not g.is_deleted)) from allowed a
$$;
revoke all on function app_private.read_budget_metadata_groups(uuid,text,uuid,uuid) from public,anon;
grant execute on function app_private.read_budget_metadata_groups(uuid,text,uuid,uuid) to authenticated;
create function public.read_budget_metadata_groups(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.read_budget_metadata_groups(p_trip_id,p_kind,p_id,p_session_id)
$$;
revoke all on function public.read_budget_metadata_groups(uuid,text,uuid,uuid) from public,anon;
grant execute on function public.read_budget_metadata_groups(uuid,text,uuid,uuid) to authenticated;
commit;
