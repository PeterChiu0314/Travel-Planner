-- Dormant Pricing/Participants extension; never a hosted rollout.
begin;
alter table app_private.budget_metadata_groups drop constraint budget_metadata_groups_group_key_check;
alter table app_private.budget_metadata_groups add constraint budget_metadata_groups_group_key_check check(group_key in ('title','note','category','payer','links','pricing'));
alter table app_private.budget_metadata_groups add column graph_revision bigint not null default 0, add column pricing_bundle jsonb;
alter table app_private.budget_metadata_effects add column pricing_manifest jsonb;
insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id)
select 'budget',id,'pricing',trip_id from public.budget_items union all select 'actual',id,'pricing',trip_id from public.actual_expenses;
create table app_private.budget_pricing_trip_versions(trip_id uuid primary key references public.trips(id) on delete cascade,rates bigint not null default 0,members bigint not null default 0);
alter table app_private.budget_pricing_trip_versions enable row level security;
revoke all on app_private.budget_pricing_trip_versions from public,anon,authenticated;
insert into app_private.budget_pricing_trip_versions(trip_id) select id from public.trips;

-- Extracted numeric contract from save_budget_workspace_record, shared by legacy and groups.
create function app_private.calculate_budget_group_pricing(p jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare mode text:=p->>'pricing_mode';currency text:=upper(p->>'currency');rate numeric;amount numeric;unit numeric;ids uuid[];u uuid;shares jsonb:='{}';n numeric;
begin
 if mode is null or mode not in ('per_person','split_total','custom') or currency is null or currency!~'^[A-Z]{3}$'
 or jsonb_typeof(p->'participantIds') is distinct from 'array' then raise exception 'Invalid pricing mode/currency/participants' using errcode='22023';end if;
 select array_agg(distinct v::uuid order by v::uuid) into ids from jsonb_array_elements_text(p->'participantIds') v;
 if coalesce(cardinality(ids),0)=0 or array_position(ids,null) is not null then raise exception 'Participants required' using errcode='22023';end if;
 if currency='TWD' then rate:=1;else
  if coalesce(p->>'exchange_rate','')!~'^\d+(\.\d{1,6})?$' then raise exception 'Invalid exchange rate' using errcode='22023';end if;rate:=(p->>'exchange_rate')::numeric;
 end if;
 if rate<=0 or rate>=1000000 then raise exception 'Invalid exchange rate' using errcode='22023';end if;
 if mode='per_person' then
  if coalesce(p->>'unit_amount','')!~'^\d+(\.\d{1,2})?$' then raise exception 'Invalid unit amount' using errcode='22023';end if;
  unit:=(p->>'unit_amount')::numeric;amount:=unit*cardinality(ids);
 elsif mode='custom' then
  if jsonb_typeof(p->'shares') is distinct from 'object' then raise exception 'Member shares required' using errcode='22023';end if;
  if exists(select 1 from jsonb_object_keys(p->'shares') k where not(k=any(ids::text[]))) then raise exception 'Unknown member share' using errcode='22023';end if;
  amount:=0;foreach u in array ids loop
   if coalesce(p->'shares'->>u::text,'')!~'^\d+(\.\d{1,2})?$' then raise exception 'Invalid member share' using errcode='22023';end if;
   n:=(p->'shares'->>u::text)::numeric;amount:=amount+n;shares:=shares||jsonb_build_object(u::text,n);
  end loop;
 else
  if coalesce(p->>'amount','')!~'^\d+(\.\d{1,2})?$' then raise exception 'Invalid total amount' using errcode='22023';end if;amount:=(p->>'amount')::numeric;
 end if;
 if amount>=10000000000 or coalesce(unit,0)>=10000000000 or round(amount*rate)>=10000000000 then raise exception 'Pricing amount out of range' using errcode='22023';end if;
 return jsonb_build_object('pricing_mode',mode,'amount',amount,'unit_amount',unit,'currency',currency,'exchange_rate',rate,'participantIds',to_jsonb(ids),'shares',shares,
   'twd_amount',round(amount*rate),'split_type',case when mode='custom' then 'custom' else 'equal' end);
end $$;
revoke all on function app_private.calculate_budget_group_pricing(jsonb) from public,anon;
grant execute on function app_private.calculate_budget_group_pricing(jsonb) to authenticated;

create function app_private.budget_pricing_targets(k text,rid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=app_private.budget_metadata_record(k,rid);a public.actual_expenses;t public.trips;counted int;
begin
 if r is null then return null;end if;select * into t from public.trips where id=(r->>'trip_id')::uuid;
 if k='actual' then
  if r->>'budget_item_id' is not null or r->>'payment_origin'<>'manual' then return null;end if;
  return jsonb_build_array(jsonb_build_object('kind',k,'id',rid));
 end if;
 if k<>'budget' or (r->>'is_fixed')::boolean or (r->>'currency'<>'TWD' and (t.start_date is null or t.start_date::timestamp at time zone 'Asia/Taipei'<=statement_timestamp() or t.status='settled')) then return null;end if;
 select count(*) into counted from public.actual_expenses where budget_item_id=rid;
 if counted>1 then return null;end if;
 if counted=1 then
  select * into a from public.actual_expenses where budget_item_id=rid;
  if t.start_date is null or t.start_date::timestamp at time zone 'Asia/Taipei'<=statement_timestamp() or t.status='settled'
   or a.trip_id<>t.id or a.payment_origin<>'budget_toggle' or a.budget_origin_id is distinct from rid
   or a.currency<>r->>'currency' or a.exchange_rate is distinct from (r->>'exchange_rate')::numeric
   or (r->>'auto_created_actual_expense_id' is not null and (r->>'auto_created_actual_expense_id')::uuid<>a.id) then return null;end if;
  return jsonb_build_array(jsonb_build_object('kind',k,'id',rid),jsonb_build_object('kind','actual','id',a.id));
 elsif r->>'auto_created_actual_expense_id' is not null then return null;end if;
 return jsonb_build_array(jsonb_build_object('kind',k,'id',rid));
end $$;
revoke all on function app_private.budget_pricing_targets(text,uuid) from public,anon,authenticated;

create function app_private.budget_pricing_versions(k text,rid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('graph',g.graph_revision,'rates',v.rates,'members',v.members,'targets',coalesce((select jsonb_agg(jsonb_build_object('kind',x->>'kind','id',x->>'id','revision',p.revision) order by x->>'kind',x->>'id')
 from jsonb_array_elements(coalesce(app_private.budget_pricing_targets(k,rid),'[]')) x join app_private.budget_metadata_groups p on p.kind=x->>'kind' and p.resource_id=(x->>'id')::uuid and p.group_key='pricing'),'[]'))
 from app_private.budget_metadata_groups g join app_private.budget_pricing_trip_versions v on v.trip_id=g.trip_id where g.kind=k and g.resource_id=rid and g.group_key='pricing'
$$;
revoke all on function app_private.budget_pricing_versions(text,uuid) from public,anon,authenticated;
create function app_private.read_budget_pricing_value(k text,rid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with rec as(select app_private.budget_metadata_record(k,rid) r),people as(
 select user_id,share_amount from public.budget_item_participants where k='budget' and budget_item_id=rid union all select user_id,share_amount from public.actual_expense_participants where k='actual' and actual_expense_id=rid)
 select jsonb_build_object('pricing_mode',r->'pricing_mode','amount',r->'amount','unit_amount',r->'unit_amount','currency',r->'currency','exchange_rate',r->'exchange_rate',
 'participantIds',coalesce((select jsonb_agg(user_id order by user_id) from people),'[]'),
 'shares',case when r->>'pricing_mode'='custom' then coalesce((select jsonb_object_agg(user_id,share_amount) from people),'{}') else '{}'::jsonb end,
 'versions',app_private.budget_pricing_versions(k,rid)) from rec
$$;
revoke all on function app_private.read_budget_pricing_value(text,uuid) from public,anon,authenticated;

create function app_private.budget_pricing_admission(p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_session_id uuid,p_token uuid,p_action text,p_base_revision bigint,p_epoch bigint,p_activity_seq bigint,p_dirty boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();primary_row app_private.budget_metadata_groups;held app_private.budget_metadata_groups;target jsonb;targets jsonb;epochs jsonb:='[]';bundle jsonb;stamp timestamptz;activity timestamptz;deadline timestamptz;
begin
 if actor is null or p_group is distinct from 'pricing' or p_kind is null or p_kind not in('budget','actual') or p_id is null or p_trip_id is null or p_session_id is null or p_token is null or p_action is null or p_action not in('acquire','renew','release') or p_activity_seq is null or p_activity_seq<0 or p_dirty is null then raise exception 'Invalid pricing lease' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 select * into primary_row from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and group_key='pricing' and trip_id=p_trip_id for update;
 if p_action='release' then
  if primary_row.user_id=actor and primary_row.session_id=p_session_id and primary_row.token_hash=sha256(convert_to(p_token::text,'UTF8')) and primary_row.lease_epoch=p_epoch
   and primary_row.pricing_bundle->>'kind'=p_kind and primary_row.pricing_bundle->>'id'=p_id::text then
   update app_private.budget_metadata_groups g set user_id=null,session_id=null,token_hash=null,expires_at=null,pricing_bundle=null,dirty=false
    where g.group_key='pricing' and g.trip_id=p_trip_id and g.user_id=actor and g.session_id=p_session_id and g.token_hash=primary_row.token_hash and g.pricing_bundle=primary_row.pricing_bundle;
  end if;return jsonb_build_object('granted',true);
 end if;
 if not app_private.budget_metadata_enabled() then raise exception 'group_protocol_disabled' using errcode='55000';end if;
 if primary_row.resource_id is null or primary_row.is_deleted or not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.trip_members where trip_id=p_trip_id and user_id=actor and status='approved' for share nowait;
 if not found then raise exception 'Forbidden' using errcode='42501';end if;
 targets:=app_private.budget_pricing_targets(p_kind,p_id);if targets is null then raise exception 'pricing_dependency_not_supported' using errcode='0A000';end if;
 if p_base_revision is distinct from primary_row.revision then raise exception 'group_conflict' using errcode='40001';end if;
 stamp:=clock_timestamp();
 if p_action='renew' or primary_row.user_id is not null and primary_row.expires_at>stamp then
  if primary_row.user_id is distinct from actor or primary_row.session_id is distinct from p_session_id or primary_row.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8'))
   or p_action='renew' and (primary_row.lease_epoch is distinct from p_epoch or primary_row.expires_at<=stamp)
   or primary_row.pricing_bundle->>'kind' is distinct from p_kind or primary_row.pricing_bundle->>'id' is distinct from p_id::text then return jsonb_build_object('granted',false,'reason','group_locked');end if;
 end if;
 if p_action='renew' and (primary_row.expires_at is null or primary_row.expires_at<=stamp) then return jsonb_build_object('granted',false,'reason','lease_lost');end if;
 if primary_row.expires_at>stamp and primary_row.pricing_bundle->'versions' is distinct from app_private.budget_pricing_versions(p_kind,p_id) then raise exception 'dependency_changed' using errcode='40001';end if;
 for target in select x from jsonb_array_elements(targets) x order by x->>'kind',x->>'id' loop
  if target->>'kind'='budget' then perform 1 from public.budget_items where id=(target->>'id')::uuid for update nowait;else perform 1 from public.actual_expenses where id=(target->>'id')::uuid for update nowait;end if;
  if exists(select 1 from app_private.budget_edit_leases where kind=target->>'kind' and resource_id=(target->>'id')::uuid and expires_at>clock_timestamp())
   or exists(select 1 from (select app_private.budget_metadata_record(target->>'kind',(target->>'id')::uuid) r) q where r->>'locked_by' is not null and (r->>'locked_at')::timestamptz>clock_timestamp()-interval '7 minutes') then return jsonb_build_object('granted',false,'reason','legacy_locked');end if;
  select * into held from app_private.budget_metadata_groups where kind=target->>'kind' and resource_id=(target->>'id')::uuid and group_key='pricing' for update;
  if held.user_id is not null and held.expires_at>clock_timestamp() and (held.user_id is distinct from actor or held.session_id is distinct from p_session_id or held.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) or held.pricing_bundle->>'id' is distinct from p_id::text or held.pricing_bundle->>'kind' is distinct from p_kind) then return jsonb_build_object('granted',false,'reason','group_locked');end if;
  if p_action='renew' and (held.expires_at is null or held.expires_at<=clock_timestamp() or not exists(select 1 from jsonb_array_elements(primary_row.pricing_bundle->'epochs') e where e->>'kind'=held.kind and e->>'id'=held.resource_id::text and (e->>'epoch')::bigint=held.lease_epoch)) then return jsonb_build_object('granted',false,'reason','lease_lost');end if;
  epochs:=epochs||jsonb_build_array(jsonb_build_object('kind',held.kind,'id',held.resource_id,'epoch',held.lease_epoch+case when held.expires_at is null or held.expires_at<=clock_timestamp() or held.user_id is null then 1 else 0 end));
 end loop;
 stamp:=clock_timestamp();activity:=case when primary_row.user_id is null or primary_row.expires_at is null or primary_row.expires_at<=stamp or p_activity_seq>primary_row.activity_seq then stamp else primary_row.last_activity_at end;
 deadline:=activity+case when p_dirty then interval '10 minutes' else interval '2 minutes' end;if deadline<=stamp then return jsonb_build_object('granted',false,'reason','idle_expired');end if;
 bundle:=jsonb_build_object('kind',p_kind,'id',p_id,'versions',app_private.budget_pricing_versions(p_kind,p_id),'epochs',epochs);
 for target in select x from jsonb_array_elements(epochs) x loop
  update app_private.budget_metadata_groups set user_id=actor,session_id=p_session_id,token_hash=sha256(convert_to(p_token::text,'UTF8')),lease_epoch=(target->>'epoch')::bigint,
    expires_at=least(stamp+interval '7 minutes',deadline),last_activity_at=activity,activity_seq=p_activity_seq,dirty=p_dirty,pricing_bundle=bundle where kind=target->>'kind' and resource_id=(target->>'id')::uuid and group_key='pricing';
 end loop;
 select * into held from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and group_key='pricing';
 return jsonb_build_object('granted',true,'epoch',held.lease_epoch,'revision',held.revision,'expires_at',held.expires_at,'value',app_private.read_budget_pricing_value(p_kind,p_id));
end $$;
revoke all on function app_private.budget_pricing_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean) from public,anon,authenticated;

create function app_private.budget_pricing_effect(k text,rid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select x from app_private.budget_metadata_effects e cross join lateral jsonb_array_elements(e.pricing_manifest) x
 where e.transaction_id=txid_current() and e.backend_id=pg_backend_pid() and e.user_id=auth.uid() and e.group_key='pricing' and x->>'kind'=k and x->>'id'=rid::text
$$;
revoke all on function app_private.budget_pricing_effect(text,uuid) from public,anon,authenticated;

create function app_private.prepare_budget_pricing_patch(p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_base_revision bigint,p_session_id uuid,p_token uuid,p_epoch bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();g app_private.budget_metadata_groups;h app_private.budget_metadata_groups;targets jsonb;target jsonb;rec jsonb;calc jsonb;normalized jsonb;signature jsonb;cached app_private.budget_metadata_requests;manifest jsonb:='[]';fields jsonb;trip public.trips;rate numeric;debit numeric;changed boolean:=false;ids uuid[];expected jsonb;current_value jsonb;
begin
 if actor is null or p_group is distinct from 'pricing' or not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_trip_id is null or p_id is null or p_request_id is null or p_session_id is null or p_kind is null or p_kind not in('budget','actual') or p_base_revision is null or p_base_revision<0 or jsonb_typeof(p_patch) is distinct from 'object' or p_patch-'pricing'<>'{}' or jsonb_typeof(p_patch->'pricing') is distinct from 'object'
 or (p_patch->'pricing')-array['pricing_mode','amount','unit_amount','currency','exchange_rate','participantIds','shares','versions']<>'{}'::jsonb then raise exception 'Invalid pricing patch' using errcode='22023';end if;
 calc:=app_private.calculate_budget_group_pricing(p_patch->'pricing');normalized:=(calc-'twd_amount'-'split_type')||jsonb_build_object('versions',p_patch->'pricing'->'versions');
 signature:=jsonb_build_object('protocol','pricing-prototype','trip',p_trip_id,'kind',p_kind,'id',p_id,'base',p_base_revision,'value',normalized,'session',p_session_id);
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 if not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into cached from app_private.budget_metadata_requests where user_id=actor and request_id=p_request_id;
 if found then if cached.signature<>signature or cached.trip_id<>p_trip_id or cached.session_id<>p_session_id then raise exception 'request_mismatch' using errcode='22023';end if;return jsonb_build_object('replayed',true,'result',cached.result);end if;
 if not app_private.budget_metadata_enabled() then raise exception 'group_protocol_disabled' using errcode='55000';end if;
 select * into trip from public.trips where id=p_trip_id for share nowait;
 targets:=app_private.budget_pricing_targets(p_kind,p_id);if targets is null then raise exception 'pricing_dependency_not_supported' using errcode='0A000';end if;
 select * into g from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and group_key='pricing' and trip_id=p_trip_id for update;
 expected:=app_private.budget_pricing_versions(p_kind,p_id);
 if p_patch->'pricing'->'versions' is distinct from expected or g.pricing_bundle->'versions' is distinct from expected then raise exception 'dependency_changed' using errcode='40001';end if;
 if g.revision<>p_base_revision then raise exception 'group_conflict' using errcode='40001';end if;
 if g.pricing_bundle->>'kind' is distinct from p_kind or g.pricing_bundle->>'id' is distinct from p_id::text then raise exception 'Incomplete pricing bundle' using errcode='55P03';end if;
 select array_agg(v::uuid order by v::uuid) into ids from jsonb_array_elements_text(calc->'participantIds') v;
 perform 1 from public.trip_members where trip_id=p_trip_id and user_id=any(array_append(ids,actor)) and status='approved' order by user_id for share nowait;
 if exists(select 1 from unnest(array_append(ids,actor)) u where not exists(select 1 from public.trip_members where trip_id=p_trip_id and user_id=u and status='approved')) then raise exception 'Invalid participants or membership revoked' using errcode='42501';end if;
 -- Current shared rate only for unlinked planning budgets; retained history keeps its saved currency/rate.
 if p_kind='budget' then
  rec:=app_private.budget_metadata_record(p_kind,p_id);
  if jsonb_array_length(targets)=1 and calc->>'currency'<>'TWD' then
   rate:=(trip.budget_exchange_rates->'rates'->>(calc->>'currency'))::numeric;
   if rate is null or rate<>(calc->>'exchange_rate')::numeric then raise exception 'Trip exchange rate changed or unavailable' using errcode='40001';end if;
  elsif jsonb_array_length(targets)>1 and (calc->>'currency' is distinct from rec->>'currency' or (calc->>'exchange_rate')::numeric is distinct from (rec->>'exchange_rate')::numeric) then raise exception 'Retained currency/rate is historical' using errcode='0A000';end if;
 end if;
 for target in select x from jsonb_array_elements(targets) x order by x->>'kind',x->>'id' loop
  if target->>'kind'='budget' then select to_jsonb(b) into rec from public.budget_items b where id=(target->>'id')::uuid and trip_id=p_trip_id for update nowait;
   perform 1 from public.budget_item_participants where budget_item_id=(target->>'id')::uuid order by user_id for update nowait;
  else select to_jsonb(a) into rec from public.actual_expenses a where id=(target->>'id')::uuid and trip_id=p_trip_id for update nowait;
   perform 1 from public.actual_expense_participants where actual_expense_id=(target->>'id')::uuid order by user_id for update nowait;
  end if;
  if rec is null then raise exception 'Resource changed' using errcode='40001';end if;
  select * into h from app_private.budget_metadata_groups where kind=target->>'kind' and resource_id=(target->>'id')::uuid and group_key='pricing' for update;
  if h.user_id is distinct from actor or h.session_id is distinct from p_session_id or p_token is null or h.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) or h.expires_at is null or h.expires_at<=clock_timestamp() or h.pricing_bundle is distinct from g.pricing_bundle
   or not exists(select 1 from jsonb_array_elements(g.pricing_bundle->'epochs') e where e->>'kind'=h.kind and e->>'id'=h.resource_id::text and (e->>'epoch')::bigint=h.lease_epoch)
   or (target->>'kind'=p_kind and target->>'id'=p_id::text and h.lease_epoch is distinct from p_epoch) then raise exception 'lease_lost or incomplete_bundle' using errcode='55P03';end if;
  if exists(select 1 from app_private.budget_edit_leases where kind=h.kind and resource_id=h.resource_id and expires_at>clock_timestamp()) or (rec->>'locked_by' is not null and (rec->>'locked_at')::timestamptz>clock_timestamp()-interval '7 minutes') then raise exception 'legacy_locked' using errcode='55P03';end if;
  fields:=calc-array['participantIds','shares'];
  if h.kind='actual' and rec->>'twd_amount_source' in('actual','legacy') then
   debit:=(rec->>'actual_twd_amount')::numeric;
   if debit is null or debit<>round(debit) or debit>0 and (calc->>'amount')::numeric=0 then raise exception 'Unsupported known debit allocation' using errcode='0A000';end if;
   if (p_kind='budget' or calc->>'currency'='TWD') and debit<>(calc->>'twd_amount')::numeric then raise exception 'Known actual debit cannot be repriced' using errcode='0A000';end if;
   fields:=fields||jsonb_build_object('twd_amount',debit);
  end if;
  current_value:=app_private.read_budget_pricing_value(h.kind,h.resource_id)-'versions';
  if current_value is distinct from normalized-'versions' then changed:=true;end if;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('kind',h.kind,'id',h.resource_id,'before',rec,'fields',fields,'inputs',normalized-'versions','base',h.revision,'epoch',h.lease_epoch));
 end loop;
 -- Re-resolve after parent locking; an administrator/raw writer cannot alter the graph during waiting.
 if expected is distinct from app_private.budget_pricing_versions(p_kind,p_id) or targets is distinct from app_private.budget_pricing_targets(p_kind,p_id) then raise exception 'dependency_changed' using errcode='40001';end if;
 select jsonb_agg(x||jsonb_build_object('changed',changed)) into manifest from jsonb_array_elements(manifest) x;
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,pricing_manifest)
 values(txid_current(),pg_backend_pid(),actor,p_trip_id,p_kind,p_id,'pricing',p_session_id,p_request_id,p_base_revision,p_epoch,normalized,signature,manifest);
 return jsonb_build_object('replayed',false,'noop',not changed,'targets',manifest);
end $$;
revoke all on function app_private.prepare_budget_pricing_patch(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid) from public,anon;
grant execute on function app_private.prepare_budget_pricing_patch(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid) to authenticated;

create function app_private.finish_budget_pricing_patch() returns jsonb
language plpgsql security definer set search_path='' as $$
declare e app_private.budget_metadata_effects;t jsonb;rec jsonb;changed boolean:=false;v jsonb;result jsonb;g app_private.budget_metadata_groups;bundle jsonb;
begin
 select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='pricing';
 if not found or not app_private.can_edit_trip(e.trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 for t in select x from jsonb_array_elements(e.pricing_manifest) x loop
  rec:=app_private.budget_metadata_record(t->>'kind',(t->>'id')::uuid);
  if rec is null or (rec-array['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type','updated_at']) is distinct from ((t->'before')-array['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type','updated_at'])
   or not(rec @> (t->'fields')) or (app_private.read_budget_pricing_value(t->>'kind',(t->>'id')::uuid)-'versions') is distinct from t->'inputs' then raise exception 'Incomplete pricing effect' using errcode='40001';end if;
 end loop;
 -- No-op is determined against pre-write inputs, recorded by the invoker before DML.
 changed:=coalesce((e.pricing_manifest->0->>'changed')::boolean,false);
 if changed then
  for t in select x from jsonb_array_elements(e.pricing_manifest) x loop
   update app_private.budget_metadata_groups set revision=(t->>'base')::bigint+1 where kind=t->>'kind' and resource_id=(t->>'id')::uuid and group_key='pricing';
   delete from app_private.budget_metadata_undo_lineage where kind=t->>'kind' and resource_id=(t->>'id')::uuid;
  end loop;
  delete from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id;
 end if;
 select * into g from app_private.budget_metadata_groups where kind=e.kind and resource_id=e.resource_id and group_key='pricing';
 v:=app_private.read_budget_pricing_value(e.kind,e.resource_id);bundle:=jsonb_set(g.pricing_bundle,'{versions}',v->'versions');
 update app_private.budget_metadata_groups set dirty=false,pricing_bundle=bundle,expires_at=least(expires_at,last_activity_at+interval '2 minutes') where group_key='pricing' and trip_id=e.trip_id and pricing_bundle=g.pricing_bundle;
 result:=jsonb_build_object('id',e.resource_id,'kind',e.kind,'group','pricing','value',v,'revision',g.revision,'request_id',e.request_id,'undo_supported',false);
 insert into app_private.budget_metadata_requests(user_id,request_id,trip_id,session_id,signature,result) values(e.user_id,e.request_id,e.trip_id,e.session_id,e.signature,result);
 delete from app_private.budget_metadata_effects where transaction_id=e.transaction_id and backend_id=e.backend_id;return result;
end $$;
revoke all on function app_private.finish_budget_pricing_patch() from public,anon;
grant execute on function app_private.finish_budget_pricing_patch() to authenticated;

create function app_private.track_budget_pricing_versions() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb;a jsonb;k text;rid uuid;trip uuid;linked uuid;v jsonb;
begin
 if tg_op<>'INSERT' then b:=to_jsonb(old);end if;if tg_op<>'DELETE' then a:=to_jsonb(new);end if;
 v:=coalesce(a,b);
 if tg_table_name='trips' then
  insert into app_private.budget_pricing_trip_versions(trip_id) values((v->>'id')::uuid) on conflict do nothing;
  if tg_op='UPDATE' and (a->'budget_exchange_rates',a->'start_date',a->'end_date',a->'status') is distinct from (b->'budget_exchange_rates',b->'start_date',b->'end_date',b->'status') then
   update app_private.budget_pricing_trip_versions set rates=rates+1 where trip_id=(v->>'id')::uuid;
  end if;return null;
 elsif tg_table_name='trip_members' then
  if tg_op='UPDATE' and (a->'user_id',a->'trip_id',a->'status',a->'role') is not distinct from (b->'user_id',b->'trip_id',b->'status',b->'role') then return null;end if;
  update app_private.budget_pricing_trip_versions set members=members+1 where trip_id in ((a->>'trip_id')::uuid,(b->>'trip_id')::uuid);return null;
 end if;
 k:=case when tg_table_name in('budget_items','budget_item_participants') then 'budget' else 'actual' end;
 rid:=case when tg_table_name='budget_item_participants' then (v->>'budget_item_id')::uuid when tg_table_name='actual_expense_participants' then (v->>'actual_expense_id')::uuid else (v->>'id')::uuid end;
 if app_private.budget_pricing_effect(k,rid) is not null then return null;end if;
 if tg_table_name in('budget_item_participants','actual_expense_participants') then
  if tg_op<>'UPDATE' or (a->'user_id',a->'share_amount',a->'budget_item_id',a->'actual_expense_id') is distinct from (b->'user_id',b->'share_amount',b->'budget_item_id',b->'actual_expense_id') then
   update app_private.budget_metadata_groups set revision=revision+1 where kind=k and resource_id in (rid,(b->>'budget_item_id')::uuid,(b->>'actual_expense_id')::uuid) and group_key='pricing';
  end if;return null;
 end if;
 if tg_op='UPDATE' and (a->'amount',a->'unit_amount',a->'currency',a->'exchange_rate',a->'twd_amount',a->'pricing_mode',a->'split_type',a->'actual_twd_amount',a->'twd_amount_source') is distinct from (b->'amount',b->'unit_amount',b->'currency',b->'exchange_rate',b->'twd_amount',b->'pricing_mode',b->'split_type',b->'actual_twd_amount',b->'twd_amount_source') then
  update app_private.budget_metadata_groups set revision=revision+1 where kind=k and resource_id=rid and group_key='pricing';
 end if;
 if tg_op<>'UPDATE' or (a->'budget_item_id',a->'budget_origin_id',a->'payment_origin',a->'auto_created_actual_expense_id',a->'is_fixed',a->'trip_id') is distinct from (b->'budget_item_id',b->'budget_origin_id',b->'payment_origin',b->'auto_created_actual_expense_id',b->'is_fixed',b->'trip_id') then
  update app_private.budget_metadata_groups set graph_revision=graph_revision+1 where group_key='pricing' and ((kind=k and resource_id=rid) or kind='budget' and resource_id in ((a->>'budget_item_id')::uuid,(b->>'budget_item_id')::uuid,(a->>'budget_origin_id')::uuid,(b->>'budget_origin_id')::uuid));
 end if;return null;
end $$;
revoke all on function app_private.track_budget_pricing_versions() from public,anon,authenticated;
create trigger zzz_pricing_budget after insert or update or delete on public.budget_items for each row execute function app_private.track_budget_pricing_versions();
create trigger zzz_pricing_actual after insert or update or delete on public.actual_expenses for each row execute function app_private.track_budget_pricing_versions();
create trigger zzz_pricing_people after insert or update or delete on public.budget_item_participants for each row execute function app_private.track_budget_pricing_versions();
create trigger zzz_pricing_actual_people after insert or update or delete on public.actual_expense_participants for each row execute function app_private.track_budget_pricing_versions();
create trigger zzz_pricing_trip after insert or update on public.trips for each row execute function app_private.track_budget_pricing_versions();
create trigger zzz_pricing_member after insert or update or delete on public.trip_members for each row execute function app_private.track_budget_pricing_versions();

create or replace function app_private.budget_metadata_admission(
  p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_session_id uuid,p_token uuid,p_action text,
  p_base_revision bigint,p_epoch bigint,p_activity_seq bigint,p_dirty boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rec jsonb; held app_private.budget_metadata_groups; stamp timestamptz;
  activity_at timestamptz; next_seq bigint; deadline timestamptz;
begin
  if p_group='pricing' then return app_private.budget_pricing_admission(p_trip_id,p_kind,p_id,p_group,p_session_id,p_token,p_action,p_base_revision,p_epoch,p_activity_seq,p_dirty);end if;
  if actor is null or p_trip_id is null or p_id is null or p_kind is null or p_kind not in ('budget','actual')
    or p_group is null or p_group not in ('title','note','category','payer','links') or (p_kind='actual' and p_group='links') or p_session_id is null or p_token is null
    or p_action is null or p_action not in ('acquire','renew','release')
    or p_activity_seq is null or p_activity_seq<0 or p_dirty is null then
    raise exception 'invalid_group_request' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  -- Exact release remains available to revoked members and while paused.
  if p_action='release' then
    update app_private.budget_metadata_groups set user_id=null,session_id=null,token_hash=null,expires_at=null,dirty=false
      where kind=p_kind and resource_id=p_id and group_key=p_group and trip_id=p_trip_id
      and user_id=actor and session_id=p_session_id and lease_epoch=p_epoch
      and token_hash=sha256(convert_to(p_token::text,'UTF8'));
    return jsonb_build_object('granted',true);
  end if;
  if not app_private.budget_metadata_enabled() then raise exception 'group_protocol_disabled' using errcode='55000'; end if;
  rec:=app_private.budget_metadata_record(p_kind,p_id);
  if rec is null or (rec->>'trip_id')::uuid<>p_trip_id or not app_private.can_edit_trip(p_trip_id,actor) then
    raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.trip_members where trip_id=p_trip_id and user_id=actor and status='approved' for share nowait;
  if not found then raise exception 'Forbidden' using errcode='42501'; end if;
  if not app_private.budget_metadata_supported(p_kind,p_id) then raise exception 'group_dependency_not_supported' using errcode='0A000'; end if;
  stamp:=clock_timestamp();
  if exists(select 1 from app_private.budget_edit_leases where kind=p_kind and resource_id=p_id and expires_at>stamp)
    or (nullif(rec->>'locked_by','') is not null and (rec->>'locked_at')::timestamptz>stamp-interval '7 minutes') then
    return jsonb_build_object('granted',false,'reason','legacy_locked'); end if;
  select * into held from app_private.budget_metadata_groups
    where kind=p_kind and resource_id=p_id and group_key=p_group and trip_id=p_trip_id and not is_deleted for update;
  if not found then raise exception 'group_state_missing' using errcode='40001'; end if;
  stamp:=clock_timestamp();
  if p_action='renew' then
    if held.user_id is distinct from actor or held.session_id is distinct from p_session_id
      or held.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8'))
      or held.lease_epoch is distinct from p_epoch or held.expires_at is null or held.expires_at<=stamp then
      return jsonb_build_object('granted',false,'reason','lease_lost'); end if;
  else
    if p_base_revision is null or held.revision<>p_base_revision then raise exception 'group_conflict' using errcode='40001'; end if;
    if held.expires_at>stamp and held.user_id is not null and (held.user_id is distinct from actor
      or held.session_id is distinct from p_session_id or held.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8'))) then
      return jsonb_build_object('granted',false,'reason','group_locked','owner_id',held.user_id,'expires_at',held.expires_at); end if;
    if held.expires_at is null or held.expires_at<=stamp or held.user_id is null then held.lease_epoch:=held.lease_epoch+1; end if;
  end if;
  if p_action='acquire' and (held.user_id is null or held.expires_at is null or held.expires_at<=stamp) then
    activity_at:=stamp; next_seq:=p_activity_seq;
  else
    activity_at:=case when p_activity_seq>held.activity_seq then stamp else held.last_activity_at end;
    next_seq:=greatest(p_activity_seq,held.activity_seq);
  end if;
  deadline:=activity_at+case when p_dirty then interval '10 minutes' else interval '2 minutes' end;
  if deadline<=stamp then return jsonb_build_object('granted',false,'reason','idle_expired'); end if;
  update app_private.budget_metadata_groups set user_id=actor,session_id=p_session_id,
    token_hash=sha256(convert_to(p_token::text,'UTF8')),lease_epoch=held.lease_epoch,
    expires_at=least(stamp+interval '7 minutes',deadline),activity_seq=next_seq,last_activity_at=activity_at,dirty=p_dirty
    where kind=p_kind and resource_id=p_id and group_key=p_group;
  return jsonb_build_object('granted',true,'revision',held.revision,'epoch',held.lease_epoch,
    'expires_at',least(stamp+interval '7 minutes',deadline),'value',app_private.budget_metadata_value(p_kind,p_id,p_group));
end $$;
create or replace function app_private.guard_budget_metadata_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_data jsonb; after_data jsonb; data jsonb; k text; active boolean; g text;
  price jsonb; effect app_private.budget_metadata_effects; held app_private.budget_metadata_groups;
begin
  if tg_op<>'INSERT' then before_data:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_data:=to_jsonb(new); end if;
  data:=coalesce(after_data,before_data); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  price:=app_private.budget_pricing_effect(k,(data->>'id')::uuid);
  if price is not null then
    select * into held from app_private.budget_metadata_groups where kind=k and resource_id=(data->>'id')::uuid and group_key='pricing';
    if tg_op<>'UPDATE' or held.user_id is distinct from auth.uid() or held.expires_at is null or held.expires_at<=clock_timestamp() or held.lease_epoch<>(price->>'epoch')::bigint or held.revision<>(price->>'base')::bigint
     or not app_private.budget_metadata_enabled() or not app_private.can_edit_trip((data->>'trip_id')::uuid,auth.uid())
     or (before_data-array['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type','updated_at']) is distinct from (after_data-array['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type','updated_at'])
     or not(after_data @> (price->'fields')) then raise exception 'invalid_pricing_effect' using errcode='55P03';end if;return null;
  end if;
  active:=app_private.budget_metadata_live(k,(data->>'id')::uuid);
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid()
    and user_id=auth.uid() and kind=k and resource_id=(data->>'id')::uuid;
  if found then
    select * into held from app_private.budget_metadata_groups where kind=k and resource_id=effect.resource_id and group_key=effect.group_key;
    if not app_private.budget_metadata_enabled() or tg_op<>'UPDATE' or effect.trip_id is distinct from (data->>'trip_id')::uuid
      or not app_private.can_edit_trip(effect.trip_id,auth.uid()) or held.lease_epoch<>effect.lease_epoch
      or held.user_id is distinct from auth.uid() or held.session_id is distinct from effect.session_id
      or held.expires_at is null or held.expires_at<=clock_timestamp() or held.revision<>effect.base_revision
      or not app_private.budget_metadata_supported(k,effect.resource_id)
      or (before_data-(case when effect.group_key='payer' then 'payer_id' else effect.group_key end)-'updated_at') is distinct from (after_data-(case when effect.group_key='payer' then 'payer_id' else effect.group_key end)-'updated_at')
      or after_data->(case when effect.group_key='payer' then 'payer_id' else effect.group_key end) is distinct from effect.value then
      raise exception 'invalid_group_effect' using errcode='55P03'; end if;
  elsif active then raise exception 'group_locked' using errcode='55P03';
  end if;
  -- New Actual links must not bypass a budget's metadata wildcard exclusion.
  if k='actual' then
    if (before_data->>'budget_item_id' is not null and app_private.budget_metadata_live('budget',(before_data->>'budget_item_id')::uuid))
      or (after_data->>'budget_item_id' is not null and app_private.budget_metadata_live('budget',(after_data->>'budget_item_id')::uuid)) then
      raise exception 'group_locked' using errcode='55P03'; end if;
  end if;
  foreach g in array (case when k='budget' then array['title','note','category','payer','links','pricing'] else array['title','note','category','payer','pricing'] end) loop
    if tg_op='INSERT' then
      insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) values(k,(data->>'id')::uuid,g,(data->>'trip_id')::uuid)
        on conflict(kind,resource_id,group_key) do update set is_deleted=false,trip_id=excluded.trip_id,revision=app_private.budget_metadata_groups.revision+1,
          lease_epoch=app_private.budget_metadata_groups.lease_epoch+1,user_id=null,session_id=null,token_hash=null,expires_at=null;
    elsif tg_op='DELETE' then
      update app_private.budget_metadata_groups set revision=revision+1,lease_epoch=lease_epoch+1,is_deleted=true,
        user_id=null,session_id=null,token_hash=null,expires_at=null where kind=k and resource_id=(data->>'id')::uuid and group_key=g;
    elsif before_data->(case when g='payer' then 'payer_id' else g end) is distinct from after_data->(case when g='payer' then 'payer_id' else g end) or before_data->>'trip_id' is distinct from after_data->>'trip_id' then
      update app_private.budget_metadata_groups set revision=revision+1,trip_id=(data->>'trip_id')::uuid
        where kind=k and resource_id=(data->>'id')::uuid and group_key=g;
    end if;
  end loop;
  return null;
end $$;
create or replace function app_private.guard_budget_metadata_children() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; k text; ids uuid[]; resource uuid; price jsonb; effect app_private.budget_metadata_effects; held app_private.budget_metadata_groups;
begin
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  if tg_table_name in ('budget_item_participants','itinerary_budget_items') then
    k:='budget'; ids:=array[(b->>'budget_item_id')::uuid,(a->>'budget_item_id')::uuid];
  elsif tg_table_name='actual_expense_participants' then
    k:='actual'; ids:=array[(b->>'actual_expense_id')::uuid,(a->>'actual_expense_id')::uuid];
  else
    k:='actual'; ids:='{}';
    if b->>'target_type'='actual_expense' then ids:=array_append(ids,(b->>'target_id')::uuid); end if;
    if a->>'target_type'='actual_expense' then ids:=array_append(ids,(a->>'target_id')::uuid); end if;
  end if;
  for resource in select distinct x from unnest(ids) x where x is not null order by x loop
    if tg_table_name in ('budget_item_participants','actual_expense_participants') then
      price:=app_private.budget_pricing_effect(k,resource);
      if price is not null then
        select * into held from app_private.budget_metadata_groups where kind=k and resource_id=resource and group_key='pricing';
        if held.user_id is distinct from auth.uid() or held.expires_at is null or held.expires_at<=clock_timestamp() or held.lease_epoch<>(price->>'epoch')::bigint or held.revision<>(price->>'base')::bigint
          or not app_private.can_edit_trip(held.trip_id,auth.uid()) or not app_private.budget_metadata_enabled()
          or (tg_op='UPDATE' and (b->'user_id',b->'budget_item_id',b->'actual_expense_id') is distinct from (a->'user_id',a->'budget_item_id',a->'actual_expense_id'))
          or (tg_op='DELETE' and (price->'inputs'->'participantIds') ? (b->>'user_id'))
          or (tg_op<>'DELETE' and (not((price->'inputs'->'participantIds') ? (a->>'user_id')) or (a->'share_amount') is distinct from case when price->'inputs'->>'pricing_mode'='custom' then price->'inputs'->'shares'->(a->>'user_id') else 'null'::jsonb end)) then raise exception 'invalid_pricing_participant_effect' using errcode='55P03';end if;
        continue;
      end if;
    end if;
    if tg_table_name='itinerary_budget_items' then
      select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and kind=k and resource_id=resource and group_key='links';
      if found then
        select * into held from app_private.budget_metadata_groups where kind=k and resource_id=resource and group_key='links';
        if tg_op='UPDATE' or not app_private.budget_metadata_enabled() or not app_private.can_edit_trip(effect.trip_id,auth.uid()) or not app_private.budget_metadata_supported(k,resource)
          or held.user_id is distinct from auth.uid() or held.session_id is distinct from effect.session_id or held.lease_epoch<>effect.lease_epoch or held.expires_at<=clock_timestamp()
          or held.revision not in(effect.base_revision,effect.base_revision+1)
          or (tg_op='INSERT' and not(effect.value ? (a->>'itinerary_item_id')))
          or (tg_op='DELETE' and effect.value ? (b->>'itinerary_item_id')) then raise exception 'invalid_link_effect' using errcode='55P03';end if;
        continue;
      end if;
    end if;
    if app_private.budget_metadata_live(k,resource) then raise exception 'group_locked' using errcode='55P03'; end if;
  end loop;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create or replace function app_private.keep_actual_twd_cost() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.twd_amount_source = 'legacy' and new.actual_twd_amount is null then new.actual_twd_amount := new.twd_amount; end if;
  if new.twd_amount_source in ('actual','legacy') then
    if new.actual_twd_amount is null then raise exception 'Actual TWD amount required' using errcode = '22023'; end if;
    new.twd_amount := new.actual_twd_amount;
  else new.actual_twd_amount := null; end if;
  if tg_op = 'UPDATE' and app_private.budget_pricing_effect('actual',new.id) is null and (to_jsonb(new) - 'updated_at' - 'locked_at' - 'locked_by' - 'payment_origin')
    is distinct from (to_jsonb(old) - 'updated_at' - 'locked_at' - 'locked_by' - 'payment_origin') then new.payment_origin := 'manual'; end if;
  return new;
end $$;
create or replace function app_private.apply_trip_budget_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_trip public.trips; v_rate numeric; v_departed boolean;
begin
  if app_private.budget_pricing_effect('budget',new.id) is not null then return new;end if;
  if tg_op = 'UPDATE' and new.currency is not distinct from old.currency and new.amount is not distinct from old.amount
    and new.exchange_rate is not distinct from old.exchange_rate and new.twd_amount is not distinct from old.twd_amount
    and new.pricing_mode is not distinct from old.pricing_mode and new.unit_amount is not distinct from old.unit_amount then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.trip_id::text,0));
  select * into v_trip from public.trips where id = new.trip_id;
  v_departed := v_trip.status = 'settled' or v_trip.start_date::timestamp at time zone 'Asia/Taipei' <= clock_timestamp()
    or exists(select 1 from public.trip_budget_baselines where trip_id = new.trip_id and departure_at <= clock_timestamp());
  if tg_op = 'UPDATE' and v_departed and old.currency <> 'TWD' then
    raise exception '已出發的外幣預算保留原金額與匯率，只能修改名稱、備註等資訊。' using errcode = '22023';
  end if;
  if v_trip.budget_exchange_rates ? 'rates' and new.currency <> 'TWD' then
    v_rate := (v_trip.budget_exchange_rates->'rates'->>new.currency)::numeric;
    if v_rate is null or v_rate <= 0 then raise exception 'Missing trip currency rate' using errcode = '22023'; end if;
    new.exchange_rate := v_rate; new.twd_amount := round(new.amount*v_rate);
  end if;
  return new;
end $$;
create or replace function app_private.capture_budget_metadata_undo_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; rec jsonb; k text; linked uuid; effect app_private.budget_metadata_effects;
begin
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  rec:=coalesce(a,b); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  if app_private.budget_pricing_effect(k,(rec->>'id')::uuid) is not null then return null;end if;
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current()
    and backend_id=pg_backend_pid() and user_id=auth.uid() and kind=k and resource_id=(rec->>'id')::uuid;
  if found and effect.group_key in ('category','payer','links') then return null; end if;
  if found and tg_op='UPDATE' then
    if app_private.budget_metadata_undo_enabled() and b->effect.group_key is distinct from a->effect.group_key then
      update app_private.budget_metadata_effects set undo_before_value=b->effect.group_key
        where transaction_id=effect.transaction_id and backend_id=effect.backend_id;
    end if;
  elsif tg_op<>'UPDATE' or (b-'updated_at'-'locked_by'-'locked_at') is distinct from (a-'updated_at'-'locked_by'-'locked_at') then
    -- Legacy operations carry no trustworthy origin-tab ID: conservatively
    -- clear this actor's trip stacks, and fence this record for every actor.
    perform app_private.invalidate_budget_metadata_undo((rec->>'trip_id')::uuid,k,(rec->>'id')::uuid);
    if b->>'trip_id' is distinct from a->>'trip_id' and b is not null then
      perform app_private.invalidate_budget_metadata_undo((b->>'trip_id')::uuid,k,(b->>'id')::uuid);
    end if;
    if k='actual' then
      for linked in select distinct x from unnest(array[(b->>'budget_item_id')::uuid,(a->>'budget_item_id')::uuid,
        (b->>'budget_origin_id')::uuid,(a->>'budget_origin_id')::uuid]) x where x is not null order by x loop
        perform app_private.invalidate_budget_metadata_undo((rec->>'trip_id')::uuid,'budget',linked);
        if b->>'trip_id' is distinct from a->>'trip_id' and b is not null then
          perform app_private.invalidate_budget_metadata_undo((b->>'trip_id')::uuid,'budget',linked);
        end if;
      end loop;
    end if;
  end if;
  return null;
end $$;
create or replace function app_private.record_budget_metadata_undo() returns trigger
language plpgsql security definer set search_path='' as $$
declare effect app_private.budget_metadata_effects; intent app_private.budget_metadata_undo_intents;
  op app_private.budget_metadata_undo_operations; lineage app_private.budget_metadata_undo_lineage;
  expected bigint; previous uuid; changed boolean; result jsonb;
begin
  if not app_private.budget_metadata_undo_enabled() then return new; end if;
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current()
    and backend_id=pg_backend_pid() and user_id=new.user_id and request_id=new.request_id;
  if not found or effect.user_id is distinct from auth.uid() or effect.trip_id<>new.trip_id
    or effect.session_id<>new.session_id then raise exception 'invalid_undo_capture' using errcode='42501'; end if;
  if effect.group_key in ('category','payer','links','pricing') then return new;end if;
  changed:=(new.result->>'revision')::bigint=effect.base_revision+1;
  select * into intent from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid();
  if found then
    select * into op from app_private.budget_metadata_undo_operations where user_id=intent.user_id and operation_id=intent.operation_id;
    select expected_revision into expected from app_private.budget_metadata_undo_stack where user_id=intent.user_id
      and session_id=intent.session_id and trip_id=intent.trip_id and operation_id=intent.operation_id;
    if not changed or intent.request_id<>new.request_id or intent.user_id<>new.user_id or intent.trip_id<>new.trip_id
      or intent.session_id<>new.session_id or op.kind<>effect.kind or op.resource_id<>effect.resource_id
      or op.group_key<>effect.group_key or expected is distinct from effect.base_revision
      or effect.undo_before_value is distinct from op.after_value or effect.value is distinct from op.before_value then
      raise exception 'invalid_undo_effect' using errcode='40001'; end if;
    if exists(select 1 from app_private.budget_metadata_undo_stack s join app_private.budget_metadata_undo_operations prior
      on prior.user_id=s.user_id and prior.operation_id=s.operation_id
      where s.user_id=op.user_id and s.session_id=op.session_id and s.trip_id=op.trip_id and s.operation_id=op.predecessor
        and (s.expected_revision<>op.before_revision or prior.after_value is distinct from op.before_value
          or prior.kind<>op.kind or prior.resource_id<>op.resource_id or prior.group_key<>op.group_key)) then
      raise exception 'undo_predecessor_conflict' using errcode='40001'; end if;
    delete from app_private.budget_metadata_undo_stack where user_id=intent.user_id and session_id=intent.session_id
      and trip_id=intent.trip_id and operation_id=intent.operation_id;
    -- Advance only the proven predecessor of this exact group. Interleaved
    -- unrelated groups keep their expected revisions and normal stack order.
    update app_private.budget_metadata_undo_stack set expected_revision=(new.result->>'revision')::bigint
      where user_id=op.user_id and session_id=op.session_id and trip_id=op.trip_id
        and operation_id=op.predecessor and expected_revision=op.before_revision;
    update app_private.budget_metadata_undo_lineage set operation_id=op.predecessor,revision=(new.result->>'revision')::bigint
      where kind=op.kind and resource_id=op.resource_id and group_key=op.group_key;
    result:=new.result||jsonb_build_object('undo_of',op.operation_id);
    insert into app_private.budget_metadata_undo_receipts values(new.user_id,new.request_id,new.trip_id,new.session_id,op.operation_id,result);
    delete from app_private.budget_metadata_undo_intents where transaction_id=intent.transaction_id and backend_id=intent.backend_id;
  elsif changed then
    if effect.undo_before_value is null then raise exception 'missing_undo_before_image' using errcode='40001'; end if;
    -- The existing patch RPC canonicalizes text. An old noncanonical image
    -- cannot be restored byte-for-byte through it, so keep it out of Undo.
    if effect.group_key='title' and coalesce(btrim(effect.undo_before_value#>>'{}'),'')=''
      or effect.undo_before_value is distinct from (case when effect.group_key='title'
      then to_jsonb(btrim(effect.undo_before_value#>>'{}'))
      else coalesce(to_jsonb(nullif(btrim(effect.undo_before_value#>>'{}'),'')),'null'::jsonb) end) then
      perform app_private.invalidate_budget_metadata_undo(effect.trip_id,effect.kind,effect.resource_id);
      return new;
    end if;
    select * into lineage from app_private.budget_metadata_undo_lineage where kind=effect.kind
      and resource_id=effect.resource_id and group_key=effect.group_key;
    if found and lineage.user_id=effect.user_id and lineage.session_id=effect.session_id and lineage.revision=effect.base_revision then
      previous:=lineage.operation_id;
    end if;
    insert into app_private.budget_metadata_undo_operations values(effect.user_id,effect.request_id,effect.trip_id,effect.session_id,
      effect.kind,effect.resource_id,effect.group_key,effect.undo_before_value,effect.value,effect.base_revision,
      (new.result->>'revision')::bigint,previous);
    insert into app_private.budget_metadata_undo_stack(user_id,session_id,trip_id,operation_id,expected_revision)
      values(effect.user_id,effect.session_id,effect.trip_id,effect.request_id,(new.result->>'revision')::bigint);
    delete from app_private.budget_metadata_undo_stack where position in (
      select position from app_private.budget_metadata_undo_stack where user_id=effect.user_id and session_id=effect.session_id
        and trip_id=effect.trip_id order by position desc offset 5);
    insert into app_private.budget_metadata_undo_lineage values(effect.kind,effect.resource_id,effect.group_key,effect.trip_id,
      effect.user_id,effect.session_id,effect.request_id,(new.result->>'revision')::bigint)
      on conflict(kind,resource_id,group_key) do update set trip_id=excluded.trip_id,user_id=excluded.user_id,
        session_id=excluded.session_id,operation_id=excluded.operation_id,revision=excluded.revision;
  end if;
  return new;
end $$;
create or replace function app_private.guard_budget_metadata_undo_boundary() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; rec jsonb; k text; ids uuid[]; resource uuid; trip uuid;
begin
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  if tg_op='UPDATE' and b is not distinct from a then return null; end if;
  if tg_table_name='itinerary_budget_items' and exists(select 1 from app_private.budget_metadata_effects e where e.transaction_id=txid_current() and e.backend_id=pg_backend_pid() and e.user_id=auth.uid() and e.kind='budget' and e.group_key='links'
    and e.resource_id=coalesce((a->>'budget_item_id')::uuid,(b->>'budget_item_id')::uuid)) then return null;end if;
  if tg_table_name='trip_members' then
    rec:=coalesce(a,b);
    if tg_op<>'UPDATE' or (b->'role',b->'status',b->'user_id',b->'trip_id') is distinct from (a->'role',a->'status',a->'user_id',a->'trip_id') then
      delete from app_private.budget_metadata_undo_stack where trip_id=(rec->>'trip_id')::uuid and user_id=(rec->>'user_id')::uuid;
      if b is not null then delete from app_private.budget_metadata_undo_stack where trip_id=(b->>'trip_id')::uuid and user_id=(b->>'user_id')::uuid; end if;
    end if; return null;
  elsif tg_table_name='trips' then
    if (b->'budget_exchange_rates',b->'start_date',b->'end_date') is distinct from (a->'budget_exchange_rates',a->'start_date',a->'end_date') then
      perform app_private.invalidate_budget_metadata_undo((a->>'id')::uuid);
    end if; return null;
  end if;
  if tg_table_name in ('budget_item_participants','itinerary_budget_items') then
    k:='budget';ids:=array[(b->>'budget_item_id')::uuid,(a->>'budget_item_id')::uuid];
  elsif tg_table_name='actual_expense_participants' then
    k:='actual';ids:=array[(b->>'actual_expense_id')::uuid,(a->>'actual_expense_id')::uuid];
  else
    k:='actual';ids:='{}';
    if b->>'target_type'='actual_expense' then ids:=array_append(ids,(b->>'target_id')::uuid);end if;
    if a->>'target_type'='actual_expense' then ids:=array_append(ids,(a->>'target_id')::uuid);end if;
  end if;
  for resource in select distinct x from unnest(ids) x where x is not null order by x loop
    if app_private.budget_pricing_effect(k,resource) is not null then continue;end if;
    rec:=app_private.budget_metadata_record(k,resource);trip:=(rec->>'trip_id')::uuid;
    if trip is null then select trip_id into trip from app_private.budget_metadata_groups where kind=k and resource_id=resource limit 1;end if;
    perform app_private.invalidate_budget_metadata_undo(trip,k,resource);
  end loop;
  return null;
end $$;
create function public.patch_budget_pricing_group(p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_base_revision bigint,p_session_id uuid,p_token uuid,p_epoch bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare admission jsonb;t jsonb;v jsonb;rid uuid;
begin
 admission:=app_private.prepare_budget_pricing_patch(p_trip_id,p_kind,p_id,p_group,p_base_revision,p_session_id,p_token,p_epoch,p_patch,p_request_id);
 if (admission->>'replayed')::boolean then return admission->'result';end if;
 if not(admission->>'noop')::boolean then
  for t in select x from jsonb_array_elements(admission->'targets') x loop
   rid:=(t->>'id')::uuid;v:=t->'fields';
   if t->>'kind'='budget' then
    update public.budget_items b set amount=(v->>'amount')::numeric,unit_amount=(v->>'unit_amount')::numeric,currency=v->>'currency',exchange_rate=(v->>'exchange_rate')::numeric,twd_amount=(v->>'twd_amount')::numeric,pricing_mode=v->>'pricing_mode',split_type=v->>'split_type'
     where id=rid and trip_id=p_trip_id and not(to_jsonb(b) @> v);
    delete from public.budget_item_participants where budget_item_id=rid and not(user_id::text in(select jsonb_array_elements_text(t->'inputs'->'participantIds')));
    insert into public.budget_item_participants(budget_item_id,user_id,share_amount) select rid,u::uuid,case when t->'inputs'->>'pricing_mode'='custom' then (t->'inputs'->'shares'->>u)::numeric end from jsonb_array_elements_text(t->'inputs'->'participantIds') u
     on conflict(budget_item_id,user_id) do update set share_amount=excluded.share_amount where public.budget_item_participants.share_amount is distinct from excluded.share_amount;
   else
    update public.actual_expenses a set amount=(v->>'amount')::numeric,unit_amount=(v->>'unit_amount')::numeric,currency=v->>'currency',exchange_rate=(v->>'exchange_rate')::numeric,twd_amount=(v->>'twd_amount')::numeric,pricing_mode=v->>'pricing_mode',split_type=v->>'split_type'
     where id=rid and trip_id=p_trip_id and not(to_jsonb(a) @> v);
    delete from public.actual_expense_participants where actual_expense_id=rid and not(user_id::text in(select jsonb_array_elements_text(t->'inputs'->'participantIds')));
    insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) select rid,u::uuid,case when t->'inputs'->>'pricing_mode'='custom' then (t->'inputs'->'shares'->>u)::numeric end from jsonb_array_elements_text(t->'inputs'->'participantIds') u
     on conflict(actual_expense_id,user_id) do update set share_amount=excluded.share_amount where public.actual_expense_participants.share_amount is distinct from excluded.share_amount;
   end if;
  end loop;
 end if;
 return app_private.finish_budget_pricing_patch();
end $$;
revoke all on function public.patch_budget_pricing_group(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid) from public,anon;
grant execute on function public.patch_budget_pricing_group(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid) to authenticated;

create or replace function public.patch_budget_metadata_group(
  p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_base_revision bigint,p_session_id uuid,p_token uuid,p_epoch bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare admission jsonb;
begin
  if p_group='pricing' then return public.patch_budget_pricing_group(p_trip_id,p_kind,p_id,p_group,p_base_revision,p_session_id,p_token,p_epoch,p_patch,p_request_id);end if;
  admission:=app_private.prepare_budget_metadata_patch(p_trip_id,p_kind,p_id,p_group,p_base_revision,p_session_id,p_token,p_epoch,p_patch,p_request_id);
  if (admission->>'replayed')::boolean then return admission->'result'; end if;
  if p_group='links' then
    if not (admission->>'noop')::boolean then
      delete from public.itinerary_budget_items where budget_item_id=p_id and itinerary_item_id not in(select v::uuid from jsonb_array_elements_text(admission->'value') v);
      insert into public.itinerary_budget_items(budget_item_id,itinerary_item_id)
        select p_id,v::uuid from jsonb_array_elements_text(admission->'value') v on conflict do nothing;
    end if;
  elsif not (admission->>'noop')::boolean then
    if p_kind='budget' then
      if p_group='title' then update public.budget_items set title=admission->>'value' where id=p_id and trip_id=p_trip_id;
      elsif p_group='category' then update public.budget_items set category=admission->>'value' where id=p_id and trip_id=p_trip_id;
      elsif p_group='payer' then update public.budget_items set payer_id=(admission->>'value')::uuid where id=p_id and trip_id=p_trip_id;
      else update public.budget_items set note=admission->>'value' where id=p_id and trip_id=p_trip_id; end if;
    else
      if p_group='title' then update public.actual_expenses set title=admission->>'value' where id=p_id and trip_id=p_trip_id;
      elsif p_group='category' then update public.actual_expenses set category=admission->>'value' where id=p_id and trip_id=p_trip_id;
      elsif p_group='payer' then update public.actual_expenses set payer_id=(admission->>'value')::uuid where id=p_id and trip_id=p_trip_id;
      else update public.actual_expenses set note=admission->>'value' where id=p_id and trip_id=p_trip_id; end if;
    end if;
    if not found then raise exception 'Record missing' using errcode='40001'; end if;
  end if;
  return app_private.finish_budget_metadata_patch();
end $$;
create or replace function app_private.read_budget_metadata_state_v3(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with allowed as materialized (
    select p_trip_id id where auth.uid() is not null
      and app_private.can_read_trip(p_trip_id,auth.uid())
  ), resources as materialized (
    select 'budget'::text kind,b.id,b.trip_id,b.title,b.note,b.category,b.payer_id,
      app_private.budget_metadata_supported('budget',b.id) supported
      from public.budget_items b join allowed t on b.trip_id=t.id
    union all
    select 'actual',a.id,a.trip_id,a.title,a.note,a.category,a.payer_id,
      app_private.budget_metadata_supported('actual',a.id)
      from public.actual_expenses a join allowed t on a.trip_id=t.id
  ), states as materialized (
    select r.kind,r.id,r.trip_id,r.supported,k.group_key,case when k.group_key='pricing' then app_private.budget_pricing_targets(r.kind,r.id) is not null else r.supported end group_supported,
      case when k.group_key='pricing' then app_private.read_budget_pricing_value(r.kind,r.id) else app_private.budget_metadata_value(r.kind,r.id,k.group_key) end value,
      g.revision,g.lease_epoch epoch,
      coalesce(not g.is_deleted and g.user_id is not null and g.expires_at>statement_timestamp()
        and app_private.can_edit_trip(r.trip_id,g.user_id),false) held,
      g.user_id,g.session_id,g.expires_at
    from resources r cross join unnest(case when r.kind='budget' then array['title','note','category','payer','links','pricing'] else array['title','note','category','payer','pricing'] end) k(group_key)
    left join app_private.budget_metadata_groups g on g.kind=r.kind and g.resource_id=r.id
      and g.group_key=k.group_key and g.trip_id=r.trip_id and not g.is_deleted
  ), records as (
    select kind,id,trip_id,bool_and(supported) supported,
      bool_and(revision is not null) state_ready,
      jsonb_agg(jsonb_build_object('group',group_key,'supported',group_supported,'value',value,'revision',revision,'epoch',epoch,
        'held',held,'owner_id',case when held then user_id end,
        'own_session',coalesce(held and user_id=auth.uid() and session_id=p_session_id,false),
        'expires_at',case when held then expires_at end) order by group_key) groups
    from states group by kind,id,trip_id
  )
  select jsonb_build_object('protocol',jsonb_build_object('name','metadata-prototype','schemaVersion',3,
      'enabled',app_private.budget_metadata_enabled(),'complete',false,'groups',jsonb_build_array('title','note','category','payer','links','pricing')),
    'records',coalesce((select jsonb_agg(to_jsonb(r) order by r.kind,r.id) from records r),'[]'),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('kind',s.kind,'resource_id',s.id,
      'group_key',s.group_key,'user_id',s.user_id,'expires_at',s.expires_at,'mode','edit',
      'own_session',coalesce(s.user_id=auth.uid() and s.session_id=p_session_id,false),
      'selected_at',null) order by s.kind,s.id,s.group_key) from states s where s.held),'[]'))
  from allowed
$$;
revoke all on function app_private.read_budget_metadata_state_v3(uuid,uuid) from public,anon;
grant execute on function app_private.read_budget_metadata_state_v3(uuid,uuid) to authenticated;

create or replace function public.read_budget_metadata_snapshot_v3(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with financial as materialized (
    select public.read_budget_snapshot(p_trip_id) data
  ), metadata as materialized (
    select app_private.read_budget_metadata_state_v3(p_trip_id,p_session_id) data
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
revoke all on function public.read_budget_metadata_snapshot_v3(uuid,uuid) from public,anon;
grant execute on function public.read_budget_metadata_snapshot_v3(uuid,uuid) to authenticated;

create or replace function public.save_budget_workspace_record(
  p_trip_id uuid, p_kind text, p_id uuid, p_base_updated_at timestamptz, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_mode text := coalesce(p_payload->>'pricing_mode','split_total');
  v_currency text := upper(coalesce(nullif(btrim(p_payload->>'currency'),''),'TWD'));
  v_calc jsonb; v_rate numeric;
  v_amount numeric;
  v_unit numeric;
  v_total_twd numeric;
  v_participants uuid[];
  v_links uuid[];
  v_shares jsonb := coalesce(p_payload->'shares','{}'::jsonb);
  v_payer uuid := nullif(p_payload->>'payer_id','')::uuid;
  v_source uuid := nullif(p_payload->>'budget_item_id','')::uuid;
  v_existing public.budget_items;
  v_actual public.actual_expenses;
  v_fixed_id uuid;
  v_user uuid;
  v_share numeric;
  v_title text := btrim(p_payload->>'title');
  v_category text := coalesce(nullif(btrim(p_payload->>'category'),''),'其他');
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id, auth.uid()) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if coalesce(p_kind,'') not in ('budget','actual') or v_mode not in ('per_person','split_total','custom') or coalesce(v_title,'') = '' then raise exception 'Invalid budget input' using errcode = '22023'; end if;
  if jsonb_typeof(p_payload->'participantIds') is distinct from 'array' then raise exception 'Participants required' using errcode = '22023'; end if;
  select array_agg(distinct value::uuid order by value::uuid) into v_participants from jsonb_array_elements_text(p_payload->'participantIds');
  if coalesce(cardinality(v_participants),0) = 0 or exists (
    select 1 from unnest(v_participants) u where not exists (select 1 from public.trip_members m where m.trip_id = p_trip_id and m.user_id = u and m.status = 'approved')
  ) then raise exception 'Invalid participants' using errcode = '22023'; end if;
  if v_payer is not null and not exists (select 1 from public.trip_members where trip_id = p_trip_id and user_id = v_payer and status = 'approved') then raise exception 'Invalid payer' using errcode = '22023'; end if;
  if v_source is not null and not exists (select 1 from public.budget_items where id = v_source and trip_id = p_trip_id) then raise exception 'Invalid source budget' using errcode = '22023'; end if;
  select array_agg(distinct value::uuid) into v_links from jsonb_array_elements_text(coalesce(p_payload->'linkedItemIds','[]'::jsonb));
  if exists (select 1 from unnest(v_links) u where not exists (select 1 from public.itinerary_items where id = u and trip_id = p_trip_id)) then raise exception 'Invalid itinerary link' using errcode = '22023'; end if;
  v_calc:=app_private.calculate_budget_group_pricing(p_payload||jsonb_build_object('pricing_mode',v_mode,'currency',v_currency));
  v_rate:=(v_calc->>'exchange_rate')::numeric;v_amount:=(v_calc->>'amount')::numeric;v_unit:=(v_calc->>'unit_amount')::numeric;v_total_twd:=(v_calc->>'twd_amount')::numeric;

  if p_kind = 'budget' then
    if p_id is not null then
      select * into v_existing from public.budget_items where id = p_id and trip_id = p_trip_id for update;
      if not found then raise exception 'Budget missing' using errcode = '40001'; end if;
      if p_base_updated_at is null or v_existing.updated_at <> p_base_updated_at then raise exception 'Budget changed' using errcode = '40001'; end if;
      if v_existing.locked_by is not null and v_existing.locked_by <> auth.uid() and v_existing.locked_at > clock_timestamp() - interval '7 minutes' then raise exception 'Budget locked' using errcode = '55P03'; end if;
    end if;
    insert into public.budget_items(id,trip_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,is_fixed,note)
    values(v_id,p_trip_id,v_category,nullif(btrim(p_payload->>'subcategory'),''),v_title,v_amount,v_currency,v_rate,v_total_twd,v_payer,v_mode,v_unit,case when v_mode = 'custom' then 'custom' else 'equal' end,coalesce((p_payload->>'is_fixed')::boolean,false),nullif(btrim(p_payload->>'note'),''))
    on conflict (id) do update set category = excluded.category, subcategory = excluded.subcategory,title = excluded.title,amount = excluded.amount,currency = excluded.currency,exchange_rate = excluded.exchange_rate,twd_amount = excluded.twd_amount,payer_id = excluded.payer_id,pricing_mode = excluded.pricing_mode,unit_amount = excluded.unit_amount,split_type = excluded.split_type,is_fixed = excluded.is_fixed,note = excluded.note;
    delete from public.budget_item_participants where budget_item_id = v_id;
    foreach v_user in array v_participants loop
      -- Only custom weights need persisted shares. Equal shares derive from
      -- total, including fractional original cents, without independent sums.
      insert into public.budget_item_participants(budget_item_id,user_id,share_amount) values (v_id,v_user,case when v_mode = 'custom' then (v_shares->>v_user::text)::numeric else null end);
    end loop;
    delete from public.itinerary_budget_items where budget_item_id = v_id;
    insert into public.itinerary_budget_items(budget_item_id,itinerary_item_id) select v_id,unnest(v_links);
    -- Fixed means create once, never overwrite an already edited actual.
    if coalesce((p_payload->>'is_fixed')::boolean,false) and not exists (select 1 from public.actual_expenses where budget_item_id = v_id) then
      v_fixed_id := gen_random_uuid();
      insert into public.actual_expenses(id,trip_id,budget_item_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,note)
      select v_fixed_id,trip_id,id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,note from public.budget_items where id = v_id;
      insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) select v_fixed_id,user_id,share_amount from public.budget_item_participants where budget_item_id = v_id;
      update public.budget_items set auto_created_actual_expense_id = v_fixed_id where id = v_id;
    end if;
    update public.budget_items set locked_by = null, locked_at = null where id = v_id and locked_by = auth.uid();
  else
    if p_id is not null then
      select * into v_actual from public.actual_expenses where id = p_id and trip_id = p_trip_id for update;
      if not found or p_base_updated_at is null or v_actual.updated_at <> p_base_updated_at then raise exception 'Expense changed' using errcode = '40001'; end if;
      if v_actual.locked_by is not null and v_actual.locked_by <> auth.uid() and v_actual.locked_at > clock_timestamp() - interval '7 minutes' then raise exception 'Expense locked' using errcode = '55P03'; end if;
    end if;
    insert into public.actual_expenses(id,trip_id,budget_item_id,category,subcategory,title,amount,currency,exchange_rate,twd_amount,payer_id,pricing_mode,unit_amount,split_type,paid_at,note)
    values(v_id,p_trip_id,v_source,v_category,nullif(btrim(p_payload->>'subcategory'),''),v_title,v_amount,v_currency,v_rate,v_total_twd,v_payer,v_mode,v_unit,case when v_mode = 'custom' then 'custom' else 'equal' end,coalesce(nullif(p_payload->>'paid_at','')::timestamptz,clock_timestamp()),nullif(btrim(p_payload->>'note'),''))
    on conflict (id) do update set budget_item_id = excluded.budget_item_id,category = excluded.category,subcategory = excluded.subcategory,title = excluded.title,amount = excluded.amount,currency = excluded.currency,exchange_rate = excluded.exchange_rate,twd_amount = excluded.twd_amount,payer_id = excluded.payer_id,pricing_mode = excluded.pricing_mode,unit_amount = excluded.unit_amount,split_type = excluded.split_type,paid_at = excluded.paid_at,note = excluded.note;
    delete from public.actual_expense_participants where actual_expense_id = v_id;
    foreach v_user in array v_participants loop
      insert into public.actual_expense_participants(actual_expense_id,user_id,share_amount) values (v_id,v_user,case when v_mode = 'custom' then (v_shares->>v_user::text)::numeric else null end);
    end loop;
    update public.actual_expenses set locked_by = null, locked_at = null where id = v_id and locked_by = auth.uid();
  end if;
  return jsonb_build_object('id',v_id);
end;
$$;
commit;
