-- READ ONLY. Production target lqvuqamzmchepgxkftcw must be verified externally.
-- POST-DORMANT ONLY: tables do not exist in Production at this plan checkpoint.
-- Expected initial Production state: seven OFF, full Undo OFF,
-- three latches FALSE, three Receipt readiness FALSE. Never copy Stage TRUEs.
begin transaction isolation level repeatable read read only;
set local statement_timeout='15s';
select jsonb_build_object('observedAt',clock_timestamp(),'database',current_database(),'role',current_user,
'ledger',(select jsonb_build_object('count',count(*),'head',max(version)) from supabase_migrations.schema_migrations),
'protocols',(select jsonb_object_agg(name,value) from (
 select 'metadata' name,to_jsonb(p) value from app_private.budget_metadata_protocol p
 union all select 'finance',to_jsonb(p) from app_private.budget_finance_protocol p
 union all select 'payment',to_jsonb(p) from app_private.budget_payment_protocol p
 union all select 'source',to_jsonb(p) from app_private.budget_source_protocol p
 union all select 'receipt',to_jsonb(p) from app_private.budget_receipt_protocol p
 union all select 'lifecycle',to_jsonb(p) from app_private.budget_lifecycle_protocol p
 union all select 'undo',to_jsonb(p) from app_private.budget_metadata_undo_protocol p) q),
'workerRole',(select jsonb_build_object('login',rolcanlogin,'inherit',rolinherit,'bypassRls',rolbypassrls,'superuser',rolsuper,'createRole',rolcreaterole) from pg_roles where rolname='budget_receipt_worker'),
'pendingIntents',(select count(*) from app_private.budget_receipt_intents where status='pending'),
'activeCleanup',(select count(*) from app_private.budget_receipt_cleanup where status in('waiting','claimed','blocked')),
'activeLeases',jsonb_build_object('legacy',(select count(*) from app_private.budget_edit_leases where expires_at>clock_timestamp()),'groups',(select count(*) from app_private.budget_metadata_groups where expires_at>clock_timestamp()),'rates',(select count(*) from app_private.budget_rates_leases where expires_at>clock_timestamp()))) readback;
commit;
