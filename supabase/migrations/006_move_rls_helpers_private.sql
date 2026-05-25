create schema if not exists app_private;

grant usage on schema app_private to authenticated;
grant usage on schema app_private to anon;

create or replace function app_private.approved_trip_role(target_trip_id uuid, target_user_id uuid)
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

create or replace function app_private.can_read_trip(target_trip_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_private.approved_trip_role(target_trip_id, target_user_id) is not null;
$$;

create or replace function app_private.can_edit_trip(target_trip_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(app_private.approved_trip_role(target_trip_id, target_user_id) in ('owner', 'editor'), false);
$$;

create or replace function app_private.can_manage_trip(target_trip_id uuid, target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_private.approved_trip_role(target_trip_id, target_user_id) = 'owner';
$$;

create or replace function app_private.is_trip_member(target_trip_id uuid, target_user_id uuid)
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

create or replace function app_private.is_approved_trip_member(target_trip_id uuid, target_user_id uuid)
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

create or replace function app_private.is_trip_owner(target_trip_id uuid, target_user_id uuid)
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

create or replace function app_private.enforce_shared_luggage_update_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if app_private.can_edit_trip(old.trip_id, auth.uid()) then
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

grant execute on function app_private.approved_trip_role(uuid, uuid) to anon, authenticated;
grant execute on function app_private.can_read_trip(uuid, uuid) to anon, authenticated;
grant execute on function app_private.can_edit_trip(uuid, uuid) to anon, authenticated;
grant execute on function app_private.can_manage_trip(uuid, uuid) to anon, authenticated;
grant execute on function app_private.is_trip_member(uuid, uuid) to anon, authenticated;
grant execute on function app_private.is_approved_trip_member(uuid, uuid) to anon, authenticated;
grant execute on function app_private.is_trip_owner(uuid, uuid) to anon, authenticated;
grant execute on function app_private.enforce_shared_luggage_update_permissions() to anon, authenticated;

drop policy if exists "Members can read trips" on public.trips;
create policy "Members can read trips"
on public.trips for select
to authenticated
using (app_private.is_trip_member(id, auth.uid()));

drop policy if exists "Authenticated users can create owned trips" on public.trips;
create policy "Authenticated users can create owned trips"
on public.trips for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "Owners can update trips" on public.trips;
create policy "Owners can update trips"
on public.trips for update
to authenticated
using (app_private.is_trip_owner(id, auth.uid()))
with check (app_private.is_trip_owner(id, auth.uid()));

drop policy if exists "Owners can delete trips" on public.trips;
create policy "Owners can delete trips"
on public.trips for delete
to authenticated
using (app_private.is_trip_owner(id, auth.uid()));

drop policy if exists "Members can read trip members" on public.trip_members;
create policy "Members can read trip members"
on public.trip_members for select
to authenticated
using (app_private.is_trip_member(trip_id, auth.uid()));

drop policy if exists "Users can request membership or create owner membership" on public.trip_members;
create policy "Users can request membership or create owner membership"
on public.trip_members for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    (role = 'editor' and status = 'pending')
    or (role = 'owner' and status = 'approved' and app_private.is_trip_owner(trip_id, auth.uid()))
  )
);

drop policy if exists "Owners can update memberships" on public.trip_members;
create policy "Owners can update memberships"
on public.trip_members for update
to authenticated
using (app_private.is_trip_owner(trip_id, auth.uid()))
with check (app_private.is_trip_owner(trip_id, auth.uid()));

drop policy if exists "Owners can delete memberships" on public.trip_members;
create policy "Owners can delete memberships"
on public.trip_members for delete
to authenticated
using (app_private.is_trip_owner(trip_id, auth.uid()));

drop policy if exists "Approved members can read itinerary items" on public.itinerary_items;
create policy "Approved members can read itinerary items"
on public.itinerary_items for select
to authenticated
using (app_private.is_approved_trip_member(trip_id, auth.uid()));

drop policy if exists "Approved members can insert itinerary items" on public.itinerary_items;
create policy "Approved members can insert itinerary items"
on public.itinerary_items for insert
to authenticated
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can update itinerary items" on public.itinerary_items;
create policy "Approved members can update itinerary items"
on public.itinerary_items for update
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()))
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can delete itinerary items" on public.itinerary_items;
create policy "Approved members can delete itinerary items"
on public.itinerary_items for delete
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read pack items" on public.pack_items;
create policy "Approved members can read pack items"
on public.pack_items for select
to authenticated
using (app_private.is_approved_trip_member(trip_id, auth.uid()));

