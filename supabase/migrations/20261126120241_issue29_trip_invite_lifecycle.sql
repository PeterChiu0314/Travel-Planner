alter table public.trip_invites add column expires_at timestamptz;
update public.trip_invites
set expires_at = created_at + interval '168 hours',
    revoked_at = coalesce(revoked_at, statement_timestamp());
alter table public.trip_invites alter column expires_at set not null;
alter table public.trip_invites add constraint trip_invites_seven_days
  check (expires_at = created_at + interval '168 hours');
create unique index trip_invites_one_unrevoked on public.trip_invites(trip_id) where revoked_at is null;

-- Only the owner-checked RPC can expose tokens or change their lifecycle.
revoke all privileges on public.trip_invites from public, anon, authenticated;

create function public.manage_trip_invite(p_trip_id uuid, p_action text, p_previous_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  invitation public.trip_invites;
  issued_at timestamptz;
begin
  if p_action is null or p_action not in ('read','create','rotate')
     or (p_action = 'rotate' and p_previous_token is null) then
    raise exception 'Invalid invite action' using errcode = '22023';
  end if;
  if auth.uid() is null or app_private.is_trip_owner(p_trip_id, auth.uid()) is not true
     or app_private.approved_trip_role(p_trip_id, auth.uid()) is distinct from 'owner' then
    raise exception 'Invite management requires an approved owner' using errcode = '42501';
  end if;
  -- Serialize even when there is no invite row to lock.
  perform 1 from public.trips t where t.id = p_trip_id
    and t.status is distinct from 'settled'
    and (t.start_date is null or t.end_date is null or t.end_date >= (now() at time zone 'Asia/Taipei')::date)
    for no key update;
  if not found then
    raise exception '旅程已進入結算階段，無法邀請或管理成員。' using errcode = '42501';
  end if;
  issued_at := clock_timestamp();
  select i.* into invitation from public.trip_invites i
    where i.trip_id = p_trip_id and i.revoked_at is null and i.expires_at > issued_at;
  if p_action = 'read' and invitation.id is null then return null; end if;
  -- Two rotations based on the same old URL converge on the first replacement.
  if p_action <> 'read' and (invitation.id is null or
      (p_action = 'rotate' and invitation.token = p_previous_token)) then
    update public.trip_invites set revoked_at = issued_at where trip_id = p_trip_id and revoked_at is null;
    insert into public.trip_invites(trip_id, token, created_at, expires_at)
      values (p_trip_id, gen_random_uuid()::text, issued_at, issued_at + interval '168 hours')
      returning * into invitation;
  end if;
  return jsonb_build_object('token', invitation.token, 'expires_at', invitation.expires_at, 'server_time', issued_at);
end;
$$;
revoke all on function public.manage_trip_invite(uuid,text,text) from public, anon;
grant execute on function public.manage_trip_invite(uuid,text,text) to authenticated;

create or replace function public.request_trip_membership(invite_token text, member_display_name text, member_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target_trip_id uuid;
begin
  select i.trip_id into target_trip_id from public.trip_invites i
    where i.token = invite_token and i.revoked_at is null and i.expires_at > clock_timestamp()
    for share;
  if target_trip_id is null or auth.uid() is null then return null; end if;
  insert into public.trip_members(trip_id, user_id, role, status, display_name, email)
    values(target_trip_id, auth.uid(), 'editor', 'pending', member_display_name, member_email)
    on conflict (trip_id, user_id) do nothing;
  return target_trip_id;
end;
$$;
