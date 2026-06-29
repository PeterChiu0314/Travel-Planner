-- Timeline Phase 4.5b Transportation Role Model.
-- Distinguishes normal transport pairs from tail transports and tail-promoted pairs.

alter table public.itinerary_items
  add column if not exists transport_role text;

alter table public.itinerary_items
  drop constraint if exists itinerary_items_transport_role_check;

alter table public.itinerary_items
  add constraint itinerary_items_transport_role_check
  check (
    transport_role is null
    or transport_role in ('normal_pair', 'tail_pending', 'tail_promoted_pair')
  );

update public.itinerary_items
set transport_role = case
  when to_item_id is null then 'tail_pending'
  else 'normal_pair'
end
where item_type = 'transport'
  and transport_role is null;

update public.itinerary_items
set transport_role = null
where item_type <> 'transport'
  and transport_role is not null;

comment on column public.itinerary_items.transport_role is
  'Timeline transportation role: normal_pair, tail_pending, or tail_promoted_pair. Null for non-transport items.';
