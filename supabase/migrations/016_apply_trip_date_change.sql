create or replace function app_private.apply_trip_date_change(
  target_trip_id uuid,
  new_start_date date,
  new_end_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  current_trip public.trips%rowtype;
  new_day_count integer;
  old_day_count integer;
  updated_item_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'permission_denied';
  end if;

  if target_trip_id is null then
    raise exception 'trip_not_found';
  end if;

  if new_start_date is null or new_end_date is null or new_end_date < new_start_date then
    raise exception 'invalid_date_range';
  end if;

  select *
    into current_trip
  from public.trips
  where id = target_trip_id
  for update;

  if not found then
    raise exception 'trip_not_found';
  end if;

  if not app_private.can_manage_trip(target_trip_id, auth.uid()) then
    raise exception 'permission_denied';
  end if;

  old_day_count := (current_trip.end_date - current_trip.start_date) + 1;
  new_day_count := (new_end_date - new_start_date) + 1;

  if new_day_count < old_day_count and exists (
    select 1
    from public.itinerary_items item
    where item.trip_id = target_trip_id
      and item.day_index >= new_day_count
  ) then
    raise exception 'unsafe_shortening';
  end if;

  update public.trips
  set
    start_date = new_start_date,
    end_date = new_end_date
  where id = target_trip_id;

  update public.itinerary_items item
  set date = new_start_date + item.day_index
  where item.trip_id = target_trip_id
    and item.date is distinct from new_start_date + item.day_index;

  get diagnostics updated_item_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'trip_id', target_trip_id,
    'old_start_date', current_trip.start_date,
    'old_end_date', current_trip.end_date,
    'new_start_date', new_start_date,
    'new_end_date', new_end_date,
    'updated_item_count', updated_item_count,
    'new_day_count', new_day_count
  );
end;
$$;

revoke execute on function app_private.apply_trip_date_change(uuid, date, date) from public;
revoke execute on function app_private.apply_trip_date_change(uuid, date, date) from anon;
revoke execute on function app_private.apply_trip_date_change(uuid, date, date) from authenticated;

create or replace function public.apply_trip_date_change(
  trip_id uuid,
  new_start_date date,
  new_end_date date
)
returns jsonb
language sql
security definer
set search_path = public, app_private
as $$
  select app_private.apply_trip_date_change(trip_id, new_start_date, new_end_date);
$$;

revoke execute on function public.apply_trip_date_change(uuid, date, date) from public;
revoke execute on function public.apply_trip_date_change(uuid, date, date) from anon;
revoke execute on function public.apply_trip_date_change(uuid, date, date) from authenticated;
grant execute on function public.apply_trip_date_change(uuid, date, date) to authenticated;
