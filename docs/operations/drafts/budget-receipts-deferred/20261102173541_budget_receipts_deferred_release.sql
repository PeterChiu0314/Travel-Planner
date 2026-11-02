-- NON-AUTO-APPLY Production candidate. NOT INSTALLED.
-- Official CLI version; preserves all installed sources and existing guards.
-- Allows a later separately verified six-protocol rollout with Receipts OFF.
begin;
set local lock_timeout='3s';set local statement_timeout='15s';
lock table app_private.budget_metadata_protocol,app_private.budget_finance_protocol,
 app_private.budget_payment_protocol,app_private.budget_source_protocol,
 app_private.budget_receipt_protocol,app_private.budget_lifecycle_protocol,
 app_private.budget_metadata_undo_protocol in exclusive mode nowait;
-- Prevent a concurrent legacy writer from changing the graph after the
-- empty-graph check. A future Activation must acquire these locks again.
lock table public.attachments,storage.objects in share row exclusive mode nowait;
do $before$ begin
 if current_setting('app.b7_install_target',true) is distinct from 'lqvuqamzmchepgxkftcw' then raise exception 'Production target must be verified and bound';end if;
 if coalesce((select enabled or activated from app_private.budget_receipt_protocol where singleton),true)
  or coalesce((select enabled or activated from app_private.budget_finance_protocol where singleton),true)
  or coalesce((select enabled or activated from app_private.budget_lifecycle_protocol where singleton),true) then raise exception 'Install deferred Receipt guard before first financial activation';end if;
 if (select encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex') from pg_proc where oid=to_regprocedure('app_private.guard_receipt_metadata()')) is distinct from '85cda3b2566527c40fe9bb1ee791b5d9ed07172e283ad46c5b2e23dd2c2df434' then raise exception 'Unknown installed Receipt guard';end if;
 if exists(select 1 from public.attachments where target_type in('actual_expense','budget_item'))
  or exists(select 1 from app_private.budget_receipt_intents)
  or exists(select 1 from app_private.budget_receipt_cleanup)
  or exists(select 1 from storage.objects where bucket_id='trip-attachments' and (storage.foldername(name))[4] in('actual_expense','budget_item')) then raise exception 'Existing Receipt graph requires an explicit preservation plan';end if;
end $before$;
create function app_private.budget_receipts_deferred() returns boolean
language sql stable security definer set search_path='' as $$
 select (coalesce(app_private.budget_finance_activated(),false)
   or coalesce(app_private.budget_lifecycle_activated(),false))
   and not coalesce(app_private.receipts_activated(),false)
$$;
revoke all on function app_private.budget_receipts_deferred() from public,anon,authenticated,service_role,budget_receipt_worker;
grant execute on function app_private.budget_receipts_deferred() to authenticated;
create function app_private.guard_deferred_budget_receipts() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if app_private.budget_receipts_deferred() and
  ((tg_op<>'INSERT' and old.target_type in('actual_expense','budget_item'))
   or (tg_op<>'DELETE' and new.target_type in('actual_expense','budget_item'))) then
  raise exception 'Receipts are unavailable in this rollout' using errcode='55000';
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function app_private.guard_deferred_budget_receipts() from public,anon,authenticated,service_role,budget_receipt_worker;
create trigger aa_deferred_budget_receipts before insert or update or delete on public.attachments
 for each row execute function app_private.guard_deferred_budget_receipts();
-- Restrictive policies intersect existing membership/claim policies. They
-- never grant access. Other workspace attachments retain their old policies.
create policy "Deferred Budget receipts deny insert" on storage.objects as restrictive
 for insert to authenticated with check(
  not app_private.budget_receipts_deferred() or bucket_id<>'trip-attachments'
  or coalesce((storage.foldername(name))[4],'') not in('actual_expense','budget_item'));
create policy "Deferred Budget receipts deny update" on storage.objects as restrictive
 for update to authenticated using(
  not app_private.budget_receipts_deferred() or bucket_id<>'trip-attachments'
  or coalesce((storage.foldername(name))[4],'') not in('actual_expense','budget_item'))
 with check(not app_private.budget_receipts_deferred() or bucket_id<>'trip-attachments'
  or coalesce((storage.foldername(name))[4],'') not in('actual_expense','budget_item'));
create policy "Deferred Budget receipts deny delete" on storage.objects as restrictive
 for delete to authenticated using(
  not app_private.budget_receipts_deferred() or bucket_id<>'trip-attachments'
  or coalesce((storage.foldername(name))[4],'') not in('actual_expense','budget_item'));
commit;
