-- Stage B disposable DB prototype ONLY. Not a Forward migration or deployment.
-- No App/Hosted client uses this namespace. Existing tables/functions unchanged.
begin;
create schema expense_stage_b;
revoke all on schema expense_stage_b from public,anon;
grant usage on schema expense_stage_b to authenticated;
create table expense_stage_b.expense_items (
 id uuid primary key, trip_id uuid not null references public.trips(id),
 title text not null default '',category text not null default '其他',note text,
 payer_id uuid, budget jsonb, paid jsonb, paid_at timestamptz,
 payment_state text not null check(payment_state in('draft','unpaid','paid')),
 budget_decisions_known boolean not null default false,
 paid_decisions_known boolean not null default false,
 check(budget is null or jsonb_typeof(budget)='object'),
 check(paid is null or jsonb_typeof(paid)='object'),
 check(budget is null or not (budget ?| array['participantIds','shares'])),
 check(paid is null or not (paid ?| array['participantIds','shares'])),
 check(payment_state<>'paid' or paid is not null),
 unique(id,trip_id)
);
create table expense_stage_b.expense_participants (
 expense_id uuid not null references expense_stage_b.expense_items(id),user_id uuid not null,
 budget_selected boolean,paid_selected boolean,
 budget_share_amount numeric,paid_share_amount numeric,
 check(budget_share_amount is null or budget_share_amount>=0),
 check(paid_share_amount is null or paid_share_amount>=0),
 primary key(expense_id,user_id)
);
create table expense_stage_b.expense_itinerary_links (
 expense_id uuid not null,trip_id uuid not null,itinerary_item_id uuid not null,
 foreign key(expense_id,trip_id) references expense_stage_b.expense_items(id,trip_id),
 foreign key(itinerary_item_id) references public.itinerary_items(id),
 primary key(expense_id,itinerary_item_id)
);
create function expense_stage_b.validate_link() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.itinerary_items i where i.id=new.itinerary_item_id and i.trip_id=new.trip_id)
 then raise exception 'Cross-trip itinerary link' using errcode='22023';end if;
 return new;
end $$;
revoke all on function expense_stage_b.validate_link() from public,anon,authenticated;
create trigger expense_link_trip before insert or update on expense_stage_b.expense_itinerary_links
 for each row execute function expense_stage_b.validate_link();
alter table expense_stage_b.expense_items enable row level security;
alter table expense_stage_b.expense_participants enable row level security;
alter table expense_stage_b.expense_itinerary_links enable row level security;
create policy expense_read on expense_stage_b.expense_items for select to authenticated
 using(app_private.can_read_trip(trip_id,auth.uid()));
create policy people_read on expense_stage_b.expense_participants for select to authenticated
 using(exists(select 1 from expense_stage_b.expense_items e where e.id=expense_id));
create policy links_read on expense_stage_b.expense_itinerary_links for select to authenticated
 using(app_private.can_read_trip(trip_id,auth.uid()));
-- Write RPC/lease integration is intentionally not exposed in this foundation.
revoke all on all tables in schema expense_stage_b from public,anon,authenticated;
grant select on all tables in schema expense_stage_b to authenticated;
commit;
