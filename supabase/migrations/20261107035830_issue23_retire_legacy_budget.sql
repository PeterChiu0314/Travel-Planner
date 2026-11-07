begin;
set local lock_timeout = '5s';

-- Issue #23: retire the Legacy Budget/Actual model. The expense graph and
-- other workspaces are preserved. This one-time migration targets ledger 77.
-- Body fingerprints fence the four shared routines being replaced; RESTRICT
-- and exact names fence removals against unexpected catalog dependencies.
do $preflight$
declare target record;
begin
  if to_regclass('public.trip_budget_baselines') is null
     or to_regclass('expense_stage_b.expense_itinerary_links') is null
     or to_regclass('expense_stage_b.receipts') is null
     or to_regprocedure('public.apply_timeline_schedule_operation_link_safe(uuid,integer,uuid,jsonb,jsonb,uuid[],jsonb,jsonb,jsonb,uuid[],uuid[])') is null
     or not exists (
       select 1 from pg_proc
       where oid = 'app_private.remove_trip_expense_graph()'::regprocedure
         and position('signature->>''trip''' in prosrc) > 0
     ) then
    raise exception 'Issue #23 requires the native link, rates and receipt cleanup migrations';
  end if;
  for target in select * from (values
    ('expense_stage_b.rate_lease(uuid,uuid,uuid,text,bigint,bigint)', '2a94ad93625de06a7faa67a78abfc06e'),
    ('expense_stage_b.update_rates(uuid,uuid,uuid,bigint,bigint,jsonb,uuid)', 'be90957127a386b98b6cfaa3d92b85da'),
    ('app_private.apply_timeline_schedule_operation(uuid,integer,uuid,jsonb,jsonb,uuid[],jsonb,jsonb,jsonb,uuid[],uuid[])', '8fb1a945b34b7ca7e9d8759e69ed404e'),
    ('app_private.apply_trip_date_change(uuid,date,date,boolean)', '1bb4eeaf8747c68ebc3546c9c01b68f5')
  ) as signatures(signature, body_hash) loop
    if (select md5(replace(prosrc, chr(13), ''))
        from pg_proc where oid = to_regprocedure(target.signature)) is distinct from target.body_hash then
      raise exception 'Issue #23 unexpected routine source: %', target.signature;
    end if;
  end loop;
  if not exists (
    select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid='expense_stage_b.update_rates(uuid,uuid,uuid,bigint,bigint,jsonb,uuid)'::regprocedure
      and p.prosecdef
      and r.rolname not in ('authenticated','anon','authenticator','service_role','budget_receipt_worker')
  ) then raise exception 'Issue #23 unexpected native rates authority'; end if;
  -- Paths outside the retired namespace would no longer be covered by the
  -- persistent restrictive Storage policy. Stop if any such file still exists.
  if exists (
    select 1 from storage.objects o
    join (
      select file_url as path from public.attachments where target_type in ('budget_item','actual_expense')
      union select object_path from app_private.budget_receipt_intents
      union select object_path from app_private.budget_receipt_cleanup
    ) retired on retired.path = o.name
    where o.bucket_id = 'trip-attachments'
      and split_part(o.name, '/', 4) not in ('budget_item','actual_expense')
  ) then raise exception 'Issue #23 unexpected live legacy receipt path'; end if;
end;
$preflight$;

