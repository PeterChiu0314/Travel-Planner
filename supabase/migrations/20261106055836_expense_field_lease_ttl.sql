CREATE OR REPLACE FUNCTION expense_stage_b.lease(eid uuid, g text, session_id uuid, token uuid, action text, base bigint, expected_epoch bigint, seq bigint DEFAULT 0, dirty boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s expense_stage_b.groups;tid uuid;begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 if session_id is null or token is null or action is null or action not in('acquire','renew','release') or g is null or g not in('title','note','category','payer','links','budget','paid','payment','lifecycle') or seq is null or seq<0 then raise exception 'Invalid lease' using errcode='22023';end if;
 if action<>'release' then
  tid:=expense_stage_b.authorize(eid);
  if base is null then raise exception 'Version required' using errcode='22023';end if;
  if g='budget' then
   perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||tid::text,0));
   if exists(select 1 from expense_stage_b.rate_leases where trip_id=tid and expires_at>clock_timestamp() and app_private.can_edit_trip(tid,actor)) then return jsonb_build_object('granted',false);end if;
  end if;
  insert into expense_stage_b.groups(expense_id,group_key) values(eid,g) on conflict do nothing;
 end if;
 select * into s from expense_stage_b.groups where expense_id=eid and group_key=g for update;
 if action='release' then
  -- The receipt certifies the submitted capability, not an empty group.
  if s.expires_at is null or s.expires_at<=clock_timestamp() then
   return jsonb_build_object('schemaVersion',1,'action','release','id',eid,'group',g,'session_id',session_id,'requested_epoch',expected_epoch,'granted',true,'settled',true,'capability_active',false,'outcome','inactive');
  end if;
  if s.actor=auth.uid() and s.sid=session_id and s.token_hash=sha256(convert_to(token::text,'UTF8')) then
   if s.epoch is distinct from expected_epoch then
    return jsonb_build_object('schemaVersion',1,'action','release','id',eid,'group',g,'session_id',session_id,'requested_epoch',expected_epoch,'granted',false,'settled',false,'capability_active',true,'outcome','epoch_mismatch','epoch',s.epoch);
   end if;
   update expense_stage_b.groups set actor=null,sid=null,token_hash=null,expires_at=null where expense_id=eid and group_key=g;
   return jsonb_build_object('schemaVersion',1,'action','release','id',eid,'group',g,'session_id',session_id,'requested_epoch',expected_epoch,'granted',true,'settled',true,'capability_active',false,'outcome','released');
  end if;
  return jsonb_build_object('schemaVersion',1,'action','release','id',eid,'group',g,'session_id',session_id,'requested_epoch',expected_epoch,'granted',true,'settled',true,'capability_active',false,'outcome','superseded');
 end if;
 if s.expires_at>clock_timestamp() and not app_private.can_edit_trip(tid,s.actor) then s.expires_at:=null;end if;
 if s.revision<>base then raise exception 'Version conflict' using errcode='PT409';end if;
 if s.expires_at>clock_timestamp() and (s.actor<>auth.uid() or s.sid<>session_id or s.token_hash<>sha256(convert_to(token::text,'UTF8'))) then return jsonb_build_object('granted',false);end if;
 if action='renew' and (s.expires_at is null or s.expires_at<=clock_timestamp() or s.actor is distinct from auth.uid() or s.sid is distinct from session_id or s.token_hash is distinct from sha256(convert_to(token::text,'UTF8')) or s.epoch is distinct from expected_epoch) then return jsonb_build_object('granted',false);end if;
 if action='renew' and seq<s.activity then return jsonb_build_object('granted',false);end if;
 if action='acquire' and (s.expires_at is null or s.expires_at<=clock_timestamp()) then s.epoch:=s.epoch+1;s.activity:=-1;end if;
 update expense_stage_b.groups set actor=auth.uid(),sid=session_id,token_hash=sha256(convert_to(token::text,'UTF8')),epoch=s.epoch,
  expires_at=case when action='renew' or seq>s.activity then clock_timestamp()+case when dirty then interval '60 seconds' else interval '20 seconds' end else s.expires_at end,
  activity=greatest(seq,s.activity) where expense_id=eid and group_key=g returning * into s;
 return jsonb_build_object('granted',true,'epoch',s.epoch,'revision',s.revision,'expires_at',s.expires_at);
end $function$;
