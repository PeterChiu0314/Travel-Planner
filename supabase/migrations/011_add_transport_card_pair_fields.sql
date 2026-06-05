-- Phase 3.0 Transportation Card pair anchors.
-- Keeps visit items sorted by time while transport cards attach to an adjacent visit pair.

alter table public.itinerary_items
  add column if not exists from_item_id uuid references public.itinerary_items(id) on delete cascade,
  add column if not exists to_item_id uuid references public.itinerary_items(id) on delete cascade;

alter table public.itinerary_items
  drop constraint if exists itinerary_items_transport_pair_distinct_check;

alter table public.itinerary_items
  add constraint itinerary_items_transport_pair_distinct_check
  check (from_item_id is null or to_item_id is null or from_item_id <> to_item_id);

with ordered as (
  select
    i.id,
    i.trip_id,
    i.day_index,
    i.item_type,
    row_number() over (
      partition by i.trip_id, i.day_index
      order by i.sort_order, i.start_time nulls last, i.created_at, i.id
    ) as flow_position
  from public.itinerary_items i
),
candidates as (
  select
    current_item.id,
    current_item.trip_id,
    current_item.day_index,
    previous_visit.id as from_item_id,
    next_visit.id as to_item_id
  from ordered current_item
  left join lateral (
    select candidate.id
    from ordered candidate
    where candidate.trip_id = current_item.trip_id
      and candidate.day_index = current_item.day_index
      and candidate.item_type is distinct from 'transport'
      and candidate.flow_position < current_item.flow_position
    order by candidate.flow_position desc
    limit 1
  ) previous_visit on true
  left join lateral (
    select candidate.id
    from ordered candidate
    where candidate.trip_id = current_item.trip_id
      and candidate.day_index = current_item.day_index
      and candidate.item_type is distinct from 'transport'
      and candidate.flow_position > current_item.flow_position
    order by candidate.flow_position
    limit 1
  ) next_visit on true
  where current_item.item_type = 'transport'
),
ranked as (
  select
    candidates.*,
    row_number() over (
      partition by trip_id, day_index, from_item_id, to_item_id
      order by id
    ) as pair_rank
  from candidates
  where from_item_id is not null
    and to_item_id is not null
)
update public.itinerary_items target
set
  from_item_id = ranked.from_item_id,
  to_item_id = ranked.to_item_id
from ranked
where target.id = ranked.id
  and ranked.pair_rank = 1
  and target.item_type = 'transport'
  and target.from_item_id is null
  and target.to_item_id is null;

create unique index if not exists itinerary_items_transport_pair_unique_idx
  on public.itinerary_items(trip_id, day_index, from_item_id, to_item_id)
  where item_type = 'transport'
    and from_item_id is not null
    and to_item_id is not null;

create index if not exists itinerary_items_transport_from_to_idx
  on public.itinerary_items(from_item_id, to_item_id)
  where item_type = 'transport';

comment on column public.itinerary_items.from_item_id is
  'Transportation cards only render when this visit is immediately before to_item_id after time sorting.';

comment on column public.itinerary_items.to_item_id is
  'Transportation cards only render when this visit is immediately after from_item_id after time sorting.';

-- RLS and Realtime remain table-level and continue to apply to itinerary_items.
-- Demo data stays local-only; mock transport rows mirror these nullable pair fields.
