-- Read-only: exact original data plus the explicitly disposable fixture.
select jsonb_build_object(
  'budget_count',(select count(*) from public.budget_items),
  'budget_original_digest',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) from public.budget_items t),
  'actual_count',(select count(*) from public.actual_expenses),
  'original_actual_preserved',(select md5(coalesce(jsonb_agg(to_jsonb(t)-array['updated_at','twd_amount_source','actual_twd_amount','payment_origin','payment_active','payment_history'] order by t.id)::text,'[]'))='5c1bfe01cf4ff7b95bc500917f8ae45d' from public.actual_expenses t where id<>'f71ae9e9-6a43-4b44-9f30-9dd562c53a99'),
  'fixture_actual_count',(select count(*) from public.actual_expenses where id='f71ae9e9-6a43-4b44-9f30-9dd562c53a99' and title='QA #10 migration 20261027' and twd_amount=1),
  'fixture_budget_count',(select count(*) from public.budget_items where title='QA #10 migration 20261027'),
  'baseline_count',(select count(*) from public.trip_budget_baselines),
  'active_waits',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from (
    select pid,state,wait_event_type,wait_event,clock_timestamp()-query_start as query_age,pg_blocking_pids(pid) as blockers
    from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and (wait_event_type='Lock' or state='active') order by query_start limit 20
  ) a)
) as result;
