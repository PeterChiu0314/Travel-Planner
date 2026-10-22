-- Additive luggage collaboration safety. No historical rows are removed or rewritten.
-- shared_luggage_items remains the only source of shared packing/confirmation state.
-- pack_items is an independent legacy/Today checklist and is intentionally unchanged.

drop policy if exists "Editors can create shared luggage" on public.shared_luggage_items;
drop policy if exists "Editors and assignees can update shared luggage" on public.shared_luggage_items;
drop policy if exists "Editors can delete shared luggage" on public.shared_luggage_items;
create policy "Approved members can create shared luggage"
on public.shared_luggage_items for insert to authenticated
with check (app_private.can_read_trip(trip_id, (select auth.uid())));
create policy "Approved members can update shared luggage"
on public.shared_luggage_items for update to authenticated
using (app_private.can_read_trip(trip_id, (select auth.uid())))
with check (app_private.can_read_trip(trip_id, (select auth.uid())));
create policy "Approved members can delete shared luggage"
on public.shared_luggage_items for delete to authenticated
using (app_private.can_read_trip(trip_id, (select auth.uid())));

-- Trigger uses invoker rights and existing private membership lookups; it does not bypass RLS.
create or replace function app_private.enforce_shared_luggage_update_permissions()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  content_changed boolean;
begin
  if actor is null or not app_private.can_read_trip(old.trip_id, actor) then
    raise exception 'luggage_forbidden' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.trip_id is distinct from old.trip_id
    or new.created_at is distinct from old.created_at then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  if new.title is distinct from old.title and nullif(btrim(new.title), '') is null then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  if old.locked_by is not null and old.locked_by <> actor
    and old.locked_at > clock_timestamp() - interval '7 minutes' then
    raise exception 'luggage_locked' using errcode = '55P03';
  end if;
  if new.locked_by is not null and new.locked_by <> actor
    and (new.locked_by is distinct from old.locked_by or new.locked_at is distinct from old.locked_at) then
    raise exception 'luggage_forbidden' using errcode = '42501';
  end if;
  if new.assigned_to is not null and new.assigned_to is distinct from old.assigned_to
    and not app_private.can_read_trip(old.trip_id, new.assigned_to) then
    raise exception 'luggage_invalid_assignee' using errcode = '22023';
  end if;
  content_changed := new.title is distinct from old.title or new.category is distinct from old.category
    or new.assigned_to is distinct from old.assigned_to;
  if content_changed then
    new.packed_by_assignee := false;
    new.confirmed_by_owner := false;
  else
    if new.packed_by_assignee is distinct from old.packed_by_assignee then
      if old.assigned_to is null or old.assigned_to <> actor then
        raise exception 'luggage_forbidden' using errcode = '42501';
      end if;
      if new.packed_by_assignee and not app_private.can_read_trip(old.trip_id, old.assigned_to) then
        raise exception 'luggage_invalid_assignee' using errcode = '22023';
      end if;
      new.confirmed_by_owner := false;
    end if;
    -- Compare the requested value, before an implicit reset can hide an unauthorized confirmation.
    if new.confirmed_by_owner is distinct from old.confirmed_by_owner
      and new.confirmed_by_owner then
      if not app_private.is_trip_owner(old.trip_id, actor) then
        raise exception 'luggage_forbidden' using errcode = '42501';
      end if;
      if not new.packed_by_assignee or new.assigned_to is null then
        raise exception 'luggage_not_packed' using errcode = '22023';
      end if;
      if not app_private.can_read_trip(old.trip_id, new.assigned_to) then
        raise exception 'luggage_invalid_assignee' using errcode = '22023';
      end if;
    elsif new.confirmed_by_owner is distinct from old.confirmed_by_owner
      and new.packed_by_assignee is not distinct from old.packed_by_assignee
      and not app_private.is_trip_owner(old.trip_id, actor) then
      raise exception 'luggage_forbidden' using errcode = '42501';
    end if;
    if new.assigned_to is null then new.packed_by_assignee := false; end if;
    if not new.packed_by_assignee then new.confirmed_by_owner := false; end if;
  end if;
  -- Strictly monotonic version even within one transaction / fixed client clocks.
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
revoke all on function app_private.enforce_shared_luggage_update_permissions() from public, anon;
grant execute on function app_private.enforce_shared_luggage_update_permissions() to authenticated;

