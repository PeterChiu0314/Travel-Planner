create or replace function app_private.swap_itinerary_destination_packages(
  source_item_id uuid,
  target_item_id uuid,
  source_updated_at timestamptz,
  target_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  source_item public.itinerary_items%rowtype;
  target_item public.itinerary_items%rowtype;
  budget_link public.itinerary_budget_items%rowtype;
  budget_links public.itinerary_budget_items[];
  moved_alternative_count integer := 0;
  moved_budget_link_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'permission_denied';
  end if;

  if source_item_id is null or target_item_id is null then
    raise exception 'item_not_found';
  end if;

  if source_item_id = target_item_id then
    raise exception 'same_item';
  end if;

  perform 1
  from public.itinerary_items item
  where item.id in (source_item_id, target_item_id)
  order by item.id
  for update;

  select *
    into source_item
  from public.itinerary_items item
  where item.id = source_item_id;

  select *
    into target_item
  from public.itinerary_items item
  where item.id = target_item_id;

  if source_item.id is null or target_item.id is null then
    raise exception 'item_not_found';
  end if;

  if source_item.trip_id <> target_item.trip_id or source_item.day_index <> target_item.day_index then
    raise exception 'different_trip_or_day';
  end if;

  if not app_private.can_edit_trip(source_item.trip_id, auth.uid()) then
    raise exception 'permission_denied';
  end if;

  if source_item.item_type = 'transport'
    or target_item.item_type = 'transport'
    or source_item.start_time is null
    or target_item.start_time is null
  then
    raise exception 'timed_visit_required';
  end if;

  if source_item.is_fixed or target_item.is_fixed then
    raise exception 'fixed_item';
  end if;

  if (
    source_item.locked_by is not null
    and source_item.locked_by <> auth.uid()
    and source_item.locked_at is not null
    and source_item.locked_at > now() - interval '7 minutes'
  ) or (
    target_item.locked_by is not null
    and target_item.locked_by <> auth.uid()
    and target_item.locked_at is not null
    and target_item.locked_at > now() - interval '7 minutes'
  ) then
    raise exception 'item_locked';
  end if;

  if source_updated_at is null
    or target_updated_at is null
    or source_item.updated_at is distinct from source_updated_at
    or target_item.updated_at is distinct from target_updated_at
  then
    raise exception 'stale_item';
  end if;

  update public.itinerary_items item
  set
    type = case when item.id = source_item_id then target_item.type else source_item.type end,
    title = case when item.id = source_item_id then target_item.title else source_item.title end,
    location = case when item.id = source_item_id then target_item.location else source_item.location end,
    note = case when item.id = source_item_id then target_item.note else source_item.note end,
    cost = case when item.id = source_item_id then target_item.cost else source_item.cost end,
    location_name = case when item.id = source_item_id then target_item.location_name else source_item.location_name end,
    address = case when item.id = source_item_id then target_item.address else source_item.address end,
    map_url = case when item.id = source_item_id then target_item.map_url else source_item.map_url end,
    latitude = case when item.id = source_item_id then target_item.latitude else source_item.latitude end,
    longitude = case when item.id = source_item_id then target_item.longitude else source_item.longitude end,
    description = case when item.id = source_item_id then target_item.description else source_item.description end,
    transportation_note = case
      when item.id = source_item_id then target_item.transportation_note
      else source_item.transportation_note
    end,
    updated_at = now()
  where item.id in (source_item_id, target_item_id);

  update public.itinerary_alternatives alternative
  set itinerary_item_id = case
    when alternative.itinerary_item_id = source_item_id then target_item_id
    else source_item_id
  end
  where alternative.itinerary_item_id in (source_item_id, target_item_id);

  get diagnostics moved_alternative_count = row_count;

  select coalesce(
    array_agg(link order by link.id),
    array[]::public.itinerary_budget_items[]
  )
    into budget_links
  from public.itinerary_budget_items link
  where link.itinerary_item_id in (source_item_id, target_item_id);

  moved_budget_link_count := coalesce(array_length(budget_links, 1), 0);

  if moved_budget_link_count > 0 then
    delete from public.itinerary_budget_items link
    where link.itinerary_item_id in (source_item_id, target_item_id);

    foreach budget_link in array budget_links
    loop
      insert into public.itinerary_budget_items (
        id,
        itinerary_item_id,
        budget_item_id,
        created_at
      )
      values (
        budget_link.id,
        case
          when budget_link.itinerary_item_id = source_item_id then target_item_id
          else source_item_id
        end,
        budget_link.budget_item_id,
        budget_link.created_at
      );
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'source_item_id', source_item_id,
    'target_item_id', target_item_id,
    'moved_alternative_count', moved_alternative_count,
    'moved_budget_link_count', moved_budget_link_count
  );
end;
$$;

revoke execute on function app_private.swap_itinerary_destination_packages(uuid, uuid, timestamptz, timestamptz) from public;
revoke execute on function app_private.swap_itinerary_destination_packages(uuid, uuid, timestamptz, timestamptz) from anon;
revoke execute on function app_private.swap_itinerary_destination_packages(uuid, uuid, timestamptz, timestamptz) from authenticated;

create or replace function public.swap_itinerary_destination_packages(
  source_item_id uuid,
  target_item_id uuid,
  source_updated_at timestamptz,
  target_updated_at timestamptz
)
returns jsonb
language sql
security definer
set search_path = public, app_private
as $$
  select app_private.swap_itinerary_destination_packages(
    source_item_id,
    target_item_id,
    source_updated_at,
    target_updated_at
  );
$$;

revoke execute on function public.swap_itinerary_destination_packages(uuid, uuid, timestamptz, timestamptz) from public;
revoke execute on function public.swap_itinerary_destination_packages(uuid, uuid, timestamptz, timestamptz) from anon;
revoke execute on function public.swap_itinerary_destination_packages(uuid, uuid, timestamptz, timestamptz) from authenticated;
grant execute on function public.swap_itinerary_destination_packages(uuid, uuid, timestamptz, timestamptz) to authenticated;

comment on function public.swap_itinerary_destination_packages(uuid, uuid, timestamptz, timestamptz) is
  'Atomically swaps destination content, alternatives, and itinerary budget links between two timed visit slots.';
