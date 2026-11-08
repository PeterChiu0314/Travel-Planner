begin;

create function expense_stage_b.copy_item(tid uuid, source_id uuid, eid uuid, request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid:=auth.uid();
 source expense_stage_b.expense_items;
 saved expense_stage_b.receipts;
 sig jsonb;
 receipt jsonb;
begin
 if actor_id is null or not app_private.can_edit_trip(tid,actor_id) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if tid is null or source_id is null or eid is null or request_id is null then
  raise exception 'Invalid copy request' using errcode='22023';
 end if;
 sig:=jsonb_build_object('operation','copy','trip',tid,'source',source_id,'id',eid);
 perform pg_advisory_xact_lock(hashtextextended(actor_id::text||request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||tid::text,0));
 if not app_private.can_edit_trip(tid,actor_id) then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 select * into saved from expense_stage_b.receipts r
 where r.actor=actor_id and r.request_id=copy_item.request_id;
 if found then
  if saved.signature<>sig then raise exception 'Request mismatch' using errcode='22023'; end if;
  return saved.result;
 end if;

 select * into source from expense_stage_b.expense_items
 where id=source_id and trip_id=tid and deleted_at is null;
 if not found then raise exception 'Item removed' using errcode='55000'; end if;
 if source.budget is not null and exists(
  select 1 from expense_stage_b.expense_participants p
  where p.expense_id=source_id and p.budget_selected and not exists(
   select 1 from public.trip_members m where m.trip_id=tid and m.user_id=p.user_id and m.status='approved')
 ) then raise exception 'Budget participants must be current members' using errcode='22023'; end if;

 insert into expense_stage_b.expense_items(id,trip_id,title,category,note,budget,payment_state,
  budget_decisions_known,paid_decisions_known,payment_mode,planning_managed)
 values(eid,tid,coalesce(nullif(btrim(source.title),''),'未命名項目')||'（副本）',source.category,
  source.note,source.budget,'unpaid',source.budget_decisions_known,false,'self',source.planning_managed);
 insert into expense_stage_b.expense_participants(expense_id,user_id,budget_selected,budget_share_amount)
 select eid,p.user_id,p.budget_selected,p.budget_share_amount
 from expense_stage_b.expense_participants p
 join public.trip_members m on m.trip_id=tid and m.user_id=p.user_id and m.status='approved'
 where p.expense_id=source_id and (p.budget_selected is not null or p.budget_share_amount is not null);
 insert into expense_stage_b.expense_itinerary_links(expense_id,trip_id,itinerary_item_id)
 select eid,tid,itinerary_item_id from expense_stage_b.expense_itinerary_links
 where expense_id=source_id and trip_id=tid;
 receipt:=jsonb_build_object('committed',true,'request_id',request_id,'expense_id',eid);
 insert into expense_stage_b.receipts values(actor_id,request_id,sig,receipt);
 return receipt;
end $$;

create function public.copy_expense_item(p_trip_id uuid,p_source_id uuid,p_id uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select expense_stage_b.copy_item(p_trip_id,p_source_id,p_id,p_request_id)
$$;
revoke all on function expense_stage_b.copy_item(uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.copy_expense_item(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function expense_stage_b.copy_item(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.copy_expense_item(uuid,uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
