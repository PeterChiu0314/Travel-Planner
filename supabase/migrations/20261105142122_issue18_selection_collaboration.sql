-- Selection is an expiring hint; only expense group leases confer write authority.
create table expense_stage_b.selections (
 trip_id uuid not null references public.trips(id) on delete cascade,
 user_id uuid not null, session_id uuid not null, resource_id uuid not null,
 activity_id uuid not null, selected_at timestamptz not null, expires_at timestamptz not null,
 primary key(trip_id,user_id,session_id)
);
alter table expense_stage_b.selections enable row level security;
create index expense_selection_expiry_by_user on expense_stage_b.selections(user_id,expires_at);
revoke all on expense_stage_b.selections from public,anon,authenticated;

create function expense_stage_b.update_selection(p_trip_id uuid,p_session_id uuid,p_kind text,p_id uuid,p_activity_id uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();stamp timestamptz:=clock_timestamp();changed integer;
begin
 if actor is null or p_trip_id is null or p_session_id is null or p_action is null or p_action not in('select','refresh','clear') then raise exception 'Forbidden' using errcode='42501';end if;
 if p_action='clear' then
  update expense_stage_b.selections set expires_at=stamp where trip_id=p_trip_id and user_id=actor and session_id=p_session_id and activity_id=p_activity_id and expires_at>stamp;
  get diagnostics changed=row_count;
  if changed>0 then perform expense_stage_b.signal(p_trip_id);end if;
  return;
 end if;
 if not app_private.can_read_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_activity_id is null or p_kind is distinct from 'expense' or p_id is null then raise exception 'Invalid selection' using errcode='22023';end if;
 if not exists(select 1 from expense_stage_b.expense_items where id=p_id and trip_id=p_trip_id and deleted_at is null) then raise exception 'Record changed' using errcode='PT409';end if;
 if p_action='refresh' then
  update expense_stage_b.selections set expires_at=stamp+interval '45 seconds'
   where trip_id=p_trip_id and user_id=actor and session_id=p_session_id and activity_id=p_activity_id and resource_id=p_id;
  get diagnostics changed=row_count;
  if changed>0 then perform expense_stage_b.signal(p_trip_id);end if;
  return;
 end if;
 delete from expense_stage_b.selections where user_id=actor and expires_at<stamp-interval '1 day';
 insert into expense_stage_b.selections(trip_id,user_id,session_id,resource_id,activity_id,selected_at,expires_at)
  values(p_trip_id,actor,p_session_id,p_id,p_activity_id,stamp,stamp+interval '45 seconds')
  on conflict(trip_id,user_id,session_id) do update set resource_id=excluded.resource_id,activity_id=excluded.activity_id,expires_at=excluded.expires_at,
   selected_at=case when expense_stage_b.selections.activity_id=excluded.activity_id then expense_stage_b.selections.selected_at else excluded.selected_at end;
 perform expense_stage_b.signal(p_trip_id);
end $$;

create function expense_stage_b.read_collaboration(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('tripId',p_trip_id,'serverNow',current_timestamp,'selectionProtocol',2,'entries',coalesce((
  select jsonb_agg(to_jsonb(e) order by e.resource_id,e.user_id,e.mode) from (
   select 'expense'::text kind,i.id resource_id,g.actor user_id,g.expires_at,'edit'::text mode,
    (g.actor=auth.uid() and g.sid=p_session_id) own_session,null::timestamptz selected_at,g.group_key
   from expense_stage_b.groups g join expense_stage_b.expense_items i on i.id=g.expense_id
   where i.trip_id=p_trip_id and i.deleted_at is null and g.expires_at>current_timestamp and app_private.can_edit_trip(p_trip_id,g.actor)
   union all
   select 'expense'::text,s.resource_id,s.user_id,s.expires_at,'selection'::text,
    (s.user_id=auth.uid() and s.session_id=p_session_id),s.selected_at,null::text
   from expense_stage_b.selections s join expense_stage_b.expense_items i on i.id=s.resource_id and i.trip_id=s.trip_id
   where s.trip_id=p_trip_id and s.expires_at>current_timestamp and i.deleted_at is null and app_private.can_read_trip(p_trip_id,s.user_id)
  ) e
 ),'[]')) where auth.uid() is not null and app_private.can_read_trip(p_trip_id,auth.uid())
$$;
revoke all on function expense_stage_b.update_selection(uuid,uuid,text,uuid,uuid,text),expense_stage_b.read_collaboration(uuid,uuid) from public,anon,authenticated;
grant execute on function expense_stage_b.update_selection(uuid,uuid,text,uuid,uuid,text),expense_stage_b.read_collaboration(uuid,uuid) to authenticated;
create function public.update_expense_selection(p_trip_id uuid,p_session_id uuid,p_kind text,p_id uuid,p_activity_id uuid,p_action text)
returns void language sql security invoker set search_path='' as $$select expense_stage_b.update_selection(p_trip_id,p_session_id,p_kind,p_id,p_activity_id,p_action)$$;
create function public.read_expense_collaboration(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select expense_stage_b.read_collaboration(p_trip_id,p_session_id)$$;
revoke all on function public.update_expense_selection(uuid,uuid,text,uuid,uuid,text),public.read_expense_collaboration(uuid,uuid) from public,anon;
grant execute on function public.update_expense_selection(uuid,uuid,text,uuid,uuid,text),public.read_expense_collaboration(uuid,uuid) to authenticated;
