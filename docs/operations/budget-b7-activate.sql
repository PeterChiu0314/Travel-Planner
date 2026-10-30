-- ADMIN ONLY, only after explicit environment authorization and real HTTP proof.
-- The caller must SET app.budget_b7_http_evidence='<64 lowercase hex sha256>'
-- to the reviewed evidence file digest. This is an operator attestation, not an
-- automated claim that SQL can prove Auth/Realtime/HTTP bytes or scheduling.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table app_private.budget_metadata_protocol,app_private.budget_finance_protocol,app_private.budget_payment_protocol,
 app_private.budget_source_protocol,app_private.budget_receipt_protocol,app_private.budget_lifecycle_protocol,
 app_private.budget_metadata_undo_protocol in exclusive mode nowait;
do $$begin
 if coalesce(current_setting('app.budget_b7_http_evidence',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed B7 real HTTP and worker evidence required';end if;
 if exists(select 1 from app_private.budget_edit_leases where expires_at>clock_timestamp())
  or exists(select 1 from app_private.budget_metadata_groups where expires_at>clock_timestamp())
  or exists(select 1 from app_private.budget_rates_leases where expires_at>clock_timestamp()) then raise exception 'Drain active leases before activation';end if;
 if exists(select 1 from app_private.budget_receipt_cleanup where status='blocked') then raise exception 'Resolve quarantined cleanup before activation';end if;
 if not exists(select 1 from app_private.budget_receipt_protocol where storage_verified and cleanup_worker_verified and content_worker_verified
  and legacy_grants_expire_at is not null and legacy_grants_expire_at<clock_timestamp()) then raise exception 'Real Storage/Worker attestations and actual legacy token exhaustion required';end if;
end $$;
update app_private.budget_metadata_protocol set enabled=true;
update app_private.budget_finance_protocol set enabled=true;
update app_private.budget_payment_protocol set enabled=true;
update app_private.budget_source_protocol set enabled=true;
update app_private.budget_receipt_protocol set enabled=true;
update app_private.budget_lifecycle_protocol set enabled=true;
update app_private.budget_metadata_undo_protocol set enabled=true,full_enabled=true;
commit;
