-- Prepared for review only. Apply to staging and verify before production.
-- Existing amount remains the ORIGINAL-CURRENCY TOTAL, including legacy rows.
begin;

alter table public.budget_items
  add column pricing_mode text not null default 'split_total' check (pricing_mode in ('per_person','split_total','custom')),
  add column unit_amount numeric(12,2) check (unit_amount >= 0);
update public.budget_items set pricing_mode = 'custom' where split_type = 'custom';
alter table public.actual_expenses
  add column budget_origin_id uuid,
  add column category text not null default '其他',
  add column subcategory text,
  add column pricing_mode text not null default 'split_total' check (pricing_mode in ('per_person','split_total','custom')),
  add column split_type text not null default 'equal' check (split_type in ('equal','custom')),
  add column unit_amount numeric(12,2) check (unit_amount >= 0);
update public.actual_expenses a set category = b.category, subcategory = b.subcategory
from public.budget_items b where b.id = a.budget_item_id;
update public.actual_expenses set budget_origin_id = budget_item_id;
-- A deleted budget's ON DELETE SET NULL must not erase its snapshot identity.
create function app_private.keep_actual_budget_origin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.budget_item_id is not null then new.budget_origin_id := new.budget_item_id;
  elsif tg_op = 'UPDATE' then new.budget_origin_id := old.budget_origin_id;
  else new.budget_origin_id := null; end if;
  return new;
end $$;
revoke all on function app_private.keep_actual_budget_origin() from public, anon, authenticated;
create trigger keep_actual_budget_origin before insert or update on public.actual_expenses for each row execute function app_private.keep_actual_budget_origin();
alter table public.budget_item_participants add column share_amount numeric(12,2) check (share_amount >= 0);
alter table public.actual_expense_participants add column share_amount numeric(12,2) check (share_amount >= 0);

create table public.trip_budget_baselines (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  departure_at timestamptz not null,
  captured_at timestamptz not null default clock_timestamp(),
  payload jsonb not null check (jsonb_typeof(payload) = 'object')
);
alter table public.trip_budget_baselines enable row level security;
create policy budget_baseline_read on public.trip_budget_baselines for select to authenticated
using (app_private.can_read_trip(trip_id, auth.uid()));
revoke all on public.trip_budget_baselines from public, anon, authenticated;
grant select on public.trip_budget_baselines to authenticated;
alter table public.trip_budget_baselines replica identity full;
alter publication supabase_realtime add table public.trip_budget_baselines;

-- Maintain the last committed planning version BEFORE departure. No cron or
-- client visit is needed at midnight. Once the cutoff is reached, this row is
-- immutable even if dates are later moved or budgets/members/items deleted.
-- Dates currently have no trip timezone: cutoff explicitly uses Asia/Taipei.
create function app_private.refresh_budget_baseline(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_trip public.trips;
  v_cutoff timestamptz;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;
  if not found or v_trip.start_date is null or v_trip.status = 'settled' then return; end if;
  v_cutoff := v_trip.start_date::timestamp at time zone 'Asia/Taipei';
  if clock_timestamp() >= v_cutoff then return; end if;
  if exists (select 1 from public.trip_budget_baselines where trip_id = p_trip_id and departure_at <= clock_timestamp()) then return; end if;
  insert into public.trip_budget_baselines(trip_id, departure_at, captured_at, payload)
  values (p_trip_id, v_cutoff, clock_timestamp(), jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(b) - 'locked_at' - 'locked_by' order by b.created_at, b.id) from public.budget_items b where b.trip_id = p_trip_id), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(to_jsonb(p) order by p.user_id) from public.budget_item_participants p join public.budget_items b on b.id = p.budget_item_id where b.trip_id = p_trip_id), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.itinerary_budget_items l join public.budget_items b on b.id = l.budget_item_id where b.trip_id = p_trip_id), '[]'::jsonb),
    'itinerary', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'day_index', i.day_index) order by i.id) from public.itinerary_items i where i.trip_id = p_trip_id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', m.display_name) order by m.user_id) from public.trip_members m where m.trip_id = p_trip_id and m.status = 'approved'), '[]'::jsonb)
  ))
  on conflict (trip_id) do update set departure_at = excluded.departure_at, captured_at = excluded.captured_at, payload = excluded.payload
  where public.trip_budget_baselines.departure_at > clock_timestamp();
end;
$$;
revoke all on function app_private.refresh_budget_baseline(uuid) from public, anon, authenticated;

