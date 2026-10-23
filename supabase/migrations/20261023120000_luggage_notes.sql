-- Additive optional notes. Existing RLS, trip isolation, exact versions and locks remain.
-- Notes are descriptive metadata: changing only notes does not reset packing.
alter table public.luggage_items add column if not exists notes text;
alter table public.shared_luggage_items add column if not exists notes text;
alter table public.luggage_items add constraint luggage_notes_length check (char_length(notes) <= 1000);
alter table public.shared_luggage_items add constraint shared_luggage_notes_length check (char_length(notes) <= 1000);

create or replace function public.mutate_luggage_item(
  p_trip_id uuid, p_scope text, p_action text, p_item_id uuid default null,
  p_expected_updated_at timestamptz default null, p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  actor uuid := auth.uid();
  personal public.luggage_items%rowtype;
  shared public.shared_luggage_items%rowtype;
  current_record jsonb;
  output_record jsonb;
  allowed_keys text[];
begin
  if actor is null or not app_private.can_read_trip(p_trip_id, actor) then
    raise exception 'luggage_forbidden' using errcode = '42501';
  end if;
  if p_scope not in ('personal', 'shared') or p_action not in ('save', 'patch', 'delete')
    or p_scope is null or p_action is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;
  if p_action = 'save' then
    allowed_keys := case when p_scope = 'shared' then array['title','category','assigned_to','notes'] else array['title','category','notes'] end;
    if nullif(btrim(p_payload->>'title'), '') is null then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
  elsif p_action = 'patch' then
    allowed_keys := case when p_scope = 'shared' then array['packed_by_assignee','confirmed_by_owner'] else array['packed'] end;
    if (select count(*) from jsonb_object_keys(p_payload)) <> 1 then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
    if exists(select 1 from jsonb_each(p_payload) as e where jsonb_typeof(e.value) <> 'boolean') then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
  else allowed_keys := array[]::text[];
  end if;
  if exists(select 1 from jsonb_object_keys(p_payload) as k where not (k = any(allowed_keys))) then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;

  if p_payload ? 'notes' and (jsonb_typeof(p_payload->'notes') not in ('string','null') or char_length(p_payload->>'notes') > 1000) then
    raise exception 'luggage_invalid_payload' using errcode = '22023';
  end if;

  if p_item_id is null then
    if p_action <> 'save' or p_expected_updated_at is not null then
      raise exception 'luggage_invalid_payload' using errcode = '22023';
    end if;
    if p_scope = 'personal' then
      insert into public.luggage_items(trip_id,owner_id,title,category,notes)
      values(p_trip_id,actor,btrim(p_payload->>'title'),nullif(btrim(p_payload->>'category'),''),nullif(btrim(p_payload->>'notes'),'')) returning to_jsonb(luggage_items.*) into output_record;
    else
      insert into public.shared_luggage_items(trip_id,title,category,assigned_to,notes)
      values(p_trip_id,btrim(p_payload->>'title'),nullif(btrim(p_payload->>'category'),''),nullif(p_payload->>'assigned_to','')::uuid,nullif(btrim(p_payload->>'notes'),'')) returning to_jsonb(shared_luggage_items.*) into output_record;
    end if;
    return output_record;
  end if;

  if p_scope = 'personal' then
    select * into personal from public.luggage_items where id = p_item_id and trip_id = p_trip_id for update;
    if not found or personal.owner_id <> actor then raise exception 'luggage_not_found' using errcode = '42501'; end if;
    if personal.shared_item_id is not null then raise exception 'luggage_invalid_payload' using errcode = '22023'; end if;
    current_record := to_jsonb(personal);
  else
    select * into shared from public.shared_luggage_items where id = p_item_id and trip_id = p_trip_id for update;
    if not found then raise exception 'luggage_not_found' using errcode = '42501'; end if;
    current_record := to_jsonb(shared);
  end if;
  if p_expected_updated_at is null or (current_record->>'updated_at')::timestamptz <> p_expected_updated_at then
    raise exception 'luggage_stale' using errcode = '40001';
  end if;
  if nullif(current_record->>'locked_by','')::uuid <> actor
    and (current_record->>'locked_at')::timestamptz > clock_timestamp() - interval '7 minutes' then
    raise exception 'luggage_locked' using errcode = '55P03';
  end if;
  if p_action = 'delete' then
    if p_scope = 'personal' then delete from public.luggage_items where id = p_item_id;
    else delete from public.shared_luggage_items where id = p_item_id; end if;
    return current_record;
  end if;
  if p_scope = 'personal' then
    if p_action = 'save' then
      update public.luggage_items set title=btrim(p_payload->>'title'),category=nullif(btrim(p_payload->>'category'),''),notes=case when p_payload ? 'notes' then nullif(btrim(p_payload->>'notes'),'') else notes end,locked_by=null,locked_at=null
      where id=p_item_id returning to_jsonb(luggage_items.*) into output_record;
    else
      update public.luggage_items set packed=(p_payload->>'packed')::boolean where id=p_item_id returning to_jsonb(luggage_items.*) into output_record;
    end if;
  else
    if p_action = 'save' then
      update public.shared_luggage_items set title=btrim(p_payload->>'title'),category=nullif(btrim(p_payload->>'category'),''),assigned_to=nullif(p_payload->>'assigned_to','')::uuid,notes=case when p_payload ? 'notes' then nullif(btrim(p_payload->>'notes'),'') else notes end,locked_by=null,locked_at=null
      where id=p_item_id returning to_jsonb(shared_luggage_items.*) into output_record;
    elsif p_payload ? 'packed_by_assignee' then
      update public.shared_luggage_items set packed_by_assignee=(p_payload->>'packed_by_assignee')::boolean where id=p_item_id returning to_jsonb(shared_luggage_items.*) into output_record;
    else
      update public.shared_luggage_items set confirmed_by_owner=(p_payload->>'confirmed_by_owner')::boolean where id=p_item_id returning to_jsonb(shared_luggage_items.*) into output_record;
    end if;
  end if;
  return output_record;
end;
$$;
revoke all on function public.mutate_luggage_item(uuid,text,text,uuid,timestamptz,jsonb) from public, anon;
grant execute on function public.mutate_luggage_item(uuid,text,text,uuid,timestamptz,jsonb) to authenticated;
