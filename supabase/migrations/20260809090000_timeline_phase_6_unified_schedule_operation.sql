-- Timeline Phase 6 unified scheduling Planner and authoritative apply RPC.
-- The private Planner is pure JSON calculation. The public wrapper accepts intent,
-- reloads and locks one Day, validates its complete revision, recalculates, and
-- applies the still-valid result atomically.

create or replace function app_private.timeline_schedule_minutes(
  value text,
  allow_day_boundary boolean default false
)
returns integer
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  matched text[];
  hours integer;
  minutes integer;
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;
  matched := regexp_match(btrim(value), '^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$');
  if matched is null then
    return null;
  end if;
  hours := matched[1]::integer;
  minutes := matched[2]::integer;
  if minutes < 0 or minutes > 59 then
    return null;
  end if;
  if hours = 24 and minutes = 0 and allow_day_boundary then
    return 1440;
  end if;
  if hours < 0 or hours > 23 then
    return null;
  end if;
  return hours * 60 + minutes;
end;
$$;

-- Forward definitions keep PostgreSQL function-body validation explicit. The
-- full Planner and Day snapshot bodies replace these signatures below.
create or replace function app_private.timeline_schedule_time_text(value integer)
returns text language sql immutable set search_path = pg_catalog
as $$ select case when value = 1440 then '24:00' when value between 0 and 1439 then lpad((value / 60)::text, 2, '0') || ':' || lpad((value % 60)::text, 2, '0') else null end $$;

create or replace function app_private.timeline_schedule_is_transport(item jsonb)
returns boolean language sql immutable set search_path = pg_catalog
as $$ select coalesce(item ->> 'item_type', '') = 'transport' $$;

create or replace function app_private.timeline_schedule_time_state(item jsonb)
returns text language sql immutable set search_path = pg_catalog, app_private
as $$
  select case
    when (nullif(item ->> 'start_time', '') is null) <> (nullif(item ->> 'end_time', '') is null) then 'partial'
    when nullif(item ->> 'start_time', '') is null then 'untimed'
    when app_private.timeline_schedule_minutes(item ->> 'start_time', false) is null
      or app_private.timeline_schedule_minutes(item ->> 'end_time', true) is null
      or app_private.timeline_schedule_minutes(item ->> 'end_time', true) <= app_private.timeline_schedule_minutes(item ->> 'start_time', false)
      then 'invalid'
    else 'timed'
  end
$$;

create or replace function app_private.timeline_schedule_put_update(updates jsonb, item jsonb)
returns jsonb language sql immutable set search_path = pg_catalog
as $$ select jsonb_set(coalesce(updates, '{}'::jsonb), array[item ->> 'id'], coalesce(updates -> (item ->> 'id'), '{}'::jsonb) || item, true) $$;

create or replace function app_private.plan_timeline_schedule_snapshot(day_snapshot jsonb, operation_intent jsonb)
returns jsonb language sql immutable set search_path = pg_catalog
as $$ select jsonb_build_object('ok', false, 'validationError', 'planner_not_initialized') $$;

create or replace function app_private.timeline_day_visit_ids(target_trip_id uuid, target_day_index integer)
returns uuid[] language sql stable security definer set search_path = pg_catalog
as $$ select array[]::uuid[] $$;

create or replace function app_private.timeline_day_schedule_snapshot(target_trip_id uuid, target_day_index integer)
returns jsonb language sql stable security definer set search_path = pg_catalog
as $$ select jsonb_build_object('dayIndex', target_day_index, 'items', '[]'::jsonb) $$;

