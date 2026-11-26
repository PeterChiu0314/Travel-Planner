-- Run as a single transaction. Every user, trip and token below is disposable.
begin;
do $test$
declare
  owner_id uuid := gen_random_uuid();
  applicant uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  tid uuid := gen_random_uuid();
  first_link jsonb;
  second_link jsonb;
  action text;
begin
  insert into auth.users(id) values(owner_id),(applicant),(outsider);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.trips(id,title,name,destination,owner_id,start_date,end_date)
    values(tid,'Issue29 QA','Issue29 QA','QA',owner_id,current_date+1,current_date+3);
  insert into public.trip_members(trip_id,user_id,role,status)
    values(tid,owner_id,'owner','approved') on conflict(trip_id,user_id) do nothing;

  set local role authenticated;
  assert public.manage_trip_invite(tid,'read') is null;
  first_link := public.manage_trip_invite(tid,'create');
  assert (first_link->>'expires_at')::timestamptz - (first_link->>'server_time')::timestamptz = interval '168 hours';
  assert public.manage_trip_invite(tid,'create')->>'token' = first_link->>'token';
  perform set_config('request.jwt.claim.sub',applicant::text,true);
  assert public.request_trip_membership(first_link->>'token','QA','') = tid;

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  second_link := public.manage_trip_invite(tid,'rotate',first_link->>'token');
  assert second_link->>'token' <> first_link->>'token';
  assert public.manage_trip_invite(tid,'rotate',first_link->>'token')->>'token' = second_link->>'token';
  assert public.manage_trip_invite(tid,'read')->>'token' = second_link->>'token';

  perform set_config('request.jwt.claim.sub',outsider::text,true);
  foreach action in array array['read','create','rotate'] loop
    begin
      perform public.manage_trip_invite(tid,action,first_link->>'token');
      raise exception 'Non-owner invite operation succeeded';
    exception when insufficient_privilege then null;
    end;
  end loop;
  assert not has_table_privilege('authenticated','public.trip_invites','SELECT');
  assert not has_table_privilege('authenticated','public.trip_invites','UPDATE');
  assert not has_table_privilege('anon','public.trip_invites','SELECT');
  assert not has_function_privilege('anon','public.manage_trip_invite(uuid,text,text)','execute');
  assert public.request_trip_membership(first_link->>'token','QA','') is null;
  assert public.request_trip_membership(gen_random_uuid()::text,'QA','') is null;
  reset role;
  assert not exists(select from public.trip_members where trip_id=tid and user_id=outsider);
  assert exists(select from public.trip_members where trip_id=tid and user_id=applicant and status='pending');
  assert exists(select from public.trip_members where trip_id=tid and user_id=owner_id and status='approved' and role='owner');

  update public.trip_invites set created_at=now()-interval '168 hours',expires_at=now() where token=second_link->>'token';
  set local role authenticated;
  assert public.request_trip_membership(second_link->>'token','QA','') is null;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  assert public.manage_trip_invite(tid,'read') is null;
  second_link := public.manage_trip_invite(tid,'create');
  perform set_config('request.jwt.claim.sub',outsider::text,true);
  assert public.request_trip_membership(second_link->>'token','QA','') = tid;
  reset role;
  assert (select count(*) from public.trip_invites where trip_id=tid and revoked_at is null) = 1;
end;
$test$;
rollback;
