-- Replaces unapplied 20261103084209. Never replay installed B7 sources.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Permanent product removal. Existing tables/latches/history remain untouched.
create or replace function app_private.budget_metadata_undo_enabled() returns boolean
language sql stable security definer set search_path='' as $$select false$$;
create or replace function app_private.workspace_undo_enabled() returns boolean
language sql stable security definer set search_path='' as $$select false$$;
-- Stop inverse/lease/clear/read entry points, including private grants behind
-- invoker wrappers. Keep read_workspace_undo for historical v10 snapshots.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in('public','app_private') and p.proname in(
 'undo_budget_metadata_group','undo_budget_workspace','budget_workspace_undo_lease',
 'read_budget_metadata_undo','clear_budget_metadata_undo','prepare_budget_metadata_undo',
 'workspace_undo_lease','prepare_workspace_inverse','workspace_inverse_manifest','finish_workspace_inverse') loop
 execute format('revoke execute on function %s from public,anon,authenticated,budget_receipt_worker',f.signature);
 end loop;
end $$;
-- Empty compatibility summary: no capability or stored pointer is exposed.
create or replace function app_private.read_budget_metadata_undo(p_trip uuid,p_session uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not app_private.can_edit_trip(p_trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 return jsonb_build_object('protocol','metadata-undo-prototype','enabled',false,'tripId',p_trip,'count',0,'top',null);
end $$;
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
 where n.nspname='public' and (p.proname in('budget_receipts_lease','mutate_budget_receipts','read_budget_receipt_operation','abandon_budget_receipt','claim_budget_receipt_cleanup','claim_budget_receipt_verification','finish_budget_receipt_verification','sweep_budget_receipts','claim_budget_receipt_worker','finish_budget_receipt_cleanup') or p.proname like 'budget_receipt_worker_%') loop
 execute format('revoke execute on function %s from public,anon,authenticated,budget_receipt_worker',f.signature);
 end loop;
end $$;
commit;
