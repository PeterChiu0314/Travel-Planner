import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {budgetSnapshotSQL,preservedBudgetTables} from "./prepare-budget-collaboration-rollout.mjs";

export async function prepareBudgetSelectionRollout(readerMd5){
  if(!/^[a-f0-9]{32}$/.test(readerMd5))throw Error('Invalid reader digest');
  const source=await fs.readFile(new URL('../../supabase/migrations/20261028104333_budget_selection_activity.sql',import.meta.url),'utf8');
  const sha256=createHash('sha256').update(source).digest('hex');
  if(sha256!=='a6bd7cf2bb9d8ae436852b0d622745fe9733fee59d799fef780b1d71b5efe661')throw Error('Reviewed migration changed');
  const checks=(await fs.readFile(new URL('../../docs/qa/2026-10-28-budget-selection-activity-verify.sql',import.meta.url),'utf8')).replace(/^--.*\n/,'').trim().replace(/;$/,'');
  const sql=`-- Approved #14 only; Production lqvuqamzmchepgxkftcw. Source pinned by SHA-256.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table ${preservedBudgetTables.map(t=>'public.'+t).join(',')} in share row exclusive mode;
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $preflight$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version in ('20261027140044','20261027145613','20261027152539'))<>3 then raise exception 'Missing prerequisites'; end if;
  if exists(select 1 from supabase_migrations.schema_migrations where version='20261028104333') or to_regprocedure('public.update_budget_selection_v2(uuid,uuid,text,uuid,uuid,text)') is not null or exists(select 1 from information_schema.columns where table_schema='app_private' and table_name='budget_selections' and column_name in ('activity_id','selected_at')) then raise exception 'Already/partially applied'; end if;
  if md5(pg_get_functiondef('app_private.read_budget_collaboration(uuid,uuid)'::regprocedure))<>'${readerMd5}' then raise exception 'Reader changed since preflight'; end if;
end $preflight$;
create or replace function pg_temp.budget_selection_snapshot() returns table(object_name text,row_count bigint,digest text) language sql as $snapshot$ ${budgetSnapshotSQL} $snapshot$;
create temporary table budget_selection_before on commit drop as select * from pg_temp.budget_selection_snapshot();
do $apply$ declare source text := $reviewed_source$${source}$reviewed_source$; begin
  source:=replace(source,chr(13)||chr(10),chr(10)); -- Clipboard/editor may use CRLF; retain exact canonical source.
  if encode(sha256(convert_to(source,'UTF8')),'hex')<>'${sha256}' then raise exception 'Migration source mismatch'; end if;
  execute regexp_replace(regexp_replace(source,$strip_begin$^begin;\\r?\\n$strip_begin$,'','m'),$strip_end$\\r?\\ncommit;\\s*$$strip_end$,'');
  insert into supabase_migrations.schema_migrations(version,name,statements) values('20261028104333','budget_selection_activity',array[source]);
end $apply$;
-- VERIFY_SELECTION_ROLLOUT
do $verify$ begin
  if exists((select * from budget_selection_before except select * from pg_temp.budget_selection_snapshot()) union all (select * from pg_temp.budget_selection_snapshot() except select * from budget_selection_before)) then raise exception 'Original content changed'; end if;
  if exists(select 1 from (${checks}) c where passed is distinct from true) then raise exception 'Selection rollout verification failed'; end if;
end $verify$;
notify pgrst,'reload schema';
commit;
select 'budget_selection_activity_applied_originals_preserved' result,jsonb_agg(to_jsonb(s) order by object_name) preserved_manifest from pg_temp.budget_selection_snapshot() s;
`;
  return {sql,sha256,verifySql:checks+`;\nselect 'source_registered' check_name,(select name='budget_selection_activity' and cardinality(statements)=1 and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${sha256}' from supabase_migrations.schema_migrations where version='20261028104333') passed;`};
}