create or replace function app_private.apply_timeline_schedule_operation(
  target_trip_id uuid,
  target_day_index integer,
  target_item_id uuid,
  target_payload jsonb,
  operation_intent jsonb,
  expected_visit_ids uuid[],
  item_updated_at_baselines jsonb,
  confirmed_major_effect jsonb default null,
  preview_result jsonb default null,
  slot_item_ids uuid[] default null,
  package_source_item_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_catalog
as $$
declare
  current_visit_ids uuid[];
  current_day_count integer;
  baseline_count integer;
  max_day_index integer;
  snapshot jsonb;
  plan jsonb;
  major_effect jsonb;
  normalized_automatic_ids jsonb;
  normalized_removed_ids jsonb;
  operation_type text := operation_intent ->> 'type';
  item_row public.itinerary_items%rowtype;
  payload_row public.itinerary_items%rowtype;
  package_row public.itinerary_items%rowtype;
  package_rows public.itinerary_items[];
  alternative_row public.itinerary_alternatives%rowtype;
  budget_row public.itinerary_budget_items%rowtype;
  budget_rows public.itinerary_budget_items[];
  update_item jsonb;
  removed_id text;
  mapped_id uuid;
  source_position integer;
  item_index integer;
  baseline_value text;
  authoritative_slot_ids uuid[];
  response_items jsonb;
  result_updated_at timestamptz;
begin
  if auth.uid() is null then raise exception 'permission_denied'; end if;
  if target_trip_id is null or target_day_index is null or target_day_index < 0 then raise exception 'invalid_day'; end if;
  if not app_private.can_edit_trip(target_trip_id, auth.uid()) then raise exception 'permission_denied'; end if;
  if operation_type not in ('edit_time', 'restore_time', 'clear_time', 'upsert_transport', 'delete_transport', 'reorder') then
    raise exception 'invalid_operation';
  end if;
  if operation_type in ('edit_time', 'restore_time', 'clear_time')
    and (
      target_item_id is null
      or target_item_id::text is distinct from coalesce(operation_intent ->> 'targetItemId', operation_intent ->> 'target_item_id')
    )
  then
    raise exception 'invalid_target';
  end if;
  if operation_type = 'upsert_transport'
    and (
      target_item_id is null
      or target_payload is null
      or target_item_id::text is distinct from operation_intent -> 'transport' ->> 'id'
    )
  then
    raise exception 'invalid_transport';
  end if;

  select trip.end_date - trip.start_date into max_day_index
  from public.trips trip where trip.id = target_trip_id;
  if max_day_index is null or target_day_index > max_day_index then raise exception 'invalid_day'; end if;

  -- A per-Day advisory lock plus deterministic row-ID locks keep the short
  -- transaction deadlock-safe. No UI wait or external call occurs here.
  perform pg_advisory_xact_lock(hashtext(target_trip_id::text), target_day_index);
  perform 1
  from public.itinerary_items item
  where item.trip_id = target_trip_id and item.day_index = target_day_index
  order by item.id
  for update;

  select count(*) into current_day_count
  from public.itinerary_items item
  where item.trip_id = target_trip_id and item.day_index = target_day_index;
  if item_updated_at_baselines is null or jsonb_typeof(item_updated_at_baselines) <> 'object' then
    raise exception 'stale_manifest';
  end if;
  select count(*) into baseline_count from jsonb_object_keys(item_updated_at_baselines);
  if baseline_count <> current_day_count then raise exception 'stale_manifest'; end if;
  for item_row in
    select item.* from public.itinerary_items item
    where item.trip_id = target_trip_id and item.day_index = target_day_index
    order by item.id
  loop
    baseline_value := item_updated_at_baselines ->> item_row.id::text;
    if baseline_value is null then raise exception 'stale_item'; end if;
    begin
      if item_row.updated_at is distinct from baseline_value::timestamptz then raise exception 'stale_item'; end if;
    exception when invalid_datetime_format then
      raise exception 'stale_item';
    end;
  end loop;

  current_visit_ids := app_private.timeline_day_visit_ids(target_trip_id, target_day_index);
  if expected_visit_ids is null or current_visit_ids is distinct from expected_visit_ids then
    raise exception 'stale_manifest';
  end if;
  if exists (
    select 1 from public.itinerary_items item
    where item.trip_id = target_trip_id
      and item.day_index = target_day_index
      and item.item_type <> 'transport'
      and item.locked_by is not null
      and item.locked_by <> auth.uid()
      and item.locked_at > now() - interval '7 minutes'
      and not coalesce(item.is_fixed, false)
  ) then
    raise exception 'item_locked';
  end if;

  snapshot := app_private.timeline_day_schedule_snapshot(target_trip_id, target_day_index);
  plan := app_private.plan_timeline_schedule_snapshot(snapshot, operation_intent);
  if not coalesce((plan ->> 'ok')::boolean, false) then
    raise exception '%', coalesce(plan ->> 'validationError', 'invalid_operation');
  end if;

  select coalesce(jsonb_agg(value #>> '{}' order by value #>> '{}'), '[]'::jsonb)
    into normalized_automatic_ids
  from jsonb_array_elements(coalesce(plan -> 'automaticUntimedItemIds', '[]'::jsonb));
  select coalesce(jsonb_agg(value #>> '{}' order by value #>> '{}'), '[]'::jsonb)
    into normalized_removed_ids
  from jsonb_array_elements(coalesce(plan -> 'removedTransportIds', '[]'::jsonb));
  major_effect := jsonb_build_object(
    'automaticUntimedItemIds', normalized_automatic_ids,
    'removedTransportIds', normalized_removed_ids
  );
  if coalesce((plan ->> 'requiresConfirmation')::boolean, false) and confirmed_major_effect is null then
    return jsonb_build_object('ok', false, 'status', 'repreview_required', 'preview', plan, 'majorEffect', major_effect);
  end if;
  if confirmed_major_effect is not null and confirmed_major_effect is distinct from major_effect then
    return jsonb_build_object('ok', false, 'status', 'repreview_required', 'preview', plan, 'majorEffect', major_effect);
  end if;
  -- preview_result is intentionally not used as mutation authority.

  if operation_type = 'reorder' then
    if (slot_item_ids is null) <> (package_source_item_ids is null) then
      raise exception 'invalid_manifest';
    end if;
    -- Pure Untimed/visual reorder has no package arrays. Timed package reorder
    -- supplies both arrays and remaps content onto the stable timed slot IDs.
    if slot_item_ids is not null then
      if cardinality(slot_item_ids) <> cardinality(package_source_item_ids)
        or cardinality(slot_item_ids) <> (select count(distinct value) from unnest(slot_item_ids) value)
        or cardinality(package_source_item_ids) <> (select count(distinct value) from unnest(package_source_item_ids) value)
        or exists (select 1 from unnest(package_source_item_ids) source_id where not source_id = any(slot_item_ids))
      then
        raise exception 'invalid_manifest';
      end if;
      select coalesce(array_agg(item.id order by ordered.ordinality), array[]::uuid[])
        into authoritative_slot_ids
      from unnest(current_visit_ids) with ordinality ordered(item_id, ordinality)
      join public.itinerary_items item on item.id = ordered.item_id
      where item.start_time is not null
        and item.end_time is not null
        and not coalesce(item.is_fixed, false);
      if authoritative_slot_ids is distinct from slot_item_ids then raise exception 'stale_manifest'; end if;

      perform 1 from public.itinerary_alternatives alternative
      where alternative.itinerary_item_id = any(slot_item_ids)
      order by alternative.id for update;
      perform 1 from public.itinerary_budget_items link
      where link.itinerary_item_id = any(slot_item_ids)
      order by link.id for update;

      select coalesce(array_agg(item order by requested.ordinality), array[]::public.itinerary_items[])
        into package_rows
      from unnest(package_source_item_ids) with ordinality requested(item_id, ordinality)
      join public.itinerary_items item on item.id = requested.item_id;
      if cardinality(package_rows) <> cardinality(package_source_item_ids) then raise exception 'stale_manifest'; end if;

      select coalesce(array_agg(link order by link.id), array[]::public.itinerary_budget_items[])
        into budget_rows
      from public.itinerary_budget_items link
      where link.itinerary_item_id = any(slot_item_ids);

      for item_index in 1..cardinality(slot_item_ids) loop
        package_row := package_rows[item_index];
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
          updated_at = now()
        where item.id = slot_item_ids[item_index]
          and item.trip_id = target_trip_id
          and item.day_index = target_day_index
          and item.item_type <> 'transport'
          and not coalesce(item.is_fixed, false);
        if not found then raise exception 'stale_item'; end if;
      end loop;

      for alternative_row in
        select alternative.* from public.itinerary_alternatives alternative
        where alternative.itinerary_item_id = any(slot_item_ids)
        order by alternative.id
      loop
        source_position := array_position(package_source_item_ids, alternative_row.itinerary_item_id);
        if source_position is null then raise exception 'stale_manifest'; end if;
        update public.itinerary_alternatives alternative
        set itinerary_item_id = slot_item_ids[source_position]
        where alternative.id = alternative_row.id;
      end loop;

      delete from public.itinerary_budget_items link where link.itinerary_item_id = any(slot_item_ids);
      if cardinality(budget_rows) > 0 then
        foreach budget_row in array budget_rows loop
          source_position := array_position(package_source_item_ids, budget_row.itinerary_item_id);
          if source_position is null then raise exception 'stale_manifest'; end if;
          insert into public.itinerary_budget_items(id, itinerary_item_id, budget_item_id, created_at)
          values (budget_row.id, slot_item_ids[source_position], budget_row.budget_item_id, budget_row.created_at);
        end loop;
      end if;
    end if;
  elsif target_payload is not null and operation_type in ('edit_time', 'restore_time', 'clear_time', 'upsert_transport') then
    payload_row := jsonb_populate_record(null::public.itinerary_items, target_payload);
    select item.* into item_row from public.itinerary_items item
    where item.id = target_item_id and item.trip_id = target_trip_id and item.day_index = target_day_index;
    if found then
      if operation_type = 'upsert_transport' and item_row.item_type <> 'transport' then
        raise exception 'invalid_transport';
      end if;
      update public.itinerary_items item
      set
        type = payload_row.type,
        title = payload_row.title,
        location = payload_row.location,
        note = payload_row.note,
        cost = payload_row.cost,
        location_name = payload_row.location_name,
        address = payload_row.address,
        map_url = payload_row.map_url,
        latitude = payload_row.latitude,
        longitude = payload_row.longitude,
        description = payload_row.description,
        transportation_note = payload_row.transportation_note,
        transport_category = payload_row.transport_category,
        transport_name = payload_row.transport_name,
        transport_duration_minutes = case
          when operation_type = 'upsert_transport' then (operation_intent -> 'transport' ->> 'transport_duration_minutes')::integer
          else payload_row.transport_duration_minutes
        end,
        transport_note = payload_row.transport_note,
        from_item_id = case
          when operation_type = 'upsert_transport' then (operation_intent -> 'transport' ->> 'from_item_id')::uuid
          else payload_row.from_item_id
        end,
        to_item_id = case
          when operation_type = 'upsert_transport' then (operation_intent -> 'transport' ->> 'to_item_id')::uuid
          else payload_row.to_item_id
        end,
        transport_role = case when item.item_type = 'transport' then 'normal_pair' else null end,
        from_snapshot_start_time = payload_row.from_snapshot_start_time,
        from_snapshot_end_time = payload_row.from_snapshot_end_time,
        from_snapshot_destination = payload_row.from_snapshot_destination,
        to_snapshot_start_time = payload_row.to_snapshot_start_time,
        to_snapshot_end_time = payload_row.to_snapshot_end_time,
        to_snapshot_destination = payload_row.to_snapshot_destination,
        updated_at = now()
      where item.id = target_item_id and item.trip_id = target_trip_id and item.day_index = target_day_index;
    elsif operation_type = 'upsert_transport' then
      insert into public.itinerary_items(
        id, trip_id, day_index, date, sort_order, item_type, type, title, location, note, cost,
        location_name, address, map_url, latitude, longitude, description, transportation_note,
        transport_category, transport_name, transport_duration_minutes, transport_note,
        from_item_id, to_item_id, transport_role,
        from_snapshot_start_time, from_snapshot_end_time, from_snapshot_destination,
        to_snapshot_start_time, to_snapshot_end_time, to_snapshot_destination,
        is_fixed, fixed_at, fixed_by
      ) values (
        target_item_id, target_trip_id, target_day_index,
        (select trip.start_date + target_day_index from public.trips trip where trip.id = target_trip_id),
        coalesce(payload_row.sort_order, (cardinality(current_visit_ids) + 1) * 10),
        'transport', 'transport', payload_row.title, null, payload_row.note, coalesce(payload_row.cost, 0),
        null, null, null, null, null, payload_row.description, payload_row.transportation_note,
        payload_row.transport_category, payload_row.transport_name,
        (operation_intent -> 'transport' ->> 'transport_duration_minutes')::integer,
        payload_row.transport_note,
        (operation_intent -> 'transport' ->> 'from_item_id')::uuid,
        (operation_intent -> 'transport' ->> 'to_item_id')::uuid,
        'normal_pair',
        payload_row.from_snapshot_start_time, payload_row.from_snapshot_end_time, payload_row.from_snapshot_destination,
        payload_row.to_snapshot_start_time, payload_row.to_snapshot_end_time, payload_row.to_snapshot_destination,
        false, null, null
      );
    else
      raise exception 'stale_item';
    end if;
  end if;

  -- Re-map preserved transport endpoints after package movement.
  if operation_type = 'reorder' and cardinality(slot_item_ids) > 0 then
    for item_row in
      select item.* from public.itinerary_items item
      where item.trip_id = target_trip_id and item.day_index = target_day_index and item.item_type = 'transport'
      order by item.id
    loop
      if coalesce(plan -> 'removedTransportIds', '[]'::jsonb) @> jsonb_build_array(item_row.id::text) then continue; end if;
      source_position := array_position(package_source_item_ids, item_row.from_item_id);
      mapped_id := case when source_position is null then item_row.from_item_id else slot_item_ids[source_position] end;
      update public.itinerary_items item
      set
        from_item_id = mapped_id,
        to_item_id = case
          when item_row.to_item_id is null then null
          when array_position(package_source_item_ids, item_row.to_item_id) is null then item_row.to_item_id
          else slot_item_ids[array_position(package_source_item_ids, item_row.to_item_id)]
        end,
        updated_at = now()
      where item.id = item_row.id;
    end loop;
  end if;

  for removed_id in select value #>> '{}' from jsonb_array_elements(coalesce(plan -> 'removedTransportIds', '[]'::jsonb)) loop
    delete from public.itinerary_items item
    where item.id = removed_id::uuid
      and item.trip_id = target_trip_id
      and item.day_index = target_day_index
      and item.item_type = 'transport';
  end loop;

  for update_item in select value from jsonb_array_elements(coalesce(plan -> 'updatedItems', '[]'::jsonb)) loop
    mapped_id := (update_item ->> 'id')::uuid;
    if operation_type = 'reorder' then
      source_position := array_position(package_source_item_ids, mapped_id);
      if source_position is not null then mapped_id := slot_item_ids[source_position]; end if;
    end if;
    update public.itinerary_items item
    set
      start_time = case when update_item ? 'start_time' then (update_item ->> 'start_time')::time else item.start_time end,
      end_time = case when update_item ? 'end_time' then (update_item ->> 'end_time')::time else item.end_time end,
      sort_order = case when update_item ? 'sort_order' then (update_item ->> 'sort_order')::integer else item.sort_order end,
      from_snapshot_start_time = case when update_item ? 'from_snapshot_start_time' then update_item ->> 'from_snapshot_start_time' else item.from_snapshot_start_time end,
      from_snapshot_end_time = case when update_item ? 'from_snapshot_end_time' then update_item ->> 'from_snapshot_end_time' else item.from_snapshot_end_time end,
      from_snapshot_destination = case when update_item ? 'from_snapshot_destination' then update_item ->> 'from_snapshot_destination' else item.from_snapshot_destination end,
      to_snapshot_start_time = case when update_item ? 'to_snapshot_start_time' then update_item ->> 'to_snapshot_start_time' else item.to_snapshot_start_time end,
      to_snapshot_end_time = case when update_item ? 'to_snapshot_end_time' then update_item ->> 'to_snapshot_end_time' else item.to_snapshot_end_time end,
      to_snapshot_destination = case when update_item ? 'to_snapshot_destination' then update_item ->> 'to_snapshot_destination' else item.to_snapshot_destination end,
      updated_at = now()
    where item.id = mapped_id and item.trip_id = target_trip_id and item.day_index = target_day_index;
    if not found and not (coalesce(plan -> 'removedTransportIds', '[]'::jsonb) @> jsonb_build_array(update_item ->> 'id')) then
      raise exception 'stale_item';
    end if;
  end loop;

  result_updated_at := now();
  response_items := app_private.timeline_day_schedule_snapshot(target_trip_id, target_day_index) -> 'items';
  return jsonb_build_object(
    'ok', true,
    'status', 'applied',
    'tripId', target_trip_id,
    'dayIndex', target_day_index,
    'plan', plan,
    'majorEffect', major_effect,
    'revision', jsonb_build_object(
      'itemIds', app_private.timeline_day_visit_ids(target_trip_id, target_day_index),
      'updatedAt', result_updated_at
    ),
    'items', response_items
  );
end;
$$;

revoke all on function app_private.timeline_schedule_minutes(text, boolean) from public, anon, authenticated;
revoke all on function app_private.timeline_schedule_time_text(integer) from public, anon, authenticated;
revoke all on function app_private.timeline_schedule_is_transport(jsonb) from public, anon, authenticated;
revoke all on function app_private.timeline_schedule_time_state(jsonb) from public, anon, authenticated;
revoke all on function app_private.timeline_schedule_put_update(jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.timeline_day_visit_ids(uuid, integer) from public, anon, authenticated;
revoke all on function app_private.timeline_day_schedule_snapshot(uuid, integer) from public, anon, authenticated;
revoke all on function app_private.plan_timeline_schedule_snapshot(jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.apply_timeline_schedule_operation(uuid, integer, uuid, jsonb, jsonb, uuid[], jsonb, jsonb, jsonb, uuid[], uuid[]) from public, anon, authenticated;

create or replace function public.apply_timeline_schedule_operation(
  target_trip_id uuid,
  target_day_index integer,
  target_item_id uuid,
  target_payload jsonb,
  operation_intent jsonb,
  expected_visit_ids uuid[],
  item_updated_at_baselines jsonb,
  confirmed_major_effect jsonb default null,
  preview_result jsonb default null,
  slot_item_ids uuid[] default null,
  package_source_item_ids uuid[] default null
)
returns jsonb
language sql
security definer
set search_path = public, app_private, pg_catalog
as $$
  select app_private.apply_timeline_schedule_operation(
    target_trip_id,
    target_day_index,
    target_item_id,
    target_payload,
    operation_intent,
    expected_visit_ids,
    item_updated_at_baselines,
    confirmed_major_effect,
    preview_result,
    slot_item_ids,
    package_source_item_ids
  );
$$;

revoke all on function public.apply_timeline_schedule_operation(uuid, integer, uuid, jsonb, jsonb, uuid[], jsonb, jsonb, jsonb, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.apply_timeline_schedule_operation(uuid, integer, uuid, jsonb, jsonb, uuid[], jsonb, jsonb, jsonb, uuid[], uuid[]) to authenticated;

comment on function public.apply_timeline_schedule_operation(uuid, integer, uuid, jsonb, jsonb, uuid[], jsonb, jsonb, jsonb, uuid[], uuid[]) is
  'Timeline Phase 6 authoritative Day scheduler. Validates a full-Day revision, recalculates from locked rows, compares major effects, and applies atomically.';

create or replace function app_private.timeline_schedule_time_text(value integer)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when value is null or value < 0 or value > 1440 then null
    when value = 1440 then '24:00'
    else lpad((value / 60)::text, 2, '0') || ':' || lpad((value % 60)::text, 2, '0')
  end;
$$;

create or replace function app_private.timeline_schedule_is_transport(item jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(item ->> 'item_type', '') = 'transport';
$$;

create or replace function app_private.timeline_schedule_time_state(item jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog, app_private
as $$
declare
  has_start boolean := nullif(item ->> 'start_time', '') is not null;
  has_end boolean := nullif(item ->> 'end_time', '') is not null;
  start_minutes integer;
  end_minutes integer;
begin
  if has_start <> has_end then return 'partial'; end if;
  if not has_start then return 'untimed'; end if;
  start_minutes := app_private.timeline_schedule_minutes(item ->> 'start_time', false);
  end_minutes := app_private.timeline_schedule_minutes(item ->> 'end_time', true);
  if start_minutes is null or end_minutes is null or end_minutes <= start_minutes then return 'invalid'; end if;
  return 'timed';
end;
$$;

create or replace function app_private.timeline_schedule_put_update(updates jsonb, item jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_set(
    coalesce(updates, '{}'::jsonb),
    array[item ->> 'id'],
    coalesce(updates -> (item ->> 'id'), '{}'::jsonb) || item,
    true
  );
$$;

create or replace function app_private.plan_timeline_schedule_snapshot(
  day_snapshot jsonb,
  operation_intent jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, app_private
as $$
declare
  operation_type text := operation_intent ->> 'type';
  all_items jsonb := coalesce(day_snapshot -> 'items', '[]'::jsonb);
  original_visits jsonb;
  visits jsonb;
  transports jsonb;
  next_ids jsonb;
  updates jsonb := '{}'::jsonb;
  removed_ids jsonb := '[]'::jsonb;
  suspended_ids jsonb := '[]'::jsonb;
  untimed_ids jsonb := '[]'::jsonb;
  automatic_untimed_ids jsonb := '[]'::jsonb;
  affected_ids jsonb := '[]'::jsonb;
  item jsonb;
  other jsonb;
  transport jsonb;
  update_item jsonb;
  target_id text;
  transport_id text;
  transport_duration_text text;
  target_index integer := -1;
  from_index integer := -1;
  to_index integer := -1;
  original_from_index integer := -1;
  original_to_index integer := -1;
  previous_index integer := -1;
  fixed_index integer := -1;
  segment_end integer := 0;
  schedule_start integer := -1;
  operation_start integer := -1;
  first_difference integer := -1;
  index_value integer;
  scan_index integer;
  original_fixed_index integer;
  next_fixed_index integer;
  visit_count integer;
  start_minutes integer;
  end_minutes integer;
  duration_minutes integer;
  previous_end integer;
  next_start integer;
  next_end integer;
  boundary_minutes integer := 1440;
  transport_minutes integer := 0;
  fixed_boundary_transport_minutes integer := 0;
  anchor_start integer := null;
  first_timed boolean := true;
  found_transport boolean := false;
  overflow_reason text := null;
  stopped_at_fixed_item_id text := null;
  explicit_removed_id text := null;
  upserted_transport jsonb := null;
  state text;
  from_state text;
  to_state text;
  blocked_by_untimed boolean;
  valid_adjacency boolean;
  timed_before integer;
  untimed_in_slot integer;
  untimed_rank integer;
  rank_step integer;
  sort_order integer;
  changed boolean;
  removed_is_major boolean := false;
  updated_items jsonb;
  ordered_visit_ids jsonb;
begin
  if operation_type not in ('edit_time', 'restore_time', 'clear_time', 'upsert_transport', 'delete_transport', 'reorder') then
    return jsonb_build_object('ok', false, 'validationError', 'invalid_operation', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
  end if;
  if jsonb_typeof(all_items) <> 'array' then
    return jsonb_build_object('ok', false, 'validationError', 'invalid_manifest', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
  end if;

  select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
    into original_visits
  from jsonb_array_elements(all_items) with ordinality
  where not app_private.timeline_schedule_is_transport(value);
  visits := original_visits;
  select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
    into transports
  from jsonb_array_elements(all_items) with ordinality
  where app_private.timeline_schedule_is_transport(value);
  visit_count := jsonb_array_length(visits);

  if visit_count > 0 then
    for index_value in 0..visit_count - 1 loop
      item := visits -> index_value;
      state := app_private.timeline_schedule_time_state(item);
      if state in ('partial', 'invalid') then
        return jsonb_build_object(
          'ok', false,
          'validationError', case when state = 'partial' then 'partial_time' else 'invalid_range' end,
          'invalidItemId', item ->> 'id',
          'affectedItemIds', '[]'::jsonb,
          'requiresConfirmation', false
        );
      end if;
    end loop;
  end if;

  if operation_type = 'reorder' then
    next_ids := operation_intent -> 'orderedVisitIds';
    if next_ids is null or jsonb_typeof(next_ids) <> 'array' or jsonb_array_length(next_ids) <> visit_count
      or (select count(distinct value) from jsonb_array_elements_text(next_ids)) <> visit_count
      or exists (
        select 1
        from jsonb_array_elements_text(next_ids) requested(id)
        where not exists (
          select 1 from jsonb_array_elements(original_visits) current_item
          where current_item ->> 'id' = requested.id
        )
      )
    then
      return jsonb_build_object('ok', false, 'validationError', 'invalid_manifest', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
    end if;
    select coalesce(jsonb_agg(current_item order by requested.ordinality), '[]'::jsonb)
      into visits
    from jsonb_array_elements_text(next_ids) with ordinality requested(id, ordinality)
    join lateral (
      select value as current_item
      from jsonb_array_elements(original_visits)
      where value ->> 'id' = requested.id
      limit 1
    ) matched on true;

    if visit_count > 0 then
      for index_value in 0..visit_count - 1 loop
        item := original_visits -> index_value;
        if coalesce((item ->> 'is_fixed')::boolean, false)
          and app_private.timeline_schedule_time_state(item) = 'timed'
        then
          select ordinality::integer - 1 into next_fixed_index
          from jsonb_array_elements(visits) with ordinality
          where value ->> 'id' = item ->> 'id';
          if next_fixed_index is distinct from index_value then
            return jsonb_build_object('ok', false, 'validationError', 'fixed_boundary_crossed', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
          end if;
          if exists (
            select 1
            from jsonb_array_elements(original_visits) with ordinality original_entry(value, ordinality)
            join jsonb_array_elements(visits) with ordinality next_entry(value, ordinality)
              on next_entry.value ->> 'id' = original_entry.value ->> 'id'
            where (
              original_entry.ordinality < index_value + 1
              and next_entry.ordinality > next_fixed_index + 1
            ) or (
              original_entry.ordinality > index_value + 1
              and next_entry.ordinality < next_fixed_index + 1
            )
          ) then
            return jsonb_build_object('ok', false, 'validationError', 'fixed_boundary_crossed', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
          end if;
        end if;
        if first_difference < 0 and (original_visits -> index_value ->> 'id') is distinct from (visits -> index_value ->> 'id') then
          first_difference := index_value;
        end if;
      end loop;
    end if;
    if first_difference < 0 then
      return jsonb_build_object(
        'ok', true,
        'updatedItems', '[]'::jsonb,
        'affectedItemIds', '[]'::jsonb,
        'automaticUntimedItemIds', '[]'::jsonb,
        'untimedItemIds', '[]'::jsonb,
        'removedTransportIds', '[]'::jsonb,
        'suspendedTransportIds', '[]'::jsonb,
        'stoppedAtFixedItemId', null,
        'overflowReason', null,
        'operationStartIndex', -1,
        'orderedVisitIds', next_ids,
        'requiresConfirmation', false
      );
    end if;
    operation_start := first_difference;
    schedule_start := first_difference;

    for transport in select value from jsonb_array_elements(transports) loop
      if transport ->> 'transport_role' = 'normal_pair' then
        original_from_index := null;
        original_to_index := null;
        select ordinality::integer - 1 into original_from_index
        from jsonb_array_elements(original_visits) with ordinality
        where value ->> 'id' = transport ->> 'from_item_id';
        select ordinality::integer - 1 into original_to_index
        from jsonb_array_elements(original_visits) with ordinality
        where value ->> 'id' = transport ->> 'to_item_id';
        if original_from_index is not null
          and original_to_index = original_from_index + 1
          and app_private.timeline_schedule_time_state(original_visits -> original_from_index) = 'timed'
          and app_private.timeline_schedule_time_state(original_visits -> original_to_index) = 'timed'
        then
          from_index := null;
          to_index := null;
          select ordinality::integer - 1 into from_index
          from jsonb_array_elements(visits) with ordinality
          where value ->> 'id' = transport ->> 'from_item_id';
          select ordinality::integer - 1 into to_index
          from jsonb_array_elements(visits) with ordinality
          where value ->> 'id' = transport ->> 'to_item_id';
          if from_index is null or to_index is null or to_index <> from_index + 1 then
            removed_ids := removed_ids || jsonb_build_array(transport ->> 'id');
          end if;
        end if;
      end if;
    end loop;

    previous_index := -1;
    if schedule_start > 0 then
      for scan_index in reverse schedule_start - 1..0 loop
        if app_private.timeline_schedule_time_state(visits -> scan_index) = 'timed' then
          previous_index := scan_index;
          exit;
        end if;
      end loop;
    end if;
    if previous_index < 0 then
      for scan_index in schedule_start..visit_count - 1 loop
        if app_private.timeline_schedule_time_state(original_visits -> scan_index) = 'timed' then
          anchor_start := app_private.timeline_schedule_minutes(original_visits -> scan_index ->> 'start_time', false);
          exit;
        end if;
      end loop;
    end if;
  elsif operation_type in ('edit_time', 'restore_time', 'clear_time') then
    target_id := coalesce(operation_intent ->> 'targetItemId', operation_intent ->> 'target_item_id');
    select ordinality::integer - 1 into target_index
    from jsonb_array_elements(visits) with ordinality
    where value ->> 'id' = target_id;
    if target_index is null then
      return jsonb_build_object('ok', false, 'validationError', 'invalid_target', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
    end if;
    item := visits -> target_index;
    if coalesce((item ->> 'is_fixed')::boolean, false) and app_private.timeline_schedule_time_state(item) = 'timed' then
      return jsonb_build_object('ok', false, 'validationError', 'fixed_item', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
    end if;
    if operation_type = 'clear_time' then
      item := jsonb_set(jsonb_set(item, '{start_time}', 'null'::jsonb), '{end_time}', 'null'::jsonb);
      visits := jsonb_set(visits, array[target_index::text], item);
      updates := app_private.timeline_schedule_put_update(updates, jsonb_build_object('id', target_id, 'start_time', null, 'end_time', null));
      untimed_ids := untimed_ids || jsonb_build_array(target_id);
      schedule_start := target_index + 1;
    else
      start_minutes := app_private.timeline_schedule_minutes(
        coalesce(operation_intent ->> 'start_time', operation_intent ->> 'targetStartTime'), false
      );
      end_minutes := app_private.timeline_schedule_minutes(
        coalesce(operation_intent ->> 'end_time', operation_intent ->> 'targetEndTime'), true
      );
      if start_minutes is null or end_minutes is null then
        return jsonb_build_object('ok', false, 'validationError', 'partial_time', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
      end if;
      if end_minutes <= start_minutes then
        return jsonb_build_object('ok', false, 'validationError', 'invalid_range', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
      end if;
      previous_index := -1;
      if target_index > 0 then
        for scan_index in reverse target_index - 1..0 loop
          if app_private.timeline_schedule_time_state(visits -> scan_index) = 'timed' then
            previous_index := scan_index;
            exit;
          end if;
        end loop;
      end if;
      if previous_index >= 0 then
        previous_end := app_private.timeline_schedule_minutes(visits -> previous_index ->> 'end_time', true);
        transport_minutes := 0;
        if target_index = previous_index + 1 then
          for transport in select value from jsonb_array_elements(transports) loop
            if transport ->> 'transport_role' = 'normal_pair'
              and transport ->> 'from_item_id' = visits -> previous_index ->> 'id'
              and transport ->> 'to_item_id' = target_id
              and not (removed_ids @> jsonb_build_array(transport ->> 'id'))
            then
              transport_minutes := coalesce((transport ->> 'transport_duration_minutes')::integer, 0);
              exit;
            end if;
          end loop;
        end if;
        if start_minutes < previous_end + transport_minutes then
          return jsonb_build_object(
            'ok', false,
            'validationError', 'earlier_conflict',
            'earliestStart', app_private.timeline_schedule_time_text(previous_end + transport_minutes),
            'affectedItemIds', '[]'::jsonb,
            'requiresConfirmation', false
          );
        end if;
      end if;
      item := jsonb_set(
        jsonb_set(item, '{start_time}', to_jsonb(app_private.timeline_schedule_time_text(start_minutes))),
        '{end_time}', to_jsonb(app_private.timeline_schedule_time_text(end_minutes))
      );
      visits := jsonb_set(visits, array[target_index::text], item);
      updates := app_private.timeline_schedule_put_update(
        updates,
        jsonb_build_object('id', target_id, 'start_time', app_private.timeline_schedule_time_text(start_minutes), 'end_time', app_private.timeline_schedule_time_text(end_minutes))
      );
      schedule_start := target_index;
      anchor_start := start_minutes;
    end if;
    operation_start := target_index;
  elsif operation_type = 'upsert_transport' then
    transport := operation_intent -> 'transport';
    transport_id := transport ->> 'id';
    transport_duration_text := transport ->> 'transport_duration_minutes';
    if transport_id is null or transport ->> 'from_item_id' is null or transport ->> 'to_item_id' is null
      or transport_duration_text is null
      or transport_duration_text !~ '^[0-9]+$'
    then
      return jsonb_build_object('ok', false, 'validationError', 'invalid_transport', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
    end if;
    transport_minutes := transport_duration_text::integer;
    if transport_minutes <= 0 then
      return jsonb_build_object('ok', false, 'validationError', 'invalid_transport', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
    end if;
    if exists (select 1 from jsonb_array_elements(visits) where value ->> 'id' = transport_id) then
      return jsonb_build_object('ok', false, 'validationError', 'invalid_transport', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
    end if;
    select ordinality::integer - 1 into from_index
    from jsonb_array_elements(visits) with ordinality
    where value ->> 'id' = transport ->> 'from_item_id';
    select ordinality::integer - 1 into to_index
    from jsonb_array_elements(visits) with ordinality
    where value ->> 'id' = transport ->> 'to_item_id';
    if from_index is null or to_index is null or to_index <> from_index + 1 then
      return jsonb_build_object('ok', false, 'validationError', 'invalid_transport', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
    end if;
    select coalesce(jsonb_agg(
      case when value ->> 'id' = transport_id then value || transport || jsonb_build_object('item_type', 'transport', 'transport_role', 'normal_pair') else value end
      order by ordinality
    ), '[]'::jsonb)
    into transports
    from jsonb_array_elements(transports) with ordinality;
    if not exists (select 1 from jsonb_array_elements(transports) where value ->> 'id' = transport_id) then
      transports := transports || jsonb_build_array(transport || jsonb_build_object('item_type', 'transport', 'transport_role', 'normal_pair'));
    end if;
    upserted_transport := transport || jsonb_build_object('item_type', 'transport', 'transport_role', 'normal_pair');
    operation_start := to_index;
    from_state := app_private.timeline_schedule_time_state(visits -> from_index);
    to_state := app_private.timeline_schedule_time_state(visits -> to_index);
    if from_state = 'timed' and to_state = 'timed' then
      if coalesce((visits -> to_index ->> 'is_fixed')::boolean, false) then
        previous_end := app_private.timeline_schedule_minutes(visits -> from_index ->> 'end_time', true);
        start_minutes := app_private.timeline_schedule_minutes(visits -> to_index ->> 'start_time', false);
        if previous_end + transport_minutes > start_minutes then
          return jsonb_build_object('ok', false, 'validationError', 'fixed_boundary_conflict', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
        end if;
      else
        schedule_start := to_index;
      end if;
    end if;
  elsif operation_type = 'delete_transport' then
    transport_id := coalesce(operation_intent ->> 'transportId', operation_intent ->> 'targetItemId');
    select value into transport from jsonb_array_elements(transports)
    where value ->> 'id' = transport_id and value ->> 'transport_role' = 'normal_pair'
    limit 1;
    if transport is null then
      return jsonb_build_object('ok', false, 'validationError', 'invalid_transport', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
    end if;
    select ordinality::integer - 1 into from_index from jsonb_array_elements(visits) with ordinality where value ->> 'id' = transport ->> 'from_item_id';
    select ordinality::integer - 1 into to_index from jsonb_array_elements(visits) with ordinality where value ->> 'id' = transport ->> 'to_item_id';
    if from_index is null or to_index is null then
      return jsonb_build_object('ok', false, 'validationError', 'invalid_transport', 'affectedItemIds', '[]'::jsonb, 'requiresConfirmation', false);
    end if;
    removed_ids := removed_ids || jsonb_build_array(transport_id);
    explicit_removed_id := transport_id;
    operation_start := to_index;
    if app_private.timeline_schedule_time_state(visits -> from_index) = 'timed'
      and app_private.timeline_schedule_time_state(visits -> to_index) = 'timed'
      and not coalesce((visits -> to_index ->> 'is_fixed')::boolean, false)
    then
      schedule_start := to_index;
    end if;
  end if;

  -- Find the next fixed boundary and pack the affected Timed suffix.
  if schedule_start >= 0 and schedule_start < visit_count then
    fixed_index := -1;
    for scan_index in schedule_start..visit_count - 1 loop
      item := visits -> scan_index;
      if coalesce((item ->> 'is_fixed')::boolean, false) and app_private.timeline_schedule_time_state(item) = 'timed' then
        fixed_index := scan_index;
        exit;
      end if;
    end loop;
    segment_end := case when fixed_index >= 0 then fixed_index else visit_count end;
    boundary_minutes := case
      when fixed_index >= 0 then app_private.timeline_schedule_minutes(visits -> fixed_index ->> 'start_time', false)
      else 1440
    end;
    previous_index := -1;
    if schedule_start > 0 then
      for scan_index in reverse schedule_start - 1..0 loop
        if app_private.timeline_schedule_time_state(visits -> scan_index) = 'timed' then
          previous_index := scan_index;
          exit;
        end if;
      end loop;
    end if;
    previous_end := case when previous_index >= 0 then app_private.timeline_schedule_minutes(visits -> previous_index ->> 'end_time', true) else null end;
    first_timed := true;
    if segment_end > schedule_start then
      for index_value in schedule_start..segment_end - 1 loop
        item := visits -> index_value;
        state := app_private.timeline_schedule_time_state(item);
        if state <> 'timed' then continue; end if;
        start_minutes := app_private.timeline_schedule_minutes(item ->> 'start_time', false);
        end_minutes := app_private.timeline_schedule_minutes(item ->> 'end_time', true);
        duration_minutes := end_minutes - start_minutes;
        if first_timed and anchor_start is not null then
          next_start := anchor_start;
        elsif previous_end is not null then
          transport_minutes := 0;
          if previous_index >= 0 and index_value = previous_index + 1 then
            for transport in select value from jsonb_array_elements(transports) loop
              if transport ->> 'transport_role' = 'normal_pair'
                and transport ->> 'from_item_id' = visits -> previous_index ->> 'id'
                and transport ->> 'to_item_id' = item ->> 'id'
                and not (removed_ids @> jsonb_build_array(transport ->> 'id'))
              then
                transport_minutes := coalesce((transport ->> 'transport_duration_minutes')::integer, 0);
                exit;
              end if;
            end loop;
          end if;
          next_start := previous_end + transport_minutes;
        else
          next_start := start_minutes;
        end if;
        next_end := next_start + duration_minutes;
        fixed_boundary_transport_minutes := 0;
        if fixed_index >= 0 and index_value = fixed_index - 1 then
          for transport in select value from jsonb_array_elements(transports) loop
            if transport ->> 'transport_role' = 'normal_pair'
              and transport ->> 'from_item_id' = item ->> 'id'
              and transport ->> 'to_item_id' = visits -> fixed_index ->> 'id'
              and not (removed_ids @> jsonb_build_array(transport ->> 'id'))
            then
              fixed_boundary_transport_minutes := coalesce((transport ->> 'transport_duration_minutes')::integer, 0);
              exit;
            end if;
          end loop;
        end if;
        if next_end + fixed_boundary_transport_minutes > boundary_minutes then
          for scan_index in index_value..segment_end - 1 loop
            other := visits -> scan_index;
            if app_private.timeline_schedule_time_state(other) = 'timed'
              and not coalesce((other ->> 'is_fixed')::boolean, false)
            then
              other := jsonb_set(jsonb_set(other, '{start_time}', 'null'::jsonb), '{end_time}', 'null'::jsonb);
              visits := jsonb_set(visits, array[scan_index::text], other);
              updates := app_private.timeline_schedule_put_update(updates, jsonb_build_object('id', other ->> 'id', 'start_time', null, 'end_time', null));
              untimed_ids := untimed_ids || jsonb_build_array(other ->> 'id');
              automatic_untimed_ids := automatic_untimed_ids || jsonb_build_array(other ->> 'id');
            end if;
          end loop;
          overflow_reason := case when fixed_index >= 0 then 'fixed' else 'day_boundary' end;
          stopped_at_fixed_item_id := case when fixed_index >= 0 then visits -> fixed_index ->> 'id' else null end;
          exit;
        end if;
        changed := (left(coalesce(item ->> 'start_time', ''), 5) is distinct from app_private.timeline_schedule_time_text(next_start))
          or (left(coalesce(item ->> 'end_time', ''), 5) is distinct from app_private.timeline_schedule_time_text(next_end));
        item := jsonb_set(
          jsonb_set(item, '{start_time}', to_jsonb(app_private.timeline_schedule_time_text(next_start))),
          '{end_time}', to_jsonb(app_private.timeline_schedule_time_text(next_end))
        );
        visits := jsonb_set(visits, array[index_value::text], item);
        if changed then
          updates := app_private.timeline_schedule_put_update(
            updates,
            jsonb_build_object('id', item ->> 'id', 'start_time', app_private.timeline_schedule_time_text(next_start), 'end_time', app_private.timeline_schedule_time_text(next_end))
          );
        end if;
        previous_end := next_end;
        previous_index := index_value;
        first_timed := false;
      end loop;
    end if;
    if fixed_index >= 0 and stopped_at_fixed_item_id is null then
      stopped_at_fixed_item_id := visits -> fixed_index ->> 'id';
    end if;
  end if;

  -- Normalize Untimed sort orders to preserve the final visual sequence.
  timed_before := 0;
  if visit_count > 0 then
    for index_value in 0..visit_count - 1 loop
      item := visits -> index_value;
      if app_private.timeline_schedule_time_state(item) = 'timed' then
        timed_before := timed_before + 1;
        continue;
      end if;
      select count(*)::integer into untimed_in_slot
      from jsonb_array_elements(visits) with ordinality entry(value, ordinality)
      where app_private.timeline_schedule_time_state(value) <> 'timed'
        and (
          select count(*) from jsonb_array_elements(visits) with ordinality before_entry(value, ordinality)
          where before_entry.ordinality < entry.ordinality
            and app_private.timeline_schedule_time_state(before_entry.value) = 'timed'
        ) = timed_before;
      select count(*)::integer into untimed_rank
      from jsonb_array_elements(visits) with ordinality entry(value, ordinality)
      where entry.ordinality <= index_value + 1
        and app_private.timeline_schedule_time_state(value) <> 'timed'
        and (
          select count(*) from jsonb_array_elements(visits) with ordinality before_entry(value, ordinality)
          where before_entry.ordinality < entry.ordinality
            and app_private.timeline_schedule_time_state(before_entry.value) = 'timed'
        ) = timed_before;
      rank_step := floor(1000000.0 / (untimed_in_slot + 1))::integer;
      sort_order := -2000000000 + timed_before * 1000000 + rank_step * untimed_rank;
      if coalesce((item ->> 'sort_order')::integer, 0) <> sort_order then
        item := jsonb_set(item, '{sort_order}', to_jsonb(sort_order));
        visits := jsonb_set(visits, array[index_value::text], item);
        updates := app_private.timeline_schedule_put_update(updates, jsonb_build_object('id', item ->> 'id', 'sort_order', sort_order));
      end if;
    end loop;
  end if;

  -- Classify preserved-but-suspended transports and refresh pair snapshots.
  for transport in select value from jsonb_array_elements(transports) loop
    if transport ->> 'transport_role' <> 'normal_pair'
      or removed_ids @> jsonb_build_array(transport ->> 'id')
    then
      continue;
    end if;
    from_index := null;
    to_index := null;
    select ordinality::integer - 1 into from_index from jsonb_array_elements(visits) with ordinality where value ->> 'id' = transport ->> 'from_item_id';
    select ordinality::integer - 1 into to_index from jsonb_array_elements(visits) with ordinality where value ->> 'id' = transport ->> 'to_item_id';
    if from_index is null or to_index is null then continue; end if;
    from_state := app_private.timeline_schedule_time_state(visits -> from_index);
    to_state := app_private.timeline_schedule_time_state(visits -> to_index);
    valid_adjacency := to_index = from_index + 1;
    blocked_by_untimed := false;
    if to_index > from_index + 1 then
      for scan_index in from_index + 1..to_index - 1 loop
        if app_private.timeline_schedule_time_state(visits -> scan_index) = 'untimed' then
          blocked_by_untimed := true;
          exit;
        end if;
      end loop;
    end if;
    if not (valid_adjacency and from_state = 'timed' and to_state = 'timed')
      and (blocked_by_untimed or from_state <> 'timed' or to_state <> 'timed')
    then
      suspended_ids := suspended_ids || jsonb_build_array(transport ->> 'id');
    end if;
    if valid_adjacency then
      update_item := jsonb_build_object(
        'id', transport ->> 'id',
        'from_snapshot_start_time', visits -> from_index ->> 'start_time',
        'from_snapshot_end_time', visits -> from_index ->> 'end_time',
        'from_snapshot_destination', coalesce(
          nullif(visits -> from_index ->> 'location_name', ''),
          nullif(visits -> from_index ->> 'location', ''),
          nullif(visits -> from_index ->> 'title', '')
        ),
        'to_snapshot_start_time', visits -> to_index ->> 'start_time',
        'to_snapshot_end_time', visits -> to_index ->> 'end_time',
        'to_snapshot_destination', coalesce(
          nullif(visits -> to_index ->> 'location_name', ''),
          nullif(visits -> to_index ->> 'location', ''),
          nullif(visits -> to_index ->> 'title', '')
        )
      );
      if (transport ->> 'from_snapshot_start_time') is distinct from (update_item ->> 'from_snapshot_start_time')
        or (transport ->> 'from_snapshot_end_time') is distinct from (update_item ->> 'from_snapshot_end_time')
        or (transport ->> 'from_snapshot_destination') is distinct from (update_item ->> 'from_snapshot_destination')
        or (transport ->> 'to_snapshot_start_time') is distinct from (update_item ->> 'to_snapshot_start_time')
        or (transport ->> 'to_snapshot_end_time') is distinct from (update_item ->> 'to_snapshot_end_time')
        or (transport ->> 'to_snapshot_destination') is distinct from (update_item ->> 'to_snapshot_destination')
      then
        updates := app_private.timeline_schedule_put_update(updates, update_item);
      end if;
    end if;
  end loop;

  select coalesce(jsonb_agg(value order by key), '[]'::jsonb) into updated_items from jsonb_each(updates);
  ordered_visit_ids := (
    select coalesce(jsonb_agg(value ->> 'id' order by ordinality), '[]'::jsonb)
    from jsonb_array_elements(visits) with ordinality
  );
  for update_item in select value from jsonb_array_elements(updated_items) loop
    affected_ids := affected_ids || jsonb_build_array(update_item ->> 'id');
  end loop;
  for transport_id in select value #>> '{}' from jsonb_array_elements(removed_ids) loop
    if not (affected_ids @> jsonb_build_array(transport_id)) then affected_ids := affected_ids || jsonb_build_array(transport_id); end if;
    if transport_id is distinct from explicit_removed_id then removed_is_major := true; end if;
  end loop;
  for transport_id in select value #>> '{}' from jsonb_array_elements(suspended_ids) loop
    if not (affected_ids @> jsonb_build_array(transport_id)) then affected_ids := affected_ids || jsonb_build_array(transport_id); end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'updatedItems', updated_items,
    'affectedItemIds', affected_ids,
    'automaticUntimedItemIds', automatic_untimed_ids,
    'untimedItemIds', untimed_ids,
    'removedTransportIds', removed_ids,
    'suspendedTransportIds', suspended_ids,
    'stoppedAtFixedItemId', stopped_at_fixed_item_id,
    'overflowReason', overflow_reason,
    'operationStartIndex', operation_start,
    'orderedVisitIds', ordered_visit_ids,
    'requiresConfirmation', jsonb_array_length(automatic_untimed_ids) > 0 or removed_is_major,
    'upsertedTransport', upserted_transport
  );
end;
$$;

create or replace function app_private.timeline_schedule_time_text(value integer)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when value is null or value < 0 or value > 1440 then null
    when value = 1440 then '24:00'
    else lpad((value / 60)::text, 2, '0') || ':' || lpad((value % 60)::text, 2, '0')
  end;
$$;

create or replace function app_private.timeline_schedule_is_transport(item jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(item ->> 'item_type', '') = 'transport';
$$;

create or replace function app_private.timeline_schedule_time_state(item jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog, app_private
as $$
declare
  has_start boolean := nullif(item ->> 'start_time', '') is not null;
  has_end boolean := nullif(item ->> 'end_time', '') is not null;
  start_minutes integer;
  end_minutes integer;
begin
  if has_start <> has_end then return 'partial'; end if;
  if not has_start then return 'untimed'; end if;
  start_minutes := app_private.timeline_schedule_minutes(item ->> 'start_time', false);
  end_minutes := app_private.timeline_schedule_minutes(item ->> 'end_time', true);
  if start_minutes is null or end_minutes is null or end_minutes <= start_minutes then
    return 'invalid';
  end if;
  return 'timed';
end;
$$;

create or replace function app_private.timeline_schedule_put_update(updates jsonb, item jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_set(
    coalesce(updates, '{}'::jsonb),
    array[item ->> 'id'],
    coalesce(updates -> (item ->> 'id'), '{}'::jsonb) || item,
    true
  );
$$;

create or replace function app_private.timeline_day_visit_ids(
  target_trip_id uuid,
  target_day_index integer
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, app_private, pg_catalog
as $$
declare
  result_ids uuid[];
  transport_row public.itinerary_items%rowtype;
  from_position integer;
  to_position integer;
  swap_id uuid;
  from_is_untimed boolean;
  to_is_untimed boolean;
begin
  with visit_counts as (
    select count(*) filter (where item.start_time is not null and item.end_time is not null)::integer as timed_count
    from public.itinerary_items item
    where item.trip_id = target_trip_id
      and item.day_index = target_day_index
      and item.item_type <> 'transport'
  ), positioned as (
    select
      item.id,
      item.created_at,
      item.start_time,
      item.sort_order,
      case
        when item.start_time is not null and item.end_time is not null then
          row_number() over (
            partition by (item.start_time is not null and item.end_time is not null)
            order by item.start_time, item.sort_order, item.id
          )::integer - 1
        when item.sort_order >= -2000000000 and item.sort_order < -100000000
          and mod(item.sort_order + 2000000000, 1000000) between 1 and 999999
          then least((item.sort_order + 2000000000) / 1000000, visit_counts.timed_count)
        else visit_counts.timed_count
      end as visual_slot,
      case when item.start_time is null or item.end_time is null then 0 else 1 end as kind_order,
      case
        when item.start_time is null or item.end_time is null then
          case
            when item.sort_order >= -2000000000 and item.sort_order < -100000000
              then mod(item.sort_order + 2000000000, 1000000)
            else 500000 + greatest(-100000, least(100000, item.sort_order))
          end
        else 0
      end as visual_rank
    from public.itinerary_items item
    cross join visit_counts
    where item.trip_id = target_trip_id
      and item.day_index = target_day_index
      and item.item_type <> 'transport'
  )
  select coalesce(
    array_agg(positioned.id order by positioned.visual_slot, positioned.kind_order, positioned.visual_rank, positioned.created_at, positioned.id),
    array[]::uuid[]
  )
  into result_ids
  from positioned;

  -- Preserve the client visual adapter's suspended-pair orientation when one
  -- endpoint became Untimed after the pair was created.
  for transport_row in
    select item.*
    from public.itinerary_items item
    where item.trip_id = target_trip_id
      and item.day_index = target_day_index
      and item.item_type = 'transport'
      and item.transport_role = 'normal_pair'
      and item.from_item_id is not null
      and item.to_item_id is not null
    order by item.id
  loop
    from_position := array_position(result_ids, transport_row.from_item_id);
    to_position := array_position(result_ids, transport_row.to_item_id);
    if from_position = to_position + 1 then
      select (item.start_time is null or item.end_time is null)
        into from_is_untimed
      from public.itinerary_items item
      where item.id = transport_row.from_item_id;
      select (item.start_time is null or item.end_time is null)
        into to_is_untimed
      from public.itinerary_items item
      where item.id = transport_row.to_item_id;
      if coalesce(from_is_untimed, false) or coalesce(to_is_untimed, false) then
        swap_id := result_ids[from_position];
        result_ids[from_position] := result_ids[to_position];
        result_ids[to_position] := swap_id;
      end if;
    end if;
  end loop;
  return result_ids;
end;
$$;

create or replace function app_private.timeline_day_schedule_snapshot(
  target_trip_id uuid,
  target_day_index integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app_private, pg_catalog
as $$
declare
  visit_ids uuid[];
  visit_items jsonb;
  transport_items jsonb;
begin
  visit_ids := app_private.timeline_day_visit_ids(target_trip_id, target_day_index);
  select coalesce(jsonb_agg(to_jsonb(item) order by ordered.ordinality), '[]'::jsonb)
    into visit_items
  from unnest(visit_ids) with ordinality as ordered(item_id, ordinality)
  join public.itinerary_items item on item.id = ordered.item_id;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.id), '[]'::jsonb)
    into transport_items
  from public.itinerary_items item
  where item.trip_id = target_trip_id
    and item.day_index = target_day_index
    and item.item_type = 'transport';

  return jsonb_build_object(
    'dayIndex', target_day_index,
    'items', visit_items || transport_items
  );
end;
$$;
