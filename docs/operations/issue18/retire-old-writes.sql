-- Stop old clients from changing the archived financial graph after cutover.
-- Existing rows/history, Source Origin and Baseline remain physically intact.
do $$declare f record;begin
 if exists(select 1 from app_private.budget_edit_leases where expires_at>clock_timestamp())
 or exists(select 1 from app_private.budget_rates_leases where expires_at>clock_timestamp()) then raise exception 'Old financial lease active';end if;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in(
   'budget_edit_lease','budget_lifecycle_lease','budget_metadata_group_lease','budget_metadata_group_lease_v2',
   'budget_payment_lease','budget_payment_lease_v2','budget_rates_lease','budget_source_lease',
   'create_budget_workspace_placeholder','delete_budget_workspace_record','delete_budget_workspace_record_v2',
   'mutate_budget_lifecycle','mutate_budget_payment_v2','mutate_budget_receipt','mutate_budget_source',
   'patch_budget_metadata_group','patch_budget_metadata_group_v2','patch_budget_pricing_group',
   'save_budget_workspace_record','save_budget_workspace_record_v2','save_budget_workspace_record_v3','save_budget_workspace_record_v4',
   'update_trip_budget_rates','update_trip_budget_rates_v2') loop
   execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
 end loop;
end$$;
revoke insert,update,delete on public.budget_items,public.budget_item_participants,public.itinerary_budget_items,
 public.actual_expenses,public.actual_expense_participants from public,anon,authenticated;
