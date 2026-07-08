create table if not exists public.itinerary_route_overrides (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_index integer not null,
  from_item_id uuid not null references public.itinerary_items(id) on delete cascade,
  to_item_id uuid not null references public.itinerary_items(id) on delete cascade,
  points_json jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, day_index, from_item_id, to_item_id),
  constraint itinerary_route_overrides_points_json_array_check
    check (jsonb_typeof(points_json) = 'array')
);

create index if not exists itinerary_route_overrides_trip_day_idx
  on public.itinerary_route_overrides(trip_id, day_index);

create index if not exists itinerary_route_overrides_from_item_idx
  on public.itinerary_route_overrides(from_item_id);

create index if not exists itinerary_route_overrides_to_item_idx
  on public.itinerary_route_overrides(to_item_id);

drop trigger if exists touch_itinerary_route_overrides_updated_at on public.itinerary_route_overrides;
create trigger touch_itinerary_route_overrides_updated_at
before update on public.itinerary_route_overrides
for each row execute function public.touch_updated_at();

alter table public.itinerary_route_overrides enable row level security;

drop policy if exists "Approved members can read itinerary route overrides" on public.itinerary_route_overrides;
create policy "Approved members can read itinerary route overrides"
on public.itinerary_route_overrides for select
to authenticated
using (app_private.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can insert itinerary route overrides" on public.itinerary_route_overrides;
create policy "Editors can insert itinerary route overrides"
on public.itinerary_route_overrides for insert
to authenticated
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Editors can update itinerary route overrides" on public.itinerary_route_overrides;
create policy "Editors can update itinerary route overrides"
on public.itinerary_route_overrides for update
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()))
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Editors can delete itinerary route overrides" on public.itinerary_route_overrides;
create policy "Editors can delete itinerary route overrides"
on public.itinerary_route_overrides for delete
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()));
