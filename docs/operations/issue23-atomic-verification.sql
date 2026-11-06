-- Run inside BEGIN/ROLLBACK after the candidate source, or after installation.
-- All test rows belong to a new synthetic trip and are rolled back.
do $verify$
declare
  actor uuid; tid uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
  eid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); token uuid:=gen_random_uuid();
  held jsonb; result jsonb; versions jsonb; link_revision bigint; request uuid:=gen_random_uuid(); value jsonb;
begin
  select user_id into actor from public.trip_members where status='approved' and role='owner' order by trip_id limit 1;
  if actor is null then raise exception 'No approved QA actor available'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.trips(id,title,name,destination,start_date,end_date,owner_id)
    values(tid,'Issue23 rollback QA','Issue23 rollback QA','Japan','2090-01-01','2090-01-03',actor);
  insert into public.trip_members(trip_id,user_id,role,status) values(tid,actor,'owner','approved') on conflict do nothing;
  insert into public.itinerary_items(id,trip_id,day_index,sort_order,type,title,start_time,end_time,updated_at)
    values(a,tid,0,0,'attraction','QA A','09:00','10:00',current_timestamp-interval '1 day'),
      (b,tid,0,1,'attraction','QA B','10:00','11:00',current_timestamp-interval '1 day');
  insert into expense_stage_b.expense_items(id,trip_id,title,payment_state,budget)
    values(eid,tid,'QA A cost','unpaid','{"amount":100}');
  insert into expense_stage_b.expense_itinerary_links values(eid,tid,a);
  select jsonb_object_agg(id,updated_at) into versions from public.itinerary_items where trip_id=tid;
  execute 'set local role authenticated';
  result:=public.apply_timeline_schedule_operation_link_safe(tid,0,null,null,
    jsonb_build_object('type','reorder','orderedVisitIds',jsonb_build_array(a,b)),array[a,b],versions,null,null,array[a,b],array[b,a]);
  if result->>'ok' is distinct from 'true' then raise exception 'Swap failed %',result;end if;
  if not exists(select 1 from expense_stage_b.expense_itinerary_links l join public.itinerary_items i on i.id=l.itinerary_item_id where l.expense_id=eid and i.title='QA A') then raise exception 'Expense detached from destination';end if;
  execute 'reset role';
  select g.revision into link_revision from expense_stage_b.groups g where expense_id=eid and group_key='links';
  execute 'set local role authenticated';
  held:=public.expense_group_lease(eid,'links',sid,token,'acquire',link_revision,null,0,false);
  value:=jsonb_build_object('ids',jsonb_build_array(a),'itinerary_versions',jsonb_build_object(a::text,versions->a::text));
  begin
    perform public.mutate_expense_group(eid,'links',sid,token,(held->>'epoch')::bigint,link_revision,value,request);
    raise exception 'Stale target version admitted';
  exception when sqlstate 'PT409' then null;
  end;
  perform public.delete_itinerary_item_budget_safe(tid,b);
  if exists(select 1 from expense_stage_b.expense_itinerary_links where expense_id=eid) then raise exception 'Deleted link remains';end if;
  if not exists(select 1 from expense_stage_b.expense_items where id=eid and budget->>'amount'='100') then raise exception 'Expense lost';end if;
  execute 'reset role';
  insert into public.itinerary_items(id,trip_id,day_index,sort_order,type,title)
    values(b,tid,2,0,'attraction','Tail QA');
  insert into expense_stage_b.expense_itinerary_links values(eid,tid,b);
  execute 'set local role authenticated';
  result:=public.apply_trip_date_change(tid,'2090-01-01','2090-01-02',true);
  if result->>'ok' is distinct from 'true' then raise exception 'Shortening failed';end if;
  if exists(select 1 from expense_stage_b.expense_itinerary_links where expense_id=eid) then raise exception 'Shortened link remains';end if;
  delete from public.trips where id=tid;
  if found is false then raise exception 'Owner trip deletion refused';end if;
  execute 'reset role';
  if exists(select 1 from expense_stage_b.expense_items where trip_id=tid)
    or exists(select 1 from public.expense_signals where trip_id=tid)
    or exists(select 1 from expense_stage_b.groups where expense_id=eid) then raise exception 'Trip graph not cleaned';end if;
end;
$verify$;
select jsonb_build_object('atomic_swap',true,'stale_link_refused',true,'unlink_preserves_expense',true,
  'shortening',true,'owner_trip_cleanup',true,'rolled_back_by_caller',true) as verification;
