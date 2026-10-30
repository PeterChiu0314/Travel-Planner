-- ADMIN ONLY. Stop new group writes without removing guards/latches or history.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
lock table app_private.budget_metadata_protocol,app_private.budget_finance_protocol,app_private.budget_payment_protocol,
 app_private.budget_source_protocol,app_private.budget_receipt_protocol,app_private.budget_lifecycle_protocol,
 app_private.budget_metadata_undo_protocol in exclusive mode nowait;
update app_private.budget_metadata_undo_protocol set enabled=false,full_enabled=false;
update app_private.budget_lifecycle_protocol set enabled=false;
update app_private.budget_receipt_protocol set enabled=false;
update app_private.budget_source_protocol set enabled=false;
update app_private.budget_payment_protocol set enabled=false;
update app_private.budget_finance_protocol set enabled=false;
update app_private.budget_metadata_protocol set enabled=false;
commit;