create or replace function app_private.validate_luggage_insert()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not app_private.can_read_trip(new.trip_id, auth.uid()) then
    raise exception 'luggage_forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(new.title), '') is null then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  if tg_table_name = 'shared_luggage_items' then
    if new.assigned_to is not null and not app_private.can_read_trip(new.trip_id, new.assigned_to) then
      raise exception 'luggage_invalid_assignee' using errcode = '22023';
    end if;
    new.packed_by_assignee := false;
    new.confirmed_by_owner := false;
  else
    if new.owner_id <> auth.uid() or new.shared_item_id is not null or new.is_shared_assigned_item then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
  end if;
  if new.locked_by is not null and new.locked_by <> auth.uid() then
    raise exception 'luggage_forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app_private.validate_luggage_insert() from public, anon;
grant execute on function app_private.validate_luggage_insert() to authenticated;
create trigger luggage_insert_guard before insert on public.luggage_items
for each row execute function app_private.validate_luggage_insert();
create trigger shared_luggage_insert_guard before insert on public.shared_luggage_items
for each row execute function app_private.validate_luggage_insert();

create or replace function app_private.guard_personal_luggage_update()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.title is distinct from old.title and nullif(btrim(new.title), '') is null then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  if new.id is distinct from old.id or new.trip_id is distinct from old.trip_id
    or new.owner_id is distinct from old.owner_id or new.created_at is distinct from old.created_at
    or new.is_shared_assigned_item is distinct from old.is_shared_assigned_item
    or new.shared_item_id is distinct from old.shared_item_id then
    -- The FK is allowed to detach an old mirror when its shared source is deleted.
    if not (old.shared_item_id is not null and new.shared_item_id is null
      and (to_jsonb(new) - 'shared_item_id' - 'updated_at') = (to_jsonb(old) - 'shared_item_id' - 'updated_at')) then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
  end if;
  if old.shared_item_id is not null and new.shared_item_id is not null
    and (new.title is distinct from old.title or new.category is distinct from old.category
      or new.packed is distinct from old.packed) then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  if old.locked_by is not null and old.locked_by <> auth.uid()
    and old.locked_at > clock_timestamp() - interval '7 minutes' then
    raise exception 'luggage_locked' using errcode = '55P03';
  end if;
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
revoke all on function app_private.guard_personal_luggage_update() from public, anon;
grant execute on function app_private.guard_personal_luggage_update() to authenticated;
-- z-prefix ensures this final version is later than the existing touch_updated_at trigger.
create trigger z_luggage_personal_state_guard before update on public.luggage_items
for each row execute function app_private.guard_personal_luggage_update();
drop trigger if exists enforce_shared_luggage_update_permissions on public.shared_luggage_items;
create trigger z_luggage_shared_state_guard before update on public.shared_luggage_items
for each row execute function app_private.enforce_shared_luggage_update_permissions();

-- Row lock and exact expected version make all new frontend operations stale-safe.
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
  if p_action = 'save' then
    allowed_keys := case when p_scope = 'shared' then array['title','category','assigned_to'] else array['title','category'] end;
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

  if p_item_id is null then
    if p_action <> 'save' or p_expected_updated_at is not null then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
    if p_scope = 'personal' then
      insert into public.luggage_items(trip_id,owner_id,title,category)
      values(p_trip_id,actor,btrim(p_payload->>'title'),nullif(btrim(p_payload->>'category'),'')) returning to_jsonb(luggage_items.*) into output_record;
    else
      insert into public.shared_luggage_items(trip_id,title,category,assigned_to)
      values(p_trip_id,btrim(p_payload->>'title'),nullif(btrim(p_payload->>'category'),''),nullif(p_payload->>'assigned_to','')::uuid) returning to_jsonb(shared_luggage_items.*) into output_record;
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
      update public.luggage_items set title=btrim(p_payload->>'title'),category=nullif(btrim(p_payload->>'category'),''),locked_by=null,locked_at=null
      where id=p_item_id returning to_jsonb(luggage_items.*) into output_record;
    else
      update public.luggage_items set packed=(p_payload->>'packed')::boolean where id=p_item_id returning to_jsonb(luggage_items.*) into output_record;
    end if;
  else
    if p_action = 'save' then
      update public.shared_luggage_items set title=btrim(p_payload->>'title'),category=nullif(btrim(p_payload->>'category'),''),assigned_to=nullif(p_payload->>'assigned_to','')::uuid,locked_by=null,locked_at=null
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
