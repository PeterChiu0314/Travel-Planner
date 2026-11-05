-- Every existing Actual retains its ID, financial JSON, source/history fields,
-- payer, date and member/share rows. Pure old Budget references are omitted.
insert into expense_stage_b.expense_items(id,trip_id,title,category,note,payer_id,paid,paid_at,payment_state,paid_decisions_known)
select a.id,a.trip_id,a.title,a.category,a.note,a.payer_id,
 to_jsonb(a)-array['budget_item_id','budget_origin_id','id','trip_id','title','category','note','payer_id','paid_at'],
 a.paid_at,case when a.record_status='incomplete' then 'draft' when a.payment_active is false then 'unpaid' else 'paid' end,false
from public.actual_expenses a;
insert into expense_stage_b.expense_participants(expense_id,user_id,paid_selected,paid_share_amount)
select p.actual_expense_id,p.user_id,true,p.share_amount from public.actual_expense_participants p;

do $$begin
 if (select count(*) from expense_stage_b.expense_items)<>8 or (select count(*) from expense_stage_b.expense_participants)<>11 then raise exception 'Actual import count mismatch';end if;
 if exists(select 1 from public.actual_expenses a left join expense_stage_b.expense_items e on e.id=a.id where e.id is null or e.trip_id is distinct from a.trip_id or e.paid is distinct from (to_jsonb(a)-array['budget_item_id','budget_origin_id','id','trip_id','title','category','note','payer_id','paid_at']) or e.payment_state is distinct from (case when a.record_status='incomplete' then 'draft' when a.payment_active is false then 'unpaid' else 'paid' end) or e.paid_at is distinct from a.paid_at or e.payer_id is distinct from a.payer_id) then raise exception 'Actual import values mismatch';end if;
 if exists(select 1 from public.actual_expense_participants p left join expense_stage_b.expense_participants x on x.expense_id=p.actual_expense_id and x.user_id=p.user_id where x.expense_id is null or x.paid_share_amount is distinct from p.share_amount) then raise exception 'Actual people import mismatch';end if;
end$$;
