create table if not exists public.itinerary_route_override_nodes (
  id uuid primary key default gen_random_uuid(),
  route_override_id uuid not null references public.itinerary_route_overrides(id) on delete cascade,
  node_key text not null,
  order_key numeric(20, 6) not null,
  lat double precision not null,
  lng double precision not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (route_override_id, node_key),
  constraint itinerary_route_override_nodes_node_key_check check (length(trim(node_key)) between 1 and 128),
  constraint itinerary_route_override_nodes_lat_check check (lat between -90 and 90),
  constraint itinerary_route_override_nodes_lng_check check (lng between -180 and 180)
);

create index if not exists itinerary_route_override_nodes_route_order_idx
  on public.itinerary_route_override_nodes(route_override_id, order_key, node_key);

create index if not exists itinerary_route_override_nodes_created_by_idx
  on public.itinerary_route_override_nodes(created_by)
  where created_by is not null;

create index if not exists itinerary_route_override_nodes_updated_by_idx
  on public.itinerary_route_override_nodes(updated_by)
  where updated_by is not null;

drop trigger if exists touch_itinerary_route_override_nodes_updated_at on public.itinerary_route_override_nodes;
create trigger touch_itinerary_route_override_nodes_updated_at
before update on public.itinerary_route_override_nodes
for each row execute function public.touch_updated_at();

create or replace function app_private.enforce_itinerary_route_override_node_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  node_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.route_override_id::text, 0)
  );

  select count(*)
  into node_count
  from public.itinerary_route_override_nodes
  where route_override_id = new.route_override_id;

  if node_count >= 5 then
    raise exception 'route override node limit exceeded'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function app_private.enforce_itinerary_route_override_node_limit() from public;
revoke all on function app_private.enforce_itinerary_route_override_node_limit() from anon, authenticated;

drop trigger if exists enforce_itinerary_route_override_node_limit on public.itinerary_route_override_nodes;
create trigger enforce_itinerary_route_override_node_limit
before insert on public.itinerary_route_override_nodes
for each row execute function app_private.enforce_itinerary_route_override_node_limit();

alter table public.itinerary_route_override_nodes enable row level security;

revoke all on table public.itinerary_route_override_nodes from anon;
grant select, insert, update, delete on table public.itinerary_route_override_nodes to authenticated;

drop policy if exists "Approved members can read itinerary route override nodes" on public.itinerary_route_override_nodes;
create policy "Approved members can read itinerary route override nodes"
on public.itinerary_route_override_nodes for select
to authenticated
using (
  exists (
    select 1
    from public.itinerary_route_overrides route_override
    where route_override.id = route_override_id
      and app_private.can_read_trip(route_override.trip_id, (select auth.uid()))
  )
);

drop policy if exists "Editors can insert itinerary route override nodes" on public.itinerary_route_override_nodes;
create policy "Editors can insert itinerary route override nodes"
on public.itinerary_route_override_nodes for insert
to authenticated
with check (
  exists (
    select 1
    from public.itinerary_route_overrides route_override
    where route_override.id = route_override_id
      and app_private.can_edit_trip(route_override.trip_id, (select auth.uid()))
  )
);

drop policy if exists "Editors can update itinerary route override nodes" on public.itinerary_route_override_nodes;
create policy "Editors can update itinerary route override nodes"
on public.itinerary_route_override_nodes for update
to authenticated
using (
  exists (
    select 1
    from public.itinerary_route_overrides route_override
    where route_override.id = route_override_id
      and app_private.can_edit_trip(route_override.trip_id, (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.itinerary_route_overrides route_override
    where route_override.id = route_override_id
      and app_private.can_edit_trip(route_override.trip_id, (select auth.uid()))
  )
);

drop policy if exists "Editors can delete itinerary route override nodes" on public.itinerary_route_override_nodes;
create policy "Editors can delete itinerary route override nodes"
on public.itinerary_route_override_nodes for delete
to authenticated
using (
  exists (
    select 1
    from public.itinerary_route_overrides route_override
    where route_override.id = route_override_id
      and app_private.can_edit_trip(route_override.trip_id, (select auth.uid()))
  )
);

insert into public.itinerary_route_override_nodes (
  route_override_id,
  node_key,
  order_key,
  lat,
  lng,
  created_by,
  updated_by
)
select
  route_override.id,
  coalesce(
    nullif(trim(point.value ->> 'id'), ''),
    'legacy-' || (point.ordinality - 1)::text || '-' || (point.value ->> 'lat') || '-' || (point.value ->> 'lng')
  ),
  point.ordinality * 1000,
  (point.value ->> 'lat')::double precision,
  (point.value ->> 'lng')::double precision,
  route_override.created_by,
  route_override.updated_by
from public.itinerary_route_overrides route_override
cross join lateral jsonb_array_elements(route_override.points_json) with ordinality as point(value, ordinality)
where jsonb_typeof(point.value) = 'object'
  and jsonb_typeof(point.value -> 'lat') = 'number'
  and jsonb_typeof(point.value -> 'lng') = 'number'
  and (point.value ->> 'lat')::double precision between -90 and 90
  and (point.value ->> 'lng')::double precision between -180 and 180
on conflict (route_override_id, node_key) do nothing;

create or replace function app_private.touch_itinerary_route_override_from_node()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.itinerary_route_overrides
  set updated_at = now(),
      updated_by = coalesce(new.updated_by, old.updated_by, auth.uid())
  where id = coalesce(new.route_override_id, old.route_override_id);

  return coalesce(new, old);
end;
$$;

revoke all on function app_private.touch_itinerary_route_override_from_node() from public;
revoke all on function app_private.touch_itinerary_route_override_from_node() from anon, authenticated;

drop trigger if exists touch_itinerary_route_override_from_node on public.itinerary_route_override_nodes;
create trigger touch_itinerary_route_override_from_node
after insert or update or delete on public.itinerary_route_override_nodes
for each row execute function app_private.touch_itinerary_route_override_from_node();
