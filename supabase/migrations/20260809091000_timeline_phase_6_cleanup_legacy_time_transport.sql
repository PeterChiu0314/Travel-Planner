-- Timeline Phase 6 legacy cleanup.
-- Normalizes partial visit time, removes tail-only transport rows, and freezes
-- the transport model to complete same-Day destination pairs.

update public.itinerary_items item
set start_time = null,
    end_time = null,
    is_fixed = false,
    fixed_at = null,
    fixed_by = null,
    updated_at = now()
where item.item_type <> 'transport'
  and ((item.start_time is null) <> (item.end_time is null));

update public.itinerary_items item
set transport_role = 'normal_pair',
    updated_at = now()
where item.item_type = 'transport'
  and item.from_item_id is not null
  and item.to_item_id is not null
  and item.transport_role in ('tail_promoted_pair', 'tail_pending');

-- Tail rows and structurally invalid legacy pairs cannot participate in the
-- Phase 6 model. Removing them is safer than inventing an endpoint.
delete from public.itinerary_items transport
where transport.item_type = 'transport'
  and (
    transport.from_item_id is null
    or transport.to_item_id is null
    or not exists (
      select 1
      from public.itinerary_items from_item
      join public.itinerary_items to_item on to_item.id = transport.to_item_id
      where from_item.id = transport.from_item_id
        and from_item.item_type <> 'transport'
        and to_item.item_type <> 'transport'
        and from_item.trip_id = transport.trip_id
        and to_item.trip_id = transport.trip_id
        and from_item.day_index = transport.day_index
        and to_item.day_index = transport.day_index
    )
  );

update public.itinerary_items item
set transport_role = case when item.item_type = 'transport' then 'normal_pair' else null end,
    updated_at = now()
where item.transport_role is distinct from case when item.item_type = 'transport' then 'normal_pair' else null end;

alter table public.itinerary_items
  drop constraint if exists itinerary_items_transport_role_check;

alter table public.itinerary_items
  add constraint itinerary_items_transport_role_check
  check (
    (item_type = 'transport' and transport_role = 'normal_pair')
    or (item_type <> 'transport' and transport_role is null)
  );

alter table public.itinerary_items
  drop constraint if exists itinerary_items_phase_6_time_state_check;

alter table public.itinerary_items
  add constraint itinerary_items_phase_6_time_state_check
  check (
    item_type = 'transport'
    or ((start_time is null and end_time is null) or (start_time is not null and end_time is not null and end_time > start_time))
  );

alter table public.itinerary_items
  drop constraint if exists itinerary_items_phase_6_transport_pair_check;

alter table public.itinerary_items
  add constraint itinerary_items_phase_6_transport_pair_check
  check (
    item_type <> 'transport'
    or (
      from_item_id is not null
      and to_item_id is not null
      and from_item_id <> to_item_id
      and transport_role = 'normal_pair'
      and transport_duration_minutes is not null
      and transport_duration_minutes > 0
    )
  );

create or replace function app_private.enforce_timeline_transport_pair_scope()
returns trigger
language plpgsql
security definer
set search_path = public, app_private, pg_catalog
as $$
declare
  from_item public.itinerary_items%rowtype;
  to_item public.itinerary_items%rowtype;
begin
  if new.item_type <> 'transport' then
    if new.transport_role is not null then raise exception 'invalid_transport_role'; end if;
    return new;
  end if;
  if new.from_item_id is null or new.to_item_id is null or new.from_item_id = new.to_item_id then
    raise exception 'invalid_transport';
  end if;
  select item.* into from_item from public.itinerary_items item where item.id = new.from_item_id;
  select item.* into to_item from public.itinerary_items item where item.id = new.to_item_id;
  if not found or from_item.id is null or to_item.id is null
    or from_item.item_type = 'transport'
    or to_item.item_type = 'transport'
    or from_item.trip_id <> new.trip_id
    or to_item.trip_id <> new.trip_id
    or from_item.day_index <> new.day_index
    or to_item.day_index <> new.day_index
  then
    raise exception 'invalid_transport_scope';
  end if;
  new.transport_role := 'normal_pair';
  return new;
end;
$$;

revoke all on function app_private.enforce_timeline_transport_pair_scope() from public, anon, authenticated;

drop trigger if exists enforce_timeline_transport_pair_scope on public.itinerary_items;
create trigger enforce_timeline_transport_pair_scope
before insert or update of item_type, trip_id, day_index, from_item_id, to_item_id, transport_role
on public.itinerary_items
for each row execute function app_private.enforce_timeline_transport_pair_scope();

comment on column public.itinerary_items.transport_role is
  'Timeline Phase 6 transport role. Only normal_pair remains; tail transport semantics were removed.';
