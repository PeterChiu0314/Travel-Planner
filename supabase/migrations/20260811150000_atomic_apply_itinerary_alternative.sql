-- Atomically exchange one itinerary destination with one of its alternatives.
-- The destination keeps its stable slot identity and schedule fields. Only the
-- destination content moves; the previous main content becomes the alternative.

create or replace function app_private.apply_itinerary_alternative(
  target_item_id uuid,
  target_alternative_id uuid,
  item_updated_at_baseline timestamptz,
  alternative_updated_at_baseline timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  original_item public.itinerary_items%rowtype;
  updated_item public.itinerary_items%rowtype;
  alternative_row public.itinerary_alternatives%rowtype;
  updated_alternative public.itinerary_alternatives%rowtype;
begin
  if auth.uid() is null then
    raise exception 'permission_denied';
  end if;

  if target_item_id is null then
    raise exception 'item_not_found';
  end if;

  if target_alternative_id is null then
    raise exception 'alternative_not_found';
  end if;

  -- Every concurrent alternative apply for the same destination locks the
  -- parent first, then the alternative, so lock order stays deterministic.
  select item.*
    into original_item
  from public.itinerary_items item
  where item.id = target_item_id
  for update;

  if original_item.id is null then
    raise exception 'item_not_found';
  end if;

  if not app_private.can_edit_trip(original_item.trip_id, auth.uid()) then
    raise exception 'permission_denied';
  end if;

  select alternative.*
    into alternative_row
  from public.itinerary_alternatives alternative
  where alternative.id = target_alternative_id
    and alternative.itinerary_item_id = target_item_id
  for update;

  if alternative_row.id is null then
    raise exception 'alternative_not_found';
  end if;

  if original_item.item_type = 'transport' then
    raise exception 'visit_required';
  end if;

  if coalesce(original_item.is_fixed, false) then
    raise exception 'fixed_item';
  end if;

  if original_item.locked_by is not null
    and original_item.locked_by <> auth.uid()
    and original_item.locked_at is not null
    and original_item.locked_at > now() - interval '7 minutes'
  then
    raise exception 'item_locked';
  end if;

  if item_updated_at_baseline is null
    or original_item.updated_at is distinct from item_updated_at_baseline
  then
    raise exception 'stale_item';
  end if;

  if alternative_updated_at_baseline is null
    or alternative_row.updated_at is distinct from alternative_updated_at_baseline
  then
    raise exception 'stale_alternative';
  end if;

  update public.itinerary_items item
  set
    type = coalesce(alternative_row.type, original_item.type, 'attraction'),
    title = alternative_row.title,
    location = alternative_row.location_name,
    note = alternative_row.description,
    cost = alternative_row.cost,
    location_name = alternative_row.location_name,
    address = alternative_row.address,
    map_url = alternative_row.map_url,
    latitude = alternative_row.latitude,
    longitude = alternative_row.longitude,
    description = alternative_row.description,
    transportation_note = alternative_row.transportation_note
  where item.id = target_item_id
  returning item.* into updated_item;

  update public.itinerary_alternatives alternative
  set
    title = original_item.title,
    type = coalesce(original_item.type, 'attraction'),
    start_time = original_item.start_time,
    end_time = original_item.end_time,
    cost = coalesce(original_item.cost, 0),
    location_name = coalesce(original_item.location_name, original_item.location),
    address = original_item.address,
    map_url = original_item.map_url,
    latitude = original_item.latitude,
    longitude = original_item.longitude,
    description = coalesce(original_item.description, original_item.note),
    transportation_note = original_item.transportation_note
  where alternative.id = target_alternative_id
  returning alternative.* into updated_alternative;

  return jsonb_build_object(
    'ok', true,
    'item', to_jsonb(updated_item),
    'alternative', to_jsonb(updated_alternative)
  );
end;
$$;

revoke execute on function app_private.apply_itinerary_alternative(uuid, uuid, timestamptz, timestamptz) from public;
revoke execute on function app_private.apply_itinerary_alternative(uuid, uuid, timestamptz, timestamptz) from anon;
revoke execute on function app_private.apply_itinerary_alternative(uuid, uuid, timestamptz, timestamptz) from authenticated;

create or replace function public.apply_itinerary_alternative(
  target_item_id uuid,
  target_alternative_id uuid,
  item_updated_at_baseline timestamptz,
  alternative_updated_at_baseline timestamptz
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, app_private
as $$
  select app_private.apply_itinerary_alternative(
    target_item_id,
    target_alternative_id,
    item_updated_at_baseline,
    alternative_updated_at_baseline
  );
$$;

revoke execute on function public.apply_itinerary_alternative(uuid, uuid, timestamptz, timestamptz) from public;
revoke execute on function public.apply_itinerary_alternative(uuid, uuid, timestamptz, timestamptz) from anon;
revoke execute on function public.apply_itinerary_alternative(uuid, uuid, timestamptz, timestamptz) from authenticated;
grant execute on function public.apply_itinerary_alternative(uuid, uuid, timestamptz, timestamptz) to authenticated;

comment on function public.apply_itinerary_alternative(uuid, uuid, timestamptz, timestamptz) is
  'Atomically exchanges itinerary destination content with one attached alternative while preserving slot, time, transport, budget, and fixed fields.';
