begin;

-- Expense writes take this same transaction lock before reading or mutating
-- links. Acquire it before any itinerary or expense row lock on RPC paths.
create function app_private.lock_itinerary_links(trip_id uuid) returns void
language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('expense-trip:' || trip_id::text, 0));
$$;
revoke all on function app_private.lock_itinerary_links(uuid) from public, anon, authenticated;

create index expense_itinerary_links_itinerary_idx
  on expense_stage_b.expense_itinerary_links(itinerary_item_id);

create function app_private.bump_expense_link_revisions(expense_ids uuid[]) returns void
language sql set search_path = '' as $$
  insert into expense_stage_b.groups(expense_id, group_key, revision)
  select distinct id, 'links', 1 from unnest(expense_ids) as ids(id)
  order by id
  on conflict (expense_id, group_key) do update set revision = expense_stage_b.groups.revision + 1;
$$;
revoke all on function app_private.bump_expense_link_revisions(uuid[]) from public, anon, authenticated;

create function app_private.unlink_removed_itinerary_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare affected uuid[];
begin
  with removed as (
    delete from expense_stage_b.expense_itinerary_links where itinerary_item_id = old.id
    returning expense_id
  )
  select array_agg(expense_id) into affected from removed;
  if affected is not null then
    perform app_private.bump_expense_link_revisions(affected);
  end if;
  return old;
end;
$$;
revoke all on function app_private.unlink_removed_itinerary_item() from public, anon, authenticated;
create trigger unlink_native_expenses_before_itinerary_delete
  before delete on public.itinerary_items for each row
  execute function app_private.unlink_removed_itinerary_item();

-- Trip deletion already owns the parent row. Never wait on a writer that may
-- need its FK lock. The owner's existing DELETE policy admits the lifecycle.
create function app_private.remove_trip_expense_graph() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_trip_owner(old.id, auth.uid()) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('expense-trip:' || old.id::text, 0)) then
    raise exception 'Trip transaction in progress' using errcode = '55P03';
  end if;
  perform 1 from expense_stage_b.expense_items where trip_id=old.id order by id for update nowait;
  perform 1 from expense_stage_b.groups where expense_id in (
    select id from expense_stage_b.expense_items where trip_id=old.id
  ) order by expense_id,group_key for update nowait;
  update public.accommodations set expense_id=null where trip_id=old.id and expense_id is not null;
  delete from expense_stage_b.receipts where signature->>'id' in (
    select id::text from expense_stage_b.expense_items where trip_id=old.id
  );
  delete from expense_stage_b.expense_itinerary_links where trip_id=old.id;
  delete from expense_stage_b.expense_participants where expense_id in (
    select id from expense_stage_b.expense_items where trip_id=old.id
  );
  delete from expense_stage_b.groups where expense_id in (
    select id from expense_stage_b.expense_items where trip_id=old.id
  );
  delete from expense_stage_b.expense_items where trip_id=old.id;
  delete from expense_stage_b.rate_leases where trip_id=old.id;
  delete from public.expense_signals where trip_id=old.id;
  return old;
end;
$$;
revoke all on function app_private.remove_trip_expense_graph() from public, anon, authenticated;
create trigger z_remove_native_expenses_before_trip_delete
  before delete on public.trips for each row execute function app_private.remove_trip_expense_graph();

