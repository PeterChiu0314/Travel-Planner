-- Prepared locally only. Payment status never deletes a payment or receipt.
begin;
alter table public.actual_expenses add column payment_active boolean not null default true,
  add column payment_history jsonb not null default '[]'::jsonb check(jsonb_typeof(payment_history)='array');

create function public.save_budget_workspace_record_v3(p_trip_id uuid,p_kind text,p_id uuid,p_base_updated_at timestamptz,p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_result jsonb; v_signature text; v_inner uuid; v_payload jsonb; v_id uuid; v_payment public.actual_expenses;
  v_received jsonb; v_expected jsonb; v_count integer; v_active boolean; v_budget public.budget_items;
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_kind <> 'budget' or p_request_id is null then raise exception 'Invalid planning request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  v_signature:=md5(jsonb_build_object('v',3,'kind',p_kind,'id',p_id,'base',p_base_updated_at,'payload',p_payload)::text);
  v_result:=app_private.budget_workspace_request(p_trip_id,p_request_id,v_signature,p_kind);
  if v_result is not null then return v_result; end if;
  perform 1 from public.actual_expenses where trip_id=p_trip_id and budget_item_id=p_id order by id for update;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by id),'[]') into v_count,v_received from public.actual_expenses where trip_id=p_trip_id and budget_item_id=p_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',(e->>'id')::uuid,'updated_at',(e->>'updated_at')::timestamptz) order by (e->>'id')::uuid),'[]') into v_expected from jsonb_array_elements(coalesce(p_payload->'payment_expected','[]')) e;
  if v_received<>v_expected then raise exception '付款資料已變更，請重新開啟確認。' using errcode='40001'; end if;
  if exists(select 1 from public.actual_expenses where trip_id=p_trip_id and budget_item_id=p_id and locked_by is not null and locked_by<>auth.uid() and locked_at>clock_timestamp()-interval '7 minutes') then raise exception 'Expense locked' using errcode='55P03'; end if;
  if p_payload->>'payment_action' not in ('paid','unpaid','keep') then raise exception 'Invalid payment state' using errcode='22023'; end if;
  if coalesce((p_payload->>'sync_payment')::boolean,false) and v_count>1 then raise exception '多筆既有付款請逐筆修改金額。' using errcode='22023'; end if;
  v_inner:=md5(p_request_id::text||':planning')::uuid;
  v_payload:=p_payload||jsonb_build_object('payment_action','keep','is_fixed',false);
  v_result:=public.save_budget_workspace_record_v2(p_trip_id,p_kind,p_id,p_base_updated_at,v_payload,v_inner);
  v_id:=(v_result->>'id')::uuid;
  select * into v_budget from public.budget_items where trip_id=p_trip_id and id=v_id;
  if v_count=0 and p_payload->>'payment_action'='paid' then
    insert into public.actual_expenses(trip_id,budget_item_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,note,payment_origin,twd_amount_source,actual_twd_amount)
      values(p_trip_id,v_id,v_budget.category,v_budget.subcategory,v_budget.title,v_budget.amount,v_budget.currency,v_budget.exchange_rate,v_budget.twd_amount,v_budget.payer_id,v_budget.pricing_mode,v_budget.unit_amount,v_budget.split_type,v_budget.note,'budget_toggle',case when v_budget.currency='TWD' then 'actual' else 'estimated' end,case when v_budget.currency='TWD' then v_budget.twd_amount else null end) returning * into v_payment;
    insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) select v_payment.id,user_id,share_amount from public.budget_item_participants where budget_item_id=v_id;
    update public.budget_items set auto_created_actual_expense_id=v_payment.id where id=v_id;
  elsif v_count=1 and coalesce((p_payload->>'sync_payment')::boolean,false) and not coalesce((p_payload->>'payment_only')::boolean,false) then
    select * into v_payment from public.actual_expenses where trip_id=p_trip_id and budget_item_id=v_id;
    -- Keep the original currency, amount and receipt identity in history before an edit.
    update public.actual_expenses set payment_history=payment_history||jsonb_build_array(to_jsonb(v_payment)-'payment_history'),
      category=v_budget.category,title=v_budget.title,note=v_budget.note,amount=v_budget.amount,currency=v_budget.currency,exchange_rate=v_budget.exchange_rate,
      payer_id=v_budget.payer_id,pricing_mode=v_budget.pricing_mode,unit_amount=v_budget.unit_amount,split_type=v_budget.split_type,
      twd_amount_source=case when v_budget.currency='TWD' then 'actual' else 'estimated' end,
      actual_twd_amount=case when v_budget.currency='TWD' then v_budget.twd_amount else null end,twd_amount=v_budget.twd_amount
      where id=v_payment.id and trip_id=p_trip_id;
    delete from public.actual_expense_participants where actual_expense_id=v_payment.id;
    insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) select v_payment.id,user_id,share_amount from public.budget_item_participants where budget_item_id=v_id;
  end if;
  if p_payload->>'payment_action'<>'keep' then
    update public.actual_expenses set payment_active=(p_payload->>'payment_action'='paid') where trip_id=p_trip_id and budget_item_id=v_id;
  end if;
  return app_private.budget_workspace_request(p_trip_id,p_request_id,v_signature,p_kind,v_id);
