begin;

-- Native receipts have two ownership contracts: create/mutate identify an
-- expense with signature.id, while rates identify the trip with signature.trip.
-- Match either ownership before deleting items; never infer it from actor/session.
-- Keep the installed function's owner checks, try-lock and NOWAIT order unchanged.
create or replace function app_private.remove_trip_expense_graph() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_trip_owner(old.id, auth.uid()) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('expense-trip:' || old.id::text, 0)) then
    raise exception 'Trip transaction in progress' using errcode = '55P03';
  end if;
  perform 1 from expense_stage_b.expense_items where trip_id=old.id order by id for update nowait;
  perform 1 from expense_stage_b.groups where expense_id in (
    select id from expense_stage_b.expense_items where trip_id=old.id
  ) order by expense_id,group_key for update nowait;
  update public.accommodations set expense_id=null where trip_id=old.id and expense_id is not null;
  delete from expense_stage_b.receipts where signature->>'trip' = old.id::text
    or signature->>'id' in (
      select id::text from expense_stage_b.expense_items where trip_id=old.id
    );
  delete from expense_stage_b.expense_itinerary_links where trip_id=old.id;
  delete from expense_stage_b.expense_participants where expense_id in (
    select id from expense_stage_b.expense_items where trip_id=old.id
  );
  delete from expense_stage_b.groups where expense_id in (
    select id from expense_stage_b.expense_items where trip_id=old.id
  );
  delete from expense_stage_b.expense_items where trip_id=old.id;
  delete from expense_stage_b.rate_leases where trip_id=old.id;
  delete from public.expense_signals where trip_id=old.id;
  return old;
end;
$$;
revoke all on function app_private.remove_trip_expense_graph() from public, anon, authenticated;

commit;
