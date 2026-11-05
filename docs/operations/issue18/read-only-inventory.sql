-- Review/preflight draft only. NOT RUN by this task.
-- Independently confirm project uyqdopksfysbobhjcepk before execution.
-- Counts cover Staging; future writes need a separate exact target manifest.
-- No secrets/session tokens, readiness changes, protocol toggles or DML.
begin transaction read only;
set local statement_timeout = '15s';

select version from supabase_migrations.schema_migrations order by version desc limit 5;

select c.oid::regclass as relation, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
 ('budget_items','actual_expenses','budget_item_participants','actual_expense_participants',
  'itinerary_budget_items','trip_budget_baselines','accommodations','attachments');

select conrelid::regclass as dependent_table, conname,
       confrelid::regclass as parent_table, pg_get_constraintdef(oid) as definition
from pg_constraint
where contype = 'f' and (confrelid in
 (to_regclass('public.budget_items'),to_regclass('public.actual_expenses'))
 or conrelid in (to_regclass('public.budget_items'),to_regclass('public.actual_expenses')))
order by 1,2;

select tgrelid::regclass as relation, tgname, pg_get_triggerdef(oid) as definition
from pg_trigger where not tgisinternal and tgrelid in
 (to_regclass('public.budget_items'),to_regclass('public.actual_expenses'),
  to_regclass('public.budget_item_participants'),to_regclass('public.actual_expense_participants'),
  to_regclass('public.itinerary_budget_items'),to_regclass('public.attachments'))
order by 1,2;

-- Catalog dependencies alone miss dynamic SQL. Review definitions/imports too;
-- never treat absence here as permission for a cascading drop.
select p.oid::regprocedure as signature, p.prosecdef, p.proacl,
       pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','app_private') and p.prokind='f'
  and p.proname ~ '(budget|expense|source|receipt|workspace_undo)'
order by 1;

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage') and
 (tablename in ('budget_items','actual_expenses','budget_item_participants',
  'actual_expense_participants','itinerary_budget_items','trip_budget_baselines','attachments','objects'))
order by 1,2,3;

select count(*) as old_budget_rows,
       count(*) filter (where record_status='incomplete') as incomplete_budget_rows
from public.budget_items;

select (budget_item_id is not null) as currently_linked,
       (budget_origin_id is not null) as historical_origin,
       record_status,payment_active,twd_amount_source,count(*) as actual_rows
from public.actual_expenses
group by 1,2,3,4,5 order by 1,2,3,4,5;

select budget_item_id,count(*) as rows_per_budget
from public.actual_expenses where budget_item_id is not null
group by budget_item_id having count(*)>1;

select count(*) as orphan_actual_people
from public.actual_expense_participants p
left join public.actual_expenses a on a.id=p.actual_expense_id where a.id is null;

select count(*) as active_complete_rows_requiring_financial_review
from public.actual_expenses a
where a.payment_active is distinct from false and a.record_status='complete'
 and (a.payer_id is null or a.paid_at is null or a.amount is null or a.twd_amount is null
      or a.amount<0 or a.twd_amount<0
      or (a.twd_amount_source='legacy' and a.twd_amount<>trunc(a.twd_amount)));

-- True canonical fingerprints, to be captured only when this SELECT is run.
-- No literal/current result is fabricated in the planning document.
select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb)::text,'UTF8')),'hex')
 as actual_rows_sha256 from public.actual_expenses a;
select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(p) order by p.actual_expense_id,p.user_id),'[]'::jsonb)::text,'UTF8')),'hex')
 as actual_people_sha256 from public.actual_expense_participants p;
select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(b) order by b.trip_id),'[]'::jsonb)::text,'UTF8')),'hex')
 as original_baselines_sha256 from public.trip_budget_baselines b;

rollback;