drop policy if exists "Approved members can insert pack items" on public.pack_items;
create policy "Approved members can insert pack items"
on public.pack_items for insert
to authenticated
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can update pack items" on public.pack_items;
create policy "Approved members can update pack items"
on public.pack_items for update
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()))
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can delete pack items" on public.pack_items;
create policy "Approved members can delete pack items"
on public.pack_items for delete
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Owners can read invites" on public.trip_invites;
create policy "Owners can read invites"
on public.trip_invites for select
to authenticated
using (app_private.is_trip_owner(trip_id, auth.uid()));

drop policy if exists "Owners can create invites" on public.trip_invites;
create policy "Owners can create invites"
on public.trip_invites for insert
to authenticated
with check (app_private.is_trip_owner(trip_id, auth.uid()));

drop policy if exists "Owners can update invites" on public.trip_invites;
create policy "Owners can update invites"
on public.trip_invites for update
to authenticated
using (app_private.is_trip_owner(trip_id, auth.uid()))
with check (app_private.is_trip_owner(trip_id, auth.uid()));

drop policy if exists "Approved members can read itinerary alternatives" on public.itinerary_alternatives;
create policy "Approved members can read itinerary alternatives"
on public.itinerary_alternatives for select
to authenticated
using (
  exists (
    select 1 from public.itinerary_items item
    where item.id = itinerary_item_id
      and app_private.can_read_trip(item.trip_id, auth.uid())
  )
);

drop policy if exists "Editors can manage itinerary alternatives" on public.itinerary_alternatives;
create policy "Editors can manage itinerary alternatives"
on public.itinerary_alternatives for all
to authenticated
using (
  exists (
    select 1 from public.itinerary_items item
    where item.id = itinerary_item_id
      and app_private.can_edit_trip(item.trip_id, auth.uid())
  )
)
with check (
  exists (
    select 1 from public.itinerary_items item
    where item.id = itinerary_item_id
      and app_private.can_edit_trip(item.trip_id, auth.uid())
  )
);

drop policy if exists "Approved members can read budget items" on public.budget_items;
create policy "Approved members can read budget items"
on public.budget_items for select
to authenticated
using (app_private.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage budget items" on public.budget_items;
create policy "Editors can manage budget items"
on public.budget_items for all
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()))
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read budget participants" on public.budget_item_participants;
create policy "Approved members can read budget participants"
on public.budget_item_participants for select
to authenticated
using (
  exists (
    select 1 from public.budget_items budget
    where budget.id = budget_item_id
      and app_private.can_read_trip(budget.trip_id, auth.uid())
  )
);

drop policy if exists "Editors can manage budget participants" on public.budget_item_participants;
create policy "Editors can manage budget participants"
on public.budget_item_participants for all
to authenticated
using (
  exists (
    select 1 from public.budget_items budget
    where budget.id = budget_item_id
      and app_private.can_edit_trip(budget.trip_id, auth.uid())
  )
)
with check (
  exists (
    select 1 from public.budget_items budget
    where budget.id = budget_item_id
      and app_private.can_edit_trip(budget.trip_id, auth.uid())
  )
);

drop policy if exists "Approved members can read itinerary budget links" on public.itinerary_budget_items;
create policy "Approved members can read itinerary budget links"
on public.itinerary_budget_items for select
to authenticated
using (
  exists (
    select 1 from public.itinerary_items item
    where item.id = itinerary_item_id
      and app_private.can_read_trip(item.trip_id, auth.uid())
  )
);

drop policy if exists "Editors can manage itinerary budget links" on public.itinerary_budget_items;
create policy "Editors can manage itinerary budget links"
on public.itinerary_budget_items for all
to authenticated
using (
  exists (
    select 1 from public.itinerary_items item
    where item.id = itinerary_item_id
      and app_private.can_edit_trip(item.trip_id, auth.uid())
  )
)
with check (
  exists (
    select 1 from public.itinerary_items item
    where item.id = itinerary_item_id
      and app_private.can_edit_trip(item.trip_id, auth.uid())
  )
);

