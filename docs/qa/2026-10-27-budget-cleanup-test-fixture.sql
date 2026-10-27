-- User explicitly approved deleting this new test payment and its test Budget.
-- The Budget is already gone. Preserve original content and audit ledger.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
lock table public.budget_items,public.actual_expenses,public.actual_expense_participants,public.attachments,public.trip_budget_baselines in share row exclusive mode;
do $$
declare original_actual text; original_budget text;
begin
  select md5(coalesce(jsonb_agg(to_jsonb(t)-array['updated_at','twd_amount_source','actual_twd_amount','payment_origin','payment_active','payment_history'] order by t.id)::text,'[]')) into original_actual
  from public.actual_expenses t where id<>'f71ae9e9-6a43-4b44-9f30-9dd562c53a99';
  select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) into original_budget from public.budget_items t;
  if original_actual<>'5c1bfe01cf4ff7b95bc500917f8ae45d' or original_budget<>'7dc61b89fe73d035645bde5d16eee259'
    or (select count(*) from public.actual_expenses)<>2 or (select count(*) from public.budget_items)<>13
    or (select count(*) from public.trip_budget_baselines)<>4 then raise exception 'Original content differs; cleanup cancelled'; end if;
  if (select count(*) from public.actual_expenses where id='f71ae9e9-6a43-4b44-9f30-9dd562c53a99'
    and trip_id='6762ea59-ea84-411c-af44-06be1f906347' and title='QA #10 migration 20261027'
    and currency='TWD' and amount=1 and twd_amount=1 and actual_twd_amount=1 and budget_item_id is null)<>1
    or exists(select 1 from public.attachments where target_type='actual_expense' and target_id='f71ae9e9-6a43-4b44-9f30-9dd562c53a99')
    or (select count(*) from public.actual_expense_participants where actual_expense_id='f71ae9e9-6a43-4b44-9f30-9dd562c53a99')<>3
    or (select sum(share_amount) from public.actual_expense_participants where actual_expense_id='f71ae9e9-6a43-4b44-9f30-9dd562c53a99')<>1 then raise exception 'Fixture differs; cleanup cancelled'; end if;
  delete from public.actual_expenses where id='f71ae9e9-6a43-4b44-9f30-9dd562c53a99'
    and trip_id='6762ea59-ea84-411c-af44-06be1f906347' and title='QA #10 migration 20261027' and twd_amount=1;
  if (select count(*) from public.actual_expenses)<>1
    or exists(select 1 from public.actual_expense_participants where actual_expense_id='f71ae9e9-6a43-4b44-9f30-9dd562c53a99')
    or (select md5(coalesce(jsonb_agg(to_jsonb(t)-array['updated_at','twd_amount_source','actual_twd_amount','payment_origin','payment_active','payment_history'] order by t.id)::text,'[]')) from public.actual_expenses t)<>original_actual
    or (select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) from public.budget_items t)<>original_budget then raise exception 'Cleanup preservation failed'; end if;
end $$;
commit;
select 'only_approved_test_actual_deleted_and_originals_preserved' as result;
