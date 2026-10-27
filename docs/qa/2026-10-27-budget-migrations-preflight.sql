-- Read-only preflight for the two existing Budget safety migrations.
select 'migration_state' as check_name,jsonb_build_object(
 'safety_applied',exists(select 1 from supabase_migrations.schema_migrations where version='20261022110000'),
 'planning_applied',exists(select 1 from supabase_migrations.schema_migrations where version='20261022120000'),
 'new_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='actual_expenses' and column_name in ('twd_amount_source','actual_twd_amount','payment_origin','payment_active','payment_history')))::text as result
union all
select 'affected_rows',jsonb_build_object('actual_expenses',(select count(*) from public.actual_expenses),
 'budgets',(select count(*) from public.budget_items),'attachments',(select count(*) from public.attachments),
 'baselines',(select count(*) from public.trip_budget_baselines),
 'invalid_actual_costs',(select count(*) from public.actual_expenses where twd_amount is null or twd_amount<0),
 'active_budget_locks',(select count(*) from public.budget_items where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes'),
 'active_actual_locks',(select count(*) from public.actual_expenses where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes'))::text
union all
select 'actual_original_content',jsonb_build_object('count',count(*),'digest',md5(coalesce(jsonb_agg(to_jsonb(e)-'updated_at' order by e.id)::text,'[]')))::text from public.actual_expenses e
union all
select 'budget_original_content',jsonb_build_object('count',count(*),'digest',md5(coalesce(jsonb_agg(to_jsonb(b) order by b.id)::text,'[]')))::text from public.budget_items b
union all
select 'existing_function_backups',jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'definition',pg_get_functiondef(p.oid)))::text
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='app_private' and p.proname='apply_trip_budget_rate') or (n.nspname='public' and p.proname='update_trip_budget_rates');