-- The schedule wrapper already moves native links in the same transaction.
-- The date-change preview now counts the same links that shortening unlinks.
-- Rates keep their Taipei planning gate, pricing lock, lease and replay.
CREATE OR REPLACE FUNCTION app_private.apply_timeline_schedule_operation(target_trip_id uuid, target_day_index integer, target_item_id uuid, target_payload jsonb, operation_intent jsonb, expected_visit_ids uuid[], item_updated_at_baselines jsonb, confirmed_major_effect jsonb DEFAULT NULL::jsonb, preview_result jsonb DEFAULT NULL::jsonb, slot_item_ids uuid[] DEFAULT NULL::uuid[], package_source_item_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'pg_catalog'
AS $function$
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
      select coalesce(array_agg(item order by requested.ordinality), array[]::public.itinerary_items[])
        into package_rows
      from unnest(package_source_item_ids) with ordinality requested(item_id, ordinality)
      join public.itinerary_items item on item.id = requested.item_id;
      if cardinality(package_rows) <> cardinality(package_source_item_ids) then raise exception 'stale_manifest'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION app_private.apply_trip_date_change(target_trip_id uuid, new_start_date date, new_end_date date, confirm_timeline_removal boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private'
AS $function$
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
    from expense_stage_b.expense_itinerary_links link
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
$function$;

CREATE OR REPLACE FUNCTION expense_stage_b.rate_lease(tid uuid, session_id uuid, token uuid, action text, base bigint, expected_epoch bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s expense_stage_b.rate_leases;begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 if session_id is null or token is null or action is null or action not in('acquire','release') then raise exception 'Invalid lease' using errcode='22023';end if;
 if action='acquire' then
  if not app_private.can_edit_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||tid::text,0));
  perform 1 from public.trips where id=tid for update;
  if not exists(select 1 from public.trips t where t.id=tid and t.start_date is not null and t.start_date::timestamp at time zone 'Asia/Taipei'>clock_timestamp() and t.status<>'settled' and (t.end_date is null or t.end_date>=(clock_timestamp() at time zone 'Asia/Taipei')::date)) then raise exception '只有行前規劃可更新旅程預算匯率。' using errcode='22023';end if;
  insert into expense_stage_b.rate_leases(trip_id) values(tid) on conflict do nothing;
 end if;
 select * into s from expense_stage_b.rate_leases where trip_id=tid for update;
 if action='release' then
  if s.actor=auth.uid() and s.sid=session_id and s.token_hash=sha256(convert_to(token::text,'UTF8')) and s.epoch=expected_epoch then
   update expense_stage_b.rate_leases set actor=null,sid=null,token_hash=null,expires_at=null where trip_id=tid;
  end if;return jsonb_build_object('granted',true);
 end if;
 if base is distinct from s.revision then raise exception 'Rates changed' using errcode='PT409';end if;
 if s.expires_at>clock_timestamp() and app_private.can_edit_trip(tid,s.actor) and (s.actor<>auth.uid() or s.sid<>session_id or s.token_hash<>sha256(convert_to(token::text,'UTF8'))) then return jsonb_build_object('granted',false);end if;
 if exists(select 1 from expense_stage_b.groups g join expense_stage_b.expense_items e on e.id=g.expense_id where e.trip_id=tid and e.deleted_at is null and e.payment_state<>'paid' and e.budget->>'currency'<>'TWD' and g.group_key='budget' and g.expires_at>clock_timestamp() and app_private.can_edit_trip(tid,g.actor)) then return jsonb_build_object('granted',false);end if;
 update expense_stage_b.rate_leases set actor=auth.uid(),sid=session_id,token_hash=sha256(convert_to(token::text,'UTF8')),epoch=epoch+1,expires_at=clock_timestamp()+interval '1 minute' where trip_id=tid returning * into s;
 return jsonb_build_object('granted',true,'epoch',s.epoch,'revision',s.revision,'expires_at',s.expires_at);
end $function$;

CREATE OR REPLACE FUNCTION expense_stage_b.update_rates(tid uuid, session_id uuid, token uuid, expected_epoch bigint, base bigint, value jsonb, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s expense_stage_b.rate_leases;r expense_stage_b.receipts;signature jsonb;quote jsonb;previous jsonb;receipt jsonb;entry record;rate numeric;changed boolean;begin
 if auth.uid() is null or not app_private.can_edit_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if session_id is null or request_id is null or value is null then raise exception 'Invalid request' using errcode='22023';end if;
 signature:=jsonb_build_object('trip',tid,'session',session_id,'base',base,'value',value);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into r from expense_stage_b.receipts where actor=auth.uid() and receipts.request_id=update_rates.request_id;
 if found then if r.signature<>signature then raise exception 'Request mismatch' using errcode='22023';end if;return r.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||tid::text,0));
 select * into s from expense_stage_b.rate_leases where trip_id=tid for update;
 if not found or s.actor is distinct from auth.uid() or s.sid is distinct from session_id or token is null or s.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or s.epoch is distinct from expected_epoch or s.expires_at is null or s.expires_at<=clock_timestamp() then raise exception 'Lease required' using errcode='55P03';end if;
 select budget_exchange_rates into previous from public.trips where id=tid for update;
 if not exists(select 1 from public.trips t where t.id=tid and t.start_date is not null and t.start_date::timestamp at time zone 'Asia/Taipei'>clock_timestamp() and t.status<>'settled' and (t.end_date is null or t.end_date>=(clock_timestamp() at time zone 'Asia/Taipei')::date)) then raise exception '只有行前規劃可更新旅程預算匯率。' using errcode='22023';end if;
 if (value->>'initialize')::boolean is true and jsonb_typeof(previous->'rates')='object' and previous->'rates' ?& array['JPY','USD','EUR','KRW','HKD'] then raise exception 'Rates already initialized' using errcode='PT409';end if;
 if s.revision is distinct from base or value->'previous' is distinct from previous or value->'targets' is distinct from expense_stage_b.rate_targets(tid) then raise exception 'Rates/pricing changed' using errcode='PT409';end if;
 if exists(select 1 from expense_stage_b.groups g join expense_stage_b.expense_items e on e.id=g.expense_id where e.trip_id=tid and e.deleted_at is null and e.payment_state<>'paid' and e.budget->>'currency'<>'TWD' and g.group_key='budget' and g.expires_at>clock_timestamp() and app_private.can_edit_trip(tid,g.actor)) then raise exception 'Pricing busy' using errcode='55P03';end if;
 quote:=value->'quote';
 if jsonb_typeof(quote->'rates') is distinct from 'object' or quote->>'source' is distinct from 'ExchangeRate-API' or (quote->>'quoted_at')::timestamptz is null or (quote->>'quoted_at')::timestamptz>clock_timestamp()+interval '1 day' then raise exception 'Invalid public quote' using errcode='22023';end if;
 for entry in select fx.key,fx.value from jsonb_each(quote->'rates') fx loop
  rate:=entry.value::text::numeric;
  if entry.key!~'^[A-Z]{3}$' or rate<=0 or rate>1000000 or rate<>round(rate,6) then raise exception 'Invalid rate' using errcode='22023';end if;
 end loop;
 if not (quote->'rates' ?& array['JPY','USD','EUR','KRW','HKD']) then raise exception 'Missing rates' using errcode='22023';end if;
 if exists(select 1 from expense_stage_b.expense_items e where e.trip_id=tid and e.deleted_at is null and e.payment_state<>'paid' and e.budget is not null and e.budget->>'currency'<>'TWD' and not(quote->'rates' ? (e.budget->>'currency'))) then raise exception 'Missing item currency' using errcode='22023';end if;
 changed:=(previous->'rates') is distinct from (quote->'rates');
 update public.trips set budget_exchange_rates=quote where id=tid;
 if changed then
  with repriced as (
   update expense_stage_b.expense_items e set budget=e.budget||jsonb_build_object('exchange_rate',(quote->'rates'->>(e.budget->>'currency'))::numeric,'twd_amount',round((e.budget->>'amount')::numeric*(quote->'rates'->>(e.budget->>'currency'))::numeric))
   where e.trip_id=tid and e.deleted_at is null and e.payment_state<>'paid' and e.budget is not null and e.budget->>'currency'<>'TWD' returning e.id
  ) insert into expense_stage_b.groups(expense_id,group_key,revision) select id,'budget',1 from repriced on conflict(expense_id,group_key) do update set revision=groups.revision+1;
 end if;
 update expense_stage_b.rate_leases set revision=revision+1 where trip_id=tid returning * into s;
 receipt:=jsonb_build_object('committed',true,'request_id',request_id,'trip_id',tid,'revision',s.revision,'changed',changed,'quote',quote);
 insert into expense_stage_b.receipts values(auth.uid(),request_id,signature,receipt);
 return receipt;
