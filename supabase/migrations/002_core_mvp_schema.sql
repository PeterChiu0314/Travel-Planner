create extension if not exists pgcrypto;

alter table public.trips
  add column if not exists name text,
  add column if not exists status text not null default 'planning';

update public.trips
set name = coalesce(name, title)
where name is null;

alter table public.trips
  alter column name set not null;

do $$
begin
  alter table public.trips
    add constraint trips_status_check
    check (status in ('planning', 'traveling', 'settled'));
exception when duplicate_object then null;
end $$;

alter table public.trip_members
  drop constraint if exists trip_members_role_check;

alter table public.trip_members
  add constraint trip_members_role_check
  check (role in ('owner', 'editor', 'viewer'));

alter table public.itinerary_items
  add column if not exists date date,
  add column if not exists location_name text,
  add column if not exists address text,
  add column if not exists map_url text,
  add column if not exists latitude numeric(10, 7),
  add column if not exists longitude numeric(10, 7),
  add column if not exists description text,
  add column if not exists transportation_note text,
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz;

update public.itinerary_items item
set
  date = coalesce(item.date, trip.start_date + item.day_index),
  location_name = coalesce(item.location_name, item.location),
  description = coalesce(item.description, item.note)
from public.trips trip
where item.trip_id = trip.id
  and (item.date is null or item.location_name is null or item.description is null);

