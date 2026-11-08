-- Budget decisions made by a membership approval are committed with the membership row.
begin;

create function expense_stage_b.on_member_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  item expense_stage_b.expense_items;
  approved_ids uuid[];
  selected_ids uuid[];
  mode text;
  scale integer;
  old_total numeric;
  new_total numeric;
  unit numeric;
  rate numeric;
  twd numeric;
  count_selected integer;
  payers jsonb;
begin
  -- The existing BEFORE trigger already holds the expense trip transaction lock.
  select array_agg(user_id order by user_id) into approved_ids
  from public.trip_members where trip_id=new.trip_id and status='approved';

  for item in select e.* from expense_stage_b.expense_items e
    where e.trip_id=new.trip_id and e.deleted_at is null and e.payment_state<>'paid'
      and e.budget is not null and e.budget->>'requires_participants' is distinct from 'true'
      and exists(select 1 from expense_stage_b.expense_participants p where p.expense_id=e.id and p.budget_selected)
      and not exists(select 1 from expense_stage_b.expense_participants p
        where p.expense_id=e.id and p.user_id=new.user_id and p.budget_selected)
    order by e.id for update nowait
  loop
    -- Releases can touch group rows without holding the trip lock.
    perform 1 from expense_stage_b.groups where expense_id=item.id and group_key in ('budget','payer')
    order by group_key for update nowait;
    if exists(select 1 from expense_stage_b.groups g where g.expense_id=item.id
        and g.group_key in ('budget','paid','payer','payment','lifecycle') and g.expires_at>clock_timestamp()
        and app_private.can_edit_trip(new.trip_id,g.actor))
      or (item.budget->>'currency'<>'TWD' and exists(select 1 from expense_stage_b.rate_leases r
        where r.trip_id=new.trip_id and r.expires_at>clock_timestamp() and app_private.can_edit_trip(new.trip_id,r.actor))) then
      raise exception 'Expense edit in progress' using errcode='55P03';
    end if;

    select array_agg(user_id order by user_id) into selected_ids
    from expense_stage_b.expense_participants where expense_id=item.id and budget_selected;
    mode := item.budget->>'pricing_mode';
    scale := case when item.budget->>'original_scale'='0' then 1 else 100 end;
    old_total := (item.budget->>'amount')::numeric;
    if mode is null or mode not in ('split_total','per_person','custom') or not(selected_ids <@ approved_ids)
      or old_total is null or old_total not between 0 and 9999999999.99 or old_total*scale<>trunc(old_total*scale)
      or (select sum(budget_share_amount) from expense_stage_b.expense_participants
        where expense_id=item.id and budget_selected) is distinct from old_total
      or exists(select 1 from expense_stage_b.expense_participants where expense_id=item.id and budget_selected
        and (budget_share_amount is null or budget_share_amount*scale<>trunc(budget_share_amount*scale))) then
      raise exception 'Invalid saved expense split for member approval' using errcode='22023';
    end if;

    new_total := old_total;
    count_selected := cardinality(selected_ids)+1;
    if mode='per_person' then
      unit := (item.budget->>'unit_amount')::numeric;
      rate := (item.budget->>'exchange_rate')::numeric;
      if unit is null or unit<0 or unit*scale<>trunc(unit*scale) or unit*cardinality(selected_ids)<>old_total
        or rate is null or rate<=0 or rate<>round(rate,6)
        or exists(select 1 from expense_stage_b.expense_participants where expense_id=item.id
          and budget_selected and budget_share_amount<>unit) then
        raise exception 'Invalid saved unit amount or rate for member approval' using errcode='22023';
      end if;
      new_total := unit*count_selected;
      twd := round(new_total*rate);
      if new_total>9999999999.99 or twd>9999999999 then
        raise exception 'Expense amount exceeds limit after member approval' using errcode='22023';
      end if;
    end if;

    insert into expense_stage_b.expense_participants(expense_id,user_id,budget_selected,budget_share_amount)
    values(item.id,new.user_id,true,case when mode='per_person' then unit else 0 end)
    on conflict(expense_id,user_id) do update set budget_selected=true,budget_share_amount=excluded.budget_share_amount;

    if mode='split_total' then
      update expense_stage_b.expense_participants p
      set budget_share_amount=(trunc(old_total*scale/count_selected)
        + case when member.position<=mod(old_total*scale,count_selected) then 1 else 0 end)/scale
      from (select user_id,row_number() over(order by user_id) as position
        from expense_stage_b.expense_participants where expense_id=item.id and budget_selected) member
      where p.expense_id=item.id and p.user_id=member.user_id;
    elsif mode='per_person' and new_total<>old_total then
      update expense_stage_b.expense_items set budget=budget||jsonb_build_object('amount',new_total,'twd_amount',twd)
      where id=item.id;
      -- Keep the same planned payers. A retained paid bundle keeps its payment history.
      if item.paid is null and item.payment_mode='advance' and jsonb_array_length(item.payer_allocations)>0
        and round(new_total)<>round(old_total) then
        payers := expense_stage_b.normalize_payers(jsonb_build_object('mode',item.payment_mode,
          'rows',item.payer_allocations,'sequence',item.payer_sequence),new_total,approved_ids)->'rows';
        if payers is distinct from item.payer_allocations then
          update expense_stage_b.expense_items set payer_allocations=payers where id=item.id;
          insert into expense_stage_b.groups(expense_id,group_key,revision) values(item.id,'payer',1)
          on conflict(expense_id,group_key) do update set revision=groups.revision+1;
        end if;
      end if;
    end if;

    insert into expense_stage_b.groups(expense_id,group_key,revision) values(item.id,'budget',1)
    on conflict(expense_id,group_key) do update set revision=groups.revision+1;
  end loop;

  if exists(select 1 from expense_stage_b.expense_items where trip_id=new.trip_id and deleted_at is null) then
    perform expense_stage_b.signal(new.trip_id);
  end if;
  return null;
end;
$$;
revoke all on function expense_stage_b.on_member_approval() from public, anon, authenticated;

create trigger expense_member_joined after insert on public.trip_members
for each row when (new.status='approved') execute function expense_stage_b.on_member_approval();
create trigger expense_member_newly_approved after update of status on public.trip_members
for each row when (old.status is distinct from 'approved' and new.status='approved')
execute function expense_stage_b.on_member_approval();

commit;