end $function$;

-- Direct trip updates must not change rates without repricing. This trigger
-- runs as the writer; the validated native RPC runs as its trusted owner.
create function app_private.guard_native_trip_rates() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.budget_exchange_rates is distinct from old.budget_exchange_rates
     and current_user is distinct from (
       select pg_get_userbyid(proowner) from pg_proc
       where oid = 'expense_stage_b.update_rates(uuid,uuid,uuid,bigint,bigint,jsonb,uuid)'::regprocedure
     ) then
    raise exception 'Use native expense rates protocol' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_native_trip_rates() from public, anon, authenticated, service_role;
create trigger guard_native_trip_rates before update of budget_exchange_rates on public.trips
for each row execute function app_private.guard_native_trip_rates();

-- A DELETE locks the trip tuple before its row trigger runs. Admit the
-- request in the same order as native writers, before taking that row lock.
-- The DELETE itself still runs under the caller's existing RLS policy.
create function public.delete_trip_with_expenses(p_trip_id uuid) returns uuid
language plpgsql security invoker set search_path = '' set lock_timeout = '3s' as $$
declare deleted_id uuid;
begin
  if auth.uid() is null or not app_private.is_trip_owner(p_trip_id, auth.uid()) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('expense-trip:' || p_trip_id::text, 0)) then
    raise exception 'Trip transaction in progress' using errcode = '55P03';
  end if;
  perform 1 from public.trips where id = p_trip_id for update nowait;
  delete from public.trips where id = p_trip_id returning id into deleted_id;
  if deleted_id is null then raise exception 'permission_denied' using errcode = '42501'; end if;
  return deleted_id;
end;
$$;
revoke all on function public.delete_trip_with_expenses(uuid) from public, anon, service_role;
grant execute on function public.delete_trip_with_expenses(uuid) to authenticated;

