-- Budget/Actual only. Lease heartbeats never UPDATE financial records.
begin;
create table app_private.budget_edit_leases (
  kind text not null check(kind in ('budget','actual')), resource_id uuid not null,
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null, token_hash bytea not null, expires_at timestamptz not null,
  primary key(kind,resource_id)
);
alter table app_private.budget_edit_leases enable row level security;
revoke all on app_private.budget_edit_leases from public,anon,authenticated;
create index budget_edit_leases_trip on app_private.budget_edit_leases(trip_id);

-- The private helper elevates access to lease metadata only. Public financial
-- writes still use invoker/RLS RPCs. No plaintext capability is stored/published.
create function app_private.budget_edit_lease_action(p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rec jsonb; trip uuid; held app_private.budget_edit_leases; stamp timestamptz;
begin
  if actor is null or p_session_id is null or p_token is null or p_id is null or p_kind is null or p_action is null
    or p_kind not in ('budget','actual') or p_action not in ('acquire','renew','release') then
    raise exception 'Invalid lease request' using errcode='42501';
  end if;
  -- A revoked member may release its own capability without reading trip data.
  if p_action='release' then
    delete from app_private.budget_edit_leases where kind=p_kind and resource_id=p_id
      and user_id=actor and session_id=p_session_id and token_hash=sha256(convert_to(p_token::text,'UTF8'));
    return jsonb_build_object('granted',true);
  end if;
  if p_kind='budget' then select to_jsonb(b) into rec from public.budget_items b where id=p_id;
  else select to_jsonb(e) into rec from public.actual_expenses e where id=p_id; end if;
  trip:=(rec->>'trip_id')::uuid;
  if trip is null or not app_private.can_edit_trip(trip,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(trip::text,0));
  if p_kind='budget' then select to_jsonb(b) into rec from public.budget_items b where id=p_id and trip_id=trip;
  else select to_jsonb(e) into rec from public.actual_expenses e where id=p_id and trip_id=trip; end if;
  if rec is null or not app_private.can_edit_trip(trip,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  stamp:=clock_timestamp();
  select * into held from app_private.budget_edit_leases where kind=p_kind and resource_id=p_id for update;
  if p_action='renew' then
    if held.user_id is distinct from actor or held.session_id is distinct from p_session_id
      or held.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) or held.expires_at<=stamp then
      return jsonb_build_object('granted',false,'reason','lease_lost');
    end if;
  else
    if p_base_updated_at is null or p_base_updated_at is distinct from (rec->>'updated_at')::timestamptz then
      raise exception 'Record changed' using errcode='40001';
    end if;
    if held.expires_at>stamp and (held.user_id is distinct from actor or held.session_id is distinct from p_session_id
      or held.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8'))) then
      return jsonb_build_object('granted',false,'reason','locked','owner_id',held.user_id,'expires_at',held.expires_at);
    end if;
    -- Do not silently steal an active legacy lock, even from the same account.
    if nullif(rec->>'locked_by','') is not null and (rec->>'locked_at')::timestamptz>stamp-interval '7 minutes' then
      return jsonb_build_object('granted',false,'reason','legacy_locked','owner_id',rec->>'locked_by');
    end if;
  end if;
  insert into app_private.budget_edit_leases(kind,resource_id,trip_id,user_id,session_id,token_hash,expires_at)
    values(p_kind,p_id,trip,actor,p_session_id,sha256(convert_to(p_token::text,'UTF8')),stamp+interval '7 minutes')
    on conflict(kind,resource_id) do update set user_id=excluded.user_id,session_id=excluded.session_id,
      token_hash=excluded.token_hash,expires_at=excluded.expires_at,trip_id=excluded.trip_id;
  return jsonb_build_object('granted',true,'record',rec,'expires_at',stamp+interval '7 minutes');
end $$;
revoke all on function app_private.budget_edit_lease_action(text,uuid,uuid,uuid,text,timestamptz) from public,anon;
grant execute on function app_private.budget_edit_lease_action(text,uuid,uuid,uuid,text,timestamptz) to authenticated;
create function public.budget_edit_lease(p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_updated_at timestamptz default null)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.budget_edit_lease_action(p_kind,p_id,p_session_id,p_token,p_action,p_base_updated_at)
$$;
revoke all on function public.budget_edit_lease(text,uuid,uuid,uuid,text,timestamptz) from public,anon;
grant execute on function public.budget_edit_lease(text,uuid,uuid,uuid,text,timestamptz) to authenticated;

create function app_private.assert_budget_edit_lease(p_kind text,p_id uuid,p_required boolean default false,p_session_id uuid default null,p_token uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare held app_private.budget_edit_leases; trip uuid; actor uuid:=auth.uid();
begin
  -- Only privileged administrative sessions bypass leases; unauthenticated API
  -- roles do not. Existing RLS/EXECUTE permissions still govern the mutation.
  if actor is null and current_setting('role') in ('none','postgres','service_role') then return; end if;
  if actor is null or p_kind is null or p_kind not in ('budget','actual') then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_kind='budget' then select trip_id into trip from public.budget_items where id=p_id;
  else select trip_id into trip from public.actual_expenses where id=p_id; end if;
  if trip is not null then
    if not app_private.can_edit_trip(trip,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended(trip::text,0));
  end if;
  select * into held from app_private.budget_edit_leases where kind=p_kind and resource_id=p_id;
  if not p_required and (held.resource_id is null or held.expires_at<=clock_timestamp()) then return; end if;
  if held.resource_id is null or held.expires_at<=clock_timestamp() or held.user_id is distinct from actor
    or held.session_id is distinct from p_session_id or p_token is null
    or held.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) then
    raise exception '編輯權限已到期或由另一分頁持有，草稿已保留。' using errcode='55P03';
  end if;
end $$;
revoke all on function app_private.assert_budget_edit_lease(text,uuid,boolean,uuid,uuid) from public,anon;
grant execute on function app_private.assert_budget_edit_lease(text,uuid,boolean,uuid,uuid) to authenticated;

create function app_private.guard_budget_edit_lease() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_data jsonb; new_data jsonb; k text; ids uuid[]:='{}'; resource uuid;
  context_kind text:=current_setting('app.budget_edit_kind',true);
  context_id text:=current_setting('app.budget_edit_id',true);
  sid uuid:=nullif(current_setting('app.budget_edit_session',true),'')::uuid;
  token uuid:=nullif(current_setting('app.budget_edit_token',true),'')::uuid;
begin
  if tg_op<>'INSERT' then old_data:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then new_data:=to_jsonb(new); end if;
  if tg_table_name in ('budget_items','actual_expenses') then
    k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
    ids:=array[coalesce(old_data->>'id',new_data->>'id')::uuid];
  elsif tg_table_name in ('budget_item_participants','itinerary_budget_items') then
    k:='budget'; ids:=array[(old_data->>'budget_item_id')::uuid,(new_data->>'budget_item_id')::uuid];
  elsif tg_table_name='actual_expense_participants' then
    k:='actual'; ids:=array[(old_data->>'actual_expense_id')::uuid,(new_data->>'actual_expense_id')::uuid];
  else
    k:='actual';
    if old_data->>'target_type'='actual_expense' then ids:=array_append(ids,(old_data->>'target_id')::uuid); end if;
    if new_data->>'target_type'='actual_expense' then ids:=array_append(ids,(new_data->>'target_id')::uuid); end if;
  end if;
  for resource in select distinct x from unnest(ids) x where x is not null order by x loop
    perform app_private.assert_budget_edit_lease(k,resource,false,
      case when context_kind=k and context_id=resource::text then sid else null end,
      case when context_kind=k and context_id=resource::text then token else null end);
  end loop;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function app_private.guard_budget_edit_lease() from public,anon,authenticated;
create trigger budget_edit_lease_guard before update or delete on public.budget_items for each row execute function app_private.guard_budget_edit_lease();
create trigger actual_edit_lease_guard before update or delete on public.actual_expenses for each row execute function app_private.guard_budget_edit_lease();
create trigger budget_people_lease_guard before insert or update or delete on public.budget_item_participants for each row execute function app_private.guard_budget_edit_lease();
create trigger actual_people_lease_guard before insert or update or delete on public.actual_expense_participants for each row execute function app_private.guard_budget_edit_lease();
create trigger budget_links_lease_guard before insert or update or delete on public.itinerary_budget_items for each row execute function app_private.guard_budget_edit_lease();
create trigger budget_receipts_lease_guard before insert or update or delete on public.attachments for each row execute function app_private.guard_budget_edit_lease();

create function app_private.cleanup_budget_edit_lease() returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from app_private.budget_edit_leases where kind=case when tg_table_name='budget_items' then 'budget' else 'actual' end and resource_id=old.id;
  return old;
end $$;
revoke all on function app_private.cleanup_budget_edit_lease() from public,anon,authenticated;
create trigger budget_edit_lease_cleanup after delete on public.budget_items for each row execute function app_private.cleanup_budget_edit_lease();
create trigger actual_edit_lease_cleanup after delete on public.actual_expenses for each row execute function app_private.cleanup_budget_edit_lease();

-- New clients require an exact capability at the final write boundary. Existing
-- RPC signatures stay intact; their DML is also blocked by an active new lease.
create function public.save_budget_workspace_record_v4(p_trip_id uuid,p_kind text,p_id uuid,p_base_updated_at timestamptz,p_payload jsonb,p_request_id uuid,p_edit_session_id uuid default null,p_edit_token uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  if p_id is not null then perform app_private.assert_budget_edit_lease(p_kind,p_id,true,p_edit_session_id,p_edit_token); end if;
  perform set_config('app.budget_edit_kind',p_kind,true); perform set_config('app.budget_edit_id',coalesce(p_id::text,''),true);
  perform set_config('app.budget_edit_session',coalesce(p_edit_session_id::text,''),true); perform set_config('app.budget_edit_token',coalesce(p_edit_token::text,''),true);
  if p_kind='budget' and coalesce((p_payload->>'unified_planning')::boolean,false) then
    return public.save_budget_workspace_record_v3(p_trip_id,p_kind,p_id,p_base_updated_at,p_payload,p_request_id);
  end if;
  return public.save_budget_workspace_record_v2(p_trip_id,p_kind,p_id,p_base_updated_at,p_payload,p_request_id);
end $$;
revoke all on function public.save_budget_workspace_record_v4(uuid,text,uuid,timestamptz,jsonb,uuid,uuid,uuid) from public,anon;
grant execute on function public.save_budget_workspace_record_v4(uuid,text,uuid,timestamptz,jsonb,uuid,uuid,uuid) to authenticated;
create function public.delete_budget_workspace_record_v2(p_trip_id uuid,p_kind text,p_id uuid,p_base_updated_at timestamptz,p_edit_session_id uuid,p_edit_token uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  perform app_private.assert_budget_edit_lease(p_kind,p_id,true,p_edit_session_id,p_edit_token);
  perform set_config('app.budget_edit_kind',p_kind,true); perform set_config('app.budget_edit_id',p_id::text,true);
  perform set_config('app.budget_edit_session',p_edit_session_id::text,true); perform set_config('app.budget_edit_token',p_edit_token::text,true);
  perform public.delete_budget_workspace_record(p_trip_id,p_kind,p_id,p_base_updated_at);
end $$;
revoke all on function public.delete_budget_workspace_record_v2(uuid,text,uuid,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.delete_budget_workspace_record_v2(uuid,text,uuid,timestamptz,uuid,uuid) to authenticated;
-- Receipt metadata participates in the same Actual capability. Storage byte
-- deletion must follow this transaction's successful metadata deletion.
create function public.mutate_budget_receipt(p_trip_id uuid,p_actual_id uuid,p_action text,p_receipt jsonb,p_edit_session_id uuid,p_edit_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare rec public.attachments;
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  if not exists(select 1 from public.actual_expenses where id=p_actual_id and trip_id=p_trip_id) then raise exception 'Expense missing' using errcode='40001'; end if;
  perform app_private.assert_budget_edit_lease('actual',p_actual_id,true,p_edit_session_id,p_edit_token);
  perform set_config('app.budget_edit_kind','actual',true); perform set_config('app.budget_edit_id',p_actual_id::text,true);
  perform set_config('app.budget_edit_session',p_edit_session_id::text,true); perform set_config('app.budget_edit_token',p_edit_token::text,true);
  if p_action='insert' then
    if coalesce(p_receipt->>'file_url','') not like 'trips/'||p_trip_id::text||'/attachments/actual_expense/'||p_actual_id::text||'/%'
      or nullif(p_receipt->>'file_name','') is null or coalesce((p_receipt->>'file_size')::bigint,-1) not between 0 and 10485760 then
      raise exception 'Invalid receipt' using errcode='22023';
    end if;
    insert into public.attachments(trip_id,target_type,target_id,file_name,file_url,file_type,file_size,uploaded_by)
      values(p_trip_id,'actual_expense',p_actual_id,p_receipt->>'file_name',p_receipt->>'file_url',p_receipt->>'file_type',(p_receipt->>'file_size')::bigint,auth.uid()) returning * into rec;
  elsif p_action='delete' then
    delete from public.attachments where id=(p_receipt->>'id')::uuid and trip_id=p_trip_id and target_type='actual_expense' and target_id=p_actual_id returning * into rec;
    if not found then raise exception 'Receipt changed' using errcode='40001'; end if;
  else raise exception 'Invalid action' using errcode='22023'; end if;
  return to_jsonb(rec);
end $$;
revoke all on function public.mutate_budget_receipt(uuid,uuid,text,jsonb,uuid,uuid) from public,anon;
grant execute on function public.mutate_budget_receipt(uuid,uuid,text,jsonb,uuid,uuid) to authenticated;
commit;
