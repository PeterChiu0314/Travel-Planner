// Generate reviewable complete definitions from immutable installed sources.
// No database connection or execution.
import fs from 'node:fs/promises';
const old=await fs.readFile('supabase/migrations/20261030082712_budget_workspace_undo.sql','utf8');
const definition=name=>{const start=old.indexOf(`create function app_private.${name}(`),end=old.indexOf('end $$;',start);if(start<0||end<0)throw Error(name);return old.slice(start,end+7).replace('create function','create or replace function').replaceAll("errcode='40001'","errcode='PT409'");};
let record=definition('record_workspace_undo').replace('offset 5','offset 1');
let top=definition('workspace_undo_top').replace(" if op.bundle is null", " if op.saved_at + interval '30 seconds' <= clock_timestamp() then raise exception 'Undo expired' using errcode='PT409';end if;\n if op.bundle is null");
const sql=`-- REVIEW ONLY: never applied Hosted by this task. Preserve history and latches.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Existing capabilities expire; audit records and payment history remain intact.
alter table app_private.budget_metadata_undo_operations add column saved_at timestamptz not null default '-infinity';
alter table app_private.budget_metadata_undo_operations alter column saved_at set default clock_timestamp();
delete from app_private.budget_metadata_undo_stack;
${record}
${top}
-- NULL permits independent travel expenses. Duplicates abort the whole Forward;
-- never merge/delete financial rows to satisfy this constraint.
create unique index actual_expenses_one_budget on public.actual_expenses(budget_item_id) where budget_item_id is not null;
-- Financial attachments are removed regardless of Protocol/latch state.
create function app_private.guard_removed_budget_receipts() returns trigger
language plpgsql set search_path='' as $$
begin
 if (tg_op<>'INSERT' and old.target_type in('budget_item','actual_expense'))
 or (tg_op<>'DELETE' and new.target_type in('budget_item','actual_expense')) then
 raise exception 'Financial receipts removed' using errcode='55000';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function app_private.guard_removed_budget_receipts() from public,anon,authenticated,service_role;
create trigger aa_removed_budget_receipts before insert or update or delete on public.attachments for each row execute function app_private.guard_removed_budget_receipts();
create policy removed_receipts_metadata_read on public.attachments as restrictive for select to anon,authenticated using(target_type not in('budget_item','actual_expense'));
-- Intersect existing policies; grants for accommodation and other attachments unchanged.
create policy removed_receipts_storage on storage.objects as restrictive for all to anon,authenticated,budget_receipt_worker
 using(bucket_id<>'trip-attachments' or coalesce((storage.foldername(name))[4],'') not in('budget_item','actual_expense'))
 with check(bucket_id<>'trip-attachments' or coalesce((storage.foldername(name))[4],'') not in('budget_item','actual_expense'));
-- Retain implementations for dependency/audit compatibility, remove client entry points.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname in('undo_budget_metadata_group','budget_receipts_lease','mutate_budget_receipts','read_budget_receipt_operation','abandon_budget_receipt','claim_budget_receipt_cleanup','claim_budget_receipt_verification','finish_budget_receipt_verification','sweep_budget_receipts','claim_budget_receipt_worker','finish_budget_receipt_cleanup') or p.proname like 'budget_receipt_worker_%') loop
 execute format('revoke execute on function %s from public,anon,authenticated,budget_receipt_worker',f.signature);
 end loop;
end $$;
commit;
`;
await fs.writeFile('supabase/migrations/20261103084209_budget_planning_simplification.sql',sql);
