-- Issue #15 B-1 catalog/data preservation inventory, NOT a migration.
-- Not executed against hosted Supabase by this task.
-- Run only in the intended authorized environment; output contains counts,
-- hashes and catalog definitions, never capability hashes or financial rows.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

select current_database() as database_name, version() as postgres_version,
  current_user as sql_role, current_timestamp as captured_at;

-- A version record is evidence, not proof that source/security still matches.
select version, name from supabase_migrations.schema_migrations
where version in ('20261022090000','20261022100000','20261022110000',
  '20261022120000','20261027140044','20261027145613',
  '20261027152539','20261028104333') order by version;

select table_schema, table_name, column_name, data_type, is_nullable,
  column_default, numeric_precision, numeric_scale
from information_schema.columns
where (table_schema='public' and table_name in
  ('budget_items','budget_item_participants','actual_expenses',
   'actual_expense_participants','itinerary_budget_items','attachments',
   'trip_budget_baselines','budget_collaboration_signals'))
  or (table_schema='app_private' and table_name in
    ('budget_edit_leases','budget_selections','budget_workspace_requests'))
order by table_schema, table_name, ordinal_position;

select n.nspname as schema_name, c.relname as table_name,
  con.conname, con.contype, con.condeferrable, con.condeferred,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','app_private') and c.relname in
  ('budget_items','budget_item_participants','actual_expenses',
   'actual_expense_participants','itinerary_budget_items','attachments',
   'budget_edit_leases','budget_selections','trip_budget_baselines')
order by n.nspname,c.relname,con.conname;

select schemaname,tablename,indexname,indexdef from pg_indexes
where schemaname in ('public','app_private') and tablename in
  ('budget_items','budget_item_participants','actual_expenses',
   'actual_expense_participants','itinerary_budget_items','attachments',
   'budget_edit_leases','budget_selections','budget_workspace_requests')
order by schemaname,tablename,indexname;

select n.nspname as schema_name,c.relname as table_name,t.tgname,
  t.tgenabled, pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname in ('public','app_private','storage')
  and c.relname in ('budget_items','budget_item_participants','actual_expenses',
    'actual_expense_participants','itinerary_budget_items','attachments',
    'trip_budget_baselines','trips','trip_members','itinerary_items',
    'budget_edit_leases','budget_selections','objects')
order by n.nspname,c.relname,t.tgname;

select p.oid::regprocedure::text as signature,p.prosecdef as security_definer,
  p.provolatile,p.proconfig,md5(pg_get_functiondef(p.oid)) as source_digest,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','app_private') and p.prokind='f'
  and (p.proname like '%budget%' or p.proname in
    ('keep_actual_twd_cost','keep_actual_budget_origin','apply_trip_budget_rate',
     'can_edit_trip','can_read_trip'))
order by n.nspname,p.proname,p.oid;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where (schemaname='storage' and tablename='objects')
  or (schemaname in ('public','app_private') and tablename in
    ('budget_items','budget_item_participants','actual_expenses',
     'actual_expense_participants','itinerary_budget_items','attachments',
     'trip_budget_baselines','budget_edit_leases','budget_selections',
     'budget_workspace_requests','budget_collaboration_signals'))
order by schemaname,tablename,policyname;

select n.nspname as schema_name,c.relname,c.relrowsecurity,c.relforcerowsecurity,
  has_table_privilege('authenticated',c.oid,'SELECT') as auth_select,
  has_table_privilege('authenticated',c.oid,'INSERT') as auth_insert,
  has_table_privilege('authenticated',c.oid,'UPDATE') as auth_update,
  has_table_privilege('authenticated',c.oid,'DELETE') as auth_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and n.nspname='app_private'
  and c.relname in ('budget_edit_leases','budget_selections','budget_workspace_requests')
order by c.relname;

select pubname,schemaname,tablename from pg_publication_tables
where pubname='supabase_realtime' and (schemaname='app_private' or tablename in
  ('budget_items','budget_item_participants','actual_expenses',
   'actual_expense_participants','itinerary_budget_items','attachments',
   'trip_budget_baselines','budget_collaboration_signals'))
order by schemaname,tablename;

select count(*) filter(where expires_at>current_timestamp) as active_leases,
  count(*) filter(where expires_at<=current_timestamp) as expired_leases
from app_private.budget_edit_leases;

-- Snapshot original business content without printing any row values.
with originals as (
  select 'trips' as table_name,to_jsonb(t) as data from public.trips t
  union all select 'trip_members',to_jsonb(t) from public.trip_members t
  union all select 'itinerary_items',to_jsonb(t) from public.itinerary_items t
  union all select 'budget_items',to_jsonb(t) from public.budget_items t
  union all select 'budget_item_participants',to_jsonb(t) from public.budget_item_participants t
  union all select 'actual_expenses',to_jsonb(t) from public.actual_expenses t
  union all select 'actual_expense_participants',to_jsonb(t) from public.actual_expense_participants t
  union all select 'itinerary_budget_items',to_jsonb(t) from public.itinerary_budget_items t
  union all select 'attachments',to_jsonb(t) from public.attachments t
  union all select 'accommodations',to_jsonb(t) from public.accommodations t
  union all select 'trip_budget_baselines',to_jsonb(t) from public.trip_budget_baselines t
), names(table_name) as (values ('trips'),('trip_members'),('itinerary_items'),
  ('budget_items'),('budget_item_participants'),('actual_expenses'),
  ('actual_expense_participants'),('itinerary_budget_items'),('attachments'),('accommodations'),
  ('trip_budget_baselines'))
select n.table_name,count(o.table_name) as row_count,
  md5(coalesce(jsonb_agg(o.data order by o.data::text)
    filter(where o.table_name is not null),'[]'::jsonb)::text) as content_digest
from names n left join originals o using(table_name)
group by n.table_name order by n.table_name;

rollback;
