-- Read-only preflight for the three NEW #10 migrations. Do not replay old ones.
select 'trips'::text object_name,count(*)::bigint row_count,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) digest from public.trips t
union all select 'trip_members',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.trip_members t
union all select 'budget_items',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.budget_items t
union all select 'budget_item_participants',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.budget_item_participants t
union all select 'actual_expenses',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.actual_expenses t
union all select 'actual_expense_participants',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.actual_expense_participants t
union all select 'itinerary_budget_items',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.itinerary_budget_items t
union all select 'trip_budget_baselines',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.trip_budget_baselines t
union all select 'attachments',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.attachments t
union all select 'luggage_items',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.luggage_items t
union all select 'shared_luggage_items',count(*),md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) from public.shared_luggage_items t;
