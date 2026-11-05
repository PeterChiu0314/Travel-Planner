-- Disposable Stage B extension. Install only after isolated-schema.sql.
begin;
create table expense_stage_b.groups(
 expense_id uuid not null references expense_stage_b.expense_items(id),group_key text not null,
 revision bigint not null default 0,epoch bigint not null default 0,
 actor uuid,sid uuid,token_hash bytea,expires_at timestamptz,activity bigint not null default 0,
 primary key(expense_id,group_key),
 check(group_key in('title','note','category','payer','links','budget','paid','payment','lifecycle'))
);
create table expense_stage_b.receipts(actor uuid not null,request_id uuid not null,signature jsonb not null,result jsonb not null,primary key(actor,request_id));
revoke all on expense_stage_b.groups,expense_stage_b.receipts from public,anon,authenticated;

create function expense_stage_b.authorize(eid uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare tid uuid;begin
 select trip_id into tid from expense_stage_b.expense_items where id=eid;
 if auth.uid() is null or tid is null or not app_private.can_edit_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 return tid;
end $$;
revoke all on function expense_stage_b.authorize(uuid) from public,anon,authenticated;

create function expense_stage_b.lease(eid uuid,g text,session_id uuid,token uuid,action text,base bigint,expected_epoch bigint,seq bigint default 0,dirty boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s expense_stage_b.groups;tid uuid;begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 if session_id is null or token is null or action is null or action not in('acquire','renew','release') or g is null or g not in('title','note','category','payer','links','budget','paid','payment','lifecycle') or seq is null or seq<0 then raise exception 'Invalid lease' using errcode='22023';end if;
 if action<>'release' then
  tid:=expense_stage_b.authorize(eid);
  if base is null then raise exception 'Version required' using errcode='22023';end if;
  if g='budget' then
   perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||tid::text,0));
   if exists(select 1 from expense_stage_b.rate_leases where trip_id=tid and expires_at>clock_timestamp() and app_private.can_edit_trip(tid,actor)) then return jsonb_build_object('granted',false);end if;
  end if;
  insert into expense_stage_b.groups(expense_id,group_key) values(eid,g) on conflict do nothing;
 end if;
 select * into s from expense_stage_b.groups where expense_id=eid and group_key=g for update;
 if action='release' then
  if s.actor=auth.uid() and s.sid=session_id and s.token_hash=sha256(convert_to(token::text,'UTF8')) and s.epoch=expected_epoch then
   update expense_stage_b.groups set actor=null,sid=null,token_hash=null,expires_at=null where expense_id=eid and group_key=g;
  end if;return jsonb_build_object('granted',true);
 end if;
 if s.expires_at>clock_timestamp() and not app_private.can_edit_trip(tid,s.actor) then s.expires_at:=null;end if;
 if s.revision<>base then raise exception 'Version conflict' using errcode='PT409';end if;
 if s.expires_at>clock_timestamp() and (s.actor<>auth.uid() or s.sid<>session_id or s.token_hash<>sha256(convert_to(token::text,'UTF8'))) then return jsonb_build_object('granted',false);end if;
 if action='renew' and (s.expires_at is null or s.expires_at<=clock_timestamp() or s.actor is distinct from auth.uid() or s.sid is distinct from session_id or s.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or s.epoch is distinct from expected_epoch) then return jsonb_build_object('granted',false);end if;
 if action='acquire' and (s.expires_at is null or s.expires_at<=clock_timestamp()) then s.epoch:=s.epoch+1;s.activity:=-1;end if;
 update expense_stage_b.groups set actor=auth.uid(),sid=session_id,token_hash=sha256(convert_to(token::text,'UTF8')),epoch=s.epoch,
  expires_at=case when seq>s.activity then clock_timestamp()+case when dirty then interval '7 minutes' else interval '2 minutes' end else s.expires_at end,
  activity=greatest(seq,s.activity) where expense_id=eid and group_key=g returning * into s;
 return jsonb_build_object('granted',true,'epoch',s.epoch,'revision',s.revision,'expires_at',s.expires_at);
end $$;
revoke all on function expense_stage_b.lease(uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean) from public,anon;
grant execute on function expense_stage_b.lease(uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean) to authenticated;

create function expense_stage_b.mutate(eid uuid,g text,session_id uuid,token uuid,expected_epoch bigint,base bigint,value jsonb,request_id uuid)
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
  person:=(value->>'user_id')::uuid;if person is not null and not(person=any(members)) then raise exception 'Invalid payer' using errcode='22023';end if;
  if item.payment_state='paid' and person is null then raise exception 'Paid payer required' using errcode='22023';end if;
  update expense_stage_b.expense_items set payer_id=person where id=eid;
 elsif g='lifecycle' then
  if value->>'action'<>'delete' then raise exception 'Invalid lifecycle' using errcode='22023';end if;
  if exists(select 1 from public.accommodations where expense_id=eid) then raise exception 'Accommodation still linked' using errcode='55000';end if;
  if exists(select 1 from expense_stage_b.groups where expense_id=eid and group_key<>'lifecycle' and expires_at>clock_timestamp() and (actor is distinct from auth.uid() or sid is distinct from session_id)) then raise exception 'Item busy' using errcode='55P03';end if;
  update expense_stage_b.expense_items set deleted_at=clock_timestamp() where id=eid;
 elsif g='links' then
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
   if item.payer_id is null or not(item.payer_id=any(members)) or (value->>'paid_at')::timestamptz is null or btrim(item.title)='' then raise exception 'Complete payment details required' using errcode='22023';end if;
   if item.paid is null then
    if item.budget is null then raise exception 'Payment amount required' using errcode='22023';end if;
    update expense_stage_b.expense_items set paid=budget,paid_decisions_known=budget_decisions_known where id=eid;
    update expense_stage_b.expense_participants set paid_selected=budget_selected,paid_share_amount=budget_share_amount where expense_id=eid;
    insert into expense_stage_b.groups(expense_id,group_key,revision) values(eid,'paid',1) on conflict(expense_id,group_key) do update set revision=groups.revision+1;
   end if;
   update expense_stage_b.expense_items set payment_state='paid',paid_at=(value->>'paid_at')::timestamptz where id=eid;
  else raise exception 'Invalid payment action' using errcode='22023';end if;
 else raise exception 'Unsupported mutation' using errcode='22023';end if;
 update expense_stage_b.groups set revision=groups.revision+1 where expense_id=eid and group_key=g returning groups.revision into revision;
 receipt:=jsonb_build_object('committed',true,'request_id',request_id,'expense_id',eid,'group',g,'revision',revision,'item',(select to_jsonb(e) from expense_stage_b.expense_items e where id=eid),'participants',(select coalesce(jsonb_agg(to_jsonb(p) order by user_id),'[]') from expense_stage_b.expense_participants p where expense_id=eid));
 insert into expense_stage_b.receipts values(auth.uid(),request_id,signature,receipt);return receipt;
