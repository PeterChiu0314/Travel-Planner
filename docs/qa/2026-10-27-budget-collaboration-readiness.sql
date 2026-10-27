-- Read-only; safe before applying the new migrations.
select 'old_safety_prerequisites' check_name,(select count(*)=2 from supabase_migrations.schema_migrations where version in ('20261022110000','20261022120000')) passed
union all select 'new_migrations_absent',not exists(select 1 from supabase_migrations.schema_migrations where version in ('20261027140044','20261027145613','20261027152539'))
union all select 'new_objects_absent',to_regclass('app_private.budget_edit_leases') is null and to_regclass('app_private.budget_selections') is null and to_regclass('public.budget_collaboration_signals') is null and to_regprocedure('public.read_budget_snapshot(uuid)') is null
union all select 'no_active_legacy_editors',not exists(select 1 from public.budget_items where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes') and not exists(select 1 from public.actual_expenses where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes');