create function app_private.budget_baseline_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old uuid; v_new uuid;
begin
  -- Locks, backlink bookkeeping and unchanged rows are not planning edits.
  if tg_op = 'UPDATE' and
    (to_jsonb(new) - 'locked_by' - 'locked_at' - 'updated_at' - 'auto_created_actual_expense_id') =
    (to_jsonb(old) - 'locked_by' - 'locked_at' - 'updated_at' - 'auto_created_actual_expense_id') then return null; end if;
  if tg_table_name = 'trips' then
    if tg_op <> 'DELETE' then v_new := new.id; end if;
  elsif tg_table_name in ('budget_items','trip_members','itinerary_items') then
    if tg_op <> 'INSERT' then v_old := old.trip_id; end if;
    if tg_op <> 'DELETE' then v_new := new.trip_id; end if;
  else
    if tg_op <> 'INSERT' then select trip_id into v_old from public.budget_items where id = old.budget_item_id; end if;
    if tg_op <> 'DELETE' then select trip_id into v_new from public.budget_items where id = new.budget_item_id; end if;
  end if;
  if v_old is not null then perform app_private.refresh_budget_baseline(v_old); end if;
  if v_new is not null and v_new is distinct from v_old then perform app_private.refresh_budget_baseline(v_new); end if;
  return null;
end;
$$;
revoke all on function app_private.budget_baseline_changed() from public, anon, authenticated;
-- Deferred triggers see the final transaction, never partially replaced joins.
-- A transaction finishing after departure must not replace the last baseline.
create constraint trigger budget_baseline_budget after insert or update or delete on public.budget_items deferrable initially deferred for each row execute function app_private.budget_baseline_changed();
create constraint trigger budget_baseline_participant after insert or update or delete on public.budget_item_participants deferrable initially deferred for each row execute function app_private.budget_baseline_changed();
create constraint trigger budget_baseline_links after insert or update or delete on public.itinerary_budget_items deferrable initially deferred for each row execute function app_private.budget_baseline_changed();
create constraint trigger budget_baseline_members after insert or update or delete on public.trip_members deferrable initially deferred for each row execute function app_private.budget_baseline_changed();
create constraint trigger budget_baseline_itinerary after insert or update or delete on public.itinerary_items deferrable initially deferred for each row execute function app_private.budget_baseline_changed();
create constraint trigger budget_baseline_trip after insert or update on public.trips deferrable initially deferred for each row execute function app_private.budget_baseline_changed();

-- Seed only trips that have not departed; historical budgets cannot be
-- reconstructed. Do not fabricate a baseline for ongoing/completed trips.
do $$ declare v_id uuid; begin
  for v_id in select id from public.trips where start_date::timestamp at time zone 'Asia/Taipei' > clock_timestamp() and status <> 'settled'
  loop perform app_private.refresh_budget_baseline(v_id); end loop;
end $$;

