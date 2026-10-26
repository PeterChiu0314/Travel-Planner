-- Issue #6: require an approved assignee. Apply as one transaction.
-- Preflight counts are emitted before narrowly scoped cleanup; no assigned or
-- personal items are deleted. Abort rather than silently rewrite old mirrors.
do $$
declare cleanup_count bigint;
begin
  select count(*) into cleanup_count from public.shared_luggage_items where assigned_to is null;
  raise notice 'unassigned_shared_luggage_cleanup_count=%', cleanup_count;
  if exists(select 1 from public.luggage_items p join public.shared_luggage_items s on s.id=p.shared_item_id where s.assigned_to is null) then
    raise exception 'luggage_cleanup_has_legacy_mirrors' using errcode='23514';
  end if;
  if exists(select 1 from public.shared_luggage_items s where s.assigned_to is not null and not exists(
    select 1 from public.trip_members m where m.trip_id=s.trip_id and m.user_id=s.assigned_to and m.status='approved')) then
    raise exception 'luggage_cleanup_requires_reassignment' using errcode='23514';
  end if;
  delete from public.shared_luggage_items where assigned_to is null;
end;
$$;

alter table public.shared_luggage_items alter column assigned_to set not null;
alter table public.shared_luggage_items drop constraint shared_luggage_items_assigned_to_fkey;
alter table public.shared_luggage_items add constraint luggage_assignee_account_fk foreign key(assigned_to)
  references auth.users(id) on delete no action deferrable initially immediate;
alter table public.shared_luggage_items add constraint luggage_assignee_membership_fk foreign key(trip_id,assigned_to)
  references public.trip_members(trip_id,user_id) on delete no action deferrable initially immediate;

-- Internal trigger only: locking membership rows must work for approved viewers
-- who may manage luggage but cannot UPDATE other members through their RLS.
-- Definer rights are confined to this lookup, with caller/trip authorization;
-- no rows are returned and this function is not a public/Data API RPC.
create function app_private.require_luggage_assignee()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not app_private.can_read_trip(new.trip_id,auth.uid()) then
    raise exception 'luggage_forbidden' using errcode='42501';
  end if;
  if new.assigned_to is null then raise exception 'luggage_invalid_assignee' using errcode='22023'; end if;
  perform 1 from public.trip_members where trip_id=new.trip_id and user_id=new.assigned_to and status='approved' for share;
  if not found then raise exception 'luggage_invalid_assignee' using errcode='22023'; end if;
  return new;
end;
$$;
revoke all on function app_private.require_luggage_assignee() from public,anon,authenticated;
create trigger a_luggage_assignee_required before insert or update of assigned_to on public.shared_luggage_items
  for each row execute function app_private.require_luggage_assignee();

create function app_private.guard_luggage_assignee_membership()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status <> 'approved' and exists(select 1 from public.shared_luggage_items where trip_id=old.trip_id and assigned_to=old.user_id) then
    raise exception 'luggage_reassign_required' using errcode='23503';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_luggage_assignee_membership() from public,anon,authenticated;
create trigger luggage_assignee_membership_status before update of status on public.trip_members
  for each row execute function app_private.guard_luggage_assignee_membership();

