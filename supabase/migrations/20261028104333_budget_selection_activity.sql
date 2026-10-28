-- Budget-only selection ordering. Does not change financial rows or edit authority.
begin;
alter table app_private.budget_selections add column activity_id uuid, add column selected_at timestamptz;

create function app_private.update_budget_selection_v2(p_trip_id uuid,p_session_id uuid,p_kind text,p_id uuid,p_activity_id uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); stamp timestamptz:=clock_timestamp();
begin
  if actor is null or p_trip_id is null or p_session_id is null or p_action is null or p_action not in ('select','refresh','clear') then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_action='clear' then
    -- Keep this session's activity identity across hiding/reconnecting. No new action time.
    update app_private.budget_selections set expires_at=stamp
      where trip_id=p_trip_id and user_id=actor and session_id=p_session_id and activity_id=p_activity_id;
    return;
  end if;
  if not app_private.can_read_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_activity_id is null or p_kind is null or p_kind not in ('budget','actual') or p_id is null then raise exception 'Invalid selection' using errcode='22023'; end if;
  if not(case when p_kind='budget' then exists(select 1 from public.budget_items where id=p_id and trip_id=p_trip_id)
    else exists(select 1 from public.actual_expenses where id=p_id and trip_id=p_trip_id) end) then raise exception 'Record changed' using errcode='40001'; end if;
  if p_action='refresh' then
    update app_private.budget_selections set expires_at=stamp+interval '45 seconds'
      where trip_id=p_trip_id and user_id=actor and session_id=p_session_id and activity_id=p_activity_id and kind=p_kind and resource_id=p_id;
    return;
  end if;
  -- Only expired hints older than a day; never remove another user's state.
  delete from app_private.budget_selections where trip_id=p_trip_id and user_id=actor and expires_at<stamp-interval '1 day';
  insert into app_private.budget_selections(trip_id,user_id,session_id,kind,resource_id,expires_at,activity_id,selected_at)
    values(p_trip_id,actor,p_session_id,p_kind,p_id,stamp+interval '45 seconds',p_activity_id,stamp)
    on conflict(trip_id,user_id,session_id) do update set kind=excluded.kind,resource_id=excluded.resource_id,expires_at=excluded.expires_at,
      selected_at=case when app_private.budget_selections.activity_id=excluded.activity_id then app_private.budget_selections.selected_at else excluded.selected_at end,
      activity_id=excluded.activity_id;
end $$;
revoke all on function app_private.update_budget_selection_v2(uuid,uuid,text,uuid,uuid,text) from public,anon;
grant execute on function app_private.update_budget_selection_v2(uuid,uuid,text,uuid,uuid,text) to authenticated;
create function public.update_budget_selection_v2(p_trip_id uuid,p_session_id uuid,p_kind text,p_id uuid,p_activity_id uuid,p_action text)
returns void language sql security invoker set search_path='' as $$select app_private.update_budget_selection_v2(p_trip_id,p_session_id,p_kind,p_id,p_activity_id,p_action)$$;
revoke all on function public.update_budget_selection_v2(uuid,uuid,text,uuid,uuid,text) from public,anon;
grant execute on function public.update_budget_selection_v2(uuid,uuid,text,uuid,uuid,text) to authenticated;

create or replace function app_private.read_budget_collaboration(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('tripId',p_trip_id,'serverNow',current_timestamp,'selectionProtocol',2,'entries',coalesce((
    select jsonb_agg(to_jsonb(e) order by e.kind,e.resource_id,e.user_id,e.mode) from (
      select l.kind,l.resource_id,l.user_id,l.expires_at,'edit'::text mode,(l.user_id=auth.uid() and l.session_id=p_session_id) own_session,null::timestamptz selected_at from app_private.budget_edit_leases l
        where l.trip_id=p_trip_id and l.expires_at>current_timestamp and app_private.can_edit_trip(p_trip_id,l.user_id)
      union all
      select s.kind,s.resource_id,s.user_id,s.expires_at,'selection'::text,(s.user_id=auth.uid() and s.session_id=p_session_id),s.selected_at from app_private.budget_selections s
        where s.trip_id=p_trip_id and s.expires_at>current_timestamp and app_private.can_read_trip(p_trip_id,s.user_id)
          and (case when s.kind='budget' then exists(select 1 from public.budget_items b where b.id=s.resource_id and b.trip_id=p_trip_id)
            else exists(select 1 from public.actual_expenses a where a.id=s.resource_id and a.trip_id=p_trip_id) end)
    ) e
  ),'[]')) where auth.uid() is not null and app_private.can_read_trip(p_trip_id,auth.uid())
$$;
-- Existing invoker wrapper / permissions remain, including old clients' v1 write API.
commit;
