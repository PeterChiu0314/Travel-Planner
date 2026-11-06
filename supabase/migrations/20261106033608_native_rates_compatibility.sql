-- Admit native rates through the existing trusted transaction effect, without disabling guards.
CREATE OR REPLACE FUNCTION expense_stage_b.update_rates(tid uuid, session_id uuid, token uuid, expected_epoch bigint, base bigint, value jsonb, request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s expense_stage_b.rate_leases;r expense_stage_b.receipts;signature jsonb;quote jsonb;previous jsonb;receipt jsonb;entry record;rate numeric;changed boolean;begin
 if auth.uid() is null or not app_private.can_edit_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if session_id is null or request_id is null or value is null then raise exception 'Invalid request' using errcode='22023';end if;
 signature:=jsonb_build_object('trip',tid,'session',session_id,'base',base,'value',value);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into r from expense_stage_b.receipts where actor=auth.uid() and receipts.request_id=update_rates.request_id;
 if found then if r.signature<>signature then raise exception 'Request mismatch' using errcode='22023';end if;return r.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||tid::text,0));
 select * into s from expense_stage_b.rate_leases where trip_id=tid for update;
 if not found or s.actor is distinct from auth.uid() or s.sid is distinct from session_id or token is null or s.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or s.epoch is distinct from expected_epoch or s.expires_at is null or s.expires_at<=clock_timestamp() then raise exception 'Lease required' using errcode='55P03';end if;
 select budget_exchange_rates into previous from public.trips where id=tid for update;
 if s.revision is distinct from base or value->'previous' is distinct from previous or value->'targets' is distinct from expense_stage_b.rate_targets(tid) then raise exception 'Rates/pricing changed' using errcode='PT409';end if;
 if exists(select 1 from expense_stage_b.groups g join expense_stage_b.expense_items e on e.id=g.expense_id where e.trip_id=tid and e.deleted_at is null and e.payment_state<>'paid' and e.budget->>'currency'<>'TWD' and g.group_key='budget' and g.expires_at>clock_timestamp() and app_private.can_edit_trip(tid,g.actor)) then raise exception 'Pricing busy' using errcode='55P03';end if;
 quote:=value->'quote';
 if jsonb_typeof(quote->'rates') is distinct from 'object' or quote->>'source' is distinct from 'ExchangeRate-API' or (quote->>'quoted_at')::timestamptz is null or (quote->>'quoted_at')::timestamptz>clock_timestamp()+interval '1 day' then raise exception 'Invalid public quote' using errcode='22023';end if;
 for entry in select fx.key,fx.value from jsonb_each(quote->'rates') fx loop
  rate:=entry.value::text::numeric;
  if entry.key!~'^[A-Z]{3}$' or rate<=0 or rate>1000000 or rate<>round(rate,6) then raise exception 'Invalid rate' using errcode='22023';end if;
 end loop;
 if not (quote->'rates' ?& array['JPY','USD','EUR','KRW','HKD']) then raise exception 'Missing rates' using errcode='22023';end if;
 if exists(select 1 from expense_stage_b.expense_items e where e.trip_id=tid and e.deleted_at is null and e.payment_state<>'paid' and e.budget is not null and e.budget->>'currency'<>'TWD' and not(quote->'rates' ? (e.budget->>'currency'))) then raise exception 'Missing item currency' using errcode='22023';end if;
 changed:=(previous->'rates') is distinct from (quote->'rates');
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,pricing_manifest,rates_manifest)
 values(txid_current(),pg_backend_pid(),auth.uid(),tid,'trip',tid,'rates',session_id,request_id,base,expected_epoch,value,signature,'[]',jsonb_build_object('quote',quote,'noop',not changed));
 update public.trips set budget_exchange_rates=quote where id=tid;
 if changed then
  with repriced as (
   update expense_stage_b.expense_items e set budget=e.budget||jsonb_build_object('exchange_rate',(quote->'rates'->>(e.budget->>'currency'))::numeric,'twd_amount',round((e.budget->>'amount')::numeric*(quote->'rates'->>(e.budget->>'currency'))::numeric))
   where e.trip_id=tid and e.deleted_at is null and e.payment_state<>'paid' and e.budget is not null and e.budget->>'currency'<>'TWD' returning e.id
  ) insert into expense_stage_b.groups(expense_id,group_key,revision) select id,'budget',1 from repriced on conflict(expense_id,group_key) do update set revision=groups.revision+1;
 end if;
 update expense_stage_b.rate_leases set revision=revision+1 where trip_id=tid returning * into s;
 receipt:=jsonb_build_object('committed',true,'request_id',request_id,'trip_id',tid,'revision',s.revision,'changed',changed,'quote',quote);
 receipt:=receipt||jsonb_build_object('rates_transaction',txid_current(),'rates_backend',pg_backend_pid());
 insert into expense_stage_b.receipts values(auth.uid(),request_id,signature,receipt);
 delete from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid();
 return receipt;
end $function$;

CREATE OR REPLACE FUNCTION app_private.budget_baseline_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_old uuid; v_new uuid;
begin
  -- Native Rates already owns a validated atomic receipt; retain the legacy Baseline.
  if tg_table_name='trips' and tg_op='UPDATE' then
   if (to_jsonb(new)-'budget_exchange_rates'-'updated_at') = (to_jsonb(old)-'budget_exchange_rates'-'updated_at')
    and exists(select 1 from expense_stage_b.receipts r where r.actor=auth.uid()
      and r.result->>'trip_id'=new.id::text and r.result->>'committed'='true'
      and r.result->>'rates_transaction'=txid_current()::text
      and r.result->>'rates_backend'=pg_backend_pid()::text
      and r.result->'quote'=new.budget_exchange_rates) then return null;end if;
  end if;
  -- Locks, backlink bookkeeping and unchanged rows are not planning edits.
  if tg_op = 'UPDATE' and
    (to_jsonb(new) - 'locked_by' - 'locked_at' - 'updated_at' - 'auto_created_actual_expense_id') =
    (to_jsonb(old) - 'locked_by' - 'locked_at' - 'updated_at' - 'auto_created_actual_expense_id') then return null; end if;
  if tg_table_name = 'trips' then
    if tg_op <> 'DELETE' then v_new := new.id; end if;
  elsif tg_table_name in ('budget_items','trip_members','itinerary_items') then
    if tg_op <> 'INSERT' then v_old := old.trip_id; end if;
    if tg_op <> 'DELETE' then v_new := new.trip_id; end if;
  else
    if tg_op <> 'INSERT' then select trip_id into v_old from public.budget_items where id = old.budget_item_id; end if;
    if tg_op <> 'DELETE' then select trip_id into v_new from public.budget_items where id = new.budget_item_id; end if;
  end if;
  if v_old is not null then perform app_private.refresh_budget_baseline(v_old); end if;
  if v_new is not null and v_new is distinct from v_old then perform app_private.refresh_budget_baseline(v_new); end if;
  return null;
end;
$function$;