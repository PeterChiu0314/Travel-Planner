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
  if p_assigned_to is not null and not app_private.can_read_trip(p_trip_id, p_assigned_to) then
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
