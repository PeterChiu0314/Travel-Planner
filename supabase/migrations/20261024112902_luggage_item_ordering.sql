-- Stable manual order; null keeps historical/new items after the ranked list.
alter table public.luggage_items add column sort_order integer;
alter table public.shared_luggage_items add column sort_order integer;

-- The complete visible scope manifest includes filtered-out items. A stale,
-- missing or locked record aborts the whole move, without partial renumbering.
create or replace function public.reorder_luggage_items(
  p_trip_id uuid, p_scope text, p_item_id uuid, p_target_id uuid,
  p_placement text, p_expected_items jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  table_name text;
  records jsonb;
  source jsonb;
  target jsonb;
  ids uuid[];
  next_ids uuid[];
  target_index integer;
  same_group boolean;
  result jsonb;
begin
  if actor is null or not app_private.can_read_trip(p_trip_id, actor) then
    raise exception 'luggage_forbidden' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('personal','shared') or p_placement is null
    or p_placement not in ('before','after') or p_item_id is null or p_target_id is null
    or jsonb_typeof(p_expected_items) is distinct from 'array' then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  table_name := case when p_scope = 'personal' then 'luggage_items' else 'shared_luggage_items' end;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text || ':' || p_scope || case when p_scope='personal' then actor::text else '' end, 0));
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.sort_order nulls last,t.created_at,t.id), ''[]''::jsonb) from
    (select * from public.%I where trip_id=$1 %s order by id for update) t', table_name,
    case when p_scope='personal' then 'and owner_id=$2 and shared_item_id is null and not is_shared_assigned_item' else '' end)
    into records using p_trip_id, actor;
  if jsonb_array_length(records) <> jsonb_array_length(p_expected_items)
    or (select count(distinct e->>'id') from jsonb_array_elements(p_expected_items) e) <> jsonb_array_length(records)
    or exists(select 1 from jsonb_array_elements(records) r where not exists(
      select 1 from jsonb_array_elements(p_expected_items) e where e->>'id'=r->>'id'
      and (e->>'updated_at')::timestamptz=(r->>'updated_at')::timestamptz)) then
    raise exception 'luggage_stale' using errcode='40001';
  end if;
  select r into source from jsonb_array_elements(records) r where r->>'id'=p_item_id::text;
  select r into target from jsonb_array_elements(records) r where r->>'id'=p_target_id::text;
  if source is null or target is null then raise exception 'luggage_not_found' using errcode='42501'; end if;
  if exists(select 1 from jsonb_array_elements(records) r where r->>'locked_by' is not null
    and r->>'locked_by' <> actor::text and (r->>'locked_at')::timestamptz > clock_timestamp()-interval '7 minutes') then
    raise exception 'luggage_locked' using errcode='55P03';
  end if;
  select array_agg((r->>'id')::uuid order by ord) into ids from jsonb_array_elements(records) with ordinality e(r,ord);
  next_ids := array_remove(ids,p_item_id);
  target_index := array_position(next_ids,p_target_id);
  if p_item_id=p_target_id then return records; end if;
  if p_placement='after' then target_index:=target_index+1; end if;
  next_ids := coalesce(next_ids[1:target_index-1],'{}'::uuid[]) || array[p_item_id] || coalesce(next_ids[target_index:cardinality(next_ids)],'{}'::uuid[]);
  same_group := case when p_scope='personal' then coalesce(source->>'category','')=coalesce(target->>'category','')
    else source->>'assigned_to' is not distinct from target->>'assigned_to' end;
  if ids=next_ids and same_group then return records; end if;
  if not same_group then
    if p_scope='personal' then
      perform public.mutate_luggage_item(p_trip_id,'personal','save',p_item_id,(source->>'updated_at')::timestamptz,
        jsonb_build_object('title',source->>'title','notes',source->>'notes','category',coalesce(target->>'category','')));
    else
      perform public.assign_luggage_item(p_trip_id,'shared',p_item_id,(source->>'updated_at')::timestamptz,(target->>'assigned_to')::uuid);
    end if;
  end if;
  execute format('update public.%I t set sort_order=o.ord::integer from unnest($1::uuid[]) with ordinality o(id,ord)
    where t.id=o.id and t.trip_id=$2 and t.sort_order is distinct from o.ord::integer',table_name) using next_ids,p_trip_id;
  execute format('select jsonb_agg(to_jsonb(t) order by t.sort_order,t.created_at,t.id) from public.%I t where t.id=any($1::uuid[]) and t.trip_id=$2',table_name)
    into result using next_ids,p_trip_id;
  return result;
end;
$$;
revoke all on function public.reorder_luggage_items(uuid,text,uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.reorder_luggage_items(uuid,text,uuid,uuid,text,jsonb) to authenticated;
