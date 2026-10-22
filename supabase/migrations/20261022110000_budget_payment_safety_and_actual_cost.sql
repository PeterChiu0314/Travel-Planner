-- Prepared locally. Do not replay the earlier applied migrations.
begin;

alter table public.actual_expenses
  add column twd_amount_source text not null default 'legacy' check (twd_amount_source in ('legacy','estimated','actual')),
  add column actual_twd_amount numeric(12,2) check (actual_twd_amount >= 0),
  add column payment_origin text not null default 'manual' check (payment_origin in ('manual','budget_toggle'));
update public.actual_expenses set actual_twd_amount = twd_amount;
alter table public.actual_expenses add constraint actual_debit_whole_twd check
  (twd_amount_source <> 'actual' or (actual_twd_amount is not null and actual_twd_amount = round(actual_twd_amount)));

-- The authoritative debit lives separately from the reference FX calculation.
-- Older clients cannot overwrite a known debit by recomputing amount * FX.
create function app_private.keep_actual_twd_cost() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.twd_amount_source = 'legacy' and new.actual_twd_amount is null then new.actual_twd_amount := new.twd_amount; end if;
  if new.twd_amount_source in ('actual','legacy') then
    if new.actual_twd_amount is null then raise exception 'Actual TWD amount required' using errcode = '22023'; end if;
    new.twd_amount := new.actual_twd_amount;
  else new.actual_twd_amount := null; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'updated_at' - 'locked_at' - 'locked_by' - 'payment_origin')
    is distinct from (to_jsonb(old) - 'updated_at' - 'locked_at' - 'locked_by' - 'payment_origin') then new.payment_origin := 'manual'; end if;
  return new;
end $$;
revoke all on function app_private.keep_actual_twd_cost() from public,anon,authenticated;
create trigger keep_actual_twd_cost before insert or update on public.actual_expenses for each row execute function app_private.keep_actual_twd_cost();

-- Serialize all payment-graph changes, including legacy clients and receipts.
create function app_private.lock_budget_payment_graph() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_trip uuid; v_id uuid;
begin
  if tg_table_name = 'actual_expense_participants' then
    v_id := case when tg_op = 'DELETE' then old.actual_expense_id else new.actual_expense_id end;
    select trip_id into v_trip from public.actual_expenses where id = v_id;
  else v_trip := case when tg_op = 'DELETE' then old.trip_id else new.trip_id end; end if;
  if v_trip is not null then perform pg_advisory_xact_lock(hashtextextended(v_trip::text,0)); end if;
  if tg_op = 'DELETE' then return old; end if; return new;
end $$;
revoke all on function app_private.lock_budget_payment_graph() from public,anon,authenticated;
create trigger lock_budget_payment_graph before insert or update or delete on public.actual_expenses for each row execute function app_private.lock_budget_payment_graph();
create trigger lock_budget_payment_people before insert or update or delete on public.actual_expense_participants for each row execute function app_private.lock_budget_payment_graph();
create trigger lock_budget_payment_receipts before insert or update or delete on public.attachments for each row execute function app_private.lock_budget_payment_graph();

create or replace function app_private.apply_trip_budget_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips; v_rate numeric; v_departed boolean;
begin
  if tg_op = 'UPDATE' and new.currency is not distinct from old.currency and new.amount is not distinct from old.amount
    and new.exchange_rate is not distinct from old.exchange_rate and new.twd_amount is not distinct from old.twd_amount
    and new.pricing_mode is not distinct from old.pricing_mode and new.unit_amount is not distinct from old.unit_amount then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.trip_id::text,0));
  select * into v_trip from public.trips where id = new.trip_id;
  v_departed := v_trip.status = 'settled' or v_trip.start_date::timestamp at time zone 'Asia/Taipei' <= clock_timestamp()
    or exists(select 1 from public.trip_budget_baselines where trip_id = new.trip_id and departure_at <= clock_timestamp());
  if tg_op = 'UPDATE' and v_departed and old.currency <> 'TWD' then
    raise exception '已出發的外幣預算保留原金額與匯率，只能修改名稱、備註等資訊。' using errcode = '22023';
  end if;
  if v_trip.budget_exchange_rates ? 'rates' and new.currency <> 'TWD' then
    v_rate := (v_trip.budget_exchange_rates->'rates'->>new.currency)::numeric;
    if v_rate is null or v_rate <= 0 then raise exception 'Missing trip currency rate' using errcode = '22023'; end if;
    new.exchange_rate := v_rate; new.twd_amount := round(new.amount*v_rate);
  end if;
  return new;
