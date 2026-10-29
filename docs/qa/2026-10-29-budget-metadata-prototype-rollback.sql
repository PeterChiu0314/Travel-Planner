-- Local/test reverse for the dormant Issue #15 metadata migration ONLY.
-- No hosted execution authorized. Never delete successful request evidence.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
lock table app_private.budget_metadata_protocol,app_private.budget_metadata_groups,
  app_private.budget_metadata_requests,app_private.budget_metadata_effects in access exclusive mode;
do $gate$
begin
  if exists(select 1 from app_private.budget_metadata_protocol where enabled)
    or exists(select 1 from app_private.budget_metadata_groups where user_id is not null and expires_at>clock_timestamp())
    or exists(select 1 from app_private.budget_metadata_effects)
    or exists(select 1 from app_private.budget_metadata_requests) then
    raise exception 'metadata_rollback_requires_dormant_unused_protocol';
  end if;
end $gate$;
drop trigger budget_metadata_legacy_guard on app_private.budget_edit_leases;
drop trigger budget_metadata_row_guard on public.budget_items;
drop trigger actual_metadata_row_guard on public.actual_expenses;
drop trigger budget_metadata_people_guard on public.budget_item_participants;
drop trigger actual_metadata_people_guard on public.actual_expense_participants;
drop trigger budget_metadata_links_guard on public.itinerary_budget_items;
drop trigger budget_metadata_receipts_guard on public.attachments;
drop trigger budget_metadata_effect_finished on app_private.budget_metadata_effects;
drop function public.read_budget_metadata_groups(uuid,text,uuid,uuid);
drop function public.patch_budget_metadata_group(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid);
drop function public.budget_metadata_group_lease(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean);
drop function app_private.read_budget_metadata_groups(uuid,text,uuid,uuid);
drop function app_private.guard_legacy_budget_metadata_lease();
drop function app_private.guard_budget_metadata_row();
drop function app_private.guard_budget_metadata_children();
drop function app_private.assert_budget_metadata_effect_finished();
drop function app_private.prepare_budget_metadata_patch(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid);
drop function app_private.finish_budget_metadata_patch();
drop function app_private.budget_metadata_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean);
drop function app_private.budget_metadata_live(text,uuid);
drop function app_private.budget_metadata_supported(text,uuid);
drop function app_private.budget_metadata_record(text,uuid);
drop function app_private.budget_metadata_enabled();
drop table app_private.budget_metadata_effects;
drop table app_private.budget_metadata_requests;
drop table app_private.budget_metadata_groups;
drop table app_private.budget_metadata_protocol;
commit;
