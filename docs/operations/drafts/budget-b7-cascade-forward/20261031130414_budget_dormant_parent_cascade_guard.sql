-- NON-AUTO-APPLY. Full source prepared for Review; official version pending.
-- Repairs only guard_incomplete_child; prior migrations/seals stay immutable.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
-- Freeze all seven admission rows against concurrent activation during repair.
lock table app_private.budget_metadata_protocol,app_private.budget_payment_protocol,
 app_private.budget_source_protocol,app_private.budget_finance_protocol,
 app_private.budget_lifecycle_protocol,app_private.budget_receipt_protocol,
 app_private.budget_metadata_undo_protocol in share mode nowait;
do $repair$
declare before_attr jsonb;after_attr jsonb;body text;begin
 select to_jsonb(p)-'prosrc',replace(p.prosrc,chr(13),'') into before_attr,body from pg_proc p where p.oid=to_regprocedure('app_private.guard_incomplete_child()');
 if before_attr is null or encode(sha256(convert_to(body,'UTF8')),'hex') not in('c3667a091954ed67ea677ff73aed85a5aa57cf292bb02519fcea155521a4a3d5','ecd7888508e91b6df351a9ab4e95cf1a3facc426316ee68a868e622b1cdfda51') then raise exception 'Unreviewed incomplete-child Guard hash';end if;
 if exists(select 1 from app_private.budget_finance_protocol where enabled or activated) or exists(select 1 from app_private.budget_lifecycle_protocol where enabled or activated) or exists(select 1 from app_private.budget_receipt_protocol where enabled or activated)
  or exists(select 1 from app_private.budget_metadata_protocol where enabled) or exists(select 1 from app_private.budget_payment_protocol where enabled)
  or exists(select 1 from app_private.budget_source_protocol where enabled) or exists(select 1 from app_private.budget_metadata_undo_protocol where enabled or full_enabled)
  then raise exception 'Dormant-only repair refused after activation';end if;
 execute $definition$create or replace function app_private.guard_incomplete_child() returns trigger language plpgsql security definer set search_path='' as $$
declare k text:=case when tg_table_name='actual_expense_participants' then 'actual' else 'budget' end;r jsonb:=coalesce(to_jsonb(new),to_jsonb(old));rid uuid;
begin
 rid:=(r->>case when k='budget' then 'budget_item_id' else 'actual_expense_id' end)::uuid;
 -- A genuine FK cascade runs after the parent row disappears. Before first
 -- activation, preserve the legacy delete behavior for this DELETE only.
 -- A paused activated protocol keeps the existing fail-closed boundary.
 if tg_op='DELETE' and not (app_private.budget_finance_activated() or app_private.budget_lifecycle_activated() or app_private.receipts_activated())
  and not exists(select 1 from public.budget_items where k='budget' and id=rid)
  and not exists(select 1 from public.actual_expenses where k='actual' and id=rid) then return old;end if;
 if not app_private.budget_complete(k,rid) and app_private.budget_pricing_effect(k,rid) is null and app_private.budget_lifecycle_effect(k,rid,'delete') is null then raise exception 'Incomplete participants require validated Pricing' using errcode='55000';end if;
 return coalesce(new,old);
end $$;$definition$;
 -- FORWARD_POST_REPLACE_CHECK
 select to_jsonb(p)-'prosrc',replace(p.prosrc,chr(13),'') into after_attr,body from pg_proc p where p.oid=to_regprocedure('app_private.guard_incomplete_child()');
 if before_attr is distinct from after_attr or encode(sha256(convert_to(body,'UTF8')),'hex')<>'ecd7888508e91b6df351a9ab4e95cf1a3facc426316ee68a868e622b1cdfda51' then raise exception 'Forward changed routine attributes or body unexpectedly';end if;
end $repair$;
commit;
