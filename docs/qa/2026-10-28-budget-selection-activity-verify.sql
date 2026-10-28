-- Readonly post-application checks. This task has not applied the migration remotely.
select 'activity_columns' check_name,
  (select count(*)=2 from information_schema.columns where table_schema='app_private' and table_name='budget_selections' and column_name in ('activity_id','selected_at')) passed
union all
select 'invoker_authenticated_v2_api',coalesce((select not p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE') from pg_proc p where p.oid=to_regprocedure('public.update_budget_selection_v2(uuid,uuid,text,uuid,uuid,text)')),false)
union all
select 'private_selection_table_closed',coalesce((select c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') from pg_class c where c.oid=to_regclass('app_private.budget_selections')),false)
union all
select 'private_metadata_unpublished',not exists(select 1 from pg_publication_tables where schemaname='app_private' and tablename in ('budget_selections','budget_edit_leases'))
union all
select 'legacy_selection_api_retained',to_regprocedure('public.update_budget_selection(uuid,uuid,text,uuid)') is not null
union all
select 'protocol_v2_reader',coalesce(pg_get_functiondef(to_regprocedure('app_private.read_budget_collaboration(uuid,uuid)')) like '%selectionProtocol%2%',false);
