-- No business writes or test fixtures. Inspect the older hosted delete API.
select jsonb_build_object(
  'delete_rpc',pg_get_functiondef('public.delete_budget_workspace_record(uuid,text,uuid,timestamptz)'::regprocedure),
  'invoker',(select not prosecdef from pg_proc where oid='public.delete_budget_workspace_record(uuid,text,uuid,timestamptz)'::regprocedure),
  'authenticated_execute',has_function_privilege('authenticated','public.delete_budget_workspace_record(uuid,text,uuid,timestamptz)','EXECUTE'),
  'anon_execute',has_function_privilege('anon','public.delete_budget_workspace_record(uuid,text,uuid,timestamptz)','EXECUTE'),
  'actual_count',(select count(*) from public.actual_expenses),
  'budget_count',(select count(*) from public.budget_items),
  'lease_migration_applied',exists(select 1 from supabase_migrations.schema_migrations where version='20261027140044'),
  'snapshot_migration_applied',exists(select 1 from supabase_migrations.schema_migrations where version='20261027145613'),
  'lock_wait_count',(select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock'),
  'statement_stats_schema',(select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where extname='pg_stat_statements')
) as result;
