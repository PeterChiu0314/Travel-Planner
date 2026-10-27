-- Budget collaboration uses authenticated RPCs + RLS Postgres Changes only.
-- No public Broadcast/Presence, financial fields, session IDs or capabilities.
begin;
create table app_private.budget_selections (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null, kind text not null check(kind in ('budget','actual')),
  resource_id uuid not null, expires_at timestamptz not null,
  primary key(trip_id,user_id,session_id)
);
alter table app_private.budget_selections enable row level security;
revoke all on app_private.budget_selections from public,anon,authenticated;
create table public.budget_collaboration_signals (
  -- Retain the opaque revision after trip deletion: published DELETE events
  -- cannot enforce row visibility. No business data or resource/user ID here.
  trip_id uuid primary key,
  revision bigint not null default 1
);
alter table public.budget_collaboration_signals enable row level security;
revoke all on public.budget_collaboration_signals from public,anon,authenticated;
grant select on public.budget_collaboration_signals to authenticated;
create policy budget_collaboration_read on public.budget_collaboration_signals for select to authenticated
  using(app_private.can_read_trip(trip_id,(select auth.uid())));
alter table public.budget_collaboration_signals replica identity full;
alter publication supabase_realtime add table public.budget_collaboration_signals;

create function app_private.signal_budget_collaboration() returns trigger
language plpgsql security definer set search_path='' as $$
declare trip uuid;
begin
  trip:=case when tg_op='DELETE' then old.trip_id else new.trip_id end;
  -- Parent deletion must not resurrect a cascading trip signal.
  if exists(select 1 from public.trips where id=trip) then
    insert into public.budget_collaboration_signals(trip_id) values(trip)
      on conflict(trip_id) do update set revision=public.budget_collaboration_signals.revision+1;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function app_private.signal_budget_collaboration() from public,anon,authenticated;
create trigger budget_lease_signal after insert or update or delete on app_private.budget_edit_leases for each row execute function app_private.signal_budget_collaboration();
create trigger budget_selection_signal after insert or update or delete on app_private.budget_selections for each row execute function app_private.signal_budget_collaboration();

create function app_private.update_budget_selection(p_trip_id uuid,p_session_id uuid,p_kind text,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or p_session_id is null or p_trip_id is null then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_kind is null and p_id is null then
    delete from app_private.budget_selections where trip_id=p_trip_id and user_id=actor and session_id=p_session_id;
    return;
  end if;
  if not app_private.can_read_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  delete from app_private.budget_selections where trip_id=p_trip_id and user_id=actor and expires_at<=clock_timestamp();
  if p_kind is null or p_id is null or p_kind not in ('budget','actual') then raise exception 'Invalid selection' using errcode='22023'; end if;
  if not(case when p_kind='budget' then exists(select 1 from public.budget_items where id=p_id and trip_id=p_trip_id)
    else exists(select 1 from public.actual_expenses where id=p_id and trip_id=p_trip_id) end) then raise exception 'Record changed' using errcode='40001'; end if;
  insert into app_private.budget_selections(trip_id,user_id,session_id,kind,resource_id,expires_at)
    values(p_trip_id,actor,p_session_id,p_kind,p_id,clock_timestamp()+interval '45 seconds')
    on conflict(trip_id,user_id,session_id) do update set kind=excluded.kind,resource_id=excluded.resource_id,expires_at=excluded.expires_at;
end $$;
revoke all on function app_private.update_budget_selection(uuid,uuid,text,uuid) from public,anon;
grant execute on function app_private.update_budget_selection(uuid,uuid,text,uuid) to authenticated;
create function public.update_budget_selection(p_trip_id uuid,p_session_id uuid,p_kind text default null,p_id uuid default null)
returns void language sql security invoker set search_path='' as $$select app_private.update_budget_selection(p_trip_id,p_session_id,p_kind,p_id)$$;
revoke all on function public.update_budget_selection(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.update_budget_selection(uuid,uuid,text,uuid) to authenticated;

create function app_private.read_budget_collaboration(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('tripId',p_trip_id,'serverNow',current_timestamp,'entries',coalesce((
    select jsonb_agg(to_jsonb(e) order by e.kind,e.resource_id,e.user_id,e.mode) from (
      select l.kind,l.resource_id,l.user_id,l.expires_at,'edit'::text mode,(l.user_id=auth.uid() and l.session_id=p_session_id) own_session from app_private.budget_edit_leases l
        where l.trip_id=p_trip_id and l.expires_at>current_timestamp and app_private.can_edit_trip(p_trip_id,l.user_id)
      union all
      select s.kind,s.resource_id,s.user_id,s.expires_at,'selection'::text,(s.user_id=auth.uid() and s.session_id=p_session_id) from app_private.budget_selections s
        where s.trip_id=p_trip_id and s.expires_at>current_timestamp and app_private.can_read_trip(p_trip_id,s.user_id)
          and (case when s.kind='budget' then exists(select 1 from public.budget_items b where b.id=s.resource_id and b.trip_id=p_trip_id)
            else exists(select 1 from public.actual_expenses a where a.id=s.resource_id and a.trip_id=p_trip_id) end)
    ) e
  ),'[]')) where auth.uid() is not null and app_private.can_read_trip(p_trip_id,auth.uid())
$$;
revoke all on function app_private.read_budget_collaboration(uuid,uuid) from public,anon;
grant execute on function app_private.read_budget_collaboration(uuid,uuid) to authenticated;
create function public.read_budget_collaboration(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select app_private.read_budget_collaboration(p_trip_id,p_session_id)$$;
revoke all on function public.read_budget_collaboration(uuid,uuid) from public,anon;
grant execute on function public.read_budget_collaboration(uuid,uuid) to authenticated;
commit;
