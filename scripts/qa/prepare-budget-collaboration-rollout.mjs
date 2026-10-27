import fs from "node:fs/promises";
import {createHash} from "node:crypto";
export const collaborationMigrations=["20261027140044_budget_atomic_edit_leases.sql","20261027145613_budget_consistent_snapshot.sql","20261027152539_budget_collaboration_state.sql"];
export const preservedBudgetTables=["trips","trip_members","budget_items","budget_item_participants","actual_expenses","actual_expense_participants","itinerary_budget_items","trip_budget_baselines","attachments","luggage_items","shared_luggage_items"];
export const budgetSnapshotSQL=preservedBudgetTables.map(table=>`select '${table}'::text object_name,count(*)::bigint row_count,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) digest from public.${table} t`).join("\nunion all\n");
export const collaborationReadinessSQL=`-- Read-only; safe before applying the new migrations.
select 'old_safety_prerequisites' check_name,(select count(*)=2 from supabase_migrations.schema_migrations where version in ('20261022110000','20261022120000')) passed
union all select 'new_migrations_absent',not exists(select 1 from supabase_migrations.schema_migrations where version in ('20261027140044','20261027145613','20261027152539'))
union all select 'new_objects_absent',to_regclass('app_private.budget_edit_leases') is null and to_regclass('app_private.budget_selections') is null and to_regclass('public.budget_collaboration_signals') is null and to_regprocedure('public.read_budget_snapshot(uuid)') is null
union all select 'no_active_legacy_editors',not exists(select 1 from public.budget_items where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes') and not exists(select 1 from public.actual_expenses where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes');`;
export async function prepareBudgetCollaborationRollout(expected){
  if(!Array.isArray(expected)||expected.length!==preservedBudgetTables.length||expected.some(r=>!preservedBudgetTables.includes(r.object_name)||!Number.isInteger(Number(r.row_count))||Number(r.row_count)<0||!/^[a-f0-9]{32}$/.test(r.digest))||new Set(expected.map(r=>r.object_name)).size!==expected.length)throw Error("Invalid complete preflight");
  const sources=await Promise.all(collaborationMigrations.map(name=>fs.readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),"utf8")));
  const bodies=sources.map(s=>s.replace(/^begin;\r?\n/m,"").replace(/\r?\ncommit;\s*$/,"\n"));
  const register=collaborationMigrations.map((name,i)=>{const tag=`$budget_collaboration_source_${i}$`;if(sources[i].includes(tag))throw Error("Delimiter collision");return `insert into supabase_migrations.schema_migrations(version,name,statements) values('${name.slice(0,14)}','${name.slice(15,-4)}',array[${tag}${sources[i]}${tag}]);`;}).join("\n");
  const required=["budget_edit_lease(text,uuid,uuid,uuid,text,timestamptz)","save_budget_workspace_record_v4(uuid,text,uuid,timestamptz,jsonb,uuid,uuid,uuid)","delete_budget_workspace_record_v2(uuid,text,uuid,timestamptz,uuid,uuid)","mutate_budget_receipt(uuid,uuid,text,jsonb,uuid,uuid)","read_budget_snapshot(uuid)","read_budget_collaboration(uuid,uuid)","update_budget_selection(uuid,uuid,text,uuid)"];
  const sql=`-- Travel Planner Production lqvuqamzmchepgxkftcw; #10 phases 1-3 only.
-- Additive APIs/state only. No financial backfill or original-row cleanup.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table ${preservedBudgetTables.map(t=>`public.${t}`).join(",")} in share row exclusive mode;
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $preflight$ begin
  if (select count(*) from supabase_migrations.schema_migrations where version in ('20261022110000','20261022120000'))<>2 then raise exception 'Existing safety prerequisites missing'; end if;
  if exists(select 1 from supabase_migrations.schema_migrations where version in ('20261027140044','20261027145613','20261027152539')) or to_regclass('app_private.budget_edit_leases') is not null or to_regprocedure('public.read_budget_snapshot(uuid)') is not null then raise exception 'Already/partially applied'; end if;
  if exists(select 1 from public.budget_items where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes') or exists(select 1 from public.actual_expenses where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes') then raise exception 'Active legacy editor'; end if;
end $preflight$;
create function pg_temp.budget_collaboration_snapshot() returns table(object_name text,row_count bigint,digest text) language sql as $snapshot$ ${budgetSnapshotSQL} $snapshot$;
create temporary table budget_collaboration_before on commit drop as select * from pg_temp.budget_collaboration_snapshot();
do $expected$ begin
  if exists((select * from budget_collaboration_before except select object_name,row_count,digest from jsonb_to_recordset($json$${JSON.stringify(expected)}$json$::jsonb) as r(object_name text,row_count bigint,digest text)) union all (select object_name,row_count,digest from jsonb_to_recordset($json$${JSON.stringify(expected)}$json$::jsonb) as r(object_name text,row_count bigint,digest text) except select * from budget_collaboration_before)) then raise exception 'Live preflight changed'; end if;
end $expected$;
${bodies.join("\n")}
-- VERIFY_BUDGET_COLLABORATION
do $verify$ declare fn text; begin
  if exists((select * from budget_collaboration_before except select * from pg_temp.budget_collaboration_snapshot()) union all (select * from pg_temp.budget_collaboration_snapshot() except select * from budget_collaboration_before)) then raise exception 'Original content changed'; end if;
  foreach fn in array array[${required.map(f=>`'public.${f}'`).join(",")}] loop
    if not has_function_privilege('authenticated',fn,'EXECUTE') or has_function_privilege('anon',fn,'EXECUTE') or (select prosecdef from pg_proc where oid=fn::regprocedure) then raise exception 'RPC privilege mismatch: %',fn; end if;
  end loop;
  if exists(select 1 from pg_class where oid in ('app_private.budget_edit_leases'::regclass,'app_private.budget_selections'::regclass,'public.budget_collaboration_signals'::regclass) and not relrowsecurity) then raise exception 'RLS missing'; end if;
  if has_table_privilege('authenticated','app_private.budget_edit_leases','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('anon','app_private.budget_edit_leases','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated','app_private.budget_selections','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('anon','app_private.budget_selections','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Private table exposed'; end if;
  if has_table_privilege('authenticated','public.budget_collaboration_signals','INSERT,UPDATE,DELETE') or has_table_privilege('anon','public.budget_collaboration_signals','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Signal write/public privilege mismatch'; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='budget_collaboration_signals') or exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='app_private' and tablename in ('budget_edit_leases','budget_selections')) then raise exception 'Publication boundary mismatch'; end if;
  if (select count(*) from app_private.budget_edit_leases)<>0 or (select count(*) from app_private.budget_selections)<>0 or (select count(*) from public.budget_collaboration_signals)<>0 then raise exception 'Unexpected initial collaboration rows'; end if;
end $verify$;
${register}
notify pgrst,'reload schema';
commit;
select 'budget_collaboration_applied_and_originals_preserved' result;
`;
  const verifySql=`-- Fresh READ-ONLY post-commit verification, before creating QA fixtures.
with actual as (${budgetSnapshotSQL}), expected as (select * from jsonb_to_recordset($json$${JSON.stringify(expected)}$json$::jsonb) as r(object_name text,row_count bigint,digest text))
select 'all_eleven_original_tables_preserved' check_name,not exists((select * from actual except select * from expected) union all (select * from expected except select * from actual)) passed
union all select 'exact_three_sources_registered',(select count(*)=3 and bool_and(statements=array[case version ${collaborationMigrations.map((name,i)=>`when '${name.slice(0,14)}' then $budget_verify_${i}$${sources[i]}$budget_verify_${i}$`).join(" ")} end]) from supabase_migrations.schema_migrations where version in ('20261027140044','20261027145613','20261027152539'))
union all select 'seven_invoker_authenticated_apis',(select count(*)=7 and bool_and(not p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')) from pg_proc p where p.oid in (${required.map(fn=>`'public.${fn}'::regprocedure`).join(",")}))
union all select 'three_rls_tables',(select count(*)=3 and bool_and(relrowsecurity) from pg_class where oid in ('app_private.budget_edit_leases'::regclass,'app_private.budget_selections'::regclass,'public.budget_collaboration_signals'::regclass))
union all select 'private_tables_not_client_accessible',not exists(select 1 from (values ('authenticated'),('anon')) roles(name) cross join (values ('app_private.budget_edit_leases'),('app_private.budget_selections')) tables(name) where has_table_privilege(roles.name,tables.name,'SELECT,INSERT,UPDATE,DELETE'))
union all select 'signals_read_only_authenticated',has_table_privilege('authenticated','public.budget_collaboration_signals','SELECT') and not has_table_privilege('authenticated','public.budget_collaboration_signals','INSERT,UPDATE,DELETE') and not has_table_privilege('anon','public.budget_collaboration_signals','SELECT,INSERT,UPDATE,DELETE')
union all select 'isolated_publication',exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='budget_collaboration_signals') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='app_private' and tablename in ('budget_edit_leases','budget_selections'))
union all select 'no_initial_collaboration_rows',not exists(select 1 from app_private.budget_edit_leases) and not exists(select 1 from app_private.budget_selections) and not exists(select 1 from public.budget_collaboration_signals);`;
  return {sql,verifySql,sources:collaborationMigrations.map((name,i)=>({name,sha256:createHash("sha256").update(sources[i]).digest("hex")})),expected};
}