-- Legacy triggers and policy edges on shared relations; native link/delete,
-- membership/luggage, transport, and ordinary attachment policies stay live.
drop trigger a_budget_parent_delete on public.accommodations restrict;
drop trigger a_budget_protocol_transition on public.accommodations restrict;
drop trigger a_budget_protocol_transition on public.attachments restrict;
drop trigger aa_removed_budget_receipts on public.attachments restrict;
drop trigger budget_metadata_receipts_guard on public.attachments restrict;
drop trigger budget_metadata_undo_receipts on public.attachments restrict;
drop trigger budget_receipts_lease_guard on public.attachments restrict;
drop trigger lock_budget_payment_receipts on public.attachments restrict;
drop trigger zz_receipt_metadata on public.attachments restrict;
drop trigger zzzzz_receipt_attachment on public.attachments restrict;
drop trigger a_budget_parent_delete on auth.users restrict;
drop trigger a_budget_protocol_transition on auth.users restrict;
drop trigger a_budget_parent_delete on public.itinerary_items restrict;
drop trigger a_budget_protocol_transition on public.itinerary_items restrict;
drop trigger budget_baseline_itinerary on public.itinerary_items restrict;
drop trigger a_budget_protocol_transition on public.trip_members restrict;
drop trigger budget_baseline_members on public.trip_members restrict;
drop trigger budget_metadata_member_signal on public.trip_members restrict;
drop trigger budget_metadata_undo_members on public.trip_members restrict;
drop trigger zzz_pricing_member on public.trip_members restrict;
drop trigger a_budget_parent_delete on public.trips restrict;
drop trigger a_budget_protocol_transition on public.trips restrict;
drop trigger budget_baseline_trip on public.trips restrict;
drop trigger budget_metadata_undo_trip on public.trips restrict;
drop trigger zz_finance_boundary on public.trips restrict;
drop trigger zzz_pricing_trip on public.trips restrict;
-- Hosted dormant deployments also installed a legacy trip admission helper
-- and the legacy receipt issuer cutover journal.
drop trigger if exists zzz_budget_trip_delete_cleanup on public.trips restrict;
drop policy "removed_receipts_metadata_read" on public.attachments restrict;
drop policy "Receipt worker bucket" on storage.buckets restrict;
drop policy "Receipt delete boundary" on storage.objects restrict;
drop policy "Receipt overwrite boundary" on storage.objects restrict;
drop policy "Receipt read boundary" on storage.objects restrict;
drop policy "Receipt upload boundary" on storage.objects restrict;
drop policy "Receipt worker scoped delete" on storage.objects restrict;
drop policy "Receipt worker scoped read" on storage.objects restrict;

-- Drop only the old accommodation FK/column and retired receipt metadata.
-- Binary files are Storage objects; do not delete Storage catalog rows here.
-- removed_receipts_storage continues denying access to retired receipt paths.
alter table public.accommodations drop constraint accommodations_budget_item_id_fkey restrict,
  drop column budget_item_id restrict;
delete from public.attachments where target_type in ('budget_item', 'actual_expense');
alter table public.attachments drop constraint attachments_target_type_check restrict,
  add constraint attachments_target_type_check
  check (target_type in ('accommodation', 'todo', 'guide', 'itinerary'));

-- Obsolete pre-unified schedule RPCs operated on the old budget links.
drop function
  public.reorder_itinerary_destination_packages(target_trip_id uuid, target_day_index integer, slot_item_ids uuid[], package_source_item_ids uuid[], item_updated_at_baselines jsonb),
  public.reorder_itinerary_fixed_anchor_continuation(target_trip_id uuid, target_day_index integer, slot_item_ids uuid[], package_source_item_ids uuid[], ordered_timed_item_ids uuid[], ordered_visit_item_ids uuid[], untimed_sort_order_updates jsonb, item_updated_at_baselines jsonb),
  public.reorder_itinerary_timed_auto_continuation(target_trip_id uuid, target_day_index integer, slot_item_ids uuid[], package_source_item_ids uuid[], item_updated_at_baselines jsonb),
  public.swap_itinerary_destination_packages(source_item_id uuid, target_item_id uuid, source_updated_at timestamp with time zone, target_updated_at timestamp with time zone),
  app_private.reorder_itinerary_destination_packages(target_trip_id uuid, target_day_index integer, slot_item_ids uuid[], package_source_item_ids uuid[], item_updated_at_baselines jsonb),
  app_private.reorder_itinerary_fixed_anchor_continuation(target_trip_id uuid, target_day_index integer, slot_item_ids uuid[], package_source_item_ids uuid[], ordered_timed_item_ids uuid[], ordered_visit_item_ids uuid[], untimed_sort_order_updates jsonb, item_updated_at_baselines jsonb),
  app_private.reorder_itinerary_timed_auto_continuation(target_trip_id uuid, target_day_index integer, slot_item_ids uuid[], package_source_item_ids uuid[], item_updated_at_baselines jsonb),
  app_private.swap_itinerary_destination_packages(source_item_id uuid, target_item_id uuid, source_updated_at timestamp with time zone, target_updated_at timestamp with time zone)
restrict;