create table if not exists public.itinerary_alternatives (
  id uuid primary key default gen_random_uuid(),
  itinerary_item_id uuid not null references public.itinerary_items(id) on delete cascade,
  title text not null,
  location_name text,
  address text,
  map_url text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  description text,
  transportation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null,
  subcategory text,
  title text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'TWD',
  exchange_rate numeric(14, 6),
  twd_amount numeric(12, 2) not null check (twd_amount >= 0),
  payer_id uuid references auth.users(id) on delete set null,
  split_type text not null default 'equal' check (split_type in ('equal', 'custom')),
  is_fixed boolean not null default false,
  auto_created_actual_expense_id uuid,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.budget_item_participants (
  id uuid primary key default gen_random_uuid(),
  budget_item_id uuid not null references public.budget_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (budget_item_id, user_id)
);

create table if not exists public.itinerary_budget_items (
  id uuid primary key default gen_random_uuid(),
  itinerary_item_id uuid not null references public.itinerary_items(id) on delete cascade,
  budget_item_id uuid not null references public.budget_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (itinerary_item_id, budget_item_id)
);

create table if not exists public.actual_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  budget_item_id uuid references public.budget_items(id) on delete set null,
  title text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'TWD',
  exchange_rate numeric(14, 6),
  twd_amount numeric(12, 2) not null check (twd_amount >= 0),
  payer_id uuid references auth.users(id) on delete set null,
  paid_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.budget_items
  drop constraint if exists budget_items_auto_created_actual_expense_id_fkey;

alter table public.budget_items
  add constraint budget_items_auto_created_actual_expense_id_fkey
  foreign key (auto_created_actual_expense_id)
  references public.actual_expenses(id)
  on delete set null;

create table if not exists public.actual_expense_participants (
  id uuid primary key default gen_random_uuid(),
  actual_expense_id uuid not null references public.actual_expenses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (actual_expense_id, user_id)
);

create table if not exists public.accommodations (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name text not null,
  check_in_date date not null,
  check_out_date date not null,
  check_in_time time,
  check_out_time time,
  address text,
  map_url text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  booking_code text,
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid')),
  budget_item_id uuid references public.budget_items(id) on delete set null,
  custom_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accommodations_date_order check (check_out_date >= check_in_date)
);

create table if not exists public.guide_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null,
  description text,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.todo_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null,
  description text,
  due_date date,
  assignee_id uuid references auth.users(id) on delete set null,
  guide_id uuid references public.guide_items(id) on delete set null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_luggage_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null,
  category text,
  assigned_to uuid references auth.users(id) on delete set null,
  packed_by_assignee boolean not null default false,
  confirmed_by_owner boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.luggage_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  category text,
  packed boolean not null default false,
  is_shared_assigned_item boolean not null default false,
  shared_item_id uuid references public.shared_luggage_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  target_type text not null check (target_type in ('accommodation', 'actual_expense', 'budget_item', 'todo', 'guide', 'itinerary')),
  target_id uuid not null,
  file_name text not null,
  file_url text not null,
  file_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  token text not null unique,
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists trips_owner_idx on public.trips(owner_id);
create index if not exists itinerary_items_trip_date_time_idx on public.itinerary_items(trip_id, date, start_time, sort_order);
create index if not exists itinerary_items_locked_by_idx on public.itinerary_items(locked_by);
create index if not exists itinerary_alternatives_item_idx on public.itinerary_alternatives(itinerary_item_id);
create index if not exists budget_items_trip_idx on public.budget_items(trip_id);
create index if not exists budget_items_payer_idx on public.budget_items(payer_id);
create index if not exists budget_item_participants_user_idx on public.budget_item_participants(user_id);
create index if not exists itinerary_budget_items_budget_idx on public.itinerary_budget_items(budget_item_id);
create index if not exists actual_expenses_trip_idx on public.actual_expenses(trip_id);
create index if not exists actual_expenses_budget_idx on public.actual_expenses(budget_item_id);
create index if not exists actual_expenses_payer_idx on public.actual_expenses(payer_id);
create index if not exists actual_expense_participants_user_idx on public.actual_expense_participants(user_id);
create index if not exists accommodations_trip_idx on public.accommodations(trip_id);
create index if not exists todo_items_trip_idx on public.todo_items(trip_id);
create index if not exists todo_items_assignee_idx on public.todo_items(assignee_id);
create index if not exists guide_items_trip_idx on public.guide_items(trip_id);
create index if not exists luggage_items_trip_owner_idx on public.luggage_items(trip_id, owner_id);
create index if not exists luggage_items_shared_item_idx on public.luggage_items(shared_item_id);
create index if not exists shared_luggage_items_trip_idx on public.shared_luggage_items(trip_id);
create index if not exists shared_luggage_items_assigned_to_idx on public.shared_luggage_items(assigned_to);
create index if not exists attachments_trip_target_idx on public.attachments(trip_id, target_type, target_id);
create index if not exists attachments_uploaded_by_idx on public.attachments(uploaded_by);
create index if not exists share_links_trip_idx on public.share_links(trip_id);
create index if not exists share_links_active_token_idx on public.share_links(token) where is_active;
create index if not exists pack_items_created_by_idx on public.pack_items(created_by);
create index if not exists itinerary_items_created_by_idx on public.itinerary_items(created_by);
create index if not exists trip_invites_created_by_idx on public.trip_invites(created_by);
create index if not exists trip_invites_trip_id_idx on public.trip_invites(trip_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.approved_trip_role(target_trip_id uuid, target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.trip_members
  where trip_id = target_trip_id
    and user_id = target_user_id
    and status = 'approved'
  limit 1;
$$;

create or replace function public.can_edit_trip(target_trip_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.approved_trip_role(target_trip_id, target_user_id) in ('owner', 'editor'), false);
$$;

create or replace function public.can_read_trip(target_trip_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.approved_trip_role(target_trip_id, target_user_id) is not null;
$$;

create or replace function public.can_manage_trip(target_trip_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.approved_trip_role(target_trip_id, target_user_id) = 'owner';
$$;

create or replace function public.enforce_shared_luggage_update_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.can_edit_trip(old.trip_id, auth.uid()) then
    return new;
  end if;

  if old.assigned_to = auth.uid()
    and new.id = old.id
    and new.trip_id = old.trip_id
    and new.title = old.title
    and new.category is not distinct from old.category
    and new.assigned_to is not distinct from old.assigned_to
    and new.confirmed_by_owner = old.confirmed_by_owner
    and new.created_at = old.created_at
    and new.updated_at is not distinct from old.updated_at
  then
    return new;
  end if;

  raise exception 'Not allowed to update this shared luggage item';
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'itinerary_alternatives',
    'budget_items',
    'actual_expenses',
    'accommodations',
    'todo_items',
    'guide_items',
    'luggage_items',
    'shared_luggage_items'
  ]
  loop
    execute format('drop trigger if exists touch_%I_updated_at on public.%I', target_table, target_table);
    execute format('create trigger touch_%I_updated_at before update on public.%I for each row execute function public.touch_updated_at()', target_table, target_table);
  end loop;
end $$;

drop trigger if exists enforce_shared_luggage_update_permissions on public.shared_luggage_items;
create trigger enforce_shared_luggage_update_permissions
before update on public.shared_luggage_items
for each row execute function public.enforce_shared_luggage_update_permissions();

alter table public.itinerary_alternatives enable row level security;
alter table public.budget_items enable row level security;
alter table public.budget_item_participants enable row level security;
alter table public.itinerary_budget_items enable row level security;
alter table public.actual_expenses enable row level security;
alter table public.actual_expense_participants enable row level security;
alter table public.accommodations enable row level security;
alter table public.todo_items enable row level security;
alter table public.guide_items enable row level security;
alter table public.luggage_items enable row level security;
alter table public.shared_luggage_items enable row level security;
alter table public.attachments enable row level security;
alter table public.share_links enable row level security;

drop policy if exists "Approved members can read itinerary alternatives" on public.itinerary_alternatives;
create policy "Approved members can read itinerary alternatives"
on public.itinerary_alternatives for select
to authenticated
using (
  exists (
    select 1
    from public.itinerary_items item
    where item.id = itinerary_item_id
      and public.can_read_trip(item.trip_id, auth.uid())
  )
);

drop policy if exists "Editors can manage itinerary alternatives" on public.itinerary_alternatives;
create policy "Editors can manage itinerary alternatives"
on public.itinerary_alternatives for all
to authenticated
using (
  exists (
    select 1
    from public.itinerary_items item
    where item.id = itinerary_item_id
      and public.can_edit_trip(item.trip_id, auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.itinerary_items item
    where item.id = itinerary_item_id
      and public.can_edit_trip(item.trip_id, auth.uid())
  )
);

drop policy if exists "Approved members can read budget items" on public.budget_items;
create policy "Approved members can read budget items"
on public.budget_items for select
to authenticated
using (public.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage budget items" on public.budget_items;
create policy "Editors can manage budget items"
on public.budget_items for all
to authenticated
using (public.can_edit_trip(trip_id, auth.uid()))
with check (public.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read budget participants" on public.budget_item_participants;
create policy "Approved members can read budget participants"
on public.budget_item_participants for select
to authenticated
using (
  exists (
    select 1
    from public.budget_items budget
    where budget.id = budget_item_id
      and public.can_read_trip(budget.trip_id, auth.uid())
  )
);

drop policy if exists "Editors can manage budget participants" on public.budget_item_participants;
create policy "Editors can manage budget participants"
on public.budget_item_participants for all
to authenticated
using (
  exists (
    select 1
    from public.budget_items budget
    where budget.id = budget_item_id
      and public.can_edit_trip(budget.trip_id, auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.budget_items budget
    where budget.id = budget_item_id
      and public.can_edit_trip(budget.trip_id, auth.uid())
  )
);

drop policy if exists "Approved members can read itinerary budget links" on public.itinerary_budget_items;
create policy "Approved members can read itinerary budget links"
on public.itinerary_budget_items for select
to authenticated
using (
  exists (
    select 1
    from public.itinerary_items item
    where item.id = itinerary_item_id
      and public.can_read_trip(item.trip_id, auth.uid())
  )
);

drop policy if exists "Editors can manage itinerary budget links" on public.itinerary_budget_items;
create policy "Editors can manage itinerary budget links"
on public.itinerary_budget_items for all
to authenticated
using (
  exists (
    select 1
    from public.itinerary_items item
    where item.id = itinerary_item_id
      and public.can_edit_trip(item.trip_id, auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.itinerary_items item
    where item.id = itinerary_item_id
      and public.can_edit_trip(item.trip_id, auth.uid())
  )
);

drop policy if exists "Approved members can read actual expenses" on public.actual_expenses;
create policy "Approved members can read actual expenses"
on public.actual_expenses for select
to authenticated
using (public.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage actual expenses" on public.actual_expenses;
create policy "Editors can manage actual expenses"
on public.actual_expenses for all
to authenticated
using (public.can_edit_trip(trip_id, auth.uid()))
with check (public.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read actual participants" on public.actual_expense_participants;
create policy "Approved members can read actual participants"
on public.actual_expense_participants for select
to authenticated
using (
  exists (
    select 1
    from public.actual_expenses expense
    where expense.id = actual_expense_id
      and public.can_read_trip(expense.trip_id, auth.uid())
  )
);

drop policy if exists "Editors can manage actual participants" on public.actual_expense_participants;
create policy "Editors can manage actual participants"
on public.actual_expense_participants for all
to authenticated
using (
  exists (
    select 1
    from public.actual_expenses expense
    where expense.id = actual_expense_id
      and public.can_edit_trip(expense.trip_id, auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.actual_expenses expense
    where expense.id = actual_expense_id
      and public.can_edit_trip(expense.trip_id, auth.uid())
  )
);

drop policy if exists "Approved members can read accommodations" on public.accommodations;
create policy "Approved members can read accommodations"
on public.accommodations for select
to authenticated
using (public.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage accommodations" on public.accommodations;
create policy "Editors can manage accommodations"
on public.accommodations for all
to authenticated
using (public.can_edit_trip(trip_id, auth.uid()))
with check (public.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read guide items" on public.guide_items;
create policy "Approved members can read guide items"
on public.guide_items for select
to authenticated
using (public.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage guide items" on public.guide_items;
create policy "Editors can manage guide items"
on public.guide_items for all
to authenticated
using (public.can_edit_trip(trip_id, auth.uid()))
with check (public.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read todo items" on public.todo_items;
create policy "Approved members can read todo items"
on public.todo_items for select
to authenticated
using (public.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage todo items" on public.todo_items;
create policy "Editors can manage todo items"
on public.todo_items for all
to authenticated
using (public.can_edit_trip(trip_id, auth.uid()))
with check (public.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Owners can read personal luggage" on public.luggage_items;
create policy "Owners can read personal luggage"
on public.luggage_items for select
to authenticated
using (owner_id = auth.uid() and public.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Owners can manage personal luggage" on public.luggage_items;
create policy "Owners can manage personal luggage"
on public.luggage_items for all
to authenticated
using (owner_id = auth.uid() and public.can_read_trip(trip_id, auth.uid()))
with check (owner_id = auth.uid() and public.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read shared luggage" on public.shared_luggage_items;
create policy "Approved members can read shared luggage"
on public.shared_luggage_items for select
to authenticated
using (public.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can create shared luggage" on public.shared_luggage_items;
create policy "Editors can create shared luggage"
on public.shared_luggage_items for insert
to authenticated
with check (public.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Editors and assignees can update shared luggage" on public.shared_luggage_items;
create policy "Editors and assignees can update shared luggage"
on public.shared_luggage_items for update
to authenticated
using (public.can_edit_trip(trip_id, auth.uid()) or assigned_to = auth.uid())
with check (public.can_edit_trip(trip_id, auth.uid()) or assigned_to = auth.uid());

drop policy if exists "Editors can delete shared luggage" on public.shared_luggage_items;
create policy "Editors can delete shared luggage"
on public.shared_luggage_items for delete
to authenticated
using (public.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read attachments" on public.attachments;
create policy "Approved members can read attachments"
on public.attachments for select
to authenticated
using (public.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage attachments" on public.attachments;
create policy "Editors can manage attachments"
on public.attachments for all
to authenticated
using (public.can_edit_trip(trip_id, auth.uid()))
with check (public.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Owners can manage share links" on public.share_links;
create policy "Owners can manage share links"
on public.share_links for all
to authenticated
using (public.can_manage_trip(trip_id, auth.uid()))
with check (public.can_manage_trip(trip_id, auth.uid()));

drop policy if exists "Anyone can read active share links by token" on public.share_links;
create policy "Anyone can read active share links by token"
on public.share_links for select
to anon, authenticated
using (is_active and (expires_at is null or expires_at > now()));

alter table public.itinerary_alternatives replica identity full;
alter table public.budget_items replica identity full;
alter table public.budget_item_participants replica identity full;
alter table public.itinerary_budget_items replica identity full;
alter table public.actual_expenses replica identity full;
alter table public.actual_expense_participants replica identity full;
alter table public.accommodations replica identity full;
alter table public.todo_items replica identity full;
alter table public.guide_items replica identity full;
alter table public.luggage_items replica identity full;
alter table public.shared_luggage_items replica identity full;
alter table public.attachments replica identity full;
alter table public.share_links replica identity full;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'itinerary_alternatives',
    'budget_items',
    'budget_item_participants',
    'itinerary_budget_items',
    'actual_expenses',
    'actual_expense_participants',
    'accommodations',
    'todo_items',
    'guide_items',
    'luggage_items',
    'shared_luggage_items',
    'attachments',
    'share_links'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
