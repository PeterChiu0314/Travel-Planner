-- Timeline Phase 4.7 fixed-anchor drag continuation segments.
-- Adds a new transactional RPC so applied migration 023 remains immutable.

create or replace function app_private.reorder_itinerary_fixed_anchor_continuation(
  target_trip_id uuid,
  target_day_index integer,
  slot_item_ids uuid[],
  package_source_item_ids uuid[],
  ordered_timed_item_ids uuid[],
  ordered_visit_item_ids uuid[],
  untimed_sort_order_updates jsonb,
  item_updated_at_baselines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  authoritative_timed_ids uuid[];
  authoritative_slot_ids uuid[];
  visit_rows public.itinerary_items[];
  transport_rows public.itinerary_items[];
  visit_row public.itinerary_items%rowtype;
  package_row public.itinerary_items%rowtype;
  slot_row public.itinerary_items%rowtype;
  previous_package_row public.itinerary_items%rowtype;
  fixed_row public.itinerary_items%rowtype;
  alternative_row public.itinerary_alternatives%rowtype;
  budget_link public.itinerary_budget_items%rowtype;
  baseline_value text;
  manifest_count integer;
  distinct_manifest_count integer;
  max_day_index integer;
  item_index integer;
  source_position integer;
  previous_source_position integer;
  source_start_minutes integer;
  source_end_minutes integer;
  previous_source_end_minutes integer;
  duration_minutes integer;
  gap_minutes integer;
  next_start_minutes integer;
  next_end_minutes integer;
  right_fixed_start_minutes integer;
  segment_source_ids uuid[] := array[]::uuid[];
  left_fixed_id uuid := null;
  fixed_ids uuid[] := array[]::uuid[];
  converted_slot_ids uuid[] := array[]::uuid[];
  converted_source_ids uuid[] := array[]::uuid[];
  moved_alternative_count integer := 0;
  moved_budget_link_count integer := 0;
  preserved_transport_ids uuid[] := array[]::uuid[];
  preserved_transport_from_ids uuid[] := array[]::uuid[];
  preserved_transport_to_ids uuid[] := array[]::uuid[];
  deleted_transport_ids uuid[] := array[]::uuid[];
  final_from_id uuid;
  final_to_id uuid;
  final_visit_from_position integer;
  final_visit_to_position integer;
  final_timed_from_position integer;
  mapped_source_id uuid;
  mapped_slot_id uuid;
  overflow_index integer;
  rank_step integer;
  rank_value integer;
  timed_before integer := 0;
  untimed_counts jsonb := '{}'::jsonb;
  untimed_seen jsonb := '{}'::jsonb;
  untimed_update jsonb;
  untimed_update_count integer := 0;
  current_timed_item_id uuid;
begin
  if auth.uid() is null then
    raise exception 'permission_denied';
  end if;

  if target_trip_id is null or target_day_index is null or target_day_index < 0 then
    raise exception 'invalid_day';
  end if;

  if slot_item_ids is null
    or package_source_item_ids is null
    or ordered_timed_item_ids is null
    or ordered_visit_item_ids is null
    or cardinality(slot_item_ids) <> cardinality(package_source_item_ids)
    or array_position(slot_item_ids, null) is not null
    or array_position(package_source_item_ids, null) is not null
    or array_position(ordered_timed_item_ids, null) is not null
    or array_position(ordered_visit_item_ids, null) is not null
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
    coalesce(array_agg(item.id order by item.start_time, item.sort_order, item.id), array[]::uuid[]),
    coalesce(array_agg(item.id order by item.start_time, item.sort_order, item.id) filter (where not coalesce(item.is_fixed, false)), array[]::uuid[]),
    coalesce(array_agg(item order by item.start_time, item.sort_order, item.id), array[]::public.itinerary_items[])
    into authoritative_timed_ids, authoritative_slot_ids, visit_rows
  from public.itinerary_items item
  where item.trip_id = target_trip_id
    and item.day_index = target_day_index
    and item.item_type <> 'transport'
    and item.start_time is not null
    and item.end_time is not null;

  if authoritative_slot_ids is distinct from slot_item_ids then
    raise exception 'stale_manifest';
  end if;

  if (
    select coalesce(array_agg(item_id order by item_id), array[]::uuid[])
    from unnest(authoritative_timed_ids) as ids(item_id)
  ) is distinct from (
    select coalesce(array_agg(item_id order by item_id), array[]::uuid[])
    from unnest(ordered_timed_item_ids) as ids(item_id)
  ) then
    raise exception 'invalid_manifest';
  end if;

  fixed_ids := (
    select coalesce(array_agg(item.id order by item.start_time, item.sort_order, item.id), array[]::uuid[])
    from unnest(visit_rows) item
    where coalesce(item.is_fixed, false)
  );

  if (
    select coalesce(array_agg(item_id order by ord), array[]::uuid[])
    from unnest(ordered_timed_item_ids) with ordinality as ordered(item_id, ord)
    where not item_id = any(fixed_ids)
  ) is distinct from package_source_item_ids then
    raise exception 'invalid_manifest';
  end if;

  if exists (
    select 1
    from unnest(visit_rows) item
    where item.locked_by is not null
      and item.locked_by <> auth.uid()
      and item.locked_at is not null
      and item.locked_at > now() - interval '7 minutes'
      and not coalesce(item.is_fixed, false)
  ) then
    raise exception 'item_locked';
  end if;

  select coalesce(array_agg(item order by item.id), array[]::public.itinerary_items[])
    into transport_rows
  from public.itinerary_items item
  where item.trip_id = target_trip_id
    and item.day_index = target_day_index
    and item.item_type = 'transport';

  if untimed_sort_order_updates is null then
    untimed_sort_order_updates := '[]'::jsonb;
  end if;

  if jsonb_typeof(untimed_sort_order_updates) <> 'array' then
    raise exception 'invalid_manifest';
  end if;

  select count(*)
    into untimed_update_count
  from jsonb_array_elements(untimed_sort_order_updates);

  if item_updated_at_baselines is null
    or jsonb_typeof(item_updated_at_baselines) <> 'object'
    or (select count(*) from jsonb_object_keys(item_updated_at_baselines))
      <> cardinality(visit_rows) + cardinality(transport_rows) + untimed_update_count
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

  foreach visit_row in array transport_rows
  loop
    baseline_value := item_updated_at_baselines ->> visit_row.id::text;
    if baseline_value is null then
      raise exception 'transport_state_changed';
    end if;
    begin
      if visit_row.updated_at is distinct from baseline_value::timestamptz then
        raise exception 'transport_state_changed';
      end if;
    exception
      when invalid_datetime_format then
        raise exception 'transport_state_changed';
    end;
  end loop;

  for untimed_update in
    select value
    from jsonb_array_elements(untimed_sort_order_updates)
  loop
    if (untimed_update ->> 'id') is null
      or (untimed_update ->> 'updated_at') is null
      or (untimed_update ->> 'sort_order') is null
    then
      raise exception 'stale_manifest';
    end if;

    baseline_value := item_updated_at_baselines ->> (untimed_update ->> 'id');
    if baseline_value is null or baseline_value <> (untimed_update ->> 'updated_at') then
      raise exception 'stale_item';
    end if;

    update public.itinerary_items item
    set sort_order = (untimed_update ->> 'sort_order')::integer,
        updated_at = now()
    where item.id = (untimed_update ->> 'id')::uuid
      and item.trip_id = target_trip_id
      and item.day_index = target_day_index
      and item.item_type <> 'transport'
      and (item.start_time is null or item.end_time is null)
      and not coalesce(item.is_fixed, false)
      and item.updated_at is not distinct from (untimed_update ->> 'updated_at')::timestamptz;

    if not found then
      raise exception 'stale_item';
    end if;
  end loop;

  perform 1
  from public.itinerary_alternatives alternative
  where alternative.itinerary_item_id = any(slot_item_ids)
  order by alternative.id
  for update;

  perform 1
  from public.itinerary_budget_items link
  where link.itinerary_item_id = any(slot_item_ids)
  order by link.id
  for update;

  for item_index in 1..cardinality(ordered_timed_item_ids)
  loop
    current_timed_item_id := ordered_timed_item_ids[item_index];
    select item.*
      into fixed_row
    from unnest(visit_rows) item
    where item.id = current_timed_item_id
      and coalesce(item.is_fixed, false);

    if found then
      if cardinality(segment_source_ids) > 0 then
        right_fixed_start_minutes := extract(hour from fixed_row.start_time)::integer * 60
          + extract(minute from fixed_row.start_time)::integer;

        if left_fixed_id is not null then
          select item.*
            into visit_row
          from unnest(visit_rows) item
          where item.id = left_fixed_id;
          next_start_minutes := extract(hour from visit_row.end_time)::integer * 60
            + extract(minute from visit_row.end_time)::integer;
          if right_fixed_start_minutes <= next_start_minutes then
            raise exception 'fixed_segment_no_space';
          end if;
        else
          select item.*
            into slot_row
          from unnest(visit_rows) item
          where item.id = slot_item_ids[array_position(package_source_item_ids, segment_source_ids[1])];
          next_start_minutes := extract(hour from slot_row.start_time)::integer * 60
            + extract(minute from slot_row.start_time)::integer;
        end if;

        previous_source_position := null;
        for source_position in 1..cardinality(segment_source_ids)
        loop
          select item.*
            into package_row
          from unnest(visit_rows) item
          where item.id = segment_source_ids[source_position];
          mapped_slot_id := slot_item_ids[array_position(package_source_item_ids, package_row.id)];

          source_start_minutes := extract(hour from package_row.start_time)::integer * 60
            + extract(minute from package_row.start_time)::integer;
          source_end_minutes := extract(hour from package_row.end_time)::integer * 60
            + extract(minute from package_row.end_time)::integer;
          duration_minutes := source_end_minutes - source_start_minutes;
          if duration_minutes <= 0 then
            raise exception 'invalid_time';
          end if;

          if previous_source_position is not null
            and array_position(authoritative_timed_ids, package_row.id) = previous_source_position + 1
          then
            previous_source_end_minutes := extract(hour from previous_package_row.end_time)::integer * 60
              + extract(minute from previous_package_row.end_time)::integer;
            gap_minutes := source_start_minutes - previous_source_end_minutes;
            if gap_minutes < 0 then
              raise exception 'invalid_gap';
            end if;
            next_start_minutes := next_start_minutes + gap_minutes;
          end if;

          next_end_minutes := next_start_minutes + duration_minutes;
          if next_end_minutes > right_fixed_start_minutes then
            for overflow_index in source_position..cardinality(segment_source_ids)
            loop
              mapped_source_id := segment_source_ids[overflow_index];
              converted_source_ids := array_append(converted_source_ids, mapped_source_id);
              converted_slot_ids := array_append(
                converted_slot_ids,
                slot_item_ids[array_position(package_source_item_ids, mapped_source_id)]
              );
            end loop;
            exit;
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
          where item.id = mapped_slot_id
            and item.trip_id = target_trip_id
            and item.day_index = target_day_index
            and not coalesce(item.is_fixed, false);

          next_start_minutes := next_end_minutes;
          previous_source_position := array_position(authoritative_timed_ids, package_row.id);
          previous_package_row := package_row;
        end loop;
      end if;

      left_fixed_id := fixed_row.id;
      segment_source_ids := array[]::uuid[];
    else
      segment_source_ids := array_append(segment_source_ids, current_timed_item_id);
    end if;
  end loop;

  if cardinality(segment_source_ids) > 0 then
    if left_fixed_id is not null then
      select item.*
        into visit_row
      from unnest(visit_rows) item
      where item.id = left_fixed_id;
      next_start_minutes := extract(hour from visit_row.end_time)::integer * 60
        + extract(minute from visit_row.end_time)::integer;
    else
      select item.*
        into slot_row
      from unnest(visit_rows) item
      where item.id = slot_item_ids[array_position(package_source_item_ids, segment_source_ids[1])];
      next_start_minutes := extract(hour from slot_row.start_time)::integer * 60
        + extract(minute from slot_row.start_time)::integer;
    end if;

    previous_source_position := null;
    for source_position in 1..cardinality(segment_source_ids)
    loop
      select item.*
        into package_row
      from unnest(visit_rows) item
      where item.id = segment_source_ids[source_position];
      mapped_slot_id := slot_item_ids[array_position(package_source_item_ids, package_row.id)];
      source_start_minutes := extract(hour from package_row.start_time)::integer * 60
        + extract(minute from package_row.start_time)::integer;
      source_end_minutes := extract(hour from package_row.end_time)::integer * 60
        + extract(minute from package_row.end_time)::integer;
      duration_minutes := source_end_minutes - source_start_minutes;
      if duration_minutes <= 0 then
        raise exception 'invalid_time';
      end if;
      if previous_source_position is not null
        and array_position(authoritative_timed_ids, package_row.id) = previous_source_position + 1
      then
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
      where item.id = mapped_slot_id
        and item.trip_id = target_trip_id
        and item.day_index = target_day_index
        and not coalesce(item.is_fixed, false);
      next_start_minutes := next_end_minutes;
      previous_source_position := array_position(authoritative_timed_ids, package_row.id);
      previous_package_row := package_row;
    end loop;
  end if;

  if cardinality(converted_slot_ids) > 0 then
    timed_before := 0;
    for item_index in 1..cardinality(ordered_visit_item_ids)
    loop
      mapped_source_id := ordered_visit_item_ids[item_index];
      mapped_slot_id := coalesce(slot_item_ids[array_position(package_source_item_ids, mapped_source_id)], mapped_source_id);
      if mapped_slot_id = any(converted_slot_ids) then
        untimed_counts := jsonb_set(
          untimed_counts,
          array[timed_before::text],
          to_jsonb(coalesce((untimed_counts ->> timed_before::text)::integer, 0) + 1),
          true
        );
      elsif mapped_slot_id = any(authoritative_timed_ids) then
        timed_before := timed_before + 1;
      end if;
    end loop;

    timed_before := 0;
    for item_index in 1..cardinality(ordered_visit_item_ids)
    loop
      mapped_source_id := ordered_visit_item_ids[item_index];
      mapped_slot_id := coalesce(slot_item_ids[array_position(package_source_item_ids, mapped_source_id)], mapped_source_id);
      if mapped_slot_id = any(converted_slot_ids) then
        untimed_seen := jsonb_set(
          untimed_seen,
          array[timed_before::text],
          to_jsonb(coalesce((untimed_seen ->> timed_before::text)::integer, 0) + 1),
          true
        );
        rank_step := floor(1000000.0 / (coalesce((untimed_counts ->> timed_before::text)::integer, 0) + 1))::integer;
        rank_value := rank_step * coalesce((untimed_seen ->> timed_before::text)::integer, 1);
        source_position := array_position(converted_slot_ids, mapped_slot_id);
        select item.*
          into package_row
        from unnest(visit_rows) item
        where item.id = converted_source_ids[source_position];
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
          start_time = null,
          end_time = null,
          sort_order = -2000000000 + timed_before * 1000000 + rank_value,
          updated_at = now()
        where item.id = mapped_slot_id
          and item.trip_id = target_trip_id
          and item.day_index = target_day_index
          and not coalesce(item.is_fixed, false);
      elsif mapped_slot_id = any(authoritative_timed_ids) then
        timed_before := timed_before + 1;
      end if;
    end loop;
  end if;

  for alternative_row in
    select *
    from public.itinerary_alternatives alternative
    where alternative.itinerary_item_id = any(slot_item_ids)
    order by alternative.id
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

  moved_budget_link_count := (
    select count(*)
    from public.itinerary_budget_items link
    where link.itinerary_item_id = any(slot_item_ids)
  );

  if moved_budget_link_count > 0 then
    for budget_link in
      select *
      from public.itinerary_budget_items link
      where link.itinerary_item_id = any(slot_item_ids)
      order by link.id
    loop
      source_position := array_position(package_source_item_ids, budget_link.itinerary_item_id);
      if source_position is null then
        raise exception 'stale_manifest';
      end if;
      update public.itinerary_budget_items link
      set itinerary_item_id = slot_item_ids[source_position]
      where link.id = budget_link.id;
    end loop;
  end if;

  foreach visit_row in array transport_rows
  loop
    final_visit_from_position := array_position(ordered_visit_item_ids, visit_row.from_item_id);
    final_visit_to_position := array_position(ordered_visit_item_ids, visit_row.to_item_id);
    final_timed_from_position := array_position(ordered_timed_item_ids, visit_row.from_item_id);

    if visit_row.from_item_id is not null
      and visit_row.to_item_id is not null
      and final_visit_from_position is not null
      and final_visit_to_position = final_visit_from_position + 1
      and not visit_row.from_item_id = any(converted_source_ids)
      and not visit_row.to_item_id = any(converted_source_ids)
    then
      preserved_transport_ids := array_append(preserved_transport_ids, visit_row.id);
      preserved_transport_from_ids := array_append(
        preserved_transport_from_ids,
        coalesce(slot_item_ids[array_position(package_source_item_ids, visit_row.from_item_id)], visit_row.from_item_id)
      );
      preserved_transport_to_ids := array_append(
        preserved_transport_to_ids,
        coalesce(slot_item_ids[array_position(package_source_item_ids, visit_row.to_item_id)], visit_row.to_item_id)
      );
    elsif visit_row.from_item_id is not null
      and visit_row.to_item_id is null
      and final_timed_from_position is not null
      and not exists (
        select 1
        from unnest(ordered_timed_item_ids) with ordinality as ordered(item_id, ord)
        where ordered.ord > final_timed_from_position
          and not ordered.item_id = any(converted_source_ids)
      )
      and not visit_row.from_item_id = any(converted_source_ids)
    then
      preserved_transport_ids := array_append(preserved_transport_ids, visit_row.id);
      preserved_transport_from_ids := array_append(
        preserved_transport_from_ids,
        coalesce(slot_item_ids[array_position(package_source_item_ids, visit_row.from_item_id)], visit_row.from_item_id)
      );
      preserved_transport_to_ids := array_append(preserved_transport_to_ids, null);
    else
      deleted_transport_ids := array_append(deleted_transport_ids, visit_row.id);
    end if;
  end loop;

  if cardinality(deleted_transport_ids) > 0 then
    delete from public.itinerary_items item
    where item.id = any(deleted_transport_ids)
      and item.trip_id = target_trip_id
      and item.day_index = target_day_index
      and item.item_type = 'transport';
  end if;

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

  return jsonb_build_object(
    'ok', true,
    'trip_id', target_trip_id,
    'day_index', target_day_index,
    'slot_item_ids', to_jsonb(slot_item_ids),
    'package_source_item_ids', to_jsonb(package_source_item_ids),
    'converted_slot_ids', to_jsonb(converted_slot_ids),
    'preserved_transport_ids', to_jsonb(preserved_transport_ids),
    'deleted_transport_ids', to_jsonb(deleted_transport_ids),
    'updated_visit_count', cardinality(slot_item_ids),
    'moved_alternative_count', moved_alternative_count,
    'moved_budget_link_count', moved_budget_link_count
  );
end;
$$;

revoke execute on function app_private.reorder_itinerary_fixed_anchor_continuation(uuid, integer, uuid[], uuid[], uuid[], uuid[], jsonb, jsonb) from public;
revoke execute on function app_private.reorder_itinerary_fixed_anchor_continuation(uuid, integer, uuid[], uuid[], uuid[], uuid[], jsonb, jsonb) from anon;
revoke execute on function app_private.reorder_itinerary_fixed_anchor_continuation(uuid, integer, uuid[], uuid[], uuid[], uuid[], jsonb, jsonb) from authenticated;

create or replace function public.reorder_itinerary_fixed_anchor_continuation(
  target_trip_id uuid,
  target_day_index integer,
  slot_item_ids uuid[],
  package_source_item_ids uuid[],
  ordered_timed_item_ids uuid[],
  ordered_visit_item_ids uuid[],
  untimed_sort_order_updates jsonb,
  item_updated_at_baselines jsonb
)
returns jsonb
language sql
security definer
set search_path = public, app_private
as $$
  select app_private.reorder_itinerary_fixed_anchor_continuation(
    target_trip_id,
    target_day_index,
    slot_item_ids,
    package_source_item_ids,
    ordered_timed_item_ids,
    ordered_visit_item_ids,
    untimed_sort_order_updates,
    item_updated_at_baselines
  );
$$;

revoke execute on function public.reorder_itinerary_fixed_anchor_continuation(uuid, integer, uuid[], uuid[], uuid[], uuid[], jsonb, jsonb) from public;
revoke execute on function public.reorder_itinerary_fixed_anchor_continuation(uuid, integer, uuid[], uuid[], uuid[], uuid[], jsonb, jsonb) from anon;
revoke execute on function public.reorder_itinerary_fixed_anchor_continuation(uuid, integer, uuid[], uuid[], uuid[], uuid[], jsonb, jsonb) from authenticated;
grant execute on function public.reorder_itinerary_fixed_anchor_continuation(uuid, integer, uuid[], uuid[], uuid[], uuid[], jsonb, jsonb) to authenticated;

comment on function public.reorder_itinerary_fixed_anchor_continuation(uuid, integer, uuid[], uuid[], uuid[], uuid[], jsonb, jsonb) is
  'Atomically reorders non-fixed timed destination packages across fixed anchors, recalculates fixed-bounded continuation segments, converts overflow to untimed, and cleans broken transports.';
