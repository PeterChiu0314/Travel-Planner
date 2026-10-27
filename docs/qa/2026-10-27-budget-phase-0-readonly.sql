-- Phase 0 catalog-only inspection. No application records or credentials.
-- Run as one SELECT in the authenticated Dashboard; no DDL/DML/migration.
with scope(name) as (values ('budget_items'),('budget_item_participants'),
  ('actual_expenses'),('actual_expense_participants'),('itinerary_budget_items'),
  ('trip_budget_baselines'),('trips'))
select 'realtime' as area, 'messages' as item,
  jsonb_build_object('rls',c.relrowsecurity,'policy_count',
    (select count(*) from pg_policies where schemaname='realtime' and tablename='messages'))::text as details
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='realtime' and c.relname='messages'
union all
select 'table',s.name,jsonb_build_object('rls',c.relrowsecurity,'replica',c.relreplident,
  'published',exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=s.name),
  'trip_id',exists(select 1 from information_schema.columns where table_schema='public' and table_name=s.name and column_name='trip_id'),
  'read_policies',(select jsonb_agg(jsonb_build_object('roles',roles,'using',qual)) from pg_policies where schemaname='public' and tablename=s.name and cmd in ('ALL','SELECT')),
  'triggers',(select jsonb_agg(t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal))::text
from scope s join pg_class c on c.relname=s.name join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
union all
select 'rpc',p.proname,jsonb_build_object('signature',pg_get_function_identity_arguments(p.oid),
  'security_definer',p.prosecdef,'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'anon',has_function_privilege('anon',p.oid,'EXECUTE'))::text
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
and p.proname in ('save_budget_workspace_record_v2','save_budget_workspace_record_v3','delete_budget_workspace_record','update_trip_budget_rates')
union all
select 'migration',version,name from supabase_migrations.schema_migrations
where version like '20261022%' or version=(select max(version) from supabase_migrations.schema_migrations)
order by area,item;
