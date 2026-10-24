-- Shared gear becomes the caller's private item in one RLS-protected transaction.
create or replace function public.privatize_luggage_item(
  p_trip_id uuid, p_item_id uuid, p_expected_updated_at timestamptz,
  p_category text default ''
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  source public.shared_luggage_items%rowtype;
  target public.luggage_items%rowtype;
  removed integer;
begin
  if actor is null or not app_private.can_read_trip(p_trip_id, actor) then
    raise exception 'luggage_forbidden' using errcode = '42501';
  end if;
  if p_item_id is null or p_expected_updated_at is null then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  select * into source from public.shared_luggage_items where id=p_item_id and trip_id=p_trip_id for update;
  if not found then raise exception 'luggage_not_found' using errcode = '42501'; end if;
  if source.updated_at <> p_expected_updated_at then raise exception 'luggage_stale' using errcode = '40001'; end if;
  if source.locked_by is not null and source.locked_by <> actor and source.locked_at > clock_timestamp() - interval '7 minutes' then
    raise exception 'luggage_locked' using errcode = '55P03';
  end if;
  insert into public.luggage_items(id,trip_id,owner_id,title,category,notes,packed,is_shared_assigned_item,shared_item_id)
  values(source.id,source.trip_id,actor,source.title,coalesce(btrim(p_category),''),source.notes,false,false,null)
  returning * into target;
  delete from public.shared_luggage_items where id=source.id and trip_id=p_trip_id;
  get diagnostics removed = row_count;
  if removed <> 1 then raise exception 'luggage_forbidden' using errcode = '42501'; end if;
  return to_jsonb(target);
end;
$$;
revoke all on function public.privatize_luggage_item(uuid,uuid,timestamptz,text) from public, anon;
grant execute on function public.privatize_luggage_item(uuid,uuid,timestamptz,text) to authenticated;