end $$;

-- Private idempotency ledger: callers have no direct table privileges. Only
-- this narrow helper has elevated rights; financial mutations stay invoker/RLS.
create table app_private.budget_workspace_requests (
  user_id uuid not null, request_id uuid not null, trip_id uuid not null references public.trips(id) on delete cascade,
  signature text not null, result jsonb not null, primary key(user_id,request_id)
);
revoke all on app_private.budget_workspace_requests from public,anon,authenticated;
create function app_private.budget_workspace_request(p_trip uuid,p_request uuid,p_signature text,p_kind text,p_record uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request app_private.budget_workspace_requests; v_result jsonb;
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip,auth.uid()) then raise exception 'Forbidden' using errcode = '42501'; end if;
  select * into v_request from app_private.budget_workspace_requests where user_id = auth.uid() and request_id = p_request;
  if found then
    if v_request.trip_id <> p_trip or v_request.signature <> p_signature then raise exception 'Request content changed' using errcode = '22023'; end if;
    return v_request.result;
  end if;
  if p_record is null then return null; end if;
  if p_kind = 'budget' then select jsonb_build_object('id',id,'updated_at',updated_at) into v_result from public.budget_items where id = p_record and trip_id = p_trip;
  elsif p_kind = 'actual' then select jsonb_build_object('id',id,'updated_at',updated_at) into v_result from public.actual_expenses where id = p_record and trip_id = p_trip; end if;
  if v_result is null then raise exception 'Record missing' using errcode = '40001'; end if;
  insert into app_private.budget_workspace_requests values(auth.uid(),p_request,p_trip,p_signature,v_result);
  return v_result;
end $$;
revoke all on function app_private.budget_workspace_request(uuid,uuid,text,text,uuid) from public,anon;
grant execute on function app_private.budget_workspace_request(uuid,uuid,text,text,uuid) to authenticated;