create or replace function public.mutate_luggage_item(
  p_trip_id uuid, p_scope text, p_action text, p_item_id uuid default null,
  p_expected_updated_at timestamptz default null, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  personal public.luggage_items%rowtype;
  shared public.shared_luggage_items%rowtype;
  current_record jsonb;
  output_record jsonb;
  allowed_keys text[];
begin
  if actor is null or not app_private.can_read_trip(p_trip_id, actor) then
    raise exception 'luggage_forbidden' using errcode = '42501';
  end if;
  if p_scope not in ('personal', 'shared') or p_action not in ('save', 'patch', 'delete')
    or p_scope is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  if p_scope='shared' and p_action='save' and nullif(p_payload->>'assigned_to','') is null then
    raise exception 'luggage_invalid_assignee' using errcode='22023';
  end if;
  if p_action = 'save' then
    allowed_keys := case when p_scope = 'shared' then array['title','category','assigned_to','notes'] else array['title','category','notes'] end;
    if nullif(btrim(p_payload->>'title'), '') is null then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
  elsif p_action = 'patch' then
    allowed_keys := case when p_scope = 'shared' then array['packed_by_assignee','confirmed_by_owner'] else array['packed'] end;
    if (select count(*) from jsonb_object_keys(p_payload)) <> 1 then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
    if exists(select 1 from jsonb_each(p_payload) as e where jsonb_typeof(e.value) <> 'boolean') then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
  else allowed_keys := array[]::text[];
  end if;
  if exists(select 1 from jsonb_object_keys(p_payload) as k where not (k = any(allowed_keys))) then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;

  if p_payload ? 'notes' and (jsonb_typeof(p_payload->'notes') not in ('string','null') or char_length(p_payload->>'notes') > 1000) then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;

  if p_item_id is null then
    if p_action <> 'save' or p_expected_updated_at is not null then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
    if p_scope = 'personal' then
      insert into public.luggage_items(trip_id,owner_id,title,category,notes)
      values(p_trip_id,actor,btrim(p_payload->>'title'),nullif(btrim(p_payload->>'category'),''),nullif(btrim(p_payload->>'notes'),'')) returning to_jsonb(luggage_items.*) into output_record;
    else
      insert into public.shared_luggage_items(trip_id,title,category,assigned_to,notes)
      values(p_trip_id,btrim(p_payload->>'title'),nullif(btrim(p_payload->>'category'),''),nullif(p_payload->>'assigned_to','')::uuid,nullif(btrim(p_payload->>'notes'),'')) returning to_jsonb(shared_luggage_items.*) into output_record;
    end if;
    return output_record;
  end if;

  if p_scope = 'personal' then
    select * into personal from public.luggage_items where id = p_item_id and trip_id = p_trip_id for update;
    if not found or personal.owner_id <> actor then raise exception 'luggage_not_found' using errcode = '42501'; end if;
    if personal.shared_item_id is not null then raise exception 'luggage_invalid_payload' using errcode = '22023'; end if;
    current_record := to_jsonb(personal);
  else
    select * into shared from public.shared_luggage_items where id = p_item_id and trip_id = p_trip_id for update;
    if not found then raise exception 'luggage_not_found' using errcode = '42501'; end if;
    current_record := to_jsonb(shared);
  end if;
  if p_expected_updated_at is null or (current_record->>'updated_at')::timestamptz <> p_expected_updated_at then
    raise exception 'luggage_stale' using errcode = '40001';
  end if;
  if nullif(current_record->>'locked_by','')::uuid <> actor
    and (current_record->>'locked_at')::timestamptz > clock_timestamp() - interval '7 minutes' then
    raise exception 'luggage_locked' using errcode = '55P03';
  end if;
  if p_action = 'delete' then
    if p_scope = 'personal' then delete from public.luggage_items where id = p_item_id;
    else delete from public.shared_luggage_items where id = p_item_id; end if;
    return current_record;
  end if;
  if p_scope = 'personal' then
    if p_action = 'save' then
      update public.luggage_items set title=btrim(p_payload->>'title'),category=nullif(btrim(p_payload->>'category'),''),notes=case when p_payload ? 'notes' then nullif(btrim(p_payload->>'notes'),'') else notes end,locked_by=null,locked_at=null
      where id=p_item_id returning to_jsonb(luggage_items.*) into output_record;
    else
      update public.luggage_items set packed=(p_payload->>'packed')::boolean where id=p_item_id returning to_jsonb(luggage_items.*) into output_record;
    end if;
  else
    if p_action = 'save' then
      update public.shared_luggage_items set title=btrim(p_payload->>'title'),category=nullif(btrim(p_payload->>'category'),''),assigned_to=nullif(p_payload->>'assigned_to','')::uuid,notes=case when p_payload ? 'notes' then nullif(btrim(p_payload->>'notes'),'') else notes end,locked_by=null,locked_at=null
      where id=p_item_id returning to_jsonb(shared_luggage_items.*) into output_record;
    elsif p_payload ? 'packed_by_assignee' then
      update public.shared_luggage_items set packed_by_assignee=(p_payload->>'packed_by_assignee')::boolean where id=p_item_id returning to_jsonb(shared_luggage_items.*) into output_record;
    else
      update public.shared_luggage_items set confirmed_by_owner=(p_payload->>'confirmed_by_owner')::boolean where id=p_item_id returning to_jsonb(shared_luggage_items.*) into output_record;
    end if;
  end if;
  return output_record;
end;
$$;
revoke all on function public.mutate_luggage_item(uuid,text,text,uuid,timestamptz,jsonb) from public, anon;
grant execute on function public.mutate_luggage_item(uuid,text,text,uuid,timestamptz,jsonb) to authenticated;

-- Atomic personal-to-shared conversion and version-safe shared assignment.
-- Existing tables, RLS, Realtime publication and mutation RPC remain unchanged.
create or replace function public.assign_luggage_item(
  p_trip_id uuid, p_scope text, p_item_id uuid,
  p_expected_updated_at timestamptz, p_assigned_to uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  personal public.luggage_items%rowtype;
  shared public.shared_luggage_items%rowtype;
  removed integer;
begin
  if actor is null or not app_private.can_read_trip(p_trip_id, actor) then
    raise exception 'luggage_forbidden' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('personal','shared') or p_item_id is null or p_expected_updated_at is null then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  if p_assigned_to is null or not app_private.can_read_trip(p_trip_id, p_assigned_to) then
    raise exception 'luggage_invalid_assignee' using errcode = '22023';
  end if;
  if p_scope = 'shared' then
    select * into shared from public.shared_luggage_items where id=p_item_id and trip_id=p_trip_id for update;
    if not found then raise exception 'luggage_not_found' using errcode = '42501'; end if;
    if shared.updated_at <> p_expected_updated_at then raise exception 'luggage_stale' using errcode = '40001'; end if;
    if shared.locked_by is not null and shared.locked_by <> actor and shared.locked_at > clock_timestamp() - interval '7 minutes' then
      raise exception 'luggage_locked' using errcode = '55P03';
    end if;
    if shared.assigned_to is not distinct from p_assigned_to then return to_jsonb(shared); end if;
    return public.mutate_luggage_item(p_trip_id,'shared','save',shared.id,shared.updated_at,
      jsonb_build_object('title',shared.title,'category',shared.category,'notes',shared.notes,'assigned_to',p_assigned_to));
  end if;
  select * into personal from public.luggage_items where id=p_item_id and trip_id=p_trip_id and owner_id=actor for update;
  if not found then raise exception 'luggage_not_found' using errcode = '42501'; end if;
  if personal.shared_item_id is not null or personal.is_shared_assigned_item then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  if personal.updated_at <> p_expected_updated_at then raise exception 'luggage_stale' using errcode = '40001'; end if;
  if personal.locked_by is not null and personal.locked_by <> actor and personal.locked_at > clock_timestamp() - interval '7 minutes' then
    raise exception 'luggage_locked' using errcode = '55P03';
  end if;
  -- The stable id prevents duplicate conversion rows. Any error rolls back
  -- the insert and delete together; neither operation bypasses the caller's RLS.
  insert into public.shared_luggage_items(id,trip_id,title,category,notes,assigned_to)
  values(personal.id,personal.trip_id,personal.title,personal.category,personal.notes,p_assigned_to)
  returning * into shared;
  delete from public.luggage_items where id=personal.id and trip_id=p_trip_id and owner_id=actor;
  get diagnostics removed = row_count;
  if removed <> 1 then raise exception 'luggage_forbidden' using errcode = '42501'; end if;
  return to_jsonb(shared);
end;
$$;
revoke all on function public.assign_luggage_item(uuid,text,uuid,timestamptz,uuid) from public, anon;
grant execute on function public.assign_luggage_item(uuid,text,uuid,timestamptz,uuid) to authenticated;
