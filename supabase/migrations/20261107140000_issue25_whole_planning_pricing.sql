-- Issue #25. Enforce original-currency integers on fresh planning budget writes.
-- No historical rows are migrated. Existing request receipts replay unchanged.
begin;

create function expense_stage_b.round_planning_amount(raw text)
returns numeric language plpgsql immutable set search_path='' as $$
declare amount numeric;
begin
 if btrim(coalesce(raw,'')) !~ '^[0-9]+(\.[0-9]{1,2})?$' then
  raise exception 'Invalid planning amount' using errcode='22023';
 end if;
 amount:=raw::numeric;
 if amount>9999999999.99 then raise exception 'Planning amount exceeds limit' using errcode='22023';end if;
 return round(amount);
end $$;
revoke all on function expense_stage_b.round_planning_amount(text) from public,anon,authenticated;

create or replace function expense_stage_b.mutate(eid uuid,g text,session_id uuid,token uuid,expected_epoch bigint,base bigint,value jsonb,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid;s expense_stage_b.groups;r expense_stage_b.receipts;item expense_stage_b.expense_items;
 signature jsonb;receipt jsonb;form jsonb;money jsonb;ids uuid[];expected_members uuid[];members uuid[];mode text;amount numeric;unit numeric;rate numeric;twd numeric;source text;shares jsonb;shares_total numeric;person uuid;piece numeric;position integer;n integer;revision bigint;whole_original boolean:=false;share_scale integer:=100;
begin
 tid:=expense_stage_b.authorize(eid);
 if request_id is null or session_id is null or value is null or jsonb_typeof(value)<>'object' then raise exception 'Invalid request' using errcode='22023';end if;
 signature:=jsonb_build_object('id',eid,'group',g,'session',session_id,'base',base,'value',value);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into r from expense_stage_b.receipts where actor=auth.uid() and receipts.request_id=mutate.request_id;
 if found then if r.signature<>signature then raise exception 'Request mismatch' using errcode='22023';end if;return r.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||tid::text,0));
 select * into item from expense_stage_b.expense_items where id=eid for update;
 if item.deleted_at is not null then raise exception 'Item removed' using errcode='55000';end if;
 select * into s from expense_stage_b.groups where expense_id=eid and group_key=g for update;
 if not found or s.actor is distinct from auth.uid() or s.sid is distinct from session_id or token is null or s.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or s.epoch is distinct from expected_epoch or s.expires_at<=clock_timestamp() or s.expires_at is null then raise exception 'Lease required' using errcode='55P03';end if;
 if s.revision is distinct from base then raise exception 'Version conflict' using errcode='PT409';end if;
 if g in('budget','paid','payer','payment') and exists(select 1 from expense_stage_b.groups where expense_id=eid and group_key<>g and group_key in('budget','paid','payer','payment') and expires_at>clock_timestamp() and (actor is distinct from auth.uid() or sid is distinct from session_id)) then raise exception 'Payment group busy' using errcode='55P03';end if;
 select coalesce(array_agg(user_id order by user_id),'{}') into members from public.trip_members where trip_id=tid and status='approved';
 if g in('budget','paid') then
  form:=value->'form';mode:=form->>'pricing_mode';
  select coalesce(array_agg(x::uuid order by x::uuid),'{}') into expected_members from jsonb_array_elements_text(value->'members') x;
  if expected_members<>members then raise exception 'Members changed' using errcode='PT409';end if;
  select array_agg(distinct x::uuid order by x::uuid) into ids from jsonb_array_elements_text(form->'participantIds') x;
  if cardinality(ids) is null or not(ids<@members) or mode is null or mode not in('split_total','per_person','custom') or coalesce(form->>'currency','')!~'^[A-Z]{3}$' then raise exception 'Invalid participants/mode' using errcode='22023';end if;
  rate:=case when form->>'currency'='TWD' then 1 else (form->>'exchange_rate')::numeric end;
  if (rate is null and not(g='paid' and form->>'twd_amount_source'='actual')) or rate<=0 or rate<>round(rate,6) then raise exception 'Invalid rate' using errcode='22023';end if;
  if g='budget' and form->>'currency'<>'TWD' and ((value->'rates') is distinct from (select budget_exchange_rates from public.trips where id=tid) or rate is distinct from (select (budget_exchange_rates->'rates'->>(form->>'currency'))::numeric from public.trips where id=tid)) then raise exception 'Rates changed' using errcode='PT409';end if;
  -- Derive the stage from the trip. An older or forged client cannot opt out.
  if g='budget' then
   select t.status<>'settled'
     and (t.start_date is null or t.start_date>(statement_timestamp() at time zone 'Asia/Taipei')::date)
     and (t.end_date is null or t.end_date>=(statement_timestamp() at time zone 'Asia/Taipei')::date)
   into whole_original from public.trips t where t.id=tid;
  end if;
  if whole_original then share_scale:=1;end if;
  shares:='{}';amount:=0;n:=cardinality(ids);
  if mode='per_person' then
   unit:=case when whole_original then expense_stage_b.round_planning_amount(form->>'unit_amount') else (form->>'unit_amount')::numeric end;
   amount:=unit*n;
  elsif mode='split_total' then
   amount:=case when whole_original then expense_stage_b.round_planning_amount(form->>'amount') else (form->>'amount')::numeric end;
  else
   foreach person in array ids loop
    piece:=case when whole_original then expense_stage_b.round_planning_amount(form->'shares'->>person::text)
     else (form->'shares'->>person::text)::numeric end;
    if piece is null or piece<0 or piece<>round(piece,2) then raise exception 'Invalid custom share' using errcode='22023';end if;
    amount:=amount+piece;shares:=shares||jsonb_build_object(person::text,piece);
   end loop;
  end if;
  if amount is null or amount<0 or amount>9999999999.99 or amount<>round(amount,2) or (mode='per_person' and (unit is null or unit<0 or unit<>round(unit,2))) then raise exception 'Invalid amount' using errcode='22023';end if;
  if mode<>'custom' then
   position:=0;foreach person in array ids loop piece:=(trunc(amount*share_scale/n)+case when position<mod(amount*share_scale,n) then 1 else 0 end)/share_scale;position:=position+1;shares:=shares||jsonb_build_object(person::text,piece);end loop;
  end if;
  source:=case when g='paid' then coalesce(form->>'twd_amount_source','estimated') else 'estimated' end;
  if source not in('estimated','actual') then raise exception 'Invalid debit source' using errcode='22023';end if;
  twd:=case when source='actual' then (form->>'actual_twd_amount')::numeric else round(amount*rate) end;
  if twd is null or twd<0 or twd>9999999999 or twd<>trunc(twd) or (amount=0 and twd<>0) then raise exception 'Invalid TWD amount' using errcode='22023';end if;
  money:=jsonb_build_object('amount',amount,'currency',form->>'currency','exchange_rate',rate,'pricing_mode',mode,'unit_amount',unit,'split_type',case when mode='custom' then 'custom' else 'equal' end,'twd_amount',twd,'twd_amount_source',source,'actual_twd_amount',case when source='actual' then twd else null end);
  if whole_original then money:=money||jsonb_build_object('original_scale',0);end if;
  update expense_stage_b.expense_items set budget=case when g='budget' then money else budget end,paid=case when g='paid' then money else paid end,
   budget_decisions_known=case when g='budget' then true else budget_decisions_known end,paid_decisions_known=case when g='paid' then true else paid_decisions_known end where id=eid;
  foreach person in array members loop
   if g='budget' then insert into expense_stage_b.expense_participants(expense_id,user_id,budget_selected,budget_share_amount) values(eid,person,person=any(ids),(shares->>person::text)::numeric) on conflict(expense_id,user_id) do update set budget_selected=excluded.budget_selected,budget_share_amount=excluded.budget_share_amount;
   else insert into expense_stage_b.expense_participants(expense_id,user_id,paid_selected,paid_share_amount) values(eid,person,person=any(ids),(shares->>person::text)::numeric) on conflict(expense_id,user_id) do update set paid_selected=excluded.paid_selected,paid_share_amount=excluded.paid_share_amount;end if;
  end loop;
 elsif g in('title','note','category') then
  if g<>'note' and btrim(coalesce(value->>'text',''))='' then raise exception 'Text required' using errcode='22023';end if;
  update expense_stage_b.expense_items set title=case when g='title' then btrim(value->>'text') else title end,note=case when g='note' then value->>'text' else note end,category=case when g='category' then btrim(value->>'text') else category end where id=eid;
 elsif g='payer' then
  if value ? 'form' then
   if (value->>'budget_revision')::bigint is distinct from coalesce((select groups.revision from expense_stage_b.groups where expense_id=eid and group_key='budget'),0) or (value->>'paid_revision')::bigint is distinct from coalesce((select groups.revision from expense_stage_b.groups where expense_id=eid and group_key='paid'),0) then raise exception 'Pricing changed' using errcode='PT409';end if;
   if (value->'form'->>'sequence')::bigint<item.payer_sequence then raise exception 'Payer order changed' using errcode='PT409';end if;
   form:=expense_stage_b.normalize_payers(value->'form',coalesce((item.budget->>'amount')::numeric,(item.paid->>'amount')::numeric,0),members);
   if form->>'mode'='advance' and jsonb_array_length(form->'rows')=0 then raise exception 'Payer required' using errcode='22023';end if;
   update expense_stage_b.expense_items set payment_mode=form->>'mode',payer_allocations=form->'rows',payer_sequence=(form->>'sequence')::bigint,planning_managed=true,payer_id=case when form->>'mode'='advance' then (form->'rows'->0->>'user_id')::uuid else null end where id=eid;
  else
   if jsonb_array_length(item.payer_allocations)>1 then raise exception 'Payment editor changed' using errcode='55000';end if;
   person:=(value->>'user_id')::uuid;if person is null or not(person=any(members)) then raise exception 'Invalid payer' using errcode='22023';end if;
   update expense_stage_b.expense_items set payment_mode='advance',payer_id=person,payer_allocations=jsonb_build_array(jsonb_build_object('user_id',person,'amount',round(coalesce((item.paid->>'amount')::numeric,(item.budget->>'amount')::numeric,0)),'order',0)) where id=eid;
  end if;
 elsif g='lifecycle' then
  if value->>'action'<>'delete' then raise exception 'Invalid lifecycle' using errcode='22023';end if;
  if exists(select 1 from public.accommodations where expense_id=eid) then raise exception 'Accommodation still linked' using errcode='55000';end if;
  if exists(select 1 from expense_stage_b.groups where expense_id=eid and group_key<>'lifecycle' and expires_at>clock_timestamp() and (actor is distinct from auth.uid() or sid is distinct from session_id)) then raise exception 'Item busy' using errcode='55P03';end if;
  update expense_stage_b.expense_items set deleted_at=clock_timestamp() where id=eid;
 elsif g='links' then
  perform expense_stage_b.validate_link_targets(tid, value);
  delete from expense_stage_b.expense_itinerary_links where expense_id=eid;
  insert into expense_stage_b.expense_itinerary_links(expense_id,trip_id,itinerary_item_id) select eid,tid,x::uuid from jsonb_array_elements_text(value->'ids') x;
 elsif g='payment' then
  if (value->>'budget_revision')::bigint is distinct from coalesce((select groups.revision from expense_stage_b.groups where expense_id=eid and group_key='budget'),0)
   or (value->>'paid_revision')::bigint is distinct from coalesce((select groups.revision from expense_stage_b.groups where expense_id=eid and group_key='paid'),0)
   or (value->>'payer_revision')::bigint is distinct from coalesce((select groups.revision from expense_stage_b.groups where expense_id=eid and group_key='payer'),0)
  then raise exception 'Payment dependency changed' using errcode='PT409';end if;
  if exists(select 1 from expense_stage_b.groups where expense_id=eid and group_key in('budget','paid','payer') and expires_at>clock_timestamp() and (actor is distinct from auth.uid() or sid is distinct from session_id)) then raise exception 'Pricing busy' using errcode='55P03';end if;
  if value->>'action'='unpaid' then update expense_stage_b.expense_items set payment_state='unpaid' where id=eid;
  elsif value->>'action'='paid' then
   if (item.payment_mode='advance' and ((jsonb_array_length(item.payer_allocations)=0 and item.payer_id is null) or exists(select 1 from jsonb_array_elements(item.payer_allocations) x where not((x->>'user_id')::uuid=any(members))))) or (value->>'paid_at')::timestamptz is null or btrim(item.title)='' then raise exception 'Complete payment details required' using errcode='22023';end if;
   if item.paid is null then
    if item.budget is null then raise exception 'Payment amount required' using errcode='22023';end if;
    update expense_stage_b.expense_items set paid=budget,paid_decisions_known=budget_decisions_known where id=eid;
    update expense_stage_b.expense_participants set paid_selected=budget_selected,paid_share_amount=budget_share_amount where expense_id=eid;
    insert into expense_stage_b.groups(expense_id,group_key,revision) values(eid,'paid',1) on conflict(expense_id,group_key) do update set revision=groups.revision+1;
   end if;
   update expense_stage_b.expense_items set payment_state='paid',paid_at=(value->>'paid_at')::timestamptz where id=eid;
  else raise exception 'Invalid payment action' using errcode='22023';end if;
 else raise exception 'Unsupported mutation' using errcode='22023';end if;
 if g in('budget','paid','payer','payment') then
  -- Payer edits rebalance payer amounts without replacing a stored paid bundle.
  perform expense_stage_b.sync_payment(eid,g,case when g='budget' then whole_original
   when g='payer' then false else coalesce((value->>'planning')::boolean,false) end);
 end if;
 update expense_stage_b.groups set revision=groups.revision+1 where expense_id=eid and group_key=g returning groups.revision into revision;
 receipt:=jsonb_build_object('committed',true,'request_id',request_id,'expense_id',eid,'group',g,'revision',revision,'item',(select to_jsonb(e) from expense_stage_b.expense_items e where id=eid),'participants',(select coalesce(jsonb_agg(to_jsonb(p) order by user_id),'[]') from expense_stage_b.expense_participants p where expense_id=eid));
 insert into expense_stage_b.receipts values(auth.uid(),request_id,signature,receipt);return receipt;
end $$;

commit;