create function public.save_budget_workspace_record_v2(p_trip_id uuid,p_kind text,p_id uuid,p_base_updated_at timestamptz,p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_trip public.trips; v_budget public.budget_items; v_actual public.actual_expenses;
  v_payload jsonb := p_payload; v_result jsonb; v_signature text; v_id uuid; v_payment uuid;
  v_action text := coalesce(p_payload->>'payment_action','keep'); v_expected jsonb; v_received jsonb;
  v_departed boolean; v_only boolean := coalesce((p_payload->>'payment_only')::boolean,false);
  v_source text := coalesce(p_payload->>'twd_amount_source','estimated'); v_debit numeric;
  v_people uuid[]; v_existing_people uuid[]; v_links uuid[];
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id,auth.uid()) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_request_id is null or p_kind not in ('budget','actual') or v_action not in ('keep','paid','unpaid') or (v_only and (p_kind <> 'budget' or p_id is null)) then raise exception 'Invalid request' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  v_signature := md5(jsonb_build_object('kind',p_kind,'id',p_id,'base',p_base_updated_at,'payload',p_payload)::text);
  v_result := app_private.budget_workspace_request(p_trip_id,p_request_id,v_signature,p_kind);
  if v_result is not null then return v_result; end if;
  select * into v_trip from public.trips where id = p_trip_id for update;
  v_departed := v_trip.status = 'settled' or v_trip.start_date::timestamp at time zone 'Asia/Taipei' <= clock_timestamp()
    or exists(select 1 from public.trip_budget_baselines where trip_id = p_trip_id and departure_at <= clock_timestamp());
  if p_kind = 'budget' and p_id is not null then
    select * into v_budget from public.budget_items where id = p_id and trip_id = p_trip_id for update;
    if not found or p_base_updated_at is null or p_base_updated_at <> v_budget.updated_at then raise exception 'Budget changed' using errcode = '40001'; end if;
    if v_budget.locked_by is not null and v_budget.locked_by <> auth.uid() and v_budget.locked_at > clock_timestamp()-interval '7 minutes' then raise exception 'Budget locked' using errcode = '55P03'; end if;
  end if;
  if p_kind = 'budget' and v_action <> 'keep' then
    perform 1 from public.actual_expenses where trip_id = p_trip_id and budget_item_id = p_id order by id for update;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by id),'[]') into v_received from public.actual_expenses where trip_id = p_trip_id and budget_item_id = p_id;
    select coalesce(jsonb_agg(jsonb_build_object('id',(e->>'id')::uuid,'updated_at',(e->>'updated_at')::timestamptz) order by (e->>'id')::uuid),'[]') into v_expected from jsonb_array_elements(coalesce(p_payload->'payment_expected','[]')) e;
    if v_received <> v_expected then raise exception '實付資料已變更，請重新開啟後確認。' using errcode = '40001'; end if;
    if exists(select 1 from public.actual_expenses where budget_item_id = p_id and trip_id = p_trip_id and locked_by is not null and locked_by <> auth.uid() and locked_at > clock_timestamp()-interval '7 minutes') then raise exception 'Expense locked' using errcode = '55P03'; end if;
    if v_action = 'unpaid' and jsonb_array_length(v_received)>0 then
      if not coalesce((p_payload->>'payment_confirmed')::boolean,false) then raise exception '取消付款前必須確認刪除實付資料。' using errcode = '22023'; end if;
      if exists(select 1 from public.attachments a join public.actual_expenses e on a.target_type='actual_expense' and a.target_id=e.id where e.trip_id=p_trip_id and e.budget_item_id=p_id) then
        raise exception '實付含有收據，請先至實付明細處理附件；付款與收據均已保留。' using errcode = '22023';
      end if;
    end if;
  end if;
  if p_kind = 'budget' then
    -- Never let the older fixed-actual path run before the payment transaction.
    v_payload := v_payload || jsonb_build_object('is_fixed',false);
    if not v_only and v_departed and v_budget.id is not null and v_budget.currency <> 'TWD' then
      select array_agg(distinct x::uuid order by x::uuid) into v_people from jsonb_array_elements_text(p_payload->'participantIds') x;
      select array_agg(user_id order by user_id) into v_existing_people from public.budget_item_participants where budget_item_id=p_id;
      if v_existing_people is null then select array_agg(user_id order by user_id) into v_existing_people from public.trip_members where trip_id=p_trip_id and status='approved'; end if;
      if coalesce(v_people,'{}') <> coalesce(v_existing_people,'{}') or p_payload->>'currency' is distinct from v_budget.currency
        or (p_payload->>'amount')::numeric is distinct from v_budget.amount or nullif(p_payload->>'exchange_rate','')::numeric is distinct from v_budget.exchange_rate
        or p_payload->>'pricing_mode' is distinct from v_budget.pricing_mode or nullif(p_payload->>'unit_amount','')::numeric is distinct from v_budget.unit_amount
        or exists(select 1 from public.budget_item_participants where budget_item_id=p_id and v_budget.pricing_mode='custom' and nullif(p_payload->'shares'->>user_id::text,'')::numeric is distinct from share_amount) then
        raise exception '已出發的外幣預算保留原金額與匯率，只能修改名稱、備註等資訊。' using errcode = '22023';
      end if;
      if coalesce(btrim(p_payload->>'title'),'')='' then raise exception 'Title required' using errcode='22023'; end if;
      select array_agg(distinct x::uuid) into v_links from jsonb_array_elements_text(coalesce(p_payload->'linkedItemIds','[]')) x;
      if exists(select 1 from unnest(v_links) x where not exists(select 1 from public.itinerary_items where id=x and trip_id=p_trip_id)) then raise exception 'Invalid itinerary link' using errcode='22023'; end if;
      update public.budget_items set title=btrim(p_payload->>'title'),category=coalesce(nullif(btrim(p_payload->>'category'),''),'其他'),subcategory=nullif(p_payload->>'subcategory',''),note=nullif(p_payload->>'note',''),locked_by=null,locked_at=null where id=p_id and trip_id=p_trip_id;
      delete from public.itinerary_budget_items where budget_item_id=p_id;
      insert into public.itinerary_budget_items(budget_item_id,itinerary_item_id) select p_id,unnest(v_links);
      v_id := p_id;
    elsif v_only then v_id := p_id;
    else
      if coalesce(p_payload->>'currency','TWD') <> 'TWD' then
        if not coalesce(v_trip.budget_exchange_rates->'rates' ? (p_payload->>'currency'),false) then raise exception '尚未取得此幣別的旅程匯率。' using errcode='22023'; end if;
        v_payload := v_payload || jsonb_build_object('exchange_rate',v_trip.budget_exchange_rates->'rates'->(p_payload->>'currency'));
      end if;
      v_result := public.save_budget_workspace_record(p_trip_id,p_kind,p_id,p_base_updated_at,v_payload); v_id := (v_result->>'id')::uuid;
    end if;
    if (v_action='paid' or v_action='keep' and coalesce((p_payload->>'is_fixed')::boolean,false)) and not exists(select 1 from public.actual_expenses where trip_id=p_trip_id and budget_item_id=v_id) then
      v_payment := gen_random_uuid();
      insert into public.actual_expenses(id,trip_id,budget_item_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,note,payment_origin,twd_amount_source)
      select v_payment,trip_id,id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,note,'budget_toggle','estimated' from public.budget_items where id=v_id and trip_id=p_trip_id;
      insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) select v_payment,user_id,share_amount from public.budget_item_participants where budget_item_id=v_id;
      update public.budget_items set auto_created_actual_expense_id=v_payment where id=v_id and trip_id=p_trip_id;
    elsif v_action='unpaid' then
      for v_actual in select * from public.actual_expenses where trip_id=p_trip_id and budget_item_id=v_id order by id loop
        delete from public.actual_expenses where id=v_actual.id and trip_id=p_trip_id;
      end loop;
      update public.budget_items set auto_created_actual_expense_id=null where id=v_id and trip_id=p_trip_id;
    end if;
    update public.budget_items set locked_by=null,locked_at=null where id=v_id and trip_id=p_trip_id and locked_by=auth.uid();
  else
    if v_only or v_source not in ('estimated','actual','legacy') then raise exception 'Invalid actual input' using errcode='22023'; end if;
    if v_source <> 'estimated' then
      v_debit := (p_payload->>'actual_twd_amount')::numeric;
      if v_debit is null or v_debit<0 or (v_source='actual' and v_debit<>round(v_debit)) or v_debit>9999999999 then raise exception '台幣扣款金額請輸入非負整數。' using errcode='22023'; end if;
      if v_source='legacy' then
        select * into v_actual from public.actual_expenses where id=p_id and trip_id=p_trip_id;
        if not found or v_actual.twd_amount_source<>'legacy' or v_debit<>v_actual.twd_amount then raise exception 'Legacy amount changed' using errcode='22023'; end if;
      end if;
      -- Validate original-currency pricing without deriving the known debit from FX.
      if nullif(p_payload->>'exchange_rate','')::numeric <= 0 then raise exception 'Reference rate must be positive' using errcode='22023'; end if;
      v_payload := v_payload || '{"exchange_rate":1}'::jsonb;
    end if;
    v_result := public.save_budget_workspace_record(p_trip_id,p_kind,p_id,p_base_updated_at,v_payload); v_id := (v_result->>'id')::uuid;
    if v_source<>'estimated' and v_debit>0 and exists(select 1 from public.actual_expenses where id=v_id and pricing_mode='custom' and amount=0) then raise exception '自訂分攤合計為零，無法分配非零台幣成本。' using errcode='22023'; end if;
    update public.actual_expenses set exchange_rate=case when v_source='estimated' then exchange_rate when currency='TWD' then null else nullif(p_payload->>'exchange_rate','')::numeric end,
      twd_amount_source=v_source,actual_twd_amount=case when v_source='estimated' then null else v_debit end,
      twd_amount=case when v_source='estimated' then round(amount*coalesce(exchange_rate,1)) else v_debit end,payment_origin='manual' where id=v_id and trip_id=p_trip_id;
  end if;
  return app_private.budget_workspace_request(p_trip_id,p_request_id,v_signature,p_kind,v_id);
end $$;
revoke all on function public.save_budget_workspace_record_v2(uuid,text,uuid,timestamptz,jsonb,uuid) from public,anon;
grant execute on function public.save_budget_workspace_record_v2(uuid,text,uuid,timestamptz,jsonb,uuid) to authenticated;
commit;