-- One atomic transaction for record + allocations + Timeline links + optional
-- fixed actual. Invoker privileges preserve existing RLS. All relationships
-- must belong to the same trip and approved members. Never trust client totals.
create function public.save_budget_workspace_record(
  p_trip_id uuid, p_kind text, p_id uuid, p_base_updated_at timestamptz, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_mode text := coalesce(p_payload->>'pricing_mode','split_total');
  v_currency text := upper(coalesce(nullif(btrim(p_payload->>'currency'),''),'TWD'));
  v_rate numeric;
  v_amount numeric;
  v_unit numeric;
  v_total_twd numeric;
  v_participants uuid[];
  v_links uuid[];
  v_shares jsonb := coalesce(p_payload->'shares','{}'::jsonb);
  v_payer uuid := nullif(p_payload->>'payer_id','')::uuid;
  v_source uuid := nullif(p_payload->>'budget_item_id','')::uuid;
  v_existing public.budget_items;
  v_actual public.actual_expenses;
  v_fixed_id uuid;
  v_user uuid;
  v_share numeric;
  v_title text := btrim(p_payload->>'title');
  v_category text := coalesce(nullif(btrim(p_payload->>'category'),''),'其他');
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id, auth.uid()) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if coalesce(p_kind,'') not in ('budget','actual') or v_mode not in ('per_person','split_total','custom') or coalesce(v_title,'') = '' then raise exception 'Invalid budget input' using errcode = '22023'; end if;
  if jsonb_typeof(p_payload->'participantIds') is distinct from 'array' then raise exception 'Participants required' using errcode = '22023'; end if;
  select array_agg(distinct value::uuid order by value::uuid) into v_participants from jsonb_array_elements_text(p_payload->'participantIds');
  if coalesce(cardinality(v_participants),0) = 0 or exists (
    select 1 from unnest(v_participants) u where not exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = u and m.status = 'approved')
  ) then raise exception 'Invalid participants' using errcode = '22023'; end if;
  if v_payer is not null and not exists (select 1 from public.trip_members where trip_id = p_trip_id and user_id = v_payer and status = 'approved') then raise exception 'Invalid payer' using errcode = '22023'; end if;
  if v_source is not null and not exists (select 1 from public.budget_items where id = v_source and trip_id = p_trip_id) then raise exception 'Invalid source budget' using errcode = '22023'; end if;
  select array_agg(distinct value::uuid) into v_links from jsonb_array_elements_text(coalesce(p_payload->'linkedItemIds','[]'::jsonb));
  if exists (select 1 from unnest(v_links) u where not exists (select 1 from public.itinerary_items where id = u and trip_id = p_trip_id)) then raise exception 'Invalid itinerary link' using errcode = '22023'; end if;
  v_rate := case when v_currency = 'TWD' then 1 else (p_payload->>'exchange_rate')::numeric end;
  if v_rate is null or v_rate <= 0 or v_rate <> round(v_rate,6) or v_rate >= 100000000 then raise exception 'Invalid exchange rate' using errcode = '22023'; end if;
  if v_mode = 'per_person' then
    v_unit := (p_payload->>'unit_amount')::numeric;
    if v_unit is null or v_unit < 0 or v_unit <> round(v_unit,2) then raise exception 'Invalid unit amount' using errcode = '22023'; end if;
    v_amount := v_unit * cardinality(v_participants);
  elsif v_mode = 'custom' then
    v_amount := 0;
    foreach v_user in array v_participants loop
      v_share := (v_shares->>v_user::text)::numeric;
      if v_share is null or v_share < 0 or v_share <> round(v_share,2) then raise exception 'Invalid member share' using errcode = '22023'; end if;
      v_amount := v_amount + v_share;
    end loop;
  else v_amount := (p_payload->>'amount')::numeric;
  end if;
  if v_amount is null or v_amount < 0 or v_amount <> round(v_amount,2) or v_amount >= 10000000000 then raise exception 'Invalid total amount' using errcode = '22023'; end if;
  v_total_twd := round(v_amount * v_rate);

  if p_kind = 'budget' then
    if p_id is not null then
      select * into v_existing from public.budget_items where id = p_id and trip_id = p_trip_id for update;
      if not found then raise exception 'Budget missing' using errcode = '40001'; end if;
      if p_base_updated_at is null or v_existing.updated_at <> p_base_updated_at then raise exception 'Budget changed' using errcode = '40001'; end if;
      if v_existing.locked_by is not null and v_existing.locked_by <> auth.uid() and v_existing.locked_at > clock_timestamp() - interval '7 minutes' then raise exception 'Budget locked' using errcode = '55P03'; end if;
    end if;
    insert into public.budget_items(id,trip_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,is_fixed,note)
    values(v_id,p_trip_id,v_category,nullif(btrim(p_payload->>'subcategory'),''),v_title,v_amount,v_currency,v_rate,v_total_twd,v_payer,v_mode,v_unit,case when v_mode = 'custom' then 'custom' else 'equal' end,coalesce((p_payload->>'is_fixed')::boolean,false),nullif(btrim(p_payload->>'note'),''))
    on conflict (id) do update set category = excluded.category, subcategory = excluded.subcategory,title = excluded.title,amount = excluded.amount,currency = excluded.currency,exchange_rate = excluded.exchange_rate,twd_amount = excluded.twd_amount,payer_id = excluded.payer_id,pricing_mode = excluded.pricing_mode,unit_amount = excluded.unit_amount,split_type = excluded.split_type,is_fixed = excluded.is_fixed,note = excluded.note;
    delete from public.budget_item_participants where budget_item_id = v_id;
    foreach v_user in array v_participants loop
      -- Only custom weights need persisted shares. Equal shares derive from
      -- total, including fractional original cents, without independent sums.
      insert into public.budget_item_participants(budget_item_id,user_id,share_amount) values (v_id,v_user,case when v_mode = 'custom' then (v_shares->>v_user::text)::numeric else null end);
    end loop;
    delete from public.itinerary_budget_items where budget_item_id = v_id;
    insert into public.itinerary_budget_items(budget_item_id,itinerary_item_id) select v_id,unnest(v_links);
    -- Fixed means create once, never overwrite an already edited actual.
    if coalesce((p_payload->>'is_fixed')::boolean,false) and not exists (select 1 from public.actual_expenses where budget_item_id = v_id) then
      v_fixed_id := gen_random_uuid();
      insert into public.actual_expenses(id,trip_id,budget_item_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,note)
      select v_fixed_id,trip_id,id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,note from public.budget_items where id = v_id;
      insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) select v_fixed_id,user_id,share_amount from public.budget_item_participants where budget_item_id = v_id;
      update public.budget_items set auto_created_actual_expense_id = v_fixed_id where id = v_id;
    end if;
    update public.budget_items set locked_by = null, locked_at = null where id = v_id and locked_by = auth.uid();
  else
    if p_id is not null then
      select * into v_actual from public.actual_expenses where id = p_id and trip_id = p_trip_id for update;
      if not found or p_base_updated_at is null or v_actual.updated_at <> p_base_updated_at then raise exception 'Expense changed' using errcode = '40001'; end if;
      if v_actual.locked_by is not null and v_actual.locked_by <> auth.uid() and v_actual.locked_at > clock_timestamp() - interval '7 minutes' then raise exception 'Expense locked' using errcode = '55P03'; end if;
    end if;
    insert into public.actual_expenses(id,trip_id,budget_item_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,paid_at,note)
    values(v_id,p_trip_id,v_source,v_category,nullif(btrim(p_payload->>'subcategory'),''),v_title,v_amount,v_currency,v_rate,v_total_twd,v_payer,v_mode,v_unit,case when v_mode = 'custom' then 'custom' else 'equal' end,coalesce(nullif(p_payload->>'paid_at','')::timestamptz,clock_timestamp()),nullif(btrim(p_payload->>'note'),''))
    on conflict (id) do update set budget_item_id = excluded.budget_item_id,category = excluded.category,subcategory = excluded.subcategory,title = excluded.title,amount = excluded.amount,currency = excluded.currency,exchange_rate = excluded.exchange_rate,twd_amount = excluded.twd_amount,payer_id = excluded.payer_id,pricing_mode = excluded.pricing_mode,unit_amount = excluded.unit_amount,split_type = excluded.split_type,paid_at = excluded.paid_at,note = excluded.note;
    delete from public.actual_expense_participants where actual_expense_id = v_id;
    foreach v_user in array v_participants loop
      insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) values (v_id,v_user,case when v_mode = 'custom' then (v_shares->>v_user::text)::numeric else null end);
    end loop;
    update public.actual_expenses set locked_by = null, locked_at = null where id = v_id and locked_by = auth.uid();
  end if;
  return jsonb_build_object('id',v_id);
