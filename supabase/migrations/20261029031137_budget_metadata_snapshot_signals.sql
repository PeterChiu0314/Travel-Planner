-- Local-only continuation of the dormant title/note prototype, not full groups v2.
begin;

-- Reuse the opaque, RLS-filtered published signal. Never publish private rows.
create function app_private.signal_budget_metadata_state() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_trip uuid; new_trip uuid;
begin
  if tg_op<>'INSERT' then old_trip:=old.trip_id; end if;
  if tg_op<>'DELETE' then new_trip:=new.trip_id; end if;
  -- Notify both scopes on a move; skip cascading trip deletion and never DELETE
  -- a published signal. Sorting also makes the two-signal lock order explicit.
  insert into public.budget_collaboration_signals(trip_id)
    select t.id from public.trips t where t.id in (old_trip,new_trip) order by t.id
    on conflict(trip_id) do update set revision=public.budget_collaboration_signals.revision+1;
  return null;
end $$;
revoke all on function app_private.signal_budget_metadata_state() from public,anon,authenticated;
create trigger budget_metadata_group_signal
after insert or update or delete on app_private.budget_metadata_groups
for each row execute function app_private.signal_budget_metadata_state();
create trigger budget_metadata_member_signal
after insert or update of role,status,user_id,trip_id or delete on public.trip_members
for each row execute function app_private.signal_budget_metadata_state();

create function app_private.signal_budget_metadata_protocol() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.enabled is distinct from old.enabled then
    insert into public.budget_collaboration_signals(trip_id)
      select distinct g.trip_id from app_private.budget_metadata_groups g
      join public.trips t on t.id=g.trip_id order by g.trip_id
      on conflict(trip_id) do update set revision=public.budget_collaboration_signals.revision+1;
  end if;
  return null;
end $$;
revoke all on function app_private.signal_budget_metadata_protocol() from public,anon,authenticated;
create trigger budget_metadata_protocol_signal after update on app_private.budget_metadata_protocol
for each row execute function app_private.signal_budget_metadata_protocol();

-- This projection is the only additional definer read. It checks membership and
-- scopes every canonical/private join to that trip, with a fixed output whitelist.
create function app_private.read_budget_metadata_state(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with allowed as materialized (
    select p_trip_id id where auth.uid() is not null
      and app_private.can_read_trip(p_trip_id,auth.uid())
  ), resources as materialized (
    select 'budget'::text kind,b.id,b.trip_id,b.title,b.note,
      app_private.budget_metadata_supported('budget',b.id) supported
      from public.budget_items b join allowed t on b.trip_id=t.id
    union all
    select 'actual',a.id,a.trip_id,a.title,a.note,
      app_private.budget_metadata_supported('actual',a.id)
      from public.actual_expenses a join allowed t on a.trip_id=t.id
  ), states as materialized (
    select r.kind,r.id,r.trip_id,r.supported,k.group_key,
      case when k.group_key='title' then to_jsonb(r.title) else to_jsonb(r.note) end value,
      g.revision,g.lease_epoch epoch,
      coalesce(not g.is_deleted and g.user_id is not null and g.expires_at>statement_timestamp()
        and app_private.can_edit_trip(r.trip_id,g.user_id),false) held,
      g.user_id,g.session_id,g.expires_at
    from resources r cross join unnest(array['title','note']) k(group_key)
    left join app_private.budget_metadata_groups g on g.kind=r.kind and g.resource_id=r.id
      and g.group_key=k.group_key and g.trip_id=r.trip_id and not g.is_deleted
  ), records as (
    select kind,id,trip_id,bool_and(supported) supported,
      bool_and(revision is not null) state_ready,
      jsonb_agg(jsonb_build_object('group',group_key,'value',value,'revision',revision,'epoch',epoch,
        'held',held,'owner_id',case when held then user_id end,
        'own_session',coalesce(held and user_id=auth.uid() and session_id=p_session_id,false),
        'expires_at',case when held then expires_at end) order by group_key) groups
    from states group by kind,id,trip_id
  )
  select jsonb_build_object('protocol',jsonb_build_object('name','metadata-prototype','schemaVersion',1,
      'enabled',app_private.budget_metadata_enabled(),'complete',false,'groups',jsonb_build_array('title','note')),
    'records',coalesce((select jsonb_agg(to_jsonb(r) order by r.kind,r.id) from records r),'[]'),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('kind',s.kind,'resource_id',s.id,
      'group_key',s.group_key,'user_id',s.user_id,'expires_at',s.expires_at,'mode','edit',
      'own_session',coalesce(s.user_id=auth.uid() and s.session_id=p_session_id,false),
      'selected_at',null) order by s.kind,s.id,s.group_key) from states s where s.held),'[]'))
  from allowed
$$;
revoke all on function app_private.read_budget_metadata_state(uuid,uuid) from public,anon;
grant execute on function app_private.read_budget_metadata_state(uuid,uuid) to authenticated;

-- Old readers and #14 selection ordering remain byte-for-byte unchanged.
-- STABLE throughout: graph, group revisions/values, leases and signal revision
-- share the calling statement's MVCC snapshot, even across concurrent commits.
create function public.read_budget_metadata_snapshot(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with financial as materialized (
    select public.read_budget_snapshot(p_trip_id) data
  ), metadata as materialized (
    select app_private.read_budget_metadata_state(p_trip_id,p_session_id) data
  ), legacy as materialized (
    select public.read_budget_collaboration(p_trip_id,p_session_id) data
  ), entries as materialized (
    select e.value from legacy l cross join lateral jsonb_array_elements(l.data->'entries') e
      where (e.value->>'expires_at')::timestamptz>statement_timestamp()
    union all
    select e.value from metadata m cross join lateral jsonb_array_elements(m.data->'entries') e
  )
  select f.data || jsonb_build_object('metadataProtocol',m.data->'protocol','metadataRecords',m.data->'records',
    'serverNow',statement_timestamp(),
    'collaborationRevision',coalesce((select s.revision from public.budget_collaboration_signals s where s.trip_id=p_trip_id),0),
    'nextRefreshAt',(select min((value->>'expires_at')::timestamptz) from entries),
    'collaboration',l.data || jsonb_build_object('groupProtocol','metadata-prototype',
      'serverNow',statement_timestamp(),'entries',coalesce((select jsonb_agg(value order by value->>'kind',
        value->>'resource_id',value->>'group_key',value->>'user_id',value->>'mode') from entries),'[]')))
  from financial f cross join metadata m cross join legacy l
  where f.data is not null and m.data is not null and l.data is not null
$$;
revoke all on function public.read_budget_metadata_snapshot(uuid,uuid) from public,anon;
grant execute on function public.read_budget_metadata_snapshot(uuid,uuid) to authenticated;
commit;
