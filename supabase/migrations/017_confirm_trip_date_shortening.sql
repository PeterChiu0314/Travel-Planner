drop function if exists public.apply_trip_date_change(uuid, date, date);
drop function if exists app_private.apply_trip_date_change(uuid, date, date);

create or replace function app_private.apply_trip_date_change(
  target_trip_id uuid,
  new_start_date date,
  new_end_date date,
  confirm_timeline_removal boolean default false
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
  removed_alternative_count integer := 0;
  removed_budget_link_count integer := 0;
  removed_fixed_count integer := 0;
  removed_item_ids uuid[] := array[]::uuid[];
  removed_item_count integer := 0;
  removed_transport_count integer := 0;
  removed_visit_count integer := 0;
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

  with out_of_range_items as (
    select item.id
    from public.itinerary_items item
    where item.trip_id = target_trip_id
      and item.day_index >= new_day_count
  ),
  related_transport_items as (
    select item.id
    from public.itinerary_items item
    where item.trip_id = target_trip_id
      and (item.item_type = 'transport' or item.type = 'transport')
      and (
        item.from_item_id in (select out_of_range.id from out_of_range_items out_of_range)
        or item.to_item_id in (select out_of_range.id from out_of_range_items out_of_range)
      )
  ),
  removed_items as (
    select out_of_range.id from out_of_range_items out_of_range
    union
    select related_transport.id from related_transport_items related_transport
  )
  select coalesce(array_agg(removed.id), array[]::uuid[])
    into removed_item_ids
  from removed_items removed;

  removed_item_count := coalesce(array_length(removed_item_ids, 1), 0);

  if removed_item_count > 0 and not confirm_timeline_removal then
    raise exception 'unsafe_shortening';
  end if;

  if removed_item_count > 0 and exists (
    select 1
    from public.itinerary_items item
    where item.id = any(removed_item_ids)
      and item.locked_by is not null
      and item.locked_by <> auth.uid()
      and item.locked_at is not null
      and item.locked_at > now() - interval '7 minutes'
  ) then
    raise exception 'affected_item_locked';
  end if;

  if removed_item_count > 0 then
    select
      (count(*) filter (where item.item_type = 'transport' or item.type = 'transport'))::integer,
      (count(*) filter (where not (item.item_type = 'transport' or item.type = 'transport')))::integer,
      (count(*) filter (where item.is_fixed))::integer
    into removed_transport_count, removed_visit_count, removed_fixed_count
    from public.itinerary_items item
    where item.id = any(removed_item_ids);

    select count(*)::integer
      into removed_alternative_count
    from public.itinerary_alternatives alternative
    where alternative.itinerary_item_id = any(removed_item_ids);

    select count(*)::integer
      into removed_budget_link_count
    from public.itinerary_budget_items link
    where link.itinerary_item_id = any(removed_item_ids);

    delete from public.itinerary_items item
    where item.id = any(removed_item_ids);
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
    'removed_day_count', greatest(old_day_count - new_day_count, 0),
    'removed_item_count', removed_item_count,
    'removed_visit_count', removed_visit_count,
    'removed_transport_count', removed_transport_count,
    'removed_alternative_count', removed_alternative_count,
    'removed_fixed_count', removed_fixed_count,
    'removed_budget_link_count', removed_budget_link_count,
    'updated_item_count', updated_item_count,
    'new_day_count', new_day_count
  );
end;
$$;

revoke execute on function app_private.apply_trip_date_change(uuid, date, date, boolean) from public;
revoke execute on function app_private.apply_trip_date_change(uuid, date, date, boolean) from anon;
revoke execute on function app_private.apply_trip_date_change(uuid, date, date, boolean) from authenticated;

create or replace function public.apply_trip_date_change(
  trip_id uuid,
  new_start_date date,
  new_end_date date,
  confirm_timeline_removal boolean default false
)
returns jsonb
language sql
security definer
set search_path = public, app_private
as $$
  select app_private.apply_trip_date_change(trip_id, new_start_date, new_end_date, confirm_timeline_removal);
$$;

revoke execute on function public.apply_trip_date_change(uuid, date, date, boolean) from public;
revoke execute on function public.apply_trip_date_change(uuid, date, date, boolean) from anon;
revoke execute on function public.apply_trip_date_change(uuid, date, date, boolean) from authenticated;
grant execute on function public.apply_trip_date_change(uuid, date, date, boolean) to authenticated;