end;
$$;
revoke all on function public.save_budget_workspace_record(uuid,text,uuid,timestamptz,jsonb) from public, anon;
grant execute on function public.save_budget_workspace_record(uuid,text,uuid,timestamptz,jsonb) to authenticated;

create function public.delete_budget_workspace_record(p_trip_id uuid, p_kind text, p_id uuid, p_base_updated_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_updated timestamptz; v_locked uuid; v_lock_time timestamptz;
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id,auth.uid()) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_kind = 'budget' then
    select updated_at,locked_by,locked_at into v_updated,v_locked,v_lock_time from public.budget_items where id = p_id and trip_id = p_trip_id for update;
  elsif p_kind = 'actual' then
    select updated_at,locked_by,locked_at into v_updated,v_locked,v_lock_time from public.actual_expenses where id = p_id and trip_id = p_trip_id for update;
  else raise exception 'Invalid kind' using errcode = '22023'; end if;
  if not found or p_base_updated_at is null or v_updated <> p_base_updated_at then raise exception 'Record changed' using errcode = '40001'; end if;
  if v_locked is not null and v_locked <> auth.uid() and v_lock_time > clock_timestamp()-interval '7 minutes' then raise exception 'Record locked' using errcode = '55P03'; end if;
  if p_kind = 'budget' then delete from public.budget_items where id = p_id and trip_id = p_trip_id;
  else delete from public.actual_expenses where id = p_id and trip_id = p_trip_id; end if;
end $$;
revoke all on function public.delete_budget_workspace_record(uuid,text,uuid,timestamptz) from public,anon;
grant execute on function public.delete_budget_workspace_record(uuid,text,uuid,timestamptz) to authenticated;
commit;
