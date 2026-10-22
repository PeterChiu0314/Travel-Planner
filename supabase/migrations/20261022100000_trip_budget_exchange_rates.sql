-- Prepared locally only; requires staging verification before rollout.
begin;
alter table public.trips add column budget_exchange_rates jsonb not null default '{}'::jsonb
  check (jsonb_typeof(budget_exchange_rates) = 'object');

create function public.update_trip_budget_rates(p_trip_id uuid, p_quote jsonb, p_initialize boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips; v_currency text; v_rate numeric; v_quote jsonb;
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id, auth.uid()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text, 0));
  select * into v_trip from public.trips where id = p_trip_id for update;
  if v_trip.start_date is null or v_trip.start_date::timestamp at time zone 'Asia/Taipei' <= clock_timestamp()
    or v_trip.status = 'settled' or exists(select 1 from public.trip_budget_baselines where trip_id = p_trip_id and departure_at <= clock_timestamp()) then
    raise exception '只有行前規劃可更新旅程預算匯率。' using errcode = '22023';
  end if;
  if p_initialize and v_trip.budget_exchange_rates ? 'rates' then return v_trip.budget_exchange_rates; end if;
  if jsonb_typeof(p_quote->'rates') is distinct from 'object' or p_quote->>'source' is distinct from 'ExchangeRate-API'
    or (p_quote->>'quoted_at')::timestamptz is null or (p_quote->>'quoted_at')::timestamptz > clock_timestamp() + interval '1 day' then
    raise exception 'Invalid rate quote' using errcode = '22023';
  end if;
  foreach v_currency in array array['JPY','USD','EUR','KRW','HKD'] loop
    if not (p_quote->'rates' ? v_currency) then raise exception 'Missing currency quote' using errcode = '22023'; end if;
  end loop;
  for v_currency in select jsonb_object_keys(p_quote->'rates') loop
    v_rate := (p_quote->'rates'->>v_currency)::numeric;
    if v_currency !~ '^[A-Z]{3}$' or v_rate is null or v_rate <= 0 or v_rate > 1000000 or v_rate <> round(v_rate, 6) then
      raise exception 'Invalid currency rate' using errcode = '22023';
    end if;
  end loop;
  perform 1 from public.budget_items where trip_id = p_trip_id order by id for update;
  if exists(select 1 from public.budget_items where trip_id = p_trip_id and locked_by is not null
    and locked_by <> auth.uid() and locked_at > clock_timestamp() - interval '7 minutes') then
    raise exception '其他成員正在編輯預算，請稍後更新匯率。' using errcode = '55P03';
  end if;
  if exists(select 1 from public.budget_items where trip_id = p_trip_id and currency <> 'TWD'
    and not (p_quote->'rates' ? currency)) then raise exception 'Missing currency quote' using errcode = '22023'; end if;
  v_quote := jsonb_build_object('rates', p_quote->'rates', 'source', p_quote->>'source',
    'quoted_at', (p_quote->>'quoted_at')::timestamptz, 'updated_at', clock_timestamp());
  update public.trips set budget_exchange_rates = v_quote where id = p_trip_id;
  update public.budget_items set exchange_rate = (v_quote->'rates'->>currency)::numeric,
    twd_amount = round(amount * (v_quote->'rates'->>currency)::numeric)
    where trip_id = p_trip_id and currency <> 'TWD';
  -- Actual expenses are historical payments and are deliberately untouched.
  return v_quote;
end $$;
revoke all on function public.update_trip_budget_rates(uuid,jsonb,boolean) from public, anon;
grant execute on function public.update_trip_budget_rates(uuid,jsonb,boolean) to authenticated;

create function app_private.apply_trip_budget_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_quote jsonb; v_rate numeric;
begin
  -- Lock-only updates must not reprice a draft or invalidate its baseline.
  if tg_op = 'UPDATE' and new.currency is not distinct from old.currency and new.amount is not distinct from old.amount
    and new.exchange_rate is not distinct from old.exchange_rate and new.twd_amount is not distinct from old.twd_amount then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.trip_id::text, 0));
  select budget_exchange_rates into v_quote from public.trips where id = new.trip_id;
  if v_quote ? 'rates' and new.currency <> 'TWD' then
    v_rate := (v_quote->'rates'->>new.currency)::numeric;
    if v_rate is null or v_rate <= 0 then raise exception 'Missing trip currency rate' using errcode = '22023'; end if;
    new.exchange_rate := v_rate; new.twd_amount := round(new.amount * v_rate);
  end if;
  return new;
end $$;
revoke all on function app_private.apply_trip_budget_rate() from public, anon, authenticated;
create trigger apply_trip_budget_rate before insert or update on public.budget_items
for each row execute function app_private.apply_trip_budget_rate();
commit;
