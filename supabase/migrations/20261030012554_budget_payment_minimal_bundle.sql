-- B-4a minimal long leases; committed dependency checks remain authoritative. Default-off protocols are unchanged.
begin;
create or replace function app_private.budget_payment_dependencies(k text,rid uuid,intent text) returns jsonb language sql stable security definer set search_path='' as $$
 with targets as materialized(select app_private.budget_payment_targets(k,rid) v)
 select coalesce(jsonb_agg(jsonb_build_object('kind',t->>'kind','id',t->'id','group',g) order by t->>'kind',t->>'id',g),'[]')
 from targets cross join lateral jsonb_array_elements(v) t
 cross join lateral unnest(case when k='budget' and jsonb_array_length(v)=1 and intent='paid' then array['payment','pricing','payer'] else array['payment'] end) g
$$;
revoke all on function app_private.budget_payment_dependencies(text,uuid,text) from public,anon,authenticated;
create or replace function app_private.budget_payment_dependencies(k text,rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select app_private.budget_payment_dependencies(k,rid,case when k='budget' then 'paid' else 'set_paid_at' end)
$$;
create function app_private.budget_payment_checks(k text,rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with targets as(select t->>'kind' kind,(t->>'id')::uuid id from jsonb_array_elements(app_private.budget_payment_targets(k,rid)) t
 union select 'budget',(app_private.budget_metadata_record(k,rid)->>'budget_item_id')::uuid where k='actual' and app_private.budget_metadata_record(k,rid)->>'budget_item_id' is not null)
 select coalesce(jsonb_agg(jsonb_build_object('kind',t.kind,'id',t.id,'group',g.group_key,'revision',g.revision,'graph',g.graph_revision) order by t.kind,t.id,g.group_key),'[]')
 from targets t join app_private.budget_metadata_groups g on g.kind=t.kind and g.resource_id=t.id and g.group_key in('pricing','payer')
$$;
revoke all on function app_private.budget_payment_checks(text,uuid) from public,anon,authenticated;

create or replace function app_private.budget_payment_value(k text,rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with r as(select app_private.budget_metadata_record(k,rid) v),dep as(select app_private.budget_payment_dependencies(k,rid) d)
 select jsonb_build_object('active',case when k='actual' then (r.v->>'payment_active')::boolean else exists(select 1 from public.actual_expenses where budget_item_id=rid and payment_active) end,
 'paid_at',case when k='actual' then r.v->'paid_at' else 'null'::jsonb end,'versions',jsonb_build_object(
 'rates',v.rates,'members',v.members,'graph',g.graph_revision,
 'source',coalesce((select graph_revision from app_private.budget_metadata_groups where kind='budget' and resource_id=(r.v->>'budget_item_id')::uuid and group_key='pricing'),0),
 'checks',app_private.budget_payment_checks(k,rid),'targets',coalesce((select jsonb_agg(x||jsonb_build_object('revision',p.revision) order by x->>'kind',x->>'id',x->>'group') from jsonb_array_elements(dep.d) x join app_private.budget_metadata_groups p on p.kind=x->>'kind' and p.resource_id=(x->>'id')::uuid and p.group_key=x->>'group'),'[]')))
 from r,dep,app_private.budget_metadata_groups g,app_private.budget_pricing_trip_versions v
 where g.kind=k and g.resource_id=rid and g.group_key='pricing' and v.trip_id=g.trip_id
$$;
create or replace function app_private.budget_payment_admission_v2(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_revision bigint,p_epoch bigint,p_versions jsonb,p_intent text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();root app_private.budget_metadata_groups;g app_private.budget_metadata_groups;deps jsonb;d jsonb;epochs jsonb:='[]';bundle jsonb;rec jsonb;stamp timestamptz;
begin
 if actor is null then raise exception 'Forbidden' using errcode='42501';end if;
 if p_trip_id is null or p_kind not in('budget','actual') or p_kind is null or p_id is null or p_session_id is null or p_token is null or p_action is null or p_action not in('acquire','renew','release') then raise exception 'Invalid payment lease' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 select * into root from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and trip_id=p_trip_id and group_key='payment' for update;
 if p_action='release' then
  if root.user_id=actor and root.session_id=p_session_id and root.token_hash=sha256(convert_to(p_token::text,'UTF8')) and root.lease_epoch=p_epoch and root.payment_bundle->>'kind'=p_kind and root.payment_bundle->>'id'=p_id::text then
   update app_private.budget_metadata_groups set user_id=null,session_id=null,token_hash=null,expires_at=null,payment_bundle=null where trip_id=p_trip_id and payment_bundle=root.payment_bundle and user_id=actor and session_id=p_session_id and token_hash=root.token_hash and exists(select 1 from jsonb_array_elements(root.payment_bundle->'epochs') e where e->>'kind'=kind and (e->>'id')::uuid=resource_id and e->>'group'=group_key and (e->>'epoch')::bigint=lease_epoch);
  end if;return jsonb_build_object('granted',true);
 end if;
 if p_intent is null or (p_kind='budget' and p_intent not in('paid','unpaid')) or (p_kind='actual' and p_intent<>'set_paid_at') then raise exception 'Invalid payment intent' using errcode='22023';end if;
 if not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 if not app_private.budget_payment_enabled() then raise exception 'payment_protocol_disabled' using errcode='55000';end if;
 if root.resource_id is null or root.is_deleted then raise exception 'Payment resource missing' using errcode='42501';end if;
 deps:=app_private.budget_payment_dependencies(p_kind,p_id,p_intent);
 if deps='[]' or app_private.budget_payment_targets(p_kind,p_id) is null then raise exception 'payment_dependency_not_supported' using errcode='0A000';end if;
 if root.revision is distinct from p_base_revision or p_versions is distinct from app_private.budget_payment_value(p_kind,p_id)->'versions' then raise exception 'payment_dependency_changed' using errcode='40001';end if;
 if root.expires_at>clock_timestamp() and root.user_id=actor and root.session_id=p_session_id and root.token_hash=sha256(convert_to(p_token::text,'UTF8')) and root.payment_bundle->>'intent' is distinct from p_intent then raise exception 'payment_intent_changed' using errcode='40001';end if;
 if p_action='renew' and (root.user_id is distinct from actor or root.session_id is distinct from p_session_id or root.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) or root.lease_epoch is distinct from p_epoch or root.expires_at is null or root.expires_at<=clock_timestamp()) then return jsonb_build_object('granted',false);end if;
 for d in select x from jsonb_array_elements(deps) x loop
  if d->>'kind'='budget' then perform 1 from public.budget_items where id=(d->>'id')::uuid for update nowait;else perform 1 from public.actual_expenses where id=(d->>'id')::uuid for update nowait;end if;
  select * into g from app_private.budget_metadata_groups where kind=d->>'kind' and resource_id=(d->>'id')::uuid and group_key=d->>'group' for update;
  rec:=app_private.budget_metadata_record(g.kind,g.resource_id);
  if exists(select 1 from app_private.budget_edit_leases where kind=g.kind and resource_id=g.resource_id and expires_at>clock_timestamp()) or rec->>'locked_by' is not null and (rec->>'locked_at')::timestamptz>clock_timestamp()-interval '7 minutes' then return jsonb_build_object('granted',false,'reason','legacy_locked');end if;
  if g.user_id is not null and g.expires_at>clock_timestamp() and (g.user_id is distinct from actor or g.session_id is distinct from p_session_id or g.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) or g.payment_bundle->>'kind' is distinct from p_kind or g.payment_bundle->>'id' is distinct from p_id::text) then return jsonb_build_object('granted',false,'reason','dependency_locked');end if;
  if p_action='renew' and (g.expires_at is null or g.expires_at<=clock_timestamp() or g.payment_bundle is distinct from root.payment_bundle) then return jsonb_build_object('granted',false);end if;
  epochs:=epochs||jsonb_build_array(d||jsonb_build_object('epoch',g.lease_epoch+case when g.expires_at is null or g.expires_at<=clock_timestamp() or g.user_id is null then 1 else 0 end));
 end loop;
 stamp:=clock_timestamp();bundle:=jsonb_build_object('kind',p_kind,'id',p_id,'versions',p_versions,'epochs',epochs,'intent',p_intent);
 for d in select x from jsonb_array_elements(epochs) x loop
  update app_private.budget_metadata_groups set user_id=actor,session_id=p_session_id,token_hash=sha256(convert_to(p_token::text,'UTF8')),lease_epoch=(d->>'epoch')::bigint,expires_at=stamp+interval '2 minutes',payment_bundle=bundle,pricing_bundle=null,dirty=false,last_activity_at=stamp
   where kind=d->>'kind' and resource_id=(d->>'id')::uuid and group_key=d->>'group';
 end loop;
 select * into root from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and group_key='payment';
 return jsonb_build_object('granted',true,'epoch',root.lease_epoch,'revision',root.revision,'expires_at',root.expires_at,'value',app_private.budget_payment_value(p_kind,p_id),'intent',p_intent,'targets',epochs);
end $$;
revoke all on function app_private.budget_payment_admission_v2(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,text) from public,anon;
grant execute on function app_private.budget_payment_admission_v2(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,text) to authenticated;
create function public.budget_payment_lease_v2(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_revision bigint,p_epoch bigint,p_versions jsonb,p_intent text) returns jsonb
language sql security invoker set search_path='' as $$select app_private.budget_payment_admission_v2(p_trip_id,p_kind,p_id,p_session_id,p_token,p_action,p_base_revision,p_epoch,p_versions,p_intent)$$;
revoke all on function public.budget_payment_lease_v2(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,text) from public,anon;
grant execute on function public.budget_payment_lease_v2(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,text) to authenticated;
create or replace function app_private.budget_payment_admission(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_revision bigint,p_epoch bigint,p_versions jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if p_action='release' then return app_private.budget_payment_admission_v2(p_trip_id,p_kind,p_id,p_session_id,p_token,p_action,p_base_revision,p_epoch,p_versions,null);end if;
 raise exception 'payment_intent_protocol_required' using errcode='55000';
end $$;
create function public.read_budget_metadata_snapshot_v5(p_trip_id uuid,p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_set(jsonb_set(v,'{metadataProtocol,schemaVersion}','5'),'{paymentProtocol,schemaVersion}','2')
 from (select public.read_budget_metadata_snapshot_v4(p_trip_id,p_session_id) v) s where v is not null
$$;
revoke all on function public.read_budget_metadata_snapshot_v5(uuid,uuid) from public,anon;
grant execute on function public.read_budget_metadata_snapshot_v5(uuid,uuid) to authenticated;

create or replace function app_private.prepare_budget_payment(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_epoch bigint,p_base_revision bigint,p_value jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();g app_private.budget_metadata_groups;h app_private.budget_metadata_groups;cached app_private.budget_metadata_requests;signature jsonb;targets jsonb;deps jsonb;d jsonb;r jsonb;after_row jsonb;parents jsonb:='[]';people jsonb:='[]';ids uuid[];calc jsonb;form jsonb;budget public.budget_items;stamp timestamptz:=clock_timestamp();created uuid;changed boolean:=false;action text;value jsonb:=p_value;manifest jsonb;
begin
 if actor is null or not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_id is null or p_session_id is null or p_request_id is null or p_base_revision is null or p_base_revision<0 or p_kind is null or p_kind not in('budget','actual') or jsonb_typeof(value) is distinct from 'object' or value-array['action','paid_at','versions']<>'{}' then raise exception 'Invalid payment intent' using errcode='22023';end if;
 action:=value->>'action';if action is null or p_kind='budget' and action not in('paid','unpaid') or p_kind='actual' and action<>'set_paid_at' or p_kind='budget' and value ? 'paid_at' then raise exception 'Invalid payment action' using errcode='22023';end if;
 if p_kind='actual' then if nullif(value->>'paid_at','') is null or not isfinite((value->>'paid_at')::timestamptz) then raise exception 'Invalid paid_at' using errcode='22023';end if;value:=jsonb_set(value,'{paid_at}',to_jsonb((value->>'paid_at')::timestamptz));end if;
 signature:=jsonb_build_object('protocol','payment-v2','trip',p_trip_id,'kind',p_kind,'id',p_id,'session',p_session_id,'base',p_base_revision,'value',value);
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 if not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into cached from app_private.budget_metadata_requests where user_id=actor and request_id=p_request_id;
 if found then if cached.signature<>signature or cached.trip_id<>p_trip_id or cached.session_id<>p_session_id then raise exception 'request_mismatch' using errcode='22023';end if;return jsonb_build_object('replayed',true,'result',cached.result);end if;
 if not app_private.budget_payment_enabled() then raise exception 'payment_protocol_disabled' using errcode='55000';end if;
 perform 1 from public.trips where id=p_trip_id for share nowait;
 perform 1 from public.trip_members where trip_id=p_trip_id and user_id=actor for share nowait;
 select * into g from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and trip_id=p_trip_id and group_key='payment' for update;
 targets:=app_private.budget_payment_targets(p_kind,p_id);deps:=app_private.budget_payment_dependencies(p_kind,p_id,action);
 if targets is null then raise exception 'payment_dependency_not_supported' using errcode='0A000';end if;
 if g.payment_bundle->>'intent' is distinct from action or (select jsonb_agg(x-array['epoch'] order by x->>'kind',x->>'id',x->>'group') from jsonb_array_elements(g.payment_bundle->'epochs') x) is distinct from deps then raise exception 'payment_intent_changed' using errcode='40001';end if;
 if g.revision is distinct from p_base_revision or value->'versions' is distinct from app_private.budget_payment_value(p_kind,p_id)->'versions' or g.payment_bundle->'versions' is distinct from value->'versions' then raise exception 'payment_dependency_changed' using errcode='40001';end if;
 for d in select x from jsonb_array_elements(deps) x loop
  if d->>'kind'='budget' then perform 1 from public.budget_items where id=(d->>'id')::uuid and trip_id=p_trip_id for update nowait;perform 1 from public.budget_item_participants where budget_item_id=(d->>'id')::uuid order by user_id for share nowait;
  else perform 1 from public.actual_expenses where id=(d->>'id')::uuid and trip_id=p_trip_id for update nowait;perform 1 from public.actual_expense_participants where actual_expense_id=(d->>'id')::uuid order by user_id for share nowait;end if;
  select * into h from app_private.budget_metadata_groups where kind=d->>'kind' and resource_id=(d->>'id')::uuid and group_key=d->>'group' for update;
  r:=app_private.budget_metadata_record(h.kind,h.resource_id);
  if h.user_id is distinct from actor or h.session_id is distinct from p_session_id or p_token is null or h.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) or h.expires_at is null or h.expires_at<=clock_timestamp() or h.payment_bundle is distinct from g.payment_bundle
   or not exists(select 1 from jsonb_array_elements(g.payment_bundle->'epochs') e where e->>'kind'=h.kind and e->>'id'=h.resource_id::text and e->>'group'=h.group_key and (e->>'epoch')::bigint=h.lease_epoch)
   or exists(select 1 from app_private.budget_edit_leases where kind=h.kind and resource_id=h.resource_id and expires_at>clock_timestamp()) or r->>'locked_by' is not null and (r->>'locked_at')::timestamptz>clock_timestamp()-interval '7 minutes' then raise exception 'payment_lease_lost' using errcode='55P03';end if;
 end loop;
 if g.user_id is distinct from actor or g.session_id is distinct from p_session_id or g.lease_epoch is distinct from p_epoch or g.payment_bundle->>'id' is distinct from p_id::text or g.payment_bundle->>'kind' is distinct from p_kind then raise exception 'payment_lease_lost' using errcode='55P03';end if;
 if targets is distinct from app_private.budget_payment_targets(p_kind,p_id) or value->'versions' is distinct from app_private.budget_payment_value(p_kind,p_id)->'versions' then raise exception 'payment_dependency_changed' using errcode='40001';end if;
 for d in select x from jsonb_array_elements(targets) x loop
  r:=app_private.budget_metadata_record(d->>'kind',(d->>'id')::uuid);after_row:=r;
  if d->>'kind'='actual' then
   if p_kind='actual' then after_row:=r||jsonb_build_object('paid_at',value->'paid_at');else after_row:=r||jsonb_build_object('payment_active',action='paid');end if;
  end if;
  if after_row is distinct from r then changed:=true;end if;
  parents:=parents||jsonb_build_array(d||jsonb_build_object('before',r,'after',after_row));
 end loop;
 if p_kind='budget' and action='paid' and jsonb_array_length(targets)=1 then
  select * into budget from public.budget_items where id=p_id;
  form:=app_private.read_budget_pricing_value('budget',p_id);calc:=app_private.calculate_budget_group_pricing(form);
  if (calc->>'amount')::numeric<>budget.amount or (calc->>'twd_amount')::numeric<>budget.twd_amount or calc->>'pricing_mode'<>budget.pricing_mode or calc->>'split_type'<>budget.split_type then raise exception 'Committed budget pricing incomplete' using errcode='22023';end if;
  select array_agg(x::uuid order by x::uuid) into ids from jsonb_array_elements_text(form->'participantIds') x;
  perform 1 from public.trip_members where trip_id=p_trip_id and user_id=any(array_append(ids,budget.payer_id)) order by user_id for share nowait;
  if exists(select 1 from unnest(array_append(ids,budget.payer_id)) u where u is not null and not exists(select 1 from public.trip_members where trip_id=p_trip_id and user_id=u and status='approved')) then raise exception 'Invalid payment members' using errcode='42501';end if;
  created:=gen_random_uuid();changed:=true;
  after_row:=to_jsonb(jsonb_populate_record(null::public.actual_expenses,jsonb_build_object('id',created,'trip_id',p_trip_id,'budget_item_id',p_id,'budget_origin_id',p_id,
   'category',budget.category,'subcategory',budget.subcategory,'title',budget.title,'note',budget.note,'amount',budget.amount,'currency',budget.currency,'exchange_rate',budget.exchange_rate,'twd_amount',budget.twd_amount,'payer_id',budget.payer_id,
   'pricing_mode',budget.pricing_mode,'unit_amount',budget.unit_amount,'split_type',budget.split_type,'payment_origin','budget_toggle','payment_active',true,'payment_history','[]'::jsonb,
   'twd_amount_source',case when budget.currency='TWD' then 'actual' else 'estimated' end,'actual_twd_amount',case when budget.currency='TWD' then budget.twd_amount else null end,'paid_at',stamp,'created_at',stamp,'updated_at',stamp)));
  parents:=jsonb_set(parents,'{0,after}',parents->0->'after'||jsonb_build_object('auto_created_actual_expense_id',created))||jsonb_build_array(jsonb_build_object('kind','actual','id',created,'before',null,'after',after_row));
  select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'actual_expense_id',created,'user_id',user_id,'share_amount',share_amount,'created_at',stamp) order by user_id) into people from public.budget_item_participants where budget_item_id=p_id;
 end if;
 manifest:=jsonb_build_object('parents',parents,'people',people,'created',created,'changed',changed,'dependencies',deps,'versions',value->'versions');
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,payment_manifest)
 values(txid_current(),pg_backend_pid(),actor,p_trip_id,p_kind,p_id,'payment',p_session_id,p_request_id,p_base_revision,p_epoch,value,signature,manifest);
 return jsonb_build_object('replayed',false,'manifest',manifest);
end $$;
commit;
