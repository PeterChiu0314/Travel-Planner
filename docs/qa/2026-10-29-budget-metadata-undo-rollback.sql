-- Local/test reverse for the dormant, unused Undo extension only. Never erase
-- successful operation/receipt evidence; no hosted execution is authorized.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
lock table app_private.budget_metadata_undo_protocol,app_private.budget_metadata_undo_operations,
  app_private.budget_metadata_undo_stack,app_private.budget_metadata_undo_lineage,
  app_private.budget_metadata_undo_intents,app_private.budget_metadata_undo_receipts,
  app_private.budget_metadata_effects in access exclusive mode;
do $gate$ begin
  if exists(select 1 from app_private.budget_metadata_undo_protocol where enabled)
    or exists(select 1 from app_private.budget_metadata_undo_operations)
    or exists(select 1 from app_private.budget_metadata_undo_receipts)
    or exists(select 1 from app_private.budget_metadata_undo_intents)
    or exists(select 1 from app_private.budget_metadata_effects) then
    raise exception 'undo_rollback_requires_dormant_unused_protocol';
  end if;
end $gate$;
drop trigger zz_budget_metadata_undo_row on public.budget_items;
drop trigger zz_actual_metadata_undo_row on public.actual_expenses;
drop trigger budget_metadata_undo_commit on app_private.budget_metadata_requests;
drop trigger budget_metadata_undo_finished on app_private.budget_metadata_undo_intents;
drop trigger budget_metadata_undo_people on public.budget_item_participants;
drop trigger budget_metadata_undo_actual_people on public.actual_expense_participants;
drop trigger budget_metadata_undo_links on public.itinerary_budget_items;
drop trigger budget_metadata_undo_receipts on public.attachments;
drop trigger budget_metadata_undo_members on public.trip_members;
drop trigger budget_metadata_undo_trip on public.trips;
drop function public.undo_budget_metadata_group(uuid,uuid,uuid,uuid,bigint,uuid);
drop function public.read_budget_metadata_undo(uuid,uuid);
drop function public.clear_budget_metadata_undo(uuid,uuid);
drop function app_private.prepare_budget_metadata_undo(uuid,uuid,uuid,uuid);
drop function app_private.read_budget_metadata_undo(uuid,uuid);
drop function app_private.clear_budget_metadata_undo(uuid,uuid);
drop function app_private.assert_budget_metadata_undo_finished();
drop function app_private.record_budget_metadata_undo();
drop function app_private.capture_budget_metadata_undo_row();
drop function app_private.guard_budget_metadata_undo_boundary();
drop function app_private.invalidate_budget_metadata_undo(uuid,text,uuid);
drop function app_private.budget_metadata_undo_enabled();
drop table app_private.budget_metadata_undo_intents;
drop table app_private.budget_metadata_undo_receipts;
drop table app_private.budget_metadata_undo_lineage;
drop table app_private.budget_metadata_undo_stack;
drop table app_private.budget_metadata_undo_operations;
drop table app_private.budget_metadata_undo_protocol;
alter table app_private.budget_metadata_effects drop column undo_before_value;
commit;
