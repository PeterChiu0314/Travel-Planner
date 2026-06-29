-- Timeline Phase 4.6 timed drag auto-continuation.
-- Atomically moves destination packages and recalculates each complete timed visit
-- from the new timed order while preserving every package's original duration.

create or replace function app_private.reorder_itinerary_timed_auto_continuation(
  target_trip_id uuid,
  target_day_index integer,
  slot_item_ids uuid[],
  package_source_item_ids uuid[],
  item_updated_at_baselines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  authoritative_slot_ids uuid[];
  visit_rows public.itinerary_items[];
  transport_rows public.itinerary_items[];
  alternative_rows public.itinerary_alternatives[];
  budget_links public.itinerary_budget_items[];
  visit_row public.itinerary_items%rowtype;
  package_row public.itinerary_items%rowtype;
  previous_package_row public.itinerary_items%rowtype;
  transport_row public.itinerary_items%rowtype;
  alternative_row public.itinerary_alternatives%rowtype;
  budget_link public.itinerary_budget_items%rowtype;
  baseline_value text;
  manifest_count integer;
  distinct_manifest_count integer;
  max_day_index integer;
  source_position integer;
  previous_source_position integer;
  from_position integer;
  to_position integer;
  source_start_minutes integer;
  source_end_minutes integer;
  previous_source_end_minutes integer;
  duration_minutes integer;
  gap_minutes integer;
  next_start_minutes integer;
  next_end_minutes integer;
  moved_alternative_count integer := 0;
  moved_budget_link_count integer := 0;
  preserved_transport_ids uuid[] := array[]::uuid[];
  preserved_transport_from_ids uuid[] := array[]::uuid[];
  preserved_transport_to_ids uuid[] := array[]::uuid[];
  deleted_transport_ids uuid[] := array[]::uuid[];
  final_from_id uuid;
  final_to_id uuid;
  item_index integer;
begin
  if auth.uid() is null then
    raise exception 'permission_denied';
  end if;

  if target_trip_id is null or target_day_index is null or target_day_index < 0 then
    raise exception 'invalid_day';
  end if;

  if slot_item_ids is null
    or package_source_item_ids is null
    or cardinality(slot_item_ids) = 0
    or cardinality(slot_item_ids) <> cardinality(package_source_item_ids)
    or array_position(slot_item_ids, null) is not null
    or array_position(package_source_item_ids, null) is not null
  then
    raise exception 'invalid_manifest';
  end if;

  select count(*), count(distinct item_id)
    into manifest_count, distinct_manifest_count
  from unnest(slot_item_ids) as manifest(item_id);

  if manifest_count <> distinct_manifest_count then
    raise exception 'duplicate_item';
  end if;

  select count(*), count(distinct item_id)
    into manifest_count, distinct_manifest_count
  from unnest(package_source_item_ids) as manifest(item_id);

  if manifest_count <> distinct_manifest_count then
    raise exception 'duplicate_item';
  end if;

  if exists (
    select 1
    from unnest(package_source_item_ids) as sources(source_id)
    where not source_id = any(slot_item_ids)
  ) then
    raise exception 'manifest_not_permutation';
  end if;

  if not app_private.can_edit_trip(target_trip_id, auth.uid()) then
    raise exception 'permission_denied';
  end if;

  select (trip.end_date - trip.start_date)
    into max_day_index
  from public.trips trip
  where trip.id = target_trip_id;

  if max_day_index is null or target_day_index > max_day_index then
    raise exception 'invalid_day';
  end if;

  perform pg_advisory_xact_lock(hashtext(target_trip_id::text), target_day_index);

  perform 1
  from public.itinerary_items item
  where item.trip_id = target_trip_id
    and item.day_index = target_day_index
  order by item.id
  for update;

  select
    coalesce(
      array_agg(item.id order by item.start_time, item.sort_order, item.id),
      array[]::uuid[]
    ),
    coalesce(
      array_agg(item order by item.start_time, item.sort_order, item.id),
      array[]::public.itinerary_items[]
    )
    into authoritative_slot_ids, visit_rows
  from public.itinerary_items item
  where item.trip_id = target_trip_id
    and item.day_index = target_day_index
    and item.item_type <> 'transport'
    and item.start_time is not null
    and item.end_time is not null;

  if authoritative_slot_ids is distinct from slot_item_ids then
    raise exception 'stale_manifest';
  end if;

  if exists (
    select 1
    from unnest(visit_rows) item
    where item.trip_id <> target_trip_id
      or item.day_index <> target_day_index
      or item.item_type = 'transport'
      or item.start_time is null
      or item.end_time is null
  ) then
    raise exception 'timed_visit_required';
  end if;

  if exists (
    select 1
    from unnest(visit_rows) item
    where item.is_fixed
  ) then
    raise exception 'fixed_item';
  end if;

  if exists (
    select 1
    from unnest(visit_rows) item
    where item.locked_by is not null
      and item.locked_by <> auth.uid()
      and item.locked_at is not null
      and item.locked_at > now() - interval '7 minutes'
  ) then
    raise exception 'item_locked';
  end if;

  select coalesce(
    array_agg(item order by item.id),
    array[]::public.itinerary_items[]
  )
    into transport_rows
  from public.itinerary_items item
  where item.trip_id = target_trip_id
    and item.day_index = target_day_index
    and item.item_type = 'transport';

  if item_updated_at_baselines is null
    or jsonb_typeof(item_updated_at_baselines) <> 'object'
    or (select count(*) from jsonb_object_keys(item_updated_at_baselines))
      <> cardinality(visit_rows) + cardinality(transport_rows)
  then
    raise exception 'stale_manifest';
  end if;

  foreach visit_row in array visit_rows
  loop
    baseline_value := item_updated_at_baselines ->> visit_row.id::text;
    if baseline_value is null then
      raise exception 'stale_item';
    end if;
    begin
      if visit_row.updated_at is distinct from baseline_value::timestamptz then
        raise exception 'stale_item';
      end if;
    exception
      when invalid_datetime_format then
        raise exception 'stale_item';
    end;
  end loop;

  foreach transport_row in array transport_rows
  loop
    baseline_value := item_updated_at_baselines ->> transport_row.id::text;
    if baseline_value is null then
      raise exception 'transport_state_changed';
    end if;
    begin
      if transport_row.updated_at is distinct from baseline_value::timestamptz then
        raise exception 'transport_state_changed';
      end if;
    exception
      when invalid_datetime_format then
        raise exception 'transport_state_changed';
    end;
  end loop;

  perform 1
  from public.itinerary_alternatives alternative
  where alternative.itinerary_item_id = any(slot_item_ids)
  order by alternative.id
  for update;

  select coalesce(
    array_agg(alternative order by alternative.id),
    array[]::public.itinerary_alternatives[]
  )
    into alternative_rows
  from public.itinerary_alternatives alternative
  where alternative.itinerary_item_id = any(slot_item_ids);

  perform 1
  from public.itinerary_budget_items link
  where link.itinerary_item_id = any(slot_item_ids)
  order by link.id
  for update;

  select coalesce(
    array_agg(link order by link.id),
    array[]::public.itinerary_budget_items[]
  )
    into budget_links
  from public.itinerary_budget_items link
  where link.itinerary_item_id = any(slot_item_ids);

  foreach transport_row in array transport_rows
  loop
    from_position := array_position(package_source_item_ids, transport_row.from_item_id);
    to_position := array_position(package_source_item_ids, transport_row.to_item_id);

    if transport_row.from_item_id is not null
      and transport_row.to_item_id is not null
      and from_position is not null
      and to_position = from_position + 1
    then
      preserved_transport_ids := array_append(preserved_transport_ids, transport_row.id);
      preserved_transport_from_ids := array_append(preserved_transport_from_ids, slot_item_ids[from_position]);
      preserved_transport_to_ids := array_append(preserved_transport_to_ids, slot_item_ids[to_position]);
    elsif transport_row.from_item_id is not null
      and transport_row.to_item_id is null
      and from_position = cardinality(package_source_item_ids)
    then
      preserved_transport_ids := array_append(preserved_transport_ids, transport_row.id);
      preserved_transport_from_ids := array_append(preserved_transport_from_ids, slot_item_ids[from_position]);
      preserved_transport_to_ids := array_append(preserved_transport_to_ids, null);
    else
      deleted_transport_ids := array_append(deleted_transport_ids, transport_row.id);
    end if;
  end loop;

  if exists (
    select 1
    from unnest(preserved_transport_from_ids, preserved_transport_to_ids) as mapped(from_id, to_id)
    group by mapped.from_id, mapped.to_id
    having count(*) > 1
  ) then
    raise exception 'transport_state_changed';
  end if;

  next_start_minutes := extract(hour from visit_rows[1].start_time)::integer * 60
    + extract(minute from visit_rows[1].start_time)::integer;
  previous_source_position := null;

  for item_index in 1..cardinality(slot_item_ids)
  loop
    source_position := array_position(authoritative_slot_ids, package_source_item_ids[item_index]);
    if source_position is null then
      raise exception 'manifest_not_permutation';
    end if;
    package_row := visit_rows[source_position];

    source_start_minutes := extract(hour from package_row.start_time)::integer * 60
      + extract(minute from package_row.start_time)::integer;
    source_end_minutes := extract(hour from package_row.end_time)::integer * 60
      + extract(minute from package_row.end_time)::integer;
    duration_minutes := source_end_minutes - source_start_minutes;

    if duration_minutes <= 0 then
      raise exception 'invalid_time';
    end if;

    if previous_source_position is not null and source_position = previous_source_position + 1 then
      previous_source_end_minutes := extract(hour from previous_package_row.end_time)::integer * 60
        + extract(minute from previous_package_row.end_time)::integer;
      gap_minutes := source_start_minutes - previous_source_end_minutes;
      if gap_minutes < 0 then
        raise exception 'invalid_gap';
      end if;
      next_start_minutes := next_start_minutes + gap_minutes;
    end if;

    next_end_minutes := next_start_minutes + duration_minutes;
    if next_start_minutes < 0 or next_end_minutes >= 24 * 60 then
      raise exception 'invalid_time';
    end if;

    update public.itinerary_items item
    set
      type = package_row.type,
      title = package_row.title,
      location = package_row.location,
      note = package_row.note,
      cost = package_row.cost,
      location_name = package_row.location_name,
      address = package_row.address,
      map_url = package_row.map_url,
      latitude = package_row.latitude,
      longitude = package_row.longitude,
      description = package_row.description,
      transportation_note = package_row.transportation_note,
      start_time = time '00:00' + make_interval(mins => next_start_minutes),
      end_time = time '00:00' + make_interval(mins => next_end_minutes),
      updated_at = now()
    where item.id = slot_item_ids[item_index]
      and item.trip_id = target_trip_id
      and item.day_index = target_day_index;

    next_start_minutes := next_end_minutes;
    previous_source_position := source_position;
    previous_package_row := package_row;
  end loop;

  foreach alternative_row in array alternative_rows
  loop
    source_position := array_position(package_source_item_ids, alternative_row.itinerary_item_id);
    if source_position is null then
      raise exception 'stale_manifest';
    end if;

    update public.itinerary_alternatives alternative
    set itinerary_item_id = slot_item_ids[source_position]
    where alternative.id = alternative_row.id;
    moved_alternative_count := moved_alternative_count + 1;
  end loop;

  moved_budget_link_count := cardinality(budget_links);

  if moved_budget_link_count > 0 then
    delete from public.itinerary_budget_items link
    where link.itinerary_item_id = any(slot_item_ids);

    foreach budget_link in array budget_links
    loop
      source_position := array_position(package_source_item_ids, budget_link.itinerary_item_id);
      if source_position is null then
        raise exception 'stale_manifest';
      end if;

      insert into public.itinerary_budget_items (
        id,
        itinerary_item_id,
        budget_item_id,
        created_at
      )
      values (
        budget_link.id,
        slot_item_ids[source_position],
        budget_link.budget_item_id,
        budget_link.created_at
      );
    end loop;
  end if;

  if cardinality(deleted_transport_ids) > 0 then
    delete from public.itinerary_items item
    where item.id = any(deleted_transport_ids)
      and item.trip_id = target_trip_id
      and item.day_index = target_day_index
      and item.item_type = 'transport';
  end if;

  if cardinality(preserved_transport_ids) > 0 then
    update public.itinerary_items item
    set from_item_id = null,
        to_item_id = null,
        updated_at = now()
    where item.id = any(preserved_transport_ids)
      and item.trip_id = target_trip_id
      and item.day_index = target_day_index
      and item.item_type = 'transport';

    for item_index in 1..cardinality(preserved_transport_ids)
    loop
      final_from_id := preserved_transport_from_ids[item_index];
      final_to_id := preserved_transport_to_ids[item_index];

      update public.itinerary_items item
      set from_item_id = final_from_id,
          to_item_id = final_to_id,
          updated_at = now()
      where item.id = preserved_transport_ids[item_index]
        and item.trip_id = target_trip_id
        and item.day_index = target_day_index
        and item.item_type = 'transport';
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'trip_id', target_trip_id,
    'day_index', target_day_index,
    'slot_item_ids', to_jsonb(slot_item_ids),
    'package_source_item_ids', to_jsonb(package_source_item_ids),
    'updated_visit_count', cardinality(slot_item_ids),
    'moved_alternative_count', moved_alternative_count,
    'moved_budget_link_count', moved_budget_link_count,
    'preserved_transport_ids', to_jsonb(preserved_transport_ids),
    'deleted_transport_ids', to_jsonb(deleted_transport_ids),
    'updated_transport_count', cardinality(preserved_transport_ids)
  );