create or replace function public.apply_timeline_schedule_operation(
  target_trip_id uuid,
  target_day_index integer,
  target_item_id uuid,
  target_payload jsonb,
  operation_intent jsonb,
  expected_visit_ids uuid[],
  item_updated_at_baselines jsonb,
  confirmed_major_effect jsonb default null,
  preview_result jsonb default null,
  slot_item_ids uuid[] default null,
  package_source_item_ids uuid[] default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  moved_links expense_stage_b.expense_itinerary_links[];
begin
  if auth.uid() is null or not app_private.can_edit_trip(target_trip_id, auth.uid()) then
    raise exception 'permission_denied';
  end if;
  perform app_private.lock_itinerary_links(target_trip_id);
  result := app_private.apply_timeline_schedule_operation(
    target_trip_id, target_day_index, target_item_id, target_payload, operation_intent,
    expected_visit_ids, item_updated_at_baselines, confirmed_major_effect, preview_result,
    slot_item_ids, package_source_item_ids
  );
  if result->>'ok' = 'true' and operation_intent->>'type' = 'reorder'
     and slot_item_ids is distinct from package_source_item_ids then
    -- The planner validates the permutation. Each source ID identifies the
    -- package's old slot and the paired slot ID is its new home.
    with moved as (
      delete from expense_stage_b.expense_itinerary_links link
      using unnest(slot_item_ids, package_source_item_ids) as slots(destination, source)
      where link.trip_id = target_trip_id and link.itinerary_item_id = slots.source
        and slots.source <> slots.destination
      returning link.*
    )
    select array_agg(row(moved.expense_id, moved.trip_id, moved.itinerary_item_id)::expense_stage_b.expense_itinerary_links)
      into moved_links from moved;
    if moved_links is not null then
      insert into expense_stage_b.expense_itinerary_links(expense_id, trip_id, itinerary_item_id)
      select link.expense_id, link.trip_id, slot_item_ids[array_position(package_source_item_ids, link.itinerary_item_id)]
      from unnest(moved_links) as link;
      perform app_private.bump_expense_link_revisions(array(select link.expense_id from unnest(moved_links) as link));
    end if;
  end if;
  return result;
end;
$$;

-- Clients use this entry point to distinguish a backend with atomic link
-- maintenance from one still running the pre-migration schedule RPC.
create function public.apply_timeline_schedule_operation_link_safe(
  target_trip_id uuid,
  target_day_index integer,
  target_item_id uuid,
  target_payload jsonb,
  operation_intent jsonb,
  expected_visit_ids uuid[],
  item_updated_at_baselines jsonb,
  confirmed_major_effect jsonb default null,
  preview_result jsonb default null,
  slot_item_ids uuid[] default null,
  package_source_item_ids uuid[] default null
) returns jsonb
language sql set search_path = '' as $$
  select public.apply_timeline_schedule_operation(
    target_trip_id, target_day_index, target_item_id, target_payload, operation_intent,
    expected_visit_ids, item_updated_at_baselines, confirmed_major_effect, preview_result,
    slot_item_ids, package_source_item_ids
  );
$$;
revoke all on function public.apply_timeline_schedule_operation_link_safe(uuid, integer, uuid, jsonb, jsonb, uuid[], jsonb, jsonb, jsonb, uuid[], uuid[]) from public, anon;
grant execute on function public.apply_timeline_schedule_operation_link_safe(uuid, integer, uuid, jsonb, jsonb, uuid[], jsonb, jsonb, jsonb, uuid[], uuid[]) to authenticated;

create or replace function public.apply_trip_date_change(
  trip_id uuid, new_start_date date, new_end_date date, confirm_timeline_removal boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if app_private.can_manage_trip(trip_id, auth.uid()) then
    perform app_private.lock_itinerary_links(trip_id);
  end if;
  return app_private.apply_trip_date_change(trip_id, new_start_date, new_end_date, confirm_timeline_removal);
end;
$$;

-- Retain the existing actor checks, RLS, atomic neighbor removal and legacy
-- lock. The added lock uses the same order as schedule and expense mutations.
create or replace function public.delete_itinerary_item_budget_safe(p_trip_id uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='3s' set statement_timeout='10s' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.trip_members where trip_id=p_trip_id and user_id=auth.uid() and status='approved' and role in('owner','editor')) then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||p_trip_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 perform 1 from public.itinerary_items where id=p_id and trip_id=p_trip_id for update nowait;
 if not found then raise exception 'Itinerary item unavailable' using errcode='40001';end if;
 delete from public.itinerary_items where trip_id=p_trip_id and (from_item_id=p_id or to_item_id=p_id);
 delete from public.itinerary_items where trip_id=p_trip_id and id=p_id;
 return jsonb_build_object('deleted',p_id);
end $$;

-- These rows are ephemeral. The expense_items FK continues to preserve
-- financial history under the existing protected trip deletion policy.
alter table expense_stage_b.rate_leases drop constraint rate_leases_trip_id_fkey,
  add constraint rate_leases_trip_id_fkey foreign key(trip_id) references public.trips(id) on delete cascade;
alter table public.expense_signals drop constraint expense_signals_trip_id_fkey,
  add constraint expense_signals_trip_id_fkey foreign key(trip_id) references public.trips(id) on delete cascade;

create function expense_stage_b.validate_link_targets(tid uuid, value jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(value->'ids') is distinct from 'array'
     or jsonb_typeof(value->'itinerary_versions') is distinct from 'object' then
    raise exception 'Refresh itinerary before changing expense links' using errcode = 'PT409';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(value->'ids') as requested(id)
    left join public.itinerary_items item on item.id = requested.id::uuid and item.trip_id = tid
    where item.id is null
      or item.updated_at is distinct from (value->'itinerary_versions'->>requested.id)::timestamptz
  ) then
    raise exception 'Itinerary changed before expense links were saved' using errcode = 'PT409';
  end if;
end;
$$;
revoke all on function expense_stage_b.validate_link_targets(uuid,jsonb) from public, anon, authenticated;

-- Preserve request replay and the existing group lease/payment protocol.
-- Only fresh link mutations validate the itinerary version under the lock.
create or replace function expense_stage_b.mutate(eid uuid,g text,session_id uuid,token uuid,expected_epoch bigint,base bigint,value jsonb,request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tid uuid;s expense_stage_b.groups;r expense_stage_b.receipts;item expense_stage_b.expense_items;
 signature jsonb;receipt jsonb;form jsonb;money jsonb;ids uuid[];expected_members uuid[];members uuid[];mode text;amount numeric;unit numeric;rate numeric;twd numeric;source text;shares jsonb;shares_total numeric;person uuid;piece numeric;position integer;n integer;revision bigint;
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
  shares:='{}';amount:=0;n:=cardinality(ids);
  if mode='per_person' then unit:=(form->>'unit_amount')::numeric;amount:=unit*n;
  elsif mode='split_total' then amount:=(form->>'amount')::numeric;
  else
   foreach person in array ids loop piece:=(form->'shares'->>person::text)::numeric;
    if piece is null or piece<0 or piece<>round(piece,2) then raise exception 'Invalid custom share' using errcode='22023';end if;
    amount:=amount+piece;shares:=shares||jsonb_build_object(person::text,piece);
   end loop;
  end if;
  if amount is null or amount<0 or amount>9999999999.99 or amount<>round(amount,2) or (mode='per_person' and (unit is null or unit<0 or unit<>round(unit,2))) then raise exception 'Invalid amount' using errcode='22023';end if;
  if mode<>'custom' then
   position:=0;foreach person in array ids loop piece:=trunc(amount*100/n)/100+case when position<mod(amount*100,n) then 0.01 else 0 end;position:=position+1;shares:=shares||jsonb_build_object(person::text,piece);end loop;
  end if;
  source:=case when g='paid' then coalesce(form->>'twd_amount_source','estimated') else 'estimated' end;
  if source not in('estimated','actual') then raise exception 'Invalid debit source' using errcode='22023';end if;
  twd:=case when source='actual' then (form->>'actual_twd_amount')::numeric else round(amount*rate) end;
  if twd is null or twd<0 or twd>9999999999 or twd<>trunc(twd) or (amount=0 and twd<>0) then raise exception 'Invalid TWD amount' using errcode='22023';end if;
  money:=jsonb_build_object('amount',amount,'currency',form->>'currency','exchange_rate',rate,'pricing_mode',mode,'unit_amount',unit,'split_type',case when mode='custom' then 'custom' else 'equal' end,'twd_amount',twd,'twd_amount_source',source,'actual_twd_amount',case when source='actual' then twd else null end);
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
 if g in('budget','paid','payer','payment') then perform expense_stage_b.sync_payment(eid,g,coalesce((value->>'planning')::boolean,false));end if;
 update expense_stage_b.groups set revision=groups.revision+1 where expense_id=eid and group_key=g returning groups.revision into revision;
 receipt:=jsonb_build_object('committed',true,'request_id',request_id,'expense_id',eid,'group',g,'revision',revision,'item',(select to_jsonb(e) from expense_stage_b.expense_items e where id=eid),'participants',(select coalesce(jsonb_agg(to_jsonb(p) order by user_id),'[]') from expense_stage_b.expense_participants p where expense_id=eid));
 insert into expense_stage_b.receipts values(auth.uid(),request_id,signature,receipt);return receipt;
end $$;

commit;