end $$;
revoke all on function expense_stage_b.mutate(uuid,text,uuid,uuid,bigint,bigint,jsonb,uuid) from public,anon;
grant execute on function expense_stage_b.mutate(uuid,text,uuid,uuid,bigint,bigint,jsonb,uuid) to authenticated;

create function expense_stage_b.create_item(tid uuid,eid uuid,session_id uuid,request_id uuid,view_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare signature jsonb;r expense_stage_b.receipts;receipt jsonb;
begin
 if auth.uid() is null or not app_private.can_edit_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if eid is null or session_id is null or request_id is null or view_name is null or view_name not in('budget','paid') then raise exception 'Invalid create' using errcode='22023';end if;
 signature:=jsonb_build_object('trip',tid,'id',eid,'session',session_id,'view',view_name);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into r from expense_stage_b.receipts where actor=auth.uid() and receipts.request_id=create_item.request_id;
 if found then if r.signature<>signature then raise exception 'Request mismatch' using errcode='22023';end if;return r.result;end if;
 perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||tid::text,0));
 insert into expense_stage_b.expense_items(id,trip_id,payment_state,budget_decisions_known,paid_decisions_known)
 values(eid,tid,case when view_name='paid' then 'draft' else 'unpaid' end,view_name='budget',view_name='paid');
 insert into expense_stage_b.expense_participants(expense_id,user_id,budget_selected,paid_selected)
 select eid,user_id,case when view_name='budget' then true else null end,case when view_name='paid' then true else null end from public.trip_members where trip_id=tid and status='approved';
 receipt:=jsonb_build_object('committed',true,'request_id',request_id,'expense_id',eid,'created',true);
 insert into expense_stage_b.receipts values(auth.uid(),request_id,signature,receipt);return receipt;
end $$;
revoke all on function expense_stage_b.create_item(uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function expense_stage_b.create_item(uuid,uuid,uuid,uuid,text) to authenticated;

create function expense_stage_b.snapshot(tid uuid,session_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or not app_private.can_read_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select jsonb_build_object('schemaVersion',1,'tripId',tid,'serverNow',now(),
 'rates',(select budget_exchange_rates from public.trips where id=tid),
 'rateState',jsonb_build_object('revision',coalesce((select revision from expense_stage_b.rate_leases where trip_id=tid),0),'held',coalesce((select expires_at>now() and app_private.can_edit_trip(tid,actor) from expense_stage_b.rate_leases where trip_id=tid),false),'targets',expense_stage_b.rate_targets(tid)),
 'members',coalesce((select jsonb_agg(to_jsonb(m) order by user_id) from public.trip_members m where trip_id=tid),'[]'),
 'itineraryItems',coalesce((select jsonb_agg(to_jsonb(i) order by id) from public.itinerary_items i where trip_id=tid),'[]'),
 'items',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from expense_stage_b.expense_items e where trip_id=tid and e.deleted_at is null),'[]'),
 'participants',coalesce((select jsonb_agg(to_jsonb(p) order by p.expense_id,p.user_id) from expense_stage_b.expense_participants p join expense_stage_b.expense_items e on e.id=p.expense_id where e.trip_id=tid and e.deleted_at is null),'[]'),
 'links',coalesce((select jsonb_agg(to_jsonb(l)) from expense_stage_b.expense_itinerary_links l join expense_stage_b.expense_items e on e.id=l.expense_id where l.trip_id=tid and e.deleted_at is null),'[]'),
 'groups',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'group',k,'revision',coalesce(s.revision,0),'epoch',coalesce(s.epoch,0),'held',coalesce(s.expires_at>now(),false),'owner',case when s.expires_at>now() then s.actor else null end,'own_session',coalesce(s.actor=auth.uid() and s.sid=session_id and s.expires_at>now(),false),'expires_at',s.expires_at)) from expense_stage_b.expense_items e cross join unnest(array['title','note','category','payer','links','budget','paid','payment','lifecycle']) k left join expense_stage_b.groups s on s.expense_id=e.id and s.group_key=k where e.trip_id=tid and e.deleted_at is null),'[]')) into result;
 return result;
end $$;
revoke all on function expense_stage_b.snapshot(uuid,uuid) from public,anon;
grant execute on function expense_stage_b.snapshot(uuid,uuid) to authenticated;
commit;
