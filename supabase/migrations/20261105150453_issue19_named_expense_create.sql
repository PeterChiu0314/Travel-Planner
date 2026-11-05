-- #19: one named item, optional independent financial bundles. No data rewrite.
begin;
create function expense_stage_b.create_named_item(tid uuid,eid uuid,session_id uuid,request_id uuid,item_title text)
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
 insert into expense_stage_b.expense_items(id,trip_id,title,payment_state,budget_decisions_known,paid_decisions_known)
 values(eid,tid,clean_title,'draft',true,true);
 insert into expense_stage_b.expense_participants(expense_id,user_id,budget_selected,paid_selected)
 select eid,user_id,true,true from public.trip_members where trip_id=tid and status='approved';
 receipt:=jsonb_build_object('committed',true,'request_id',request_id,'expense_id',eid,'created',true);
 insert into expense_stage_b.receipts values(auth.uid(),request_id,signature,receipt);
 return receipt;
end $$;
revoke all on function expense_stage_b.create_named_item(uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function expense_stage_b.create_named_item(uuid,uuid,uuid,uuid,text) to authenticated;
create function public.create_named_expense_item(p_trip_id uuid,p_id uuid,p_session_id uuid,p_request_id uuid,p_title text)
returns jsonb language sql security invoker set search_path='' as $$select expense_stage_b.create_named_item(p_trip_id,p_id,p_session_id,p_request_id,p_title)$$;
revoke all on function public.create_named_expense_item(uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.create_named_expense_item(uuid,uuid,uuid,uuid,text) to authenticated;

-- Old clients may resolve already committed requests, but cannot create blank rows.
create or replace function expense_stage_b.create_item(tid uuid,eid uuid,session_id uuid,request_id uuid,view_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare signature jsonb;r expense_stage_b.receipts;
begin
 if auth.uid() is null or not app_private.can_edit_trip(tid,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if eid is null or session_id is null or request_id is null or view_name is null or view_name not in('budget','paid') then raise exception 'Invalid create' using errcode='22023';end if;
 signature:=jsonb_build_object('trip',tid,'id',eid,'session',session_id,'view',view_name);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into r from expense_stage_b.receipts where actor=auth.uid() and receipts.request_id=create_item.request_id;
 if found then if r.signature<>signature then raise exception 'Request mismatch' using errcode='22023';end if;return r.result;end if;
 raise exception 'Refresh to create a named item' using errcode='22023';
end $$;
notify pgrst,'reload schema';
commit;
