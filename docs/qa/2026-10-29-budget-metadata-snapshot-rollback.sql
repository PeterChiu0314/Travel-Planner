-- Local reverse of the snapshot/signals extension only. Run before prototype reverse.
-- This never deletes financial/private state or rewinds the shared signal revision.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
lock table app_private.budget_metadata_protocol,app_private.budget_metadata_groups in access exclusive mode;
do $$begin
  if exists(select 1 from app_private.budget_metadata_protocol where enabled)
    or exists(select 1 from app_private.budget_metadata_groups where user_id is not null and expires_at>clock_timestamp())
    or exists(select 1 from app_private.budget_metadata_effects)
    or exists(select 1 from app_private.budget_metadata_requests) then
    raise exception 'metadata_snapshot_reverse_requires_dormant_unused_protocol';
  end if;
end $$;
drop function public.read_budget_metadata_snapshot(uuid,uuid);
drop function app_private.read_budget_metadata_state(uuid,uuid);
drop trigger budget_metadata_group_signal on app_private.budget_metadata_groups;
drop trigger budget_metadata_member_signal on public.trip_members;
drop trigger budget_metadata_protocol_signal on app_private.budget_metadata_protocol;
drop function app_private.signal_budget_metadata_state();
drop function app_private.signal_budget_metadata_protocol();
commit;
