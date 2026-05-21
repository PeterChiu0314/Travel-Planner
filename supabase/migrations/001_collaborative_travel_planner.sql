create extension if not exists pgcrypto;

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  destination text not null,
  start_date date not null,
  end_date date not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_date_order check (end_date >= start_date)
);

create table if not exists public.trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor')),
  status text not null check (status in ('pending', 'approved')),
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  unique (trip_id, user_id)
);

create table if not exists public.itinerary_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_index integer not null check (day_index >= 0),
  sort_order integer not null default 0,
  type text not null check (type in ('attraction', 'food', 'hotel', 'transport', 'note')),
  start_time time,
  end_time time,
  title text not null,
  location text,
  note text,
  cost numeric(12, 2) not null default 0 check (cost >= 0),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pack_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token text not null unique,
  created_by uuid references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists trip_members_user_idx on public.trip_members(user_id);
create index if not exists trip_members_trip_idx on public.trip_members(trip_id);
create index if not exists itinerary_items_trip_day_idx on public.itinerary_items(trip_id, day_index, sort_order);
create index if not exists pack_items_trip_idx on public.pack_items(trip_id);
create index if not exists trip_invites_token_idx on public.trip_invites(token);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_trips_updated_at on public.trips;
create trigger touch_trips_updated_at
before update on public.trips
for each row execute function public.touch_updated_at();

drop trigger if exists touch_itinerary_items_updated_at on public.itinerary_items;
create trigger touch_itinerary_items_updated_at
before update on public.itinerary_items
for each row execute function public.touch_updated_at();

drop trigger if exists touch_pack_items_updated_at on public.pack_items;
create trigger touch_pack_items_updated_at
before update on public.pack_items
for each row execute function public.touch_updated_at();

create or replace function public.is_trip_owner(target_trip_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips
    where id = target_trip_id
      and owner_id = target_user_id
  );
$$;

create or replace function public.is_approved_trip_member(target_trip_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_id = target_trip_id
      and user_id = target_user_id
      and status = 'approved'
  );
$$;

create or replace function public.is_trip_member(target_trip_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_id = target_trip_id
      and user_id = target_user_id
  );
$$;

create or replace function public.request_trip_membership(
  invite_token text,
  member_display_name text,
  member_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_trip_id uuid;
begin
  select trip_id
  into target_trip_id
  from public.trip_invites
  where token = invite_token
    and revoked_at is null;

  if target_trip_id is null then
    return null;
  end if;

  insert into public.trip_members (
    trip_id,
    user_id,
    role,
    status,
    display_name,
    email
  )
  values (
    target_trip_id,
    auth.uid(),
    'editor',
    'pending',
    member_display_name,
    member_email
  )
  on conflict (trip_id, user_id) do nothing;

  return target_trip_id;
end;
$$;

alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.pack_items enable row level security;
alter table public.trip_invites enable row level security;

drop policy if exists "Members can read trips" on public.trips;
create policy "Members can read trips"
on public.trips for select
to authenticated
using (public.is_trip_member(id, auth.uid()));

drop policy if exists "Authenticated users can create owned trips" on public.trips;
create policy "Authenticated users can create owned trips"
on public.trips for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "Owners can update trips" on public.trips;
create policy "Owners can update trips"
on public.trips for update
to authenticated
using (public.is_trip_owner(id, auth.uid()))
with check (public.is_trip_owner(id, auth.uid()));

drop policy if exists "Owners can delete trips" on public.trips;
create policy "Owners can delete trips"
on public.trips for delete
to authenticated
using (public.is_trip_owner(id, auth.uid()));

drop policy if exists "Members can read trip members" on public.trip_members;
create policy "Members can read trip members"
on public.trip_members for select
to authenticated
using (public.is_trip_member(trip_id, auth.uid()));

drop policy if exists "Users can request membership or create owner membership" on public.trip_members;
create policy "Users can request membership or create owner membership"
on public.trip_members for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    (role = 'editor' and status = 'pending')
    or (role = 'owner' and status = 'approved' and public.is_trip_owner(trip_id, auth.uid()))
  )
);

drop policy if exists "Owners can update memberships" on public.trip_members;
create policy "Owners can update memberships"
on public.trip_members for update
to authenticated
using (public.is_trip_owner(trip_id, auth.uid()))
with check (public.is_trip_owner(trip_id, auth.uid()));

drop policy if exists "Owners can delete memberships" on public.trip_members;
create policy "Owners can delete memberships"
on public.trip_members for delete
to authenticated
using (public.is_trip_owner(trip_id, auth.uid()));

drop policy if exists "Approved members can read itinerary items" on public.itinerary_items;
create policy "Approved members can read itinerary items"
on public.itinerary_items for select
to authenticated
using (public.is_approved_trip_member(trip_id, auth.uid()));

drop policy if exists "Approved members can insert itinerary items" on public.itinerary_items;
create policy "Approved members can insert itinerary items"
on public.itinerary_items for insert
to authenticated
with check (public.is_approved_trip_member(trip_id, auth.uid()));

drop policy if exists "Approved members can update itinerary items" on public.itinerary_items;
create policy "Approved members can update itinerary items"
on public.itinerary_items for update
to authenticated
using (public.is_approved_trip_member(trip_id, auth.uid()))
with check (public.is_approved_trip_member(trip_id, auth.uid()));

drop policy if exists "Approved members can delete itinerary items" on public.itinerary_items;
create policy "Approved members can delete itinerary items"
on public.itinerary_items for delete
to authenticated
using (public.is_approved_trip_member(trip_id, auth.uid()));

drop policy if exists "Approved members can read pack items" on public.pack_items;
create policy "Approved members can read pack items"
on public.pack_items for select
to authenticated
using (public.is_approved_trip_member(trip_id, auth.uid()));

drop policy if exists "Approved members can insert pack items" on public.pack_items;
create policy "Approved members can insert pack items"
on public.pack_items for insert
to authenticated
with check (public.is_approved_trip_member(trip_id, auth.uid()));

drop policy if exists "Approved members can update pack items" on public.pack_items;
create policy "Approved members can update pack items"
on public.pack_items for update
to authenticated
using (public.is_approved_trip_member(trip_id, auth.uid()))
with check (public.is_approved_trip_member(trip_id, auth.uid()));

drop policy if exists "Approved members can delete pack items" on public.pack_items;
create policy "Approved members can delete pack items"
on public.pack_items for delete
to authenticated
using (public.is_approved_trip_member(trip_id, auth.uid()));

drop policy if exists "Owners can read invites" on public.trip_invites;
create policy "Owners can read invites"
on public.trip_invites for select
to authenticated
using (public.is_trip_owner(trip_id, auth.uid()));

drop policy if exists "Owners can create invites" on public.trip_invites;
create policy "Owners can create invites"
on public.trip_invites for insert
to authenticated
with check (public.is_trip_owner(trip_id, auth.uid()));

drop policy if exists "Owners can update invites" on public.trip_invites;
create policy "Owners can update invites"
on public.trip_invites for update
to authenticated
using (public.is_trip_owner(trip_id, auth.uid()))
with check (public.is_trip_owner(trip_id, auth.uid()));

alter table public.trips replica identity full;
alter table public.trip_members replica identity full;
alter table public.itinerary_items replica identity full;
alter table public.pack_items replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.trips;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.trip_members;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.itinerary_items;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.pack_items;
exception when duplicate_object then null;
end $$;
