-- Member removal and its expense consequences share the membership transaction.
begin;

create table expense_stage_b.departed_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null,
  display_name text,
  primary key (trip_id, user_id)
);
alter table expense_stage_b.departed_members enable row level security;
revoke all on table expense_stage_b.departed_members from public, anon, authenticated;

create function expense_stage_b.reallocate_departed_budget(
  item expense_stage_b.expense_items, members uuid[]
) returns void language plpgsql set search_path = '' as $$
declare
  selected_ids uuid[];
  remaining_ids uuid[];
  updated_budget jsonb := item.budget;
  mode text := item.budget->>'pricing_mode';
  total numeric := (item.budget->>'amount')::numeric;
  unit numeric := (item.budget->>'unit_amount')::numeric;
  share_scale integer := 100;
  removed_total numeric;
  count_remaining integer;
begin
  select array_agg(user_id order by user_id),
         coalesce(array_agg(user_id order by user_id) filter (where user_id = any(members)), '{}')
  into selected_ids, remaining_ids
  from expense_stage_b.expense_participants where expense_id=item.id and budget_selected;

  if updated_budget is not null then
    count_remaining := cardinality(remaining_ids);
    if count_remaining=0 then
      -- Keep the amount for the next explicit participant decision.
      updated_budget := updated_budget || '{"requires_participants":true}'::jsonb;
    else
      if mode is null or mode not in ('split_total','per_person','custom')
        or total is null or total<0 or total>9999999999.99 or total<>round(total,2) then
        raise exception 'Invalid expense amount for member removal' using errcode='22023';
      end if;
      if updated_budget->>'original_scale'='0' then share_scale:=1; end if;
      if mode='custom' then
        -- Validate the saved custom split, including the portions about to be removed.
        select coalesce(sum(budget_share_amount) filter (where not (user_id = any(remaining_ids))),0)
        into removed_total
        from expense_stage_b.expense_participants
        where expense_id=item.id and user_id = any(selected_ids);
        if (select sum(budget_share_amount) from expense_stage_b.expense_participants
            where expense_id=item.id and user_id = any(selected_ids)) is distinct from total
          or exists(select 1 from expense_stage_b.expense_participants where expense_id=item.id
            and user_id = any(selected_ids) and (budget_share_amount is null or budget_share_amount<0
              or budget_share_amount*share_scale<>trunc(budget_share_amount*share_scale))) then
          raise exception 'Invalid custom shares for member removal' using errcode='22023';
        end if;
      elsif mode='per_person' then
        if unit is null or unit<0 or unit*share_scale<>trunc(unit*share_scale) or unit*cardinality(selected_ids)<>total
          or (updated_budget->>'exchange_rate')::numeric is null or (updated_budget->>'exchange_rate')::numeric<=0
          or (updated_budget->>'exchange_rate')::numeric>1000000 then
          raise exception 'Invalid unit amount or rate for member removal' using errcode='22023';
        end if;
        total := unit*count_remaining;
        updated_budget := updated_budget || jsonb_build_object('amount',total,'twd_amount',round(total*(updated_budget->>'exchange_rate')::numeric));
      end if;
      if total*share_scale<>trunc(total*share_scale) then
        raise exception 'Invalid expense precision for member removal' using errcode='22023';
      end if;
      update expense_stage_b.expense_participants p
      set budget_share_amount=case mode
        when 'per_person' then unit
        when 'custom' then p.budget_share_amount +
          (trunc(removed_total*share_scale/count_remaining) +
            case when member.ordinality<=mod(removed_total*share_scale,count_remaining) then 1 else 0 end)/share_scale
        else (trunc(total*share_scale/count_remaining) +
            case when member.ordinality<=mod(total*share_scale,count_remaining) then 1 else 0 end)/share_scale
      end
      from unnest(remaining_ids) with ordinality as member(user_id, ordinality)
      where p.expense_id=item.id and p.user_id=member.user_id;
    end if;
  end if;

  update expense_stage_b.expense_participants
  set budget_selected=false, budget_share_amount=null
  where expense_id=item.id and budget_selected and not (user_id = any(members));
  update expense_stage_b.expense_items set budget=updated_budget where id=item.id;
  insert into expense_stage_b.groups(expense_id,group_key,revision) values(item.id,'budget',1)
    on conflict(expense_id,group_key) do update set revision=groups.revision+1;
