alter table public.itinerary_items
  add column if not exists is_fixed boolean not null default false,
  add column if not exists fixed_at timestamptz,
  add column if not exists fixed_by uuid references auth.users(id) on delete set null;

comment on column public.itinerary_items.is_fixed is
  'Phase 3.6 visit card fixed state. Fixed visit cards cannot be edited, deleted, flipped, or reordered.';

comment on column public.itinerary_items.fixed_at is
  'Timestamp when a visit card was fixed.';

comment on column public.itinerary_items.fixed_by is
  'User who fixed the visit card.';
