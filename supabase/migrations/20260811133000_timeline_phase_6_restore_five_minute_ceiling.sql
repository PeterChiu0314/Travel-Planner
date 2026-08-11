-- Timeline Phase 6 five-minute ceiling hotfix.
-- Auto-calculated destination starts remain on the established five-minute
-- Timeline grid. Exact transport duration is preserved; only the next visit
-- start is rounded upward.

create or replace function app_private.timeline_schedule_round_up(
  value integer,
  step_minutes integer default 5
)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when value is null or step_minutes is null or step_minutes <= 0 then null
    else ((value + step_minutes - 1) / step_minutes) * step_minutes
  end;
$$;

revoke all on function app_private.timeline_schedule_round_up(integer, integer)
from public, anon, authenticated;

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
        if start_minutes < app_private.timeline_schedule_round_up(previous_end + transport_minutes) then
          return jsonb_build_object(
            'ok', false,
            'validationError', 'earlier_conflict',
            'earliestStart', app_private.timeline_schedule_time_text(app_private.timeline_schedule_round_up(previous_end + transport_minutes)),
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
          next_start := app_private.timeline_schedule_round_up(previous_end + transport_minutes);
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

