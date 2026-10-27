import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function prepareBudgetSafetyRollout(expected) {
  for (const k of ["actualCount", "budgetCount"]) if (!Number.isInteger(expected[k]) || expected[k] < 0) throw new Error(`Invalid ${k}`);
  for (const k of ["actualDigest", "budgetDigest"]) if (!/^[a-f0-9]{32}$/.test(expected[k])) throw new Error(`Invalid ${k}`);
  const names = ["20261022110000_budget_payment_safety_and_actual_cost.sql", "20261022120000_unified_planning_payments.sql"];
  const sources = await Promise.all(names.map(name => fs.readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8")));
  const bodies = sources.map(source => source.replace(/^begin;\r?\n/m, "").replace(/\r?\ncommit;\s*$/, "\n"));
  const registrations = names.map((name, i) => {
    const tag = `$budget_migration_${i}$`; if (sources[i].includes(tag)) throw new Error("Source delimiter collision");
    return `insert into supabase_migrations.schema_migrations(version,name,statements) values('${name.slice(0,14)}','${name.slice(15,-4)}',array[${tag}${sources[i]}${tag}]);`;
  }).join("\n");
  const snapshots = ["trips", "budget_items", "budget_item_participants", "actual_expenses", "actual_expense_participants", "itinerary_budget_items", "trip_budget_baselines", "attachments", "luggage_items", "shared_luggage_items"];
  const snapshotBody = snapshots.map(table => `select '${table}'::text,count(*)::bigint,md5(coalesce(jsonb_agg(${table === "actual_expenses" ? "to_jsonb(t)-array['updated_at','twd_amount_source','actual_twd_amount','payment_origin','payment_active','payment_history']" : "to_jsonb(t)"} order by ${table === "actual_expenses" ? "t.id" : "to_jsonb(t)::text"})::text,'[]')) from public.${table} t`).join("\nunion all\n");
  const sql = `-- Target: Travel Planner lqvuqamzmchepgxkftcw; existing Budget safety only.
-- No new Phase 1 lease schema is included. Verify Dashboard target before Run.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table public.trips,public.budget_items,public.budget_item_participants,public.actual_expenses,public.actual_expense_participants,public.itinerary_budget_items,public.trip_budget_baselines,public.attachments,public.luggage_items,public.shared_luggage_items in access exclusive mode;
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $preflight$
begin
  if exists(select 1 from supabase_migrations.schema_migrations where version in ('20261022110000','20261022120000')) then raise exception 'Unexpected migration history'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='actual_expenses' and column_name in ('twd_amount_source','actual_twd_amount','payment_origin','payment_active','payment_history')) then raise exception 'Unexpected partial schema'; end if;
  if exists(select 1 from public.actual_expenses where twd_amount is null or twd_amount<0) then raise exception 'Invalid legacy cost'; end if;
  if exists(select 1 from public.budget_items where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes') or exists(select 1 from public.actual_expenses where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes') then raise exception 'Active editor; no change'; end if;
  if (select count(*) from public.actual_expenses)<>${expected.actualCount} or (select md5(coalesce(jsonb_agg(to_jsonb(t)-'updated_at' order by t.id)::text,'[]')) from public.actual_expenses t)<>'${expected.actualDigest}' then raise exception 'Actual preflight changed'; end if;
  if (select count(*) from public.budget_items)<>${expected.budgetCount} or (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) from public.budget_items t)<>'${expected.budgetDigest}' then raise exception 'Budget preflight changed'; end if;
end $preflight$;
create function pg_temp.budget_safety_snapshot() returns table(object_name text,row_count bigint,digest text) language sql as $snapshot$ ${snapshotBody} $snapshot$;
create temporary table budget_safety_before on commit drop as select * from pg_temp.budget_safety_snapshot();
${bodies.join("\n")}
-- VERIFY_BUDGET_DATA
do $verify$
begin
  if exists((select * from budget_safety_before except select * from pg_temp.budget_safety_snapshot()) union all (select * from pg_temp.budget_safety_snapshot() except select * from budget_safety_before)) then raise exception 'Original content changed; rolling back all migrations'; end if;
  if exists(select 1 from public.actual_expenses where twd_amount_source<>'legacy' or actual_twd_amount is distinct from twd_amount or payment_origin<>'manual' or payment_active is distinct from true or payment_history<>'[]'::jsonb) then raise exception 'Metadata backfill mismatch'; end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='save_budget_workspace_record_v2' and not p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')) or not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='save_budget_workspace_record_v3' and not p.prosecdef and has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')) then raise exception 'RPC privilege mismatch'; end if;
end $verify$;
${registrations}
notify pgrst,'reload schema';
commit;
select 'budget_safety_applied_and_verified' as result;
`;
  return { sql, sources: names.map((name, i) => ({ name, sha256: createHash("sha256").update(sources[i]).digest("hex") })), expected };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url && process.env.BUDGET_SAFETY_PREFLIGHT && process.env.BUDGET_SAFETY_OUTPUT) {
  const rows = JSON.parse(await fs.readFile(process.env.BUDGET_SAFETY_PREFLIGHT, "utf8"));
  const actual = JSON.parse(rows.find(row => row.check_name === "actual_original_content").result);
  const budget = JSON.parse(rows.find(row => row.check_name === "budget_original_content").result);
  const result = await prepareBudgetSafetyRollout({ actualCount: actual.count, actualDigest: actual.digest, budgetCount: budget.count, budgetDigest: budget.digest });
  await fs.writeFile(process.env.BUDGET_SAFETY_OUTPUT, result.sql);
  console.log(JSON.stringify({ ...result, sql: "SQL saved to requested artifact path" }, null, 2));
}