drop policy if exists "Approved members can read actual expenses" on public.actual_expenses;
create policy "Approved members can read actual expenses"
on public.actual_expenses for select
to authenticated
using (app_private.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage actual expenses" on public.actual_expenses;
create policy "Editors can manage actual expenses"
on public.actual_expenses for all
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()))
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read actual participants" on public.actual_expense_participants;
create policy "Approved members can read actual participants"
on public.actual_expense_participants for select
to authenticated
using (
  exists (
    select 1 from public.actual_expenses expense
    where expense.id = actual_expense_id
      and app_private.can_read_trip(expense.trip_id, auth.uid())
  )
);

drop policy if exists "Editors can manage actual participants" on public.actual_expense_participants;
create policy "Editors can manage actual participants"
on public.actual_expense_participants for all
to authenticated
using (
  exists (
    select 1 from public.actual_expenses expense
    where expense.id = actual_expense_id
      and app_private.can_edit_trip(expense.trip_id, auth.uid())
  )
)
with check (
  exists (
    select 1 from public.actual_expenses expense
    where expense.id = actual_expense_id
      and app_private.can_edit_trip(expense.trip_id, auth.uid())
  )
);

drop policy if exists "Approved members can read accommodations" on public.accommodations;
create policy "Approved members can read accommodations"
on public.accommodations for select
to authenticated
using (app_private.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage accommodations" on public.accommodations;
create policy "Editors can manage accommodations"
on public.accommodations for all
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()))
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read guide items" on public.guide_items;
create policy "Approved members can read guide items"
on public.guide_items for select
to authenticated
using (app_private.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage guide items" on public.guide_items;
create policy "Editors can manage guide items"
on public.guide_items for all
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()))
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read todo items" on public.todo_items;
create policy "Approved members can read todo items"
on public.todo_items for select
to authenticated
using (app_private.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage todo items" on public.todo_items;
create policy "Editors can manage todo items"
on public.todo_items for all
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()))
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Owners can read personal luggage" on public.luggage_items;
create policy "Owners can read personal luggage"
on public.luggage_items for select
to authenticated
using (owner_id = auth.uid() and app_private.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Owners can manage personal luggage" on public.luggage_items;
create policy "Owners can manage personal luggage"
on public.luggage_items for all
to authenticated
using (owner_id = auth.uid() and app_private.can_read_trip(trip_id, auth.uid()))
with check (owner_id = auth.uid() and app_private.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read shared luggage" on public.shared_luggage_items;
create policy "Approved members can read shared luggage"
on public.shared_luggage_items for select
to authenticated
using (app_private.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can create shared luggage" on public.shared_luggage_items;
create policy "Editors can create shared luggage"
on public.shared_luggage_items for insert
to authenticated
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Editors and assignees can update shared luggage" on public.shared_luggage_items;
create policy "Editors and assignees can update shared luggage"
on public.shared_luggage_items for update
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()) or assigned_to = auth.uid())
with check (app_private.can_edit_trip(trip_id, auth.uid()) or assigned_to = auth.uid());

drop policy if exists "Editors can delete shared luggage" on public.shared_luggage_items;
create policy "Editors can delete shared luggage"
on public.shared_luggage_items for delete
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Approved members can read attachments" on public.attachments;
create policy "Approved members can read attachments"
on public.attachments for select
to authenticated
using (app_private.can_read_trip(trip_id, auth.uid()));

drop policy if exists "Editors can manage attachments" on public.attachments;
create policy "Editors can manage attachments"
on public.attachments for all
to authenticated
using (app_private.can_edit_trip(trip_id, auth.uid()))
with check (app_private.can_edit_trip(trip_id, auth.uid()));

drop policy if exists "Owners can manage share links" on public.share_links;
create policy "Owners can manage share links"
on public.share_links for all
to authenticated
using (app_private.can_manage_trip(trip_id, auth.uid()))
with check (app_private.can_manage_trip(trip_id, auth.uid()));

drop trigger if exists enforce_shared_luggage_update_permissions on public.shared_luggage_items;
create trigger enforce_shared_luggage_update_permissions
before update on public.shared_luggage_items
for each row execute function app_private.enforce_shared_luggage_update_permissions();