end;
$$;
revoke all on function expense_stage_b.reallocate_departed_budget(expense_stage_b.expense_items,uuid[]) from public, anon, authenticated;

create function expense_stage_b.on_member_departure() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  item expense_stage_b.expense_items;
  members uuid[];
  reprice boolean;
  payers jsonb;
  target numeric;
begin
  -- Owner trip cleanup has already removed the native graph during cascade.
  if not exists(select 1 from public.trips where id=old.trip_id) then
    return null;
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('expense-trip:'||old.trip_id::text,0)) then
    raise exception 'Trip transaction in progress' using errcode='55P03';
  end if;
  if not exists(select 1 from expense_stage_b.expense_items where trip_id=old.trip_id and deleted_at is null) then
    return null;
  end if;
  select coalesce(array_agg(user_id order by user_id),'{}') into members
  from public.trip_members where trip_id=old.trip_id and status='approved';

  -- Releases can touch these rows without the trip lock. Fail fast if one is in flight.
  perform 1 from expense_stage_b.groups g join expense_stage_b.expense_items e on e.id=g.expense_id
  where e.trip_id=old.trip_id and g.actor=old.user_id order by g.expense_id,g.group_key for update of g nowait;
  perform 1 from expense_stage_b.rate_leases where trip_id=old.trip_id and actor=old.user_id for update nowait;

  if exists(select 1 from expense_stage_b.expense_items e
    where e.trip_id=old.trip_id and e.deleted_at is null and e.paid is not null and
      (e.payer_id=old.user_id or e.payer_allocations @> jsonb_build_array(jsonb_build_object('user_id',old.user_id))
       or exists(select 1 from expense_stage_b.expense_participants p where p.expense_id=e.id and p.user_id=old.user_id and p.paid_selected))) then
    insert into expense_stage_b.departed_members(trip_id,user_id,display_name)
    values(old.trip_id,old.user_id,coalesce(nullif(btrim(old.display_name),''),nullif(split_part(old.email,'@',1),'')))
    on conflict(trip_id,user_id) do update set display_name=coalesce(excluded.display_name,departed_members.display_name);
  end if;

  for item in select e.* from expense_stage_b.expense_items e
    where e.trip_id=old.trip_id and e.deleted_at is null and e.payment_state<>'paid'
      and (e.payer_id=old.user_id or e.payer_allocations @> jsonb_build_array(jsonb_build_object('user_id',old.user_id))
       or exists(select 1 from expense_stage_b.expense_participants p where p.expense_id=e.id and p.user_id=old.user_id and p.budget_selected))
    order by e.id for update nowait
  loop
    perform 1 from expense_stage_b.groups where expense_id=item.id and group_key in ('budget','payer')
    order by group_key for update nowait;
    if exists(select 1 from expense_stage_b.groups where expense_id=item.id and group_key in ('budget','paid','payer','payment','lifecycle')
      and expires_at>clock_timestamp() and actor = any(members)) then
      raise exception 'Expense edit in progress' using errcode='55P03';
    end if;

    select exists(select 1 from expense_stage_b.expense_participants
      where expense_id=item.id and user_id=old.user_id and budget_selected) into reprice;
    if reprice then perform expense_stage_b.reallocate_departed_budget(item,members); end if;

    select coalesce(jsonb_agg(p.value order by p.ordinality),'[]') into payers
    from jsonb_array_elements(item.payer_allocations) with ordinality p(value,ordinality)
    where (p.value->>'user_id')::uuid = any(members);
    if reprice or payers is distinct from item.payer_allocations or item.payer_id=old.user_id then
      select coalesce((budget->>'amount')::numeric,(paid->>'amount')::numeric,0) into target
      from expense_stage_b.expense_items where id=item.id;
      if item.payment_mode='advance' and item.payer_allocations='[]'::jsonb and item.payer_id=any(members) then
        payers:=jsonb_build_array(jsonb_build_object('user_id',item.payer_id,'amount',round(target),'order',0));
      end if;
      payers := expense_stage_b.normalize_payers(jsonb_build_object('mode',item.payment_mode,
        'rows',payers,'sequence',item.payer_sequence),target,members)->'rows';
      if payers is distinct from item.payer_allocations or item.payer_id=old.user_id then
        update expense_stage_b.expense_items set payer_allocations=payers,
          payer_id=case when item.payment_mode='advance' then (payers->0->>'user_id')::uuid end where id=item.id;
        insert into expense_stage_b.groups(expense_id,group_key,revision) values(item.id,'payer',1)
          on conflict(expense_id,group_key) do update set revision=groups.revision+1;
      end if;
    end if;
  end loop;

  update expense_stage_b.groups g set actor=null,sid=null,token_hash=null,expires_at=null
  from expense_stage_b.expense_items e where e.id=g.expense_id and e.trip_id=old.trip_id and g.actor=old.user_id;
  update expense_stage_b.rate_leases set actor=null,sid=null,token_hash=null,expires_at=null
  where trip_id=old.trip_id and actor=old.user_id;
  perform expense_stage_b.signal(old.trip_id);
  return null;