-- Explicit legacy public RPC manifest.
drop function
  public.abandon_budget_receipt(p_trip_id uuid, p_id uuid, p_session_id uuid, p_token uuid, p_epoch bigint, p_base_revision bigint, p_versions jsonb, p_request_id uuid),
  public.budget_edit_lease(p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_updated_at timestamp with time zone),
  public.budget_lifecycle_lease(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_versions jsonb, p_intent jsonb),
  public.budget_metadata_group_lease(p_trip_id uuid, p_kind text, p_id uuid, p_group text, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_activity_seq bigint, p_dirty boolean),
  public.budget_metadata_group_lease_v2(p_trip_id uuid, p_kind text, p_id uuid, p_group text, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_activity_seq bigint, p_dirty boolean, p_versions jsonb),
  public.budget_payment_lease(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_versions jsonb),
  public.budget_payment_lease_v2(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_versions jsonb, p_intent text),
  public.budget_rates_lease(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_versions jsonb, p_intent jsonb),
  public.budget_receipts_lease(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_versions jsonb, p_intent jsonb),
  public.budget_source_lease(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_versions jsonb, p_intent jsonb),
  public.budget_workspace_undo_lease(p_trip_id uuid, p_session_id uuid, p_operation_id uuid, p_token uuid, p_action text, p_epoch bigint),
  public.claim_budget_receipt_cleanup(p_trip_id uuid, p_id uuid, p_session_id uuid, p_token uuid, p_epoch bigint, p_base_revision bigint, p_versions jsonb, p_request_id uuid),
  public.claim_budget_receipt_verification(),
  public.claim_budget_receipt_worker(),
  public.clear_budget_metadata_undo(p_trip_id uuid, p_session_id uuid),
  public.create_budget_workspace_placeholder(p_trip_id uuid, p_kind text, p_session_id uuid, p_request_id uuid),
  public.delete_budget_workspace_record(p_trip_id uuid, p_kind text, p_id uuid, p_base_updated_at timestamp with time zone),
  public.delete_budget_workspace_record_v2(p_trip_id uuid, p_kind text, p_id uuid, p_base_updated_at timestamp with time zone, p_edit_session_id uuid, p_edit_token uuid),
  public.finish_budget_receipt_cleanup(p_job_id uuid, p_token uuid, p_error text),
  public.finish_budget_receipt_verification(p_job_id uuid, p_token uuid, p_object_id uuid, p_digest text, p_size bigint, p_type text, p_error text),
  public.mutate_budget_lifecycle(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_epoch bigint, p_base_revision bigint, p_value jsonb, p_request_id uuid),
  public.mutate_budget_payment_v2(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_epoch bigint, p_base_revision bigint, p_value jsonb, p_request_id uuid),
  public.mutate_budget_receipt(p_trip_id uuid, p_actual_id uuid, p_action text, p_receipt jsonb, p_edit_session_id uuid, p_edit_token uuid),
  public.mutate_budget_receipts(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_epoch bigint, p_base_revision bigint, p_value jsonb, p_request_id uuid, p_phase text),
  public.mutate_budget_source(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_epoch bigint, p_base_revision bigint, p_value jsonb, p_request_id uuid),
  public.patch_budget_metadata_group(p_trip_id uuid, p_kind text, p_id uuid, p_group text, p_base_revision bigint, p_session_id uuid, p_token uuid, p_epoch bigint, p_patch jsonb, p_request_id uuid),
  public.patch_budget_metadata_group_v2(p_trip_id uuid, p_kind text, p_id uuid, p_group text, p_base_revision bigint, p_session_id uuid, p_token uuid, p_epoch bigint, p_patch jsonb, p_request_id uuid, p_versions jsonb),
  public.patch_budget_pricing_group(p_trip_id uuid, p_kind text, p_id uuid, p_group text, p_base_revision bigint, p_session_id uuid, p_token uuid, p_epoch bigint, p_patch jsonb, p_request_id uuid),
  public.read_budget_collaboration(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_groups(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid),
  public.read_budget_metadata_snapshot(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_snapshot_v10(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_snapshot_v2(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_snapshot_v3(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_snapshot_v4(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_snapshot_v5(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_snapshot_v6(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_snapshot_v7(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_snapshot_v8(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_snapshot_v9(p_trip_id uuid, p_session_id uuid),
  public.read_budget_metadata_undo(p_trip_id uuid, p_session_id uuid),
  public.read_budget_receipt_operation(p_trip_id uuid, p_id uuid, p_session_id uuid, p_request_id uuid),
  public.read_budget_snapshot(p_trip_id uuid),
  public.read_budget_source_preview(p_trip_id uuid, p_id uuid, p_action text, p_budget_id uuid),
  public.save_budget_workspace_record(p_trip_id uuid, p_kind text, p_id uuid, p_base_updated_at timestamp with time zone, p_payload jsonb),
  public.save_budget_workspace_record_v2(p_trip_id uuid, p_kind text, p_id uuid, p_base_updated_at timestamp with time zone, p_payload jsonb, p_request_id uuid),
  public.save_budget_workspace_record_v3(p_trip_id uuid, p_kind text, p_id uuid, p_base_updated_at timestamp with time zone, p_payload jsonb, p_request_id uuid),
  public.save_budget_workspace_record_v4(p_trip_id uuid, p_kind text, p_id uuid, p_base_updated_at timestamp with time zone, p_payload jsonb, p_request_id uuid, p_edit_session_id uuid, p_edit_token uuid),
  public.sweep_budget_receipts(),
  public.undo_budget_metadata_group(p_trip_id uuid, p_session_id uuid, p_operation_id uuid, p_token uuid, p_epoch bigint, p_request_id uuid),
  public.undo_budget_workspace(p_trip_id uuid, p_session_id uuid, p_operation_id uuid, p_token uuid, p_epoch bigint, p_request_id uuid),
  public.update_budget_selection(p_trip_id uuid, p_session_id uuid, p_kind text, p_id uuid),
  public.update_budget_selection_v2(p_trip_id uuid, p_session_id uuid, p_kind text, p_id uuid, p_activity_id uuid, p_action text),
  public.update_trip_budget_rates(p_trip_id uuid, p_quote jsonb, p_initialize boolean),
  public.update_trip_budget_rates_v2(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_epoch bigint, p_base_revision bigint, p_value jsonb, p_request_id uuid)
restrict;

drop function
  app_private.record_workspace_undo(e app_private.budget_metadata_effects, result jsonb),
  app_private.workspace_undo_top(trip uuid, sid uuid, operation uuid)
restrict;

-- Drop legacy relations together because they have mutual foreign keys.
drop table if exists app_private.budget_trip_delete_admissions restrict;
drop table if exists app_private.budget_receipt_legacy_cutover restrict;
drop table
  app_private.budget_edit_leases,
  app_private.budget_finance_protocol,
  app_private.budget_lifecycle_protocol,
  app_private.budget_metadata_effects,
  app_private.budget_metadata_groups,
  app_private.budget_metadata_protocol,
  app_private.budget_metadata_requests,
  app_private.budget_metadata_undo_intents,
  app_private.budget_metadata_undo_lineage,
  app_private.budget_metadata_undo_operations,
  app_private.budget_metadata_undo_protocol,
  app_private.budget_metadata_undo_receipts,
  app_private.budget_metadata_undo_stack,
  app_private.budget_payment_protocol,
  app_private.budget_pricing_trip_versions,
  app_private.budget_rates_leases,
  app_private.budget_receipt_cleanup,
  app_private.budget_receipt_intents,
  app_private.budget_receipt_protocol,
  app_private.budget_selections,
  app_private.budget_source_protocol,
  app_private.budget_workspace_requests,
  public.actual_expense_participants,
  public.actual_expenses,
  public.budget_collaboration_signals,
  public.budget_item_participants,
  public.budget_items,
  public.itinerary_budget_items,
  public.trip_budget_baselines
restrict;

-- Explicit implementation manifest (all legacy financial subprotocols).
drop function if exists app_private.cleanup_budget_trip_delete_admissions() restrict;
drop function if exists
  app_private.attest_budget_receipt_legacy_invalidation(uuid,jsonb,text),
  app_private.budget_receipt_legacy_exhausted(),
  app_private.budget_receipt_legacy_frozen(),
  app_private.guard_budget_receipt_cutover_journal(),
  app_private.stop_budget_receipt_legacy_issuance(uuid,uuid[],text)
restrict;
drop function
  app_private.abandon_receipt(trip uuid, rid uuid, sid uuid, token uuid, epoch bigint, base bigint, versions jsonb, request uuid),
  app_private.apply_budget_rates_quote(),
  app_private.apply_trip_budget_rate(),
  app_private.assert_budget_edit_lease(p_kind text, p_id uuid, p_required boolean, p_session_id uuid, p_token uuid),
  app_private.assert_budget_metadata_effect_finished(),
  app_private.assert_budget_metadata_undo_finished(),
  app_private.budget_baseline_changed(),
  app_private.budget_complete(k text, rid uuid),
  app_private.budget_edit_lease_action(p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_updated_at timestamp with time zone),
  app_private.budget_field_admission(trip uuid, k text, rid uuid, g text, sid uuid, token uuid, action text, base bigint, epoch bigint, seq bigint, dirty boolean, versions jsonb),
  app_private.budget_field_effect(k text, rid uuid),
  app_private.budget_field_targets(k text, rid uuid, g text),
  app_private.budget_field_versions(k text, rid uuid, g text),
  app_private.budget_finance_activated(),
  app_private.budget_finance_enabled(),
  app_private.budget_finance_membership(trip uuid),
  app_private.budget_finance_undo_context(),
  app_private.budget_lifecycle_activated(),
  app_private.budget_lifecycle_effect(k text, rid uuid, action text),
  app_private.budget_lifecycle_enabled(),
  app_private.budget_metadata_admission(p_trip_id uuid, p_kind text, p_id uuid, p_group text, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_activity_seq bigint, p_dirty boolean),
  app_private.budget_metadata_enabled(),
  app_private.budget_metadata_live(p_kind text, p_id uuid),
  app_private.budget_metadata_record(p_kind text, p_id uuid),
  app_private.budget_metadata_supported(p_kind text, p_id uuid),
  app_private.budget_metadata_undo_enabled(),
  app_private.budget_metadata_value(p_kind text, p_id uuid, p_group text),
  app_private.budget_payment_admission(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_versions jsonb),
  app_private.budget_payment_admission_v2(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_versions jsonb, p_intent text),
  app_private.budget_payment_checks(k text, rid uuid),
  app_private.budget_payment_dependencies(k text, rid uuid),
  app_private.budget_payment_dependencies(k text, rid uuid, intent text),
  app_private.budget_payment_effect(k text, rid uuid),
  app_private.budget_payment_enabled(),
  app_private.budget_payment_targets(k text, rid uuid),
  app_private.budget_payment_value(k text, rid uuid),
  app_private.budget_pricing_admission(p_trip_id uuid, p_kind text, p_id uuid, p_group text, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_activity_seq bigint, p_dirty boolean),
  app_private.budget_pricing_effect(k text, rid uuid),
  app_private.budget_pricing_targets(k text, rid uuid),
  app_private.budget_pricing_versions(k text, rid uuid),
  app_private.budget_rate_quote(quote jsonb),
  app_private.budget_rates_admission(trip uuid, sid uuid, token uuid, action text, base bigint, epoch bigint, versions jsonb, value jsonb),
  app_private.budget_rates_plan(trip uuid, value jsonb),
  app_private.budget_rates_versions(trip uuid),
  app_private.budget_readiness_changed(),
  app_private.budget_source_admission(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_action text, p_base_revision bigint, p_epoch bigint, p_versions jsonb, p_intent jsonb),
  app_private.budget_source_effect(k text, rid uuid),
  app_private.budget_source_enabled(),
  app_private.budget_source_plan(trip uuid, rid uuid, action text, destination uuid),
  app_private.budget_source_preview(p_trip_id uuid, p_id uuid, p_action text, p_budget_id uuid),
  app_private.budget_text_supported(k text, rid uuid, g text),
  app_private.budget_workspace_request(p_trip uuid, p_request uuid, p_signature text, p_kind text, p_record uuid),
  app_private.calculate_budget_group_pricing(p jsonb),
  app_private.capture_budget_metadata_undo_row(),
  app_private.capture_workspace_undo_effect(),
  app_private.claim_receipt_cleanup(trip uuid, rid uuid, sid uuid, token uuid, epoch bigint, base bigint, versions jsonb, request uuid),
  app_private.claim_receipt_verification(),
  app_private.cleanup_budget_edit_lease(),
  app_private.clear_budget_metadata_undo(p_trip uuid, p_session uuid),
  app_private.fence_budget_protocol_transition(),
  app_private.finish_budget_field(),
  app_private.finish_budget_lifecycle(),
  app_private.finish_budget_metadata_patch(),
  app_private.finish_budget_payment(),
  app_private.finish_budget_pricing_patch(),
  app_private.finish_budget_rates(),
  app_private.finish_budget_source(),
  app_private.finish_receipt(),
  app_private.finish_receipt_cleanup(job uuid, token uuid, error text),
  app_private.finish_receipt_verification(job uuid, token uuid, object uuid, digest text, size bigint, mime text, error text),
  app_private.finish_workspace_inverse(trip uuid, sid uuid, operation uuid, request uuid),
  app_private.guard_budget_edit_lease(),
  app_private.guard_budget_external_parent(),
  app_private.guard_budget_finance_boundary(),
  app_private.guard_budget_group_children_required(),
  app_private.guard_budget_metadata_children(),
  app_private.guard_budget_metadata_row(),
  app_private.guard_budget_metadata_undo_boundary(),
  app_private.guard_budget_source_boundary(),
  app_private.guard_incomplete_child(),
  app_private.guard_legacy_budget_metadata_lease(),
  app_private.guard_lifecycle_write(),
  app_private.guard_receipt_metadata(),
  app_private.guard_removed_budget_receipts(),
  app_private.invalidate_budget_metadata_undo(p_trip uuid, p_kind text, p_id uuid),
  app_private.keep_actual_budget_origin(),
  app_private.keep_actual_twd_cost(),
  app_private.latch_budget_finance(),
  app_private.latch_budget_lifecycle(),
  app_private.latch_budget_receipts(),
  app_private.legacy_budget_blocked(trip uuid),
  app_private.lifecycle_admission(trip uuid, k text, rid uuid, sid uuid, token uuid, action text, base bigint, epoch bigint, versions jsonb, intent jsonb),
  app_private.lifecycle_delete_plan(trip uuid, k text, rid uuid),
  app_private.lifecycle_membership(trip uuid),
  app_private.lifecycle_placeholder_row(trip uuid, k text, rid uuid),
  app_private.lifecycle_versions(k text, rid uuid),
  app_private.lock_budget_field_parents(trip uuid, targets jsonb),
  app_private.lock_budget_payment_graph(),
  app_private.prepare_budget_field(trip uuid, k text, rid uuid, g text, base bigint, sid uuid, token uuid, epoch bigint, patch jsonb, request uuid, versions jsonb),
  app_private.prepare_budget_lifecycle(trip uuid, k text, rid uuid, sid uuid, token uuid, epoch bigint, base bigint, value jsonb, request uuid),
  app_private.prepare_budget_metadata_patch(p_trip_id uuid, p_kind text, p_id uuid, p_group text, p_base_revision bigint, p_session_id uuid, p_token uuid, p_epoch bigint, p_patch jsonb, p_request_id uuid),
  app_private.prepare_budget_metadata_undo(p_trip uuid, p_session uuid, p_operation uuid, p_request uuid),
  app_private.prepare_budget_payment(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_epoch bigint, p_base_revision bigint, p_value jsonb, p_request_id uuid),
  app_private.prepare_budget_pricing_patch(p_trip_id uuid, p_kind text, p_id uuid, p_group text, p_base_revision bigint, p_session_id uuid, p_token uuid, p_epoch bigint, p_patch jsonb, p_request_id uuid),
  app_private.prepare_budget_rates(trip uuid, sid uuid, token uuid, epoch bigint, base bigint, value jsonb, request uuid),
  app_private.prepare_budget_source(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid, p_token uuid, p_epoch bigint, p_base_revision bigint, p_value jsonb, p_request_id uuid),
  app_private.prepare_receipt(trip uuid, rid uuid, sid uuid, token uuid, epoch bigint, base bigint, value jsonb, request uuid, phase text),
  app_private.prepare_workspace_inverse(trip uuid, sid uuid, operation uuid, request uuid, token uuid, epoch bigint),
  app_private.read_budget_collaboration(p_trip_id uuid, p_session_id uuid),
  app_private.read_budget_finance_state(trip uuid, sid uuid),
  app_private.read_budget_lifecycle_state(trip uuid, sid uuid),
  app_private.read_budget_metadata_groups(p_trip_id uuid, p_kind text, p_id uuid, p_session_id uuid),
  app_private.read_budget_metadata_state(p_trip_id uuid, p_session_id uuid),
  app_private.read_budget_metadata_state_v2(p_trip_id uuid, p_session_id uuid),
  app_private.read_budget_metadata_state_v3(p_trip_id uuid, p_session_id uuid),
  app_private.read_budget_metadata_undo(p_trip uuid, p_session uuid),
  app_private.read_budget_payment_state(p_trip_id uuid, p_session_id uuid),
  app_private.read_budget_pricing_value(k text, rid uuid),
  app_private.read_budget_source_state(p_trip_id uuid, p_session_id uuid),
  app_private.read_workspace_undo(trip uuid, sid uuid),
  app_private.receipt_admission(trip uuid, kind text, rid uuid, sid uuid, token uuid, action text, base bigint, epoch bigint, versions jsonb),
  app_private.receipt_authority(trip uuid, rid uuid, sid uuid, token uuid, epoch bigint, base bigint, versions jsonb),
  app_private.receipt_effect(),
  app_private.receipt_inspect(trip uuid, rid uuid, sid uuid, request uuid),
  app_private.receipt_path_protected(bucket text, path text),
  app_private.receipt_projection(trip uuid, sid uuid),
  app_private.receipt_storage_allowed(bucket text, path text, operation text, object uuid, metadata jsonb),
  app_private.receipt_value(rid uuid),
  app_private.receipt_versions(rid uuid),
  app_private.receipt_worker_object_allowed(path text, object uuid, operation text),
  app_private.receipts_activated(),
  app_private.receipts_enabled(),
  app_private.reconcile_budget_readiness(k text, rid uuid),
  app_private.record_budget_metadata_undo(),
  app_private.refresh_budget_baseline(p_trip_id uuid),
  app_private.replay_legacy_budget(trip uuid, k text, rid uuid, base timestamp with time zone, payload jsonb, request uuid, v integer),
  app_private.signal_budget_collaboration(),
  app_private.signal_budget_metadata_protocol(),
  app_private.signal_budget_metadata_state(),
  app_private.sweep_receipts(),
  app_private.track_budget_metadata_links(),
  app_private.track_budget_payment_versions(),
  app_private.track_budget_pricing_versions(),
  app_private.track_budget_source(),
  app_private.track_lifecycle_identity(),
  app_private.track_receipts(),
  app_private.undo_dependencies(k text, rid uuid, g text),
  app_private.undo_group_value(k text, rid uuid, g text),
  app_private.update_budget_selection(p_trip_id uuid, p_session_id uuid, p_kind text, p_id uuid),
  app_private.update_budget_selection_v2(p_trip_id uuid, p_session_id uuid, p_kind text, p_id uuid, p_activity_id uuid, p_action text),
  app_private.validate_budget_field_parent(k text, rid uuid, b jsonb, a jsonb),
  app_private.validate_budget_payment_parent(k text, rid uuid, b jsonb, a jsonb),
  app_private.validate_budget_source_parent(k text, rid uuid, b jsonb, a jsonb),
  app_private.validate_lifecycle_row(k text, rid uuid, b jsonb, a jsonb),
  app_private.worker_claim_receipt(),
  app_private.workspace_inverse_manifest(),
  app_private.workspace_undo_enabled(),
  app_private.workspace_undo_lease(trip uuid, sid uuid, operation uuid, token uuid, action text, epoch bigint)
restrict;

revoke all on table storage.buckets, storage.objects from budget_receipt_worker;
revoke usage on schema public, app_private, storage from budget_receipt_worker;

notify pgrst, 'reload schema';
commit;
