create or replace function app_private.get_share_snapshot(share_token text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with link as (
    select trip_id
    from public.share_links
    where token = share_token
      and is_active = true
      and (expires_at is null or expires_at > now())
    limit 1
  ),
  trip_data as (
    select jsonb_build_object(
      'id', t.id,
      'title', coalesce(t.title, t.name),
      'name', coalesce(t.name, t.title),
      'destination', t.destination,
      'start_date', t.start_date,
      'end_date', t.end_date,
      'status', t.status
    ) as trip
    from public.trips t
    join link on link.trip_id = t.id
  ),
  itinerary_data as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'date', i.date,
          'day_index', i.day_index,
          'start_time', i.start_time,
          'end_time', i.end_time,
          'title', i.title,
          'type', i.type,
          'location', coalesce(i.location_name, i.location),
          'location_name', coalesce(i.location_name, i.location),
          'address', i.address,
          'map_url', i.map_url,
          'description', coalesce(i.description, i.note),
          'transportation_note', i.transportation_note,
          'sort_order', i.sort_order
        )
        order by i.date, i.day_index, i.start_time, i.sort_order
      ),
      '[]'::jsonb
    ) as items
    from public.itinerary_items i
    join link on link.trip_id = i.trip_id
  ),
  accommodation_data as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'name', a.name,
          'check_in_date', a.check_in_date,
          'check_out_date', a.check_out_date,
          'check_in_time', a.check_in_time,
          'check_out_time', a.check_out_time,
          'address', a.address,
          'map_url', a.map_url,
          'custom_notes', a.custom_notes
        )
        order by a.check_in_date, a.check_out_date
      ),
      '[]'::jsonb
    ) as items
    from public.accommodations a
    join link on link.trip_id = a.trip_id
  ),
  guide_data as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'title', g.title,
          'description', g.description,
          'url', g.url,
          'created_at', g.created_at
        )
        order by g.created_at
      ),
      '[]'::jsonb
    ) as items
    from public.guide_items g
    join link on link.trip_id = g.trip_id
  )
  select case
    when not exists (select 1 from link) then null
    else jsonb_build_object(
      'trip', (select trip from trip_data),
      'itinerary_items', (select items from itinerary_data),
      'accommodations', (select items from accommodation_data),
      'guide_items', (select items from guide_data)
    )
  end;
$$;

revoke all on function app_private.get_share_snapshot(text) from public;
grant execute on function app_private.get_share_snapshot(text) to anon, authenticated;

create or replace function public.get_share_snapshot(share_token text)
returns jsonb
language sql
stable
security invoker
set search_path = public, app_private, pg_temp
as $$
  select app_private.get_share_snapshot(share_token);
$$;

revoke all on function public.get_share_snapshot(text) from public;
grant execute on function public.get_share_snapshot(text) to anon, authenticated;