end;
$$;
revoke all on function expense_stage_b.on_member_departure() from public, anon, authenticated;
create trigger expense_member_deleted after delete on public.trip_members
for each row when (old.status='approved') execute function expense_stage_b.on_member_departure();
create trigger expense_member_unapproved after update of status on public.trip_members
for each row when (old.status='approved' and new.status is distinct from 'approved') execute function expense_stage_b.on_member_departure();

-- Approvals must not change the eligible set while a departure is repricing it.
create function expense_stage_b.lock_member_approval() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not pg_try_advisory_xact_lock(hashtextextended('expense-trip:'||new.trip_id::text,0)) then
    raise exception 'Trip transaction in progress' using errcode='55P03';
  end if;
  return new;
end;
$$;
revoke all on function expense_stage_b.lock_member_approval() from public, anon, authenticated;
create trigger expense_member_approved_insert before insert on public.trip_members
for each row when (new.status='approved') execute function expense_stage_b.lock_member_approval();
create trigger expense_member_approved_update before update of status on public.trip_members
for each row when (old.status is distinct from 'approved' and new.status='approved') execute function expense_stage_b.lock_member_approval();

-- Keep current request signatures and receipt replay behavior.
create or replace function expense_stage_b.mutate(eid uuid,g text,session_id uuid,token uuid,expected_epoch bigint,base bigint,value jsonb,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid;s expense_stage_b.groups;r expense_stage_b.receipts;item expense_stage_b.expense_items;
 signature jsonb;receipt jsonb;form jsonb;money jsonb;ids uuid[];expected_members uuid[];members uuid[];mode text;amount numeric;unit numeric;rate numeric;twd numeric;source text;shares jsonb;shares_total numeric;person uuid;piece numeric;position integer;n integer;revision bigint;whole_original boolean:=false;share_scale integer:=100;
 departed_payer boolean;
begin
 tid:=expense_stage_b.authorize(eid);
 if request_id is null or session_id is null or value is null or jsonb_typeof(value)<>'object' then raise exception 'Invalid request' using errcode='22023';end if;
 signature:=jsonb_build_object('id',eid,'group',g,'session',session_id,'base',base,'value',value);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into r from expense_stage_b.receipts where actor=auth.uid() and receipts.request_id=mutate.request_id;
 if found then if r.signature<>signature then raise exception 'Request mismatch' using errcode='22023';end if;return r.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||tid::text,0));
 if not app_private.can_edit_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into item from expense_stage_b.expense_items where id=eid for update;
 if item.deleted_at is not null then raise exception 'Item removed' using errcode='55000';end if;
 select * into s from expense_stage_b.groups where expense_id=eid and group_key=g for update;
 if not found or s.actor is distinct from auth.uid() or s.sid is distinct from session_id or token is null or s.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or s.epoch is distinct from expected_epoch or s.expires_at<=clock_timestamp() or s.expires_at is null then raise exception 'Lease required' using errcode='55P03';end if;
 if s.revision is distinct from base then raise exception 'Version conflict' using errcode='PT409';end if;
 if g in('budget','paid','payer','payment') and exists(select 1 from expense_stage_b.groups where expense_id=eid and group_key<>g and group_key in('budget','paid','payer','payment') and expires_at>clock_timestamp() and (actor is distinct from auth.uid() or sid is distinct from session_id)) then raise exception 'Payment group busy' using errcode='55P03';end if;
 select coalesce(array_agg(user_id order by user_id),'{}') into members from public.trip_members where trip_id=tid and status='approved';
 departed_payer := (item.payer_id is not null and not (item.payer_id=any(members)))
  or exists(select 1 from jsonb_array_elements(item.payer_allocations) p where not ((p->>'user_id')::uuid=any(members)));
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
  -- Synchronize the edited group, including rows belonging to former members.
  if g='budget' then
   update expense_stage_b.expense_participants set budget_selected=false,budget_share_amount=null
   where expense_id=eid and not (user_id=any(ids)) and (budget_selected or budget_share_amount is not null);
  else
   update expense_stage_b.expense_participants set paid_selected=false,paid_share_amount=null
   where expense_id=eid and not (user_id=any(ids)) and (paid_selected or paid_share_amount is not null);
  end if;
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
   if item.budget->>'requires_participants'='true' or
      (item.budget is not null and exists(select 1 from expense_stage_b.expense_participants
       where expense_id=eid and budget_selected and not (user_id=any(members)))) then
    raise exception 'Select current expense participants before paying' using errcode='22023';
   end if;
   if (item.payment_mode='advance' and (departed_payer or (jsonb_array_length(item.payer_allocations)=0 and item.payer_id is null))) or (value->>'paid_at')::timestamptz is null or btrim(item.title)='' then raise exception 'Complete payment details required' using errcode='22023';end if;
   if item.paid is null then
    if item.budget is null then raise exception 'Payment amount required' using errcode='22023';end if;
    update expense_stage_b.expense_items set paid=budget,paid_decisions_known=budget_decisions_known where id=eid;
    update expense_stage_b.expense_participants set paid_selected=budget_selected,paid_share_amount=budget_share_amount where expense_id=eid;
    insert into expense_stage_b.groups(expense_id,group_key,revision) values(eid,'paid',1) on conflict(expense_id,group_key) do update set revision=groups.revision+1;
   end if;
   update expense_stage_b.expense_items set payment_state='paid',paid_at=(value->>'paid_at')::timestamptz where id=eid;
  else raise exception 'Invalid payment action' using errcode='22023';end if;
 else raise exception 'Unsupported mutation' using errcode='22023';end if;
 if g in('budget','paid','payer','payment')
  and (g='payer' or not (departed_payer or (item.paid is not null and
    exists(select 1 from expense_stage_b.expense_participants p where p.expense_id=eid and p.paid_selected and not (p.user_id=any(members)))))) then
  -- Payer edits rebalance payer amounts without replacing a stored paid bundle.
  perform expense_stage_b.sync_payment(eid,g,case when g='budget' then whole_original
   when g='payer' then false else coalesce((value->>'planning')::boolean,false) end);
 end if;
 update expense_stage_b.groups set revision=groups.revision+1 where expense_id=eid and group_key=g returning groups.revision into revision;
 receipt:=jsonb_build_object('committed',true,'request_id',request_id,'expense_id',eid,'group',g,'revision',revision,'item',(select to_jsonb(e) from expense_stage_b.expense_items e where id=eid),'participants',(select coalesce(jsonb_agg(to_jsonb(p) order by user_id),'[]') from expense_stage_b.expense_participants p where expense_id=eid));
 insert into expense_stage_b.receipts values(auth.uid(),request_id,signature,receipt);return receipt;
