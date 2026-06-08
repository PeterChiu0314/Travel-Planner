alter table public.itinerary_alternatives
  add column if not exists type text,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists cost numeric(12, 2) not null default 0;

alter table public.itinerary_alternatives
  drop constraint if exists itinerary_alternatives_cost_check;

alter table public.itinerary_alternatives
  add constraint itinerary_alternatives_cost_check
  check (cost >= 0);

comment on column public.itinerary_alternatives.type is
  'Phase 3.3 single visit alternative type, aligned with itinerary_items.type.';
comment on column public.itinerary_alternatives.start_time is
  'Phase 3.3 single visit alternative start time.';
comment on column public.itinerary_alternatives.end_time is
  'Phase 3.3 single visit alternative end time.';
comment on column public.itinerary_alternatives.cost is
  'Phase 3.3 single visit alternative estimated cost.';

-- RLS and Realtime check:
-- This migration adds columns to public.itinerary_alternatives only. Existing
-- itinerary_alternatives RLS policies, replica identity full, and realtime
-- publication continue to apply at the table level.
