-- Phase 3.1a Transportation Card review snapshots.
-- General warnings compare transport snapshots to current adjacent visit time/destination fields.
-- Pair anchors must not cascade-delete transport cards when a visit is deleted.

alter table public.itinerary_items
  add column if not exists from_snapshot_start_time text,
  add column if not exists from_snapshot_end_time text,
  add column if not exists from_snapshot_destination text,
  add column if not exists to_snapshot_start_time text,
  add column if not exists to_snapshot_end_time text,
  add column if not exists to_snapshot_destination text;

update public.itinerary_items transport
set
  from_snapshot_start_time = coalesce(transport.from_snapshot_start_time, from_visit.start_time::text),
  from_snapshot_end_time = coalesce(transport.from_snapshot_end_time, from_visit.end_time::text),
  from_snapshot_destination = coalesce(
    transport.from_snapshot_destination,
    nullif(coalesce(from_visit.location_name, from_visit.location, from_visit.title), '')
  ),
  to_snapshot_start_time = coalesce(transport.to_snapshot_start_time, to_visit.start_time::text),
  to_snapshot_end_time = coalesce(transport.to_snapshot_end_time, to_visit.end_time::text),
  to_snapshot_destination = coalesce(
    transport.to_snapshot_destination,
    nullif(coalesce(to_visit.location_name, to_visit.location, to_visit.title), '')
  )
from public.itinerary_items from_visit,
  public.itinerary_items to_visit
where transport.item_type = 'transport'
  and from_visit.id = transport.from_item_id
  and to_visit.id = transport.to_item_id;

alter table public.itinerary_items
  drop constraint if exists itinerary_items_from_item_id_fkey,
  drop constraint if exists itinerary_items_to_item_id_fkey;

alter table public.itinerary_items
  add constraint itinerary_items_from_item_id_fkey
  foreign key (from_item_id)
  references public.itinerary_items(id)
  on delete set null,
  add constraint itinerary_items_to_item_id_fkey
  foreign key (to_item_id)
  references public.itinerary_items(id)
  on delete set null;

comment on column public.itinerary_items.from_snapshot_start_time is
  'Visit start_time snapshot captured when a transportation card is created or confirmed.';

comment on column public.itinerary_items.from_snapshot_end_time is
  'Visit end_time snapshot captured when a transportation card is created or confirmed.';

comment on column public.itinerary_items.from_snapshot_destination is
  'Visit destination snapshot captured when a transportation card is created or confirmed.';

comment on column public.itinerary_items.to_snapshot_start_time is
  'Visit start_time snapshot captured when a transportation card is created or confirmed.';

comment on column public.itinerary_items.to_snapshot_end_time is
  'Visit end_time snapshot captured when a transportation card is created or confirmed.';

comment on column public.itinerary_items.to_snapshot_destination is
  'Visit destination snapshot captured when a transportation card is created or confirmed.';