end $$;

create or replace function expense_stage_b.create_named_item(tid uuid,eid uuid,session_id uuid,request_id uuid,item_title text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare signature jsonb;r expense_stage_b.receipts;receipt jsonb;clean_title text;
begin
 if auth.uid() is null or not app_private.can_edit_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 clean_title:=regexp_replace(item_title,'^[[:space:] 　]+|[[:space:] 　]+$','','g');
 if eid is null or session_id is null or request_id is null or clean_title is null or clean_title='' then raise exception 'Name required' using errcode='22023';end if;
 signature:=jsonb_build_object('trip',tid,'id',eid,'session',session_id,'title',clean_title);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into r from expense_stage_b.receipts where actor=auth.uid() and receipts.request_id=create_named_item.request_id;
 if found then if r.signature<>signature then raise exception 'Request mismatch' using errcode='22023';end if;return r.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||tid::text,0));
 if not app_private.can_edit_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 insert into expense_stage_b.expense_items(id,trip_id,title,payment_state,budget_decisions_known,paid_decisions_known,payment_mode,planning_managed)
 values(eid,tid,clean_title,'draft',true,true,'self',true);
 insert into expense_stage_b.expense_participants(expense_id,user_id,budget_selected,paid_selected)
 select eid,user_id,true,true from public.trip_members where trip_id=tid and status='approved';
 receipt:=jsonb_build_object('committed',true,'request_id',request_id,'expense_id',eid,'created',true);
 insert into expense_stage_b.receipts values(auth.uid(),request_id,signature,receipt);
 return receipt;