end $$;
revoke all on function public.save_budget_workspace_record_v3(uuid,text,uuid,timestamptz,jsonb,uuid) from public,anon;
grant execute on function public.save_budget_workspace_record_v3(uuid,text,uuid,timestamptz,jsonb,uuid) to authenticated;

-- A manual quote refresh affects unpaid estimates only. Retained payments use
-- their saved cost, including when temporarily marked unpaid.
create or replace function public.update_trip_budget_rates(p_trip_id uuid,p_quote jsonb,p_initialize boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_trip public.trips; v_currency text; v_rate numeric; v_quote jsonb;
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  select * into v_trip from public.trips where id=p_trip_id for update;
  if v_trip.start_date is null or v_trip.start_date::timestamp at time zone 'Asia/Taipei'<=clock_timestamp() or v_trip.status='settled' or exists(select 1 from public.trip_budget_baselines where trip_id=p_trip_id and departure_at<=clock_timestamp()) then raise exception '只有行前規劃可更新旅程預算匯率。' using errcode='22023'; end if;
  if p_initialize and v_trip.budget_exchange_rates ? 'rates' then return v_trip.budget_exchange_rates; end if;
  if jsonb_typeof(p_quote->'rates') is distinct from 'object' or p_quote->>'source' is distinct from 'ExchangeRate-API' or (p_quote->>'quoted_at')::timestamptz is null or (p_quote->>'quoted_at')::timestamptz>clock_timestamp()+interval '1 day' then raise exception 'Invalid rate quote' using errcode='22023'; end if;
  foreach v_currency in array array['JPY','USD','EUR','KRW','HKD'] loop
    if not(p_quote->'rates' ? v_currency) then raise exception 'Missing currency quote' using errcode='22023'; end if;
  end loop;
  for v_currency in select jsonb_object_keys(p_quote->'rates') loop
    v_rate:=(p_quote->'rates'->>v_currency)::numeric;
    if v_currency !~ '^[A-Z]{3}$' or v_rate is null or v_rate<=0 or v_rate>1000000 or v_rate<>round(v_rate,6) then raise exception 'Invalid currency rate' using errcode='22023'; end if;
  end loop;
  perform 1 from public.budget_items where trip_id=p_trip_id order by id for update;
  if exists(select 1 from public.budget_items where trip_id=p_trip_id and locked_by is not null and locked_by<>auth.uid() and locked_at>clock_timestamp()-interval '7 minutes') then raise exception '其他成員正在編輯預算，請稍後更新匯率。' using errcode='55P03'; end if;
  if exists(select 1 from public.budget_items b where b.trip_id=p_trip_id and b.currency<>'TWD' and not(p_quote->'rates' ? b.currency)) then raise exception 'Missing currency quote' using errcode='22023'; end if;
  v_quote:=jsonb_build_object('rates',p_quote->'rates','source',p_quote->>'source','quoted_at',(p_quote->>'quoted_at')::timestamptz,'updated_at',clock_timestamp());
  update public.trips set budget_exchange_rates=v_quote where id=p_trip_id;
  update public.budget_items b set exchange_rate=(v_quote->'rates'->>b.currency)::numeric,twd_amount=round(b.amount*(v_quote->'rates'->>b.currency)::numeric)
    where b.trip_id=p_trip_id and b.currency<>'TWD' and not exists(select 1 from public.actual_expenses e where e.trip_id=p_trip_id and e.budget_item_id=b.id);
  return v_quote;
end $$;
commit;
