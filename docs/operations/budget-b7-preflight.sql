-- READ ONLY. Run with ON_ERROR_STOP. No protocol/data/storage changes.
begin transaction read only;
set local statement_timeout='10s';
do $$begin
 if to_regprocedure('public.read_budget_metadata_snapshot_v10(uuid,uuid)') is null
  or to_regprocedure('public.delete_itinerary_item_budget_safe(uuid,uuid)') is null
  or to_regprocedure('public.claim_budget_receipt_verification()') is null then raise exception 'B7 migration chain incomplete';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relkind='r' and not c.relrowsecurity)
  or exists(select 1 from information_schema.role_table_grants where table_schema='app_private' and grantee in('PUBLIC','anon','authenticated','budget_receipt_worker'))
  or exists(select 1 from pg_publication_tables where schemaname='app_private') then raise exception 'Private schema RLS/ACL/publication preflight failed';end if;
 if not exists(select 1 from storage.buckets where id='trip-attachments' and not public and file_size_limit=10485760 and allowed_mime_types @> array['image/jpeg','image/png','image/webp','application/pdf']) then raise exception 'Private receipt bucket configuration mismatch';end if;
 if not exists(select 1 from pg_roles where rolname='budget_receipt_worker' and not rolcanlogin and not rolbypassrls and not rolsuper and not rolinherit)
  or exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname='budget_receipt_worker') then raise exception 'Worker role must be unprivileged and inherit no roles';end if;
 if exists(select 1 from pg_proc where oid in('public.mutate_budget_receipts(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid,text)'::regprocedure,
  'public.undo_budget_workspace(uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure,'public.delete_itinerary_item_budget_safe(uuid,uuid)'::regprocedure) and prosecdef) then raise exception 'Public RPC must be invoker';end if;
end $$;
select jsonb_build_object('metadata',(select enabled from app_private.budget_metadata_protocol),'finance',(select enabled from app_private.budget_finance_protocol),
 'payment',(select enabled from app_private.budget_payment_protocol),'source',(select enabled from app_private.budget_source_protocol),
 'receipts',(select enabled from app_private.budget_receipt_protocol),'lifecycle',(select enabled from app_private.budget_lifecycle_protocol),
 'undo',(select enabled and full_enabled from app_private.budget_metadata_undo_protocol),
 'active_wildcards',(select count(*) from app_private.budget_edit_leases where expires_at>clock_timestamp()),
 'active_groups',(select count(*) from app_private.budget_metadata_groups where expires_at>clock_timestamp()),
 'pending_receipts',(select count(*) from app_private.budget_receipt_intents where status='pending'),
 'blocked_cleanup',(select count(*) from app_private.budget_receipt_cleanup where status='blocked'),
 'storage_verified',(select storage_verified from app_private.budget_receipt_protocol),
 'worker_verified',(select cleanup_worker_verified from app_private.budget_receipt_protocol),
 'content_worker_verified',(select content_worker_verified from app_private.budget_receipt_protocol),
 'legacy_grants_expire_at',(select legacy_grants_expire_at from app_private.budget_receipt_protocol)) preflight;
commit;