end $$;

create or replace function expense_stage_b.snapshot(tid uuid,session_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or not app_private.can_read_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select jsonb_build_object('schemaVersion',1,'tripId',tid,'serverNow',now(),
 'rates',(select budget_exchange_rates from public.trips where id=tid),
 'rateState',jsonb_build_object('revision',coalesce((select revision from expense_stage_b.rate_leases where trip_id=tid),0),'held',coalesce((select expires_at>now() and app_private.can_edit_trip(tid,actor) from expense_stage_b.rate_leases where trip_id=tid),false),'targets',expense_stage_b.rate_targets(tid)),
 'members',coalesce((select jsonb_agg(to_jsonb(m) order by user_id) from public.trip_members m where trip_id=tid),'[]'),
 'departedMembers',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',m.display_name) order by m.user_id) from expense_stage_b.departed_members m where m.trip_id=tid),'[]'),
 'itineraryItems',coalesce((select jsonb_agg(to_jsonb(i) order by id) from public.itinerary_items i where trip_id=tid),'[]'),
 'items',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from expense_stage_b.expense_items e where trip_id=tid and e.deleted_at is null),'[]'),
 'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.expense_id,p.user_id) from expense_stage_b.expense_participants p join expense_stage_b.expense_items e on e.id=p.expense_id where e.trip_id=tid and e.deleted_at is null),'[]'),
 'links',coalesce((select jsonb_agg(to_jsonb(l)) from expense_stage_b.expense_itinerary_links l join expense_stage_b.expense_items e on e.id=l.expense_id where l.trip_id=tid and e.deleted_at is null),'[]'),
 'groups',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'group',k,'revision',coalesce(s.revision,0),'epoch',coalesce(s.epoch,0),'held',coalesce(s.expires_at>now(),false),'owner',case when s.expires_at>now() then s.actor else null end,'own_session',coalesce(s.actor=auth.uid() and s.sid=session_id and s.expires_at>now(),false),'expires_at',s.expires_at)) from expense_stage_b.expense_items e cross join unnest(array['title','note','category','payer','links','budget','paid','payment','lifecycle']) k left join expense_stage_b.groups s on s.expense_id=e.id and s.group_key=k where e.trip_id=tid and e.deleted_at is null),'[]')) into result;
 return result;
end $$;

commit;
