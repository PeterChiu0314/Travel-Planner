-- Timeline Phase 7.1-7.4 versioned JSON import commit boundary.
-- The browser parses, migrates, normalizes, and previews the public contract.
-- This RPC accepts only the current internal persistence payload and repeats
-- the material invariants before atomically creating Trip + Timeline rows.

create or replace function public.import_trip_timeline_v1(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  caller_id uuid := auth.uid();
  trip_payload jsonb;
  day_payload jsonb;
  visit_payload jsonb;
  alternative_payload jsonb;
  transport_payload jsonb;
  day_ordinal bigint;
  visit_ordinal bigint;
  alternative_ordinal bigint;
  transport_ordinal bigint;
  expected_day_count integer;
  target_day_index integer;
  target_day_date date;
  new_trip_id uuid := gen_random_uuid();
  new_visit_id uuid;
  visit_ref text;
  scoped_ref text;
  transport_ref text;
  from_visit_ref text;
  to_visit_ref text;
  from_visit_id uuid;
  to_visit_id uuid;
  from_visit_row public.itinerary_items%rowtype;
  to_visit_row public.itinerary_items%rowtype;
  ref_map jsonb := '{}'::jsonb;
  seen_refs jsonb := '{}'::jsonb;
  seen_pairs jsonb;
  from_position integer;
  to_position integer;
  start_time_text text;
  end_time_text text;
  start_time_value time;
  end_time_value time;
  is_fixed_value boolean;
  sort_order_value integer;
  estimated_cost_value numeric;
  transport_duration_value integer;
  visit_count integer := 0;
  transport_count integer := 0;
  alternative_count integer := 0;
begin
  if caller_id is null then
    raise exception 'permission_denied';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'invalid_import_payload';
  end if;
  if payload ->> 'schema_version' is distinct from '1' then
    raise exception 'unsupported_schema_version';
  end if;
  if payload ->> 'document_type' is distinct from 'travel_studio_trip' then
    raise exception 'invalid_document_type';
  end if;
  if jsonb_typeof(payload -> 'trip') <> 'object' or jsonb_typeof(payload -> 'days') <> 'array' then
    raise exception 'invalid_import_structure';
  end if;

  trip_payload := payload -> 'trip';
  if nullif(btrim(trip_payload ->> 'title'), '') is null
    or nullif(btrim(trip_payload ->> 'destination'), '') is null
    or (trip_payload ->> 'start_date') is null
    or (trip_payload ->> 'end_date') is null
  then
    raise exception 'invalid_trip';
  end if;
  if coalesce(trip_payload ->> 'status', '') not in ('planning', 'traveling', 'settled') then
    raise exception 'invalid_trip_status';
  end if;
  if (trip_payload ->> 'end_date')::date < (trip_payload ->> 'start_date')::date then
    raise exception 'invalid_trip_date_range';
  end if;
  expected_day_count := ((trip_payload ->> 'end_date')::date - (trip_payload ->> 'start_date')::date) + 1;
  if expected_day_count < 1 or expected_day_count > 366
    or jsonb_array_length(payload -> 'days') <> expected_day_count
  then
    raise exception 'invalid_day_count';
  end if;

  insert into public.trips (
    id,
    title,
    name,
    destination,
    destination_country,
    destination_city,
    start_date,
    end_date,
    status,
    owner_id
  ) values (
    new_trip_id,
    btrim(trip_payload ->> 'title'),
    btrim(trip_payload ->> 'title'),
    btrim(trip_payload ->> 'destination'),
    nullif(btrim(trip_payload ->> 'destination_country'), ''),
    nullif(btrim(trip_payload ->> 'destination_city'), ''),
    (trip_payload ->> 'start_date')::date,
    (trip_payload ->> 'end_date')::date,
    trip_payload ->> 'status',
    caller_id
  );

  insert into public.trip_members (
    trip_id,
    user_id,
    role,
    status,
    display_name,
    email
  ) values (
    new_trip_id,
    caller_id,
    'owner',
    'approved',
    coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() ->> 'email'),
    auth.jwt() ->> 'email'
  );

  -- Visits are inserted before transport so portable refs can resolve to fresh UUIDs.
  for day_payload, day_ordinal in
    select entry.value, entry.ordinality
    from jsonb_array_elements(payload -> 'days') with ordinality as entry(value, ordinality)
  loop
    if jsonb_typeof(day_payload) <> 'object'
      or jsonb_typeof(day_payload -> 'visits') <> 'array'
      or jsonb_typeof(day_payload -> 'transports') <> 'array'
    then
      raise exception 'invalid_day';
    end if;
    if jsonb_array_length(day_payload -> 'visits') > 2000
      or jsonb_array_length(day_payload -> 'transports') > 2000
    then
      raise exception 'import_limit_exceeded';
    end if;
    target_day_index := (day_payload ->> 'day_index')::integer;
    target_day_date := (day_payload ->> 'date')::date;
    if target_day_index <> day_ordinal - 1
      or target_day_date <> (trip_payload ->> 'start_date')::date + target_day_index
    then
      raise exception 'invalid_day_sequence';
    end if;

    for visit_payload, visit_ordinal in
      select entry.value, entry.ordinality
      from jsonb_array_elements(day_payload -> 'visits') with ordinality as entry(value, ordinality)
    loop
      if jsonb_typeof(visit_payload) <> 'object'
        or jsonb_typeof(visit_payload -> 'alternatives') <> 'array'
        or not (visit_payload ?& array[
          'ref', 'sort_order', 'type', 'title', 'location_name', 'address', 'map_url',
          'latitude', 'longitude', 'description', 'transportation_note', 'cost',
          'start_time', 'end_time', 'is_fixed', 'alternatives'
        ])
      then
        raise exception 'invalid_visit';
      end if;
      if jsonb_array_length(visit_payload -> 'alternatives') > 100 then
        raise exception 'import_limit_exceeded';
      end if;
      visit_ref := btrim(visit_payload ->> 'ref');
      scoped_ref := target_day_index::text || ':' || visit_ref;
      if visit_ref is null or visit_ref = '' or length(visit_ref) > 128
        or visit_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
        or ref_map ? scoped_ref
      then
        raise exception 'invalid_or_duplicate_ref';
      end if;
      if coalesce(visit_payload ->> 'type', '') not in ('attraction', 'food', 'hotel', 'transport', 'note')
        or nullif(btrim(visit_payload ->> 'title'), '') is null
      then
        raise exception 'invalid_visit_type_or_title';
      end if;
      if jsonb_typeof(visit_payload -> 'sort_order') <> 'number'
        or (visit_payload ->> 'sort_order') !~ '^-?[0-9]+$'
      then
        raise exception 'invalid_visit_order';
      end if;
      sort_order_value := (visit_payload ->> 'sort_order')::integer;

      start_time_text := nullif(visit_payload ->> 'start_time', '');
      end_time_text := nullif(visit_payload ->> 'end_time', '');
      if (start_time_text is null) <> (end_time_text is null) then
        raise exception 'partial_time';
      end if;
      if start_time_text is not null then
        if start_time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or end_time_text !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
        then
          raise exception 'invalid_time';
        end if;
        start_time_value := start_time_text::time;
        end_time_value := end_time_text::time;
        if end_time_value <= start_time_value then
          raise exception 'invalid_time_range';
        end if;
      else
        start_time_value := null;
        end_time_value := null;
      end if;

      if jsonb_typeof(visit_payload -> 'is_fixed') <> 'boolean' then
        raise exception 'invalid_fixed_state';
      end if;
      is_fixed_value := (visit_payload ->> 'is_fixed')::boolean;
      if is_fixed_value and start_time_value is null then
        raise exception 'fixed_requires_time';
      end if;
      if jsonb_typeof(visit_payload -> 'cost') <> 'number' then
        raise exception 'invalid_cost';
      end if;
      estimated_cost_value := (visit_payload ->> 'cost')::numeric;
      if estimated_cost_value < 0 then
        raise exception 'invalid_cost';
      end if;
      if jsonb_typeof(visit_payload -> 'latitude') not in ('number', 'null')
        or jsonb_typeof(visit_payload -> 'longitude') not in ('number', 'null')
      then
        raise exception 'invalid_coordinates';
      end if;
      if (visit_payload -> 'latitude') <> 'null'::jsonb
        and ((visit_payload ->> 'latitude')::numeric < -90 or (visit_payload ->> 'latitude')::numeric > 90)
      then
        raise exception 'invalid_coordinates';
      end if;
      if (visit_payload -> 'longitude') <> 'null'::jsonb
        and ((visit_payload ->> 'longitude')::numeric < -180 or (visit_payload ->> 'longitude')::numeric > 180)
      then
        raise exception 'invalid_coordinates';
      end if;
      if ((visit_payload -> 'latitude') = 'null'::jsonb) <> ((visit_payload -> 'longitude') = 'null'::jsonb) then
        raise exception 'invalid_coordinates';
      end if;

      new_visit_id := gen_random_uuid();
      insert into public.itinerary_items (
        id,
        trip_id,
        day_index,
        date,
        sort_order,
        item_type,
        type,
        start_time,
        end_time,
        title,
        location,
        location_name,
        address,
        map_url,
        latitude,
        longitude,
        note,
        description,
        transportation_note,
        cost,
        is_fixed,
        fixed_at,
        fixed_by,
        transport_role
      ) values (
        new_visit_id,
        new_trip_id,
        target_day_index,
        target_day_date,
        sort_order_value,
        'visit',
        visit_payload ->> 'type',
        start_time_value,
        end_time_value,
        btrim(visit_payload ->> 'title'),
        nullif(btrim(visit_payload ->> 'location_name'), ''),
        nullif(btrim(visit_payload ->> 'location_name'), ''),
        nullif(btrim(visit_payload ->> 'address'), ''),
        nullif(btrim(visit_payload ->> 'map_url'), ''),
        case when (visit_payload -> 'latitude') = 'null'::jsonb then null else (visit_payload ->> 'latitude')::numeric end,
        case when (visit_payload -> 'longitude') = 'null'::jsonb then null else (visit_payload ->> 'longitude')::numeric end,
        nullif(visit_payload ->> 'description', ''),
        nullif(visit_payload ->> 'description', ''),
        nullif(visit_payload ->> 'transportation_note', ''),
        estimated_cost_value,
        is_fixed_value,
        case when is_fixed_value then now() else null end,
        case when is_fixed_value then caller_id else null end,
        null
      );

      ref_map := jsonb_set(ref_map, array[scoped_ref], to_jsonb(new_visit_id::text), true);
      visit_count := visit_count + 1;

      for alternative_payload, alternative_ordinal in
        select entry.value, entry.ordinality
        from jsonb_array_elements(visit_payload -> 'alternatives') with ordinality as entry(value, ordinality)
      loop
        if jsonb_typeof(alternative_payload) <> 'object'
          or not (alternative_payload ?& array[
            'type', 'title', 'location_name', 'address', 'map_url', 'latitude',
            'longitude', 'description', 'transportation_note', 'cost', 'start_time', 'end_time'
          ])
          or coalesce(alternative_payload ->> 'type', '') not in ('attraction', 'food', 'hotel', 'transport', 'note')
          or nullif(btrim(alternative_payload ->> 'title'), '') is null
          or jsonb_typeof(alternative_payload -> 'cost') <> 'number'
        then
          raise exception 'invalid_alternative';
        end if;
        estimated_cost_value := (alternative_payload ->> 'cost')::numeric;
        if estimated_cost_value < 0 then raise exception 'invalid_alternative_cost'; end if;
        start_time_text := nullif(alternative_payload ->> 'start_time', '');
        end_time_text := nullif(alternative_payload ->> 'end_time', '');
        if (start_time_text is null) <> (end_time_text is null) then
          raise exception 'partial_alternative_time';
        end if;
        if start_time_text is not null then
          if start_time_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            or end_time_text !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
          then
            raise exception 'invalid_alternative_time';
          end if;
          start_time_value := start_time_text::time;
          end_time_value := end_time_text::time;
          if end_time_value <= start_time_value then raise exception 'invalid_alternative_time'; end if;
        else
          start_time_value := null;
          end_time_value := null;
        end if;
        if jsonb_typeof(alternative_payload -> 'latitude') not in ('number', 'null')
          or jsonb_typeof(alternative_payload -> 'longitude') not in ('number', 'null')
          or (
            (alternative_payload -> 'latitude') <> 'null'::jsonb
            and ((alternative_payload ->> 'latitude')::numeric < -90 or (alternative_payload ->> 'latitude')::numeric > 90)
          )
          or (
            (alternative_payload -> 'longitude') <> 'null'::jsonb
            and ((alternative_payload ->> 'longitude')::numeric < -180 or (alternative_payload ->> 'longitude')::numeric > 180)
          )
          or (((alternative_payload -> 'latitude') = 'null'::jsonb) <> ((alternative_payload -> 'longitude') = 'null'::jsonb))
        then
          raise exception 'invalid_alternative_coordinates';
        end if;

        insert into public.itinerary_alternatives (
          itinerary_item_id,
          title,
          type,
          start_time,
          end_time,
          cost,
          location_name,
          address,
          map_url,
          latitude,
          longitude,
          description,
          transportation_note
        ) values (
          new_visit_id,
          btrim(alternative_payload ->> 'title'),
          alternative_payload ->> 'type',
          start_time_value,
          end_time_value,
          estimated_cost_value,
          nullif(btrim(alternative_payload ->> 'location_name'), ''),
          nullif(btrim(alternative_payload ->> 'address'), ''),
          nullif(btrim(alternative_payload ->> 'map_url'), ''),
          case when (alternative_payload -> 'latitude') = 'null'::jsonb then null else (alternative_payload ->> 'latitude')::numeric end,
          case when (alternative_payload -> 'longitude') = 'null'::jsonb then null else (alternative_payload ->> 'longitude')::numeric end,
          nullif(alternative_payload ->> 'description', ''),
          nullif(alternative_payload ->> 'transportation_note', '')
        );
        alternative_count := alternative_count + 1;
      end loop;
    end loop;
  end loop;

  -- Transport resolves portable refs only after every visit has a fresh UUID.
  for day_payload, day_ordinal in
    select entry.value, entry.ordinality
    from jsonb_array_elements(payload -> 'days') with ordinality as entry(value, ordinality)
  loop
    target_day_index := (day_payload ->> 'day_index')::integer;
    target_day_date := (day_payload ->> 'date')::date;
    seen_pairs := '{}'::jsonb;
    seen_refs := '{}'::jsonb;
    for transport_payload, transport_ordinal in
      select entry.value, entry.ordinality
      from jsonb_array_elements(day_payload -> 'transports') with ordinality as entry(value, ordinality)
    loop
      if jsonb_typeof(transport_payload) <> 'object'
        or not (transport_payload ?& array[
          'ref', 'sort_order', 'from_visit_ref', 'to_visit_ref', 'transport_category',
          'transport_name', 'transport_duration_minutes', 'transport_note'
        ])
      then
        raise exception 'invalid_transport';
      end if;
      transport_ref := btrim(transport_payload ->> 'ref');
      from_visit_ref := btrim(transport_payload ->> 'from_visit_ref');
      to_visit_ref := btrim(transport_payload ->> 'to_visit_ref');
      scoped_ref := target_day_index::text || ':' || transport_ref;
      if transport_ref is null or transport_ref = '' or length(transport_ref) > 128
        or transport_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
        or ref_map ? scoped_ref
        or seen_refs ? transport_ref
      then
        raise exception 'invalid_or_duplicate_ref';
      end if;
      if from_visit_ref is null or to_visit_ref is null or from_visit_ref = to_visit_ref
        or not (ref_map ? (target_day_index::text || ':' || from_visit_ref))
        or not (ref_map ? (target_day_index::text || ':' || to_visit_ref))
      then
        raise exception 'invalid_transport_relation';
      end if;
      select entry.ordinality::integer into from_position
      from jsonb_array_elements(day_payload -> 'visits') with ordinality as entry(value, ordinality)
      where entry.value ->> 'ref' = from_visit_ref;
      select entry.ordinality::integer into to_position
      from jsonb_array_elements(day_payload -> 'visits') with ordinality as entry(value, ordinality)
      where entry.value ->> 'ref' = to_visit_ref;
      if from_position is null or to_position is null or from_position >= to_position then
        raise exception 'invalid_transport_order';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(day_payload -> 'visits') with ordinality as entry(value, ordinality)
        where entry.ordinality > from_position
          and entry.ordinality < to_position
          and entry.value ->> 'start_time' is not null
      ) then
        raise exception 'invalid_transport_crossing';
      end if;
      if seen_pairs ? (from_visit_ref || '->' || to_visit_ref) then
        raise exception 'duplicate_transport_pair';
      end if;
      seen_pairs := jsonb_set(seen_pairs, array[from_visit_ref || '->' || to_visit_ref], 'true'::jsonb, true);

      if jsonb_typeof(transport_payload -> 'sort_order') <> 'number'
        or (transport_payload ->> 'sort_order') !~ '^-?[0-9]+$'
      then
        raise exception 'invalid_transport_order';
      end if;
      sort_order_value := (transport_payload ->> 'sort_order')::integer;
      if jsonb_typeof(transport_payload -> 'transport_duration_minutes') <> 'number'
        or (transport_payload ->> 'transport_duration_minutes') !~ '^[0-9]+$'
      then
        raise exception 'invalid_transport_duration';
      end if;
      transport_duration_value := (transport_payload ->> 'transport_duration_minutes')::integer;
      if transport_duration_value < 1 or transport_duration_value > 1440
        or nullif(btrim(transport_payload ->> 'transport_category'), '') is null
        or nullif(btrim(transport_payload ->> 'transport_name'), '') is null
      then
        raise exception 'invalid_transport';
      end if;

      from_visit_id := (ref_map ->> (target_day_index::text || ':' || from_visit_ref))::uuid;
      to_visit_id := (ref_map ->> (target_day_index::text || ':' || to_visit_ref))::uuid;
      select item.* into from_visit_row
      from public.itinerary_items item
      where item.id = from_visit_id
        and item.trip_id = new_trip_id
        and item.day_index = target_day_index
        and item.item_type = 'visit';
      if not found then raise exception 'invalid_transport_scope'; end if;
      select item.* into to_visit_row
      from public.itinerary_items item
      where item.id = to_visit_id
        and item.trip_id = new_trip_id
        and item.day_index = target_day_index
        and item.item_type = 'visit';
      if not found then raise exception 'invalid_transport_scope'; end if;

      insert into public.itinerary_items (
        trip_id,
        day_index,
        date,
        sort_order,
        item_type,
        type,
        title,
        location,
        location_name,
        note,
        description,
        transportation_note,
        cost,
        is_fixed,
        transport_category,
        transport_name,
        transport_duration_minutes,
        transport_note,
        from_item_id,
        to_item_id,
        transport_role,
        from_snapshot_start_time,
        from_snapshot_end_time,
        from_snapshot_destination,
        to_snapshot_start_time,
        to_snapshot_end_time,
        to_snapshot_destination
      ) values (
        new_trip_id,
        target_day_index,
        target_day_date,
        sort_order_value,
        'transport',
        'transport',
        btrim(transport_payload ->> 'transport_name'),
        null,
        null,
        nullif(transport_payload ->> 'transport_note', ''),
        nullif(transport_payload ->> 'transport_note', ''),
        nullif(transport_payload ->> 'transport_note', ''),
        0,
        false,
        btrim(transport_payload ->> 'transport_category'),
        btrim(transport_payload ->> 'transport_name'),
        transport_duration_value,
        nullif(transport_payload ->> 'transport_note', ''),
        from_visit_id,
        to_visit_id,
        'normal_pair',
        case when from_visit_row.start_time is null then null else to_char(from_visit_row.start_time, 'HH24:MI') end,
        case when from_visit_row.end_time is null then null else to_char(from_visit_row.end_time, 'HH24:MI') end,
        coalesce(from_visit_row.location_name, from_visit_row.location, from_visit_row.title),
        case when to_visit_row.start_time is null then null else to_char(to_visit_row.start_time, 'HH24:MI') end,
        case when to_visit_row.end_time is null then null else to_char(to_visit_row.end_time, 'HH24:MI') end,
        coalesce(to_visit_row.location_name, to_visit_row.location, to_visit_row.title)
      );
      seen_refs := jsonb_set(seen_refs, array[transport_ref], 'true'::jsonb, true);
      transport_count := transport_count + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'trip_id', new_trip_id,
    'counts', jsonb_build_object(
      'days', expected_day_count,
      'visits', visit_count,
      'transports', transport_count,
      'alternatives', alternative_count
    )
  );
end;
$$;

revoke all on function public.import_trip_timeline_v1(jsonb) from public, anon, authenticated;
grant execute on function public.import_trip_timeline_v1(jsonb) to authenticated;

comment on function public.import_trip_timeline_v1(jsonb) is
  'Phase 7 v1 atomic Trip + Timeline import. Accepts only normalized internal persistence payloads after client parser/preview validation.';
