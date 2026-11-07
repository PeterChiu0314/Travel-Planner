/** Build an auditable SQL Editor packet. This script never connects to Supabase. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const mode = process.argv[2];
if (!["trial", "install"].includes(mode)) throw Error("Specify trial or install");
const version = "20261107035830", name = "issue23_retire_legacy_budget";
const source = readFileSync(new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url), "utf8").replaceAll("\r", "");
if (!source.startsWith("begin;\n") || !source.endsWith("commit;\n") || source.includes("$issue23_source$")) throw Error("Unexpected migration framing");
const sha = createHash("sha256").update(source).digest("hex");
const tables = [
  ...["trips","trip_members","itinerary_items","itinerary_alternatives","itinerary_route_overrides","itinerary_route_override_nodes",
    "guide_items","todo_items","luggage_items","shared_luggage_items","pack_items","accommodations",
    "attachments","trip_invites","share_links","expense_signals"].map(name => `public.${name}`),
  ...["expense_items","expense_itinerary_links","expense_participants","groups","receipts","rate_leases","selections"].map(name => `expense_stage_b.${name}`),
];
const seals = tables.map(table => {
  const where = table === "public.attachments" ? " where target_type not in ('budget_item','actual_expense')" : "";
  const json = table === "public.accommodations" ? "to_jsonb(r)-'budget_item_id'" : "to_jsonb(r)";
  return `select '${table}' as relation, count(*) as rows,
    md5(coalesce(string_agg(d::text, ',' order by d::text),'')) as digest
    from (select ${json} as d from ${table} r${where}) values_to_seal`;
}).join("\nunion all\n");

process.stdout.write(`-- Staging ONLY: uyqdopksfysbobhjcepk, ledger 77.
-- Mode: ${mode}. Source SHA256 (LF): ${sha}
begin isolation level repeatable read;
set local lock_timeout = '5s';
do $stage$
begin
  if (select count(*) from supabase_migrations.schema_migrations) <> 77
     or (select max(version) from supabase_migrations.schema_migrations) <> '20261107030622'
  then raise exception 'Issue #23 expected Staging ledger 77'; end if;
end;
$stage$;
create temporary table issue23_retired_counts on commit drop as
select (select count(*) from public.budget_items) as legacy_budgets,
       (select count(*) from public.actual_expenses) as legacy_actuals,
       (select count(*) from public.trip_budget_baselines where departure_at <= now()) as frozen_baselines,
       (select count(*) from public.trip_budget_baselines where departure_at > now()) as unfrozen_baselines,
       (select count(*) from public.attachments where target_type in ('budget_item','actual_expense')) as legacy_attachment_rows;
create temporary view issue23_current_seals as
${seals};
create temporary table issue23_before on commit drop as table issue23_current_seals;
-- Drop the temporary view before altering accommodation's row type.
drop view issue23_current_seals;
do $ledger$
declare source constant text := replace($issue23_source$${source}$issue23_source$, chr(13), '');
begin
  if encode(sha256(convert_to(source,'UTF8')),'hex') <> '${sha}' then
    raise exception 'Issue #23 source transmission mismatch';
  end if;
  -- The packet owns the transaction. Execute the exact source body.
  execute substring(source from 8 for char_length(source)-15);
  insert into supabase_migrations.schema_migrations(version,name,statements)
    values ('${version}','${name}',array[source]);
end;
$ledger$;
create temporary view issue23_current_seals as
${seals};
do $preserved$
begin
  if exists (select * from issue23_current_seals except select * from issue23_before)
     or exists (select * from issue23_before except select * from issue23_current_seals)
  then raise exception 'Issue #23 modified protected rows'; end if;
end;
$preserved$;
select '${mode}' as mode, (select to_jsonb(r) from issue23_retired_counts r) as legacy_before,
       (select jsonb_object_agg(relation, rows order by relation) from issue23_before) as protected_counts_unchanged,
       (select max(version) from supabase_migrations.schema_migrations) as verified_head,
       to_regclass('public.budget_items') is null as old_budget_removed,
       to_regclass('public.actual_expenses') is null as old_actual_removed,
       to_regclass('public.trip_budget_baselines') is null as old_baselines_removed;
drop view issue23_current_seals;
${mode === "trial" ? "rollback;" : "commit;"}
`);