end;
$$;

revoke execute on function app_private.reorder_itinerary_timed_auto_continuation(uuid, integer, uuid[], uuid[], jsonb) from public;
revoke execute on function app_private.reorder_itinerary_timed_auto_continuation(uuid, integer, uuid[], uuid[], jsonb) from anon;
revoke execute on function app_private.reorder_itinerary_timed_auto_continuation(uuid, integer, uuid[], uuid[], jsonb) from authenticated;

create or replace function public.reorder_itinerary_timed_auto_continuation(
  target_trip_id uuid,
  target_day_index integer,
  slot_item_ids uuid[],
  package_source_item_ids uuid[],
  item_updated_at_baselines jsonb
)
returns jsonb
language sql
security definer
set search_path = public, app_private
as $$
  select app_private.reorder_itinerary_timed_auto_continuation(
    target_trip_id,
    target_day_index,
    slot_item_ids,
    package_source_item_ids,
    item_updated_at_baselines
  );
$$;

revoke execute on function public.reorder_itinerary_timed_auto_continuation(uuid, integer, uuid[], uuid[], jsonb) from public;
revoke execute on function public.reorder_itinerary_timed_auto_continuation(uuid, integer, uuid[], uuid[], jsonb) from anon;
revoke execute on function public.reorder_itinerary_timed_auto_continuation(uuid, integer, uuid[], uuid[], jsonb) from authenticated;
grant execute on function public.reorder_itinerary_timed_auto_continuation(uuid, integer, uuid[], uuid[], jsonb) to authenticated;

comment on function public.reorder_itinerary_timed_auto_continuation(uuid, integer, uuid[], uuid[], jsonb) is
  'Atomically permutes timed-visit destination packages, recalculates duration-preserving times, and preserves only still-adjacent directed transportation cards.';
