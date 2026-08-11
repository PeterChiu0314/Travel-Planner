-- Timeline Phase 6 Production hotfix.
-- Destination-package reorder moves visit payloads between stable slot IDs and
-- remaps every preserved transport endpoint in the same transaction. The
-- transport pair must therefore be unique in the final state, not after each
-- intermediate row update.

drop index if exists public.itinerary_items_transport_pair_unique_idx;

alter table public.itinerary_items
  add constraint itinerary_items_transport_pair_unique_idx
  unique (trip_id, day_index, from_item_id, to_item_id, item_type)
  deferrable initially deferred;

comment on constraint itinerary_items_transport_pair_unique_idx on public.itinerary_items is
  'Deferrable Phase 6 transport-pair uniqueness. Allows atomic endpoint remapping during reorder while rejecting duplicate final pairs at transaction commit.';
