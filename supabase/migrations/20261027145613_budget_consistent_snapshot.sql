-- One statement / MVCC snapshot. No financial or collaboration writes.
begin;
create function public.read_budget_snapshot(p_trip_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with allowed as materialized (
    select t.id,t.budget_exchange_rates from public.trips t
    where t.id=p_trip_id and (select auth.uid()) is not null
      and app_private.can_read_trip(t.id,(select auth.uid()))
  ), budgets as materialized (
    select b.* from public.budget_items b join allowed t on b.trip_id=t.id
  ), actuals as materialized (
    select e.* from public.actual_expenses e join allowed t on e.trip_id=t.id
  ), itinerary as materialized (
    select i.id,i.trip_id,i.title,i.day_index,i.sort_order,i.type,i.item_type
    from public.itinerary_items i join allowed t on i.trip_id=t.id
  )
  select jsonb_build_object(
    'tripId',t.id,'tripBudgetRates',t.budget_exchange_rates,
    'budgetItems',(select coalesce(jsonb_agg(to_jsonb(b) order by b.id),'[]') from budgets b),
    'budgetParticipants',(select coalesce(jsonb_agg(to_jsonb(p) order by p.budget_item_id,p.user_id),'[]')
      from public.budget_item_participants p join budgets b on p.budget_item_id=b.id),
    'actualExpenses',(select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from actuals e),
    'actualParticipants',(select coalesce(jsonb_agg(to_jsonb(p) order by p.actual_expense_id,p.user_id),'[]')
      from public.actual_expense_participants p join actuals e on p.actual_expense_id=e.id),
    'itineraryBudgetLinks',(select coalesce(jsonb_agg(to_jsonb(l) order by l.budget_item_id,l.itinerary_item_id),'[]')
      from public.itinerary_budget_items l join budgets b on l.budget_item_id=b.id join itinerary i on l.itinerary_item_id=i.id),
    'budgetBaseline',(select to_jsonb(s) from public.trip_budget_baselines s where s.trip_id=t.id),
    'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.day_index,i.sort_order,i.id),'[]') from itinerary i),
    'members',(select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]') from (
      select id,trip_id,user_id,role,status,display_name,email,created_at from public.trip_members where trip_id=t.id and status='approved'
    ) m),
    'attachments',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]')
      from public.attachments a where a.trip_id=t.id and a.target_type='actual_expense' and a.target_id in(select id from actuals))
  ) from allowed t
$$;
revoke all on function public.read_budget_snapshot(uuid) from public,anon;
grant execute on function public.read_budget_snapshot(uuid) to authenticated;
commit;
