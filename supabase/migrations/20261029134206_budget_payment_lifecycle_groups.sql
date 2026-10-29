-- B-4a local-only expand. All switches default off; no hosted rollout.
begin;
alter table app_private.budget_metadata_groups drop constraint budget_metadata_groups_group_key_check;
alter table app_private.budget_metadata_groups add constraint budget_metadata_groups_group_key_check check(group_key in('title','note','category','payer','links','pricing','payment'));
alter table app_private.budget_metadata_groups add column payment_bundle jsonb;
alter table app_private.budget_metadata_effects add column payment_manifest jsonb;
create table app_private.budget_payment_protocol(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
alter table app_private.budget_payment_protocol enable row level security;
revoke all on app_private.budget_payment_protocol from public,anon,authenticated;
insert into app_private.budget_payment_protocol values(true,false);
create trigger budget_payment_protocol_signal after update on app_private.budget_payment_protocol for each row execute function app_private.signal_budget_metadata_protocol();
insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id)
 select kind,resource_id,'payment',trip_id from app_private.budget_metadata_groups where group_key='pricing';

create function app_private.budget_payment_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select app_private.budget_metadata_enabled() and enabled from app_private.budget_payment_protocol where singleton
$$;
revoke all on function app_private.budget_payment_enabled() from public,anon,authenticated;

create function app_private.budget_payment_targets(k text,rid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=app_private.budget_metadata_record(k,rid); rows jsonb;source public.budget_items;
begin
 if r is null then return null;end if;
 if k='actual' then
  if r->>'budget_item_id' is null then
   if r->>'budget_origin_id' is not null or r->>'payment_origin' is distinct from 'manual' then return null;end if;
  else
   select * into source from public.budget_items where id=(r->>'budget_item_id')::uuid and trip_id=(r->>'trip_id')::uuid;
   if not found or source.is_fixed or r->>'budget_origin_id' is not null and r->>'budget_origin_id'<>r->>'budget_item_id' then return null;end if;
  end if;
  return jsonb_build_array(jsonb_build_object('kind',k,'id',rid));
 end if;
 if k<>'budget' or (r->>'is_fixed')::boolean then return null;end if;
 if exists(select 1 from public.actual_expenses a where (a.budget_item_id=rid or a.budget_origin_id=rid) and
  (a.trip_id<>(r->>'trip_id')::uuid or a.budget_item_id is distinct from rid or a.budget_origin_id is not null and a.budget_origin_id<>rid or a.payment_origin not in('manual','budget_toggle'))) then return null;end if;
 if r->>'auto_created_actual_expense_id' is not null and not exists(select 1 from public.actual_expenses where id=(r->>'auto_created_actual_expense_id')::uuid and budget_item_id=rid) then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('kind','actual','id',id) order by id),'[]') into rows from public.actual_expenses where budget_item_id=rid;
 return jsonb_build_array(jsonb_build_object('kind','budget','id',rid))||rows;
end $$;
revoke all on function app_private.budget_payment_targets(text,uuid) from public,anon,authenticated;

create function app_private.budget_payment_dependencies(k text,rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('kind',t->>'kind','id',t->'id','group',g) order by t->>'kind',t->>'id',g),'[]')
 from jsonb_array_elements(app_private.budget_payment_targets(k,rid)) t
 cross join lateral unnest(case when k='budget' then array['payment','pricing','payer'] else array['payment'] end) g
$$;
revoke all on function app_private.budget_payment_dependencies(text,uuid) from public,anon,authenticated;

create function app_private.budget_payment_value(k text,rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with r as(select app_private.budget_metadata_record(k,rid) v),dep as(select app_private.budget_payment_dependencies(k,rid) d)
 select jsonb_build_object('active',case when k='actual' then (r.v->>'payment_active')::boolean else exists(select 1 from public.actual_expenses where budget_item_id=rid and payment_active) end,
 'paid_at',case when k='actual' then r.v->'paid_at' else 'null'::jsonb end,'versions',jsonb_build_object(
 'rates',v.rates,'members',v.members,'graph',g.graph_revision,
 'source',coalesce((select graph_revision from app_private.budget_metadata_groups where kind='budget' and resource_id=(r.v->>'budget_item_id')::uuid and group_key='pricing'),0),
 'targets',coalesce((select jsonb_agg(x||jsonb_build_object('revision',p.revision) order by x->>'kind',x->>'id',x->>'group') from jsonb_array_elements(dep.d) x join app_private.budget_metadata_groups p on p.kind=x->>'kind' and p.resource_id=(x->>'id')::uuid and p.group_key=x->>'group'),'[]')))
 from r,dep,app_private.budget_metadata_groups g,app_private.budget_pricing_trip_versions v
 where g.kind=k and g.resource_id=rid and g.group_key='pricing' and v.trip_id=g.trip_id
$$;
revoke all on function app_private.budget_payment_value(text,uuid) from public,anon,authenticated;

create function app_private.budget_payment_admission(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_revision bigint,p_epoch bigint,p_versions jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();root app_private.budget_metadata_groups;g app_private.budget_metadata_groups;deps jsonb;d jsonb;epochs jsonb:='[]';bundle jsonb;rec jsonb;stamp timestamptz;
begin
 if actor is null then raise exception 'Forbidden' using errcode='42501';end if;
 if p_trip_id is null or p_kind not in('budget','actual') or p_kind is null or p_id is null or p_session_id is null or p_token is null or p_action is null or p_action not in('acquire','renew','release') then raise exception 'Invalid payment lease' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 select * into root from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and trip_id=p_trip_id and group_key='payment' for update;
 if p_action='release' then
  if root.user_id=actor and root.session_id=p_session_id and root.token_hash=sha256(convert_to(p_token::text,'UTF8')) and root.lease_epoch=p_epoch and root.payment_bundle->>'kind'=p_kind and root.payment_bundle->>'id'=p_id::text then
   update app_private.budget_metadata_groups set user_id=null,session_id=null,token_hash=null,expires_at=null,payment_bundle=null where trip_id=p_trip_id and payment_bundle=root.payment_bundle and user_id=actor and session_id=p_session_id and token_hash=root.token_hash;
  end if;return jsonb_build_object('granted',true);
 end if;
 if not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 if not app_private.budget_payment_enabled() then raise exception 'payment_protocol_disabled' using errcode='55000';end if;
 if root.resource_id is null or root.is_deleted then raise exception 'Payment resource missing' using errcode='42501';end if;
 deps:=app_private.budget_payment_dependencies(p_kind,p_id);
 if deps='[]' or app_private.budget_payment_targets(p_kind,p_id) is null then raise exception 'payment_dependency_not_supported' using errcode='0A000';end if;
 if root.revision is distinct from p_base_revision or p_versions is distinct from app_private.budget_payment_value(p_kind,p_id)->'versions' then raise exception 'payment_dependency_changed' using errcode='40001';end if;
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
 stamp:=clock_timestamp();bundle:=jsonb_build_object('kind',p_kind,'id',p_id,'versions',p_versions,'epochs',epochs);
 for d in select x from jsonb_array_elements(epochs) x loop
  update app_private.budget_metadata_groups set user_id=actor,session_id=p_session_id,token_hash=sha256(convert_to(p_token::text,'UTF8')),lease_epoch=(d->>'epoch')::bigint,expires_at=stamp+interval '2 minutes',payment_bundle=bundle,pricing_bundle=null,dirty=false,last_activity_at=stamp
   where kind=d->>'kind' and resource_id=(d->>'id')::uuid and group_key=d->>'group';
 end loop;
 select * into root from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and group_key='payment';
 return jsonb_build_object('granted',true,'epoch',root.lease_epoch,'revision',root.revision,'expires_at',root.expires_at,'value',app_private.budget_payment_value(p_kind,p_id));
end $$;
revoke all on function app_private.budget_payment_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb) from public,anon;
grant execute on function app_private.budget_payment_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb) to authenticated;
create function public.budget_payment_lease(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_revision bigint,p_epoch bigint,p_versions jsonb) returns jsonb
language sql security invoker set search_path='' as $$select app_private.budget_payment_admission(p_trip_id,p_kind,p_id,p_session_id,p_token,p_action,p_base_revision,p_epoch,p_versions)$$;
revoke all on function public.budget_payment_lease(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb) from public,anon;
grant execute on function public.budget_payment_lease(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb) to authenticated;

create function app_private.budget_payment_effect(k text,rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select x from app_private.budget_metadata_effects e cross join lateral jsonb_array_elements(e.payment_manifest->'parents') x
 where e.transaction_id=txid_current() and e.backend_id=pg_backend_pid() and e.user_id=auth.uid() and e.group_key='payment' and x->>'kind'=k and x->>'id'=rid::text
$$;
revoke all on function app_private.budget_payment_effect(text,uuid) from public,anon,authenticated;

create function app_private.prepare_budget_payment(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_epoch bigint,p_base_revision bigint,p_value jsonb,p_request_id uuid) returns jsonb
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
 targets:=app_private.budget_payment_targets(p_kind,p_id);deps:=app_private.budget_payment_dependencies(p_kind,p_id);
 if targets is null then raise exception 'payment_dependency_not_supported' using errcode='0A000';end if;
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
revoke all on function app_private.prepare_budget_payment(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) from public,anon;
grant execute on function app_private.prepare_budget_payment(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) to authenticated;

create function app_private.validate_budget_payment_parent(k text,rid uuid,b jsonb,a jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare p jsonb:=app_private.budget_payment_effect(k,rid);e app_private.budget_metadata_effects;g app_private.budget_metadata_groups;
begin
 if p is null then return false;end if;
 select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='payment';
 select * into g from app_private.budget_metadata_groups where kind=e.kind and resource_id=e.resource_id and group_key='payment';
 if not app_private.budget_payment_enabled() or not app_private.can_edit_trip(e.trip_id,auth.uid()) or g.user_id is distinct from auth.uid() or g.session_id is distinct from e.session_id or g.lease_epoch is distinct from e.lease_epoch or g.expires_at is null or g.expires_at<=clock_timestamp()
  or (b-'updated_at') is distinct from (nullif(p->'before','null'::jsonb)-'updated_at') or (a-'updated_at') is distinct from ((p->'after')-'updated_at') then raise exception 'invalid_payment_effect' using errcode='55P03';end if;
 return true;
end $$;
revoke all on function app_private.validate_budget_payment_parent(text,uuid,jsonb,jsonb) from public,anon,authenticated;

create function app_private.finish_budget_payment() returns jsonb language plpgsql security definer set search_path='' as $$
declare e app_private.budget_metadata_effects;p jsonb;actual jsonb;expected jsonb;result jsonb;rev bigint;root app_private.budget_metadata_groups;held app_private.budget_metadata_groups;d jsonb;
begin
 select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='payment';
 if not found or not app_private.can_edit_trip(e.trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into root from app_private.budget_metadata_groups where kind=e.kind and resource_id=e.resource_id and group_key='payment';
 for d in select x from jsonb_array_elements(e.payment_manifest->'dependencies') x loop
  select * into held from app_private.budget_metadata_groups where kind=d->>'kind' and resource_id=(d->>'id')::uuid and group_key=d->>'group';
  if held.user_id is distinct from e.user_id or held.session_id is distinct from e.session_id or held.payment_bundle is distinct from root.payment_bundle or held.expires_at is null or held.expires_at<=clock_timestamp()
   or not exists(select 1 from jsonb_array_elements(root.payment_bundle->'epochs') v where v->>'kind'=held.kind and v->>'id'=held.resource_id::text and v->>'group'=held.group_key and (v->>'epoch')::bigint=held.lease_epoch)
   then raise exception 'payment_lease_lost' using errcode='55P03';end if;
 end loop;
 if not app_private.budget_payment_enabled() or root.lease_epoch is distinct from e.lease_epoch then raise exception 'payment_lease_lost' using errcode='55P03';end if;
 for p in select x from jsonb_array_elements(e.payment_manifest->'parents') x loop
  actual:=app_private.budget_metadata_record(p->>'kind',(p->>'id')::uuid);
  if (actual-'updated_at') is distinct from ((p->'after')-'updated_at') then raise exception 'Incomplete payment effect' using errcode='40001';end if;
  if (e.payment_manifest->>'changed')::boolean then
   update app_private.budget_metadata_groups set revision=revision+1 where kind=p->>'kind' and resource_id=(p->>'id')::uuid and group_key='payment';
   delete from app_private.budget_metadata_undo_lineage where kind=p->>'kind' and resource_id=(p->>'id')::uuid;
  end if;
 end loop;
 if e.payment_manifest->>'created' is not null then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id),'[]') into actual from public.actual_expense_participants x where actual_expense_id=(e.payment_manifest->>'created')::uuid;
  if actual is distinct from e.payment_manifest->'people' then raise exception 'Incomplete payment participants' using errcode='40001';end if;
 end if;
 if (e.payment_manifest->>'changed')::boolean then delete from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id;end if;
 select revision into rev from app_private.budget_metadata_groups where kind=e.kind and resource_id=e.resource_id and group_key='payment';
 result:=jsonb_build_object('id',e.resource_id,'kind',e.kind,'group','payment','revision',rev,'request_id',e.request_id,'value',app_private.budget_payment_value(e.kind,e.resource_id),'created_id',e.payment_manifest->'created','undo_supported',false);
 insert into app_private.budget_metadata_requests(user_id,request_id,trip_id,session_id,signature,result) values(e.user_id,e.request_id,e.trip_id,e.session_id,e.signature,result);
 delete from app_private.budget_metadata_effects where transaction_id=e.transaction_id and backend_id=e.backend_id;
 return result;
end $$;
revoke all on function app_private.finish_budget_payment() from public,anon;
grant execute on function app_private.finish_budget_payment() to authenticated;

create function public.mutate_budget_payment_v2(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_epoch bigint,p_base_revision bigint,p_value jsonb,p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prepared jsonb;m jsonb;p jsonb;row public.actual_expenses;person public.actual_expense_participants;
begin
 prepared:=app_private.prepare_budget_payment(p_trip_id,p_kind,p_id,p_session_id,p_token,p_epoch,p_base_revision,p_value,p_request_id);
 if (prepared->>'replayed')::boolean then return prepared->'result';end if;m:=prepared->'manifest';
 for p in select x from jsonb_array_elements(m->'parents') x where x->>'kind'='actual' loop
  if p->'before'='null'::jsonb then row:=jsonb_populate_record(null::public.actual_expenses,p->'after');insert into public.actual_expenses select (row).*;
  elsif p->'before' is distinct from p->'after' then
   if p_kind='actual' then update public.actual_expenses set paid_at=(p->'after'->>'paid_at')::timestamptz where id=(p->>'id')::uuid and trip_id=p_trip_id;
   else update public.actual_expenses set payment_active=(p->'after'->>'payment_active')::boolean where id=(p->>'id')::uuid and trip_id=p_trip_id;end if;
  end if;
 end loop;
 for p in select x from jsonb_array_elements(m->'people') x loop person:=jsonb_populate_record(null::public.actual_expense_participants,p);insert into public.actual_expense_participants select (person).*;end loop;
 if m->>'created' is not null then update public.budget_items set auto_created_actual_expense_id=(m->>'created')::uuid where id=p_id and trip_id=p_trip_id;end if;
 return app_private.finish_budget_payment();
end $$;
revoke all on function public.mutate_budget_payment_v2(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) from public,anon;
grant execute on function public.mutate_budget_payment_v2(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) to authenticated;

create function app_private.budget_text_supported(k text,rid uuid,g text) returns boolean language sql stable security definer set search_path='' as $$
 select app_private.budget_metadata_supported(k,rid) or app_private.budget_payment_enabled() and k='budget' and g in('title','note') and exists(select 1 from public.budget_items where id=rid and not is_fixed)
$$;
revoke all on function app_private.budget_text_supported(text,uuid,text) from public,anon,authenticated;


create or replace function app_private.budget_pricing_targets(k text,rid uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=app_private.budget_metadata_record(k,rid);a public.actual_expenses;t public.trips;counted int;
begin
 if r is null then return null;end if;select * into t from public.trips where id=(r->>'trip_id')::uuid;
 if k='actual' then
  if r->>'budget_item_id' is not null or r->>'budget_origin_id' is not null or r->>'payment_origin' is distinct from 'manual' then return null;end if;
  return jsonb_build_array(jsonb_build_object('kind',k,'id',rid));
 end if;
 if k<>'budget' or (r->>'is_fixed')::boolean or (r->>'currency'<>'TWD' and (t.start_date is null or t.start_date::timestamp at time zone 'Asia/Taipei'<=statement_timestamp() or t.status='settled')) then return null;end if;
 select count(*) into counted from public.actual_expenses where (budget_item_id=rid or budget_origin_id=rid);
 if counted>1 then return null;end if;
 if counted=1 then
  select * into a from public.actual_expenses where (budget_item_id=rid or budget_origin_id=rid);
  if t.start_date is null or t.start_date::timestamp at time zone 'Asia/Taipei'<=statement_timestamp() or t.status='settled'
   or a.budget_item_id is distinct from rid or a.trip_id<>t.id or a.payment_origin<>'budget_toggle' or a.budget_origin_id is distinct from rid
   or a.currency<>r->>'currency' or a.exchange_rate is distinct from (r->>'exchange_rate')::numeric
   or (r->>'auto_created_actual_expense_id' is not null and (r->>'auto_created_actual_expense_id')::uuid<>a.id) then return null;end if;
  return jsonb_build_array(jsonb_build_object('kind',k,'id',rid),jsonb_build_object('kind','actual','id',a.id));
 elsif r->>'auto_created_actual_expense_id' is not null then return null;end if;
 return jsonb_build_array(jsonb_build_object('kind',k,'id',rid));
end $$;

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
  if not app_private.budget_text_supported(p_kind,p_id,p_group) then raise exception 'group_dependency_not_supported' using errcode='0A000'; end if;
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

create or replace function app_private.prepare_budget_metadata_patch(
  p_trip_id uuid,p_kind text,p_id uuid,p_group text,p_base_revision bigint,p_session_id uuid,p_token uuid,p_epoch bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rec jsonb; held app_private.budget_metadata_groups;
  signature jsonb; cached app_private.budget_metadata_requests; value jsonb;
begin
  if actor is null or not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_trip_id is null or p_id is null or p_kind is null or p_kind not in ('budget','actual')
    or p_group is null or p_group not in ('title','note','category','payer','links') or (p_kind='actual' and p_group='links') or p_request_id is null or p_session_id is null
    or p_base_revision is null or p_base_revision<0 or jsonb_typeof(p_patch) is distinct from 'object'
    or not(p_patch ? p_group) or p_patch - p_group <> '{}'::jsonb then
    raise exception 'invalid_group_patch' using errcode='22023'; end if;
  if p_group in ('title','note','category') then
    if jsonb_typeof(p_patch->p_group) is distinct from 'string' and not(p_group='note' and p_patch->p_group='null'::jsonb) then raise exception 'invalid_group_value' using errcode='22023';end if;
    if p_group in ('title','category') and btrim(p_patch->>p_group)='' then raise exception 'Value required' using errcode='22023';end if;
    value:=case when p_group='note' then coalesce(to_jsonb(nullif(btrim(p_patch->>p_group),'')),'null'::jsonb) else to_jsonb(btrim(p_patch->>p_group)) end;
  elsif p_group='payer' then
    if p_patch->p_group='null'::jsonb then value:='null';
    elsif jsonb_typeof(p_patch->p_group)='string' then value:=to_jsonb((p_patch->>p_group)::uuid);
    else raise exception 'invalid_payer' using errcode='22023';end if;
  else
    if jsonb_typeof(p_patch->p_group) is distinct from 'array' then raise exception 'invalid_links' using errcode='22023';end if;
    if exists(select 1 from jsonb_array_elements(p_patch->p_group) e where jsonb_typeof(e)<>'string') then raise exception 'invalid_links' using errcode='22023';end if;
    select coalesce(jsonb_agg(id order by id),'[]') into value from (select distinct v::uuid id from jsonb_array_elements_text(p_patch->p_group) v) ids;
  end if;
  signature:=jsonb_build_object('protocol','metadata-prototype','trip',p_trip_id,'kind',p_kind,'id',p_id,
    'group',p_group,'base',p_base_revision,'value',value,'session',p_session_id);
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  if not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into cached from app_private.budget_metadata_requests where user_id=actor and request_id=p_request_id;
  if found then
    if cached.signature<>signature or cached.trip_id<>p_trip_id or cached.session_id<>p_session_id then
      raise exception 'request_mismatch' using errcode='22023'; end if;
    return jsonb_build_object('replayed',true,'result',cached.result);
  end if;
  if not app_private.budget_metadata_enabled() then raise exception 'group_protocol_disabled' using errcode='55000'; end if;
  -- Legacy/raw SQL can lock the parent BEFORE entering its trigger's trip
  -- lock. Never hold our trip lock while waiting for that parent: it creates
  -- a trip-lock -> row-lock -> trip-lock cycle. Fail atomically with 55P03;
  -- the caller can retry the same request after the other transaction ends.
  if p_kind='budget' then
    select to_jsonb(b) into rec from public.budget_items b where b.id=p_id and b.trip_id=p_trip_id for update nowait;
  else
    select to_jsonb(a) into rec from public.actual_expenses a where a.id=p_id and a.trip_id=p_trip_id for update nowait;
  end if;
  if rec is null or (rec->>'trip_id')::uuid<>p_trip_id then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.trip_members where trip_id=p_trip_id and user_id=actor and status='approved' for share nowait;
  if not found then raise exception 'Forbidden' using errcode='42501'; end if;
  if not app_private.budget_text_supported(p_kind,p_id,p_group) then raise exception 'group_dependency_not_supported' using errcode='0A000'; end if;
  if exists(select 1 from app_private.budget_edit_leases where kind=p_kind and resource_id=p_id and expires_at>clock_timestamp())
    or (nullif(rec->>'locked_by','') is not null and (rec->>'locked_at')::timestamptz>clock_timestamp()-interval '7 minutes') then
    raise exception 'legacy_locked' using errcode='55P03'; end if;
  select * into held from app_private.budget_metadata_groups where kind=p_kind and resource_id=p_id and group_key=p_group and trip_id=p_trip_id for update;
  if not found or held.is_deleted or held.user_id is distinct from actor or held.session_id is distinct from p_session_id
    or p_token is null or held.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8'))
    or held.lease_epoch is distinct from p_epoch or held.expires_at is null or held.expires_at<=clock_timestamp() then
    raise exception 'lease_lost' using errcode='55P03'; end if;
  if held.revision<>p_base_revision then raise exception 'group_conflict' using errcode='40001'; end if;
  if p_group='payer' and value<>'null'::jsonb then
    perform 1 from public.trip_members where trip_id=p_trip_id and user_id=(value#>>'{}')::uuid and status='approved' for share nowait;
    if not found then raise exception 'invalid_payer' using errcode='22023';end if;
  elsif p_group='links' then
    -- A raw legacy UPDATE/DELETE may already own a child row before entering
    -- its trip-lock trigger. Never wait for that row while holding trip lock.
    perform 1 from public.itinerary_budget_items where budget_item_id=p_id order by itinerary_item_id for update nowait;
    perform 1 from public.itinerary_items where trip_id=p_trip_id and id in(select v::uuid from jsonb_array_elements_text(value) v) order by id for share nowait;
    if (select count(*) from public.itinerary_items where trip_id=p_trip_id and id in(select v::uuid from jsonb_array_elements_text(value) v))<>jsonb_array_length(value) then raise exception 'invalid_links' using errcode='22023';end if;
  end if;
  insert into app_private.budget_metadata_effects values(txid_current(),pg_backend_pid(),actor,p_trip_id,p_kind,p_id,p_group,
    p_session_id,p_request_id,p_base_revision,p_epoch,value,signature);
  return jsonb_build_object('replayed',false,'value',value,'noop',app_private.budget_metadata_value(p_kind,p_id,p_group) is not distinct from value);
end $$;

create or replace function app_private.guard_budget_metadata_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_data jsonb; after_data jsonb; data jsonb; k text; active boolean; g text;
  price jsonb; effect app_private.budget_metadata_effects; held app_private.budget_metadata_groups;
begin
  if tg_op<>'INSERT' then before_data:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_data:=to_jsonb(new); end if;
  data:=coalesce(after_data,before_data); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  if app_private.validate_budget_payment_parent(k,(data->>'id')::uuid,before_data,after_data) then
    if tg_op='INSERT' then
      insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id)
       select k,(data->>'id')::uuid,x,(data->>'trip_id')::uuid from unnest(case when k='budget' then array['title','note','category','payer','links','pricing','payment'] else array['title','note','category','payer','pricing','payment'] end) x on conflict do nothing;
    end if;return null;
  end if;
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
      or not app_private.budget_text_supported(k,effect.resource_id,effect.group_key)
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
  foreach g in array (case when k='budget' then array['title','note','category','payer','links','pricing','payment'] else array['title','note','category','payer','pricing','payment'] end) loop
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
    if tg_table_name='actual_expense_participants' and app_private.budget_payment_effect(k,resource) is not null then
      if tg_op<>'INSERT' or not app_private.budget_payment_enabled() or not exists(select 1 from app_private.budget_metadata_effects e cross join lateral jsonb_array_elements(e.payment_manifest->'people') p
       where e.transaction_id=txid_current() and e.backend_id=pg_backend_pid() and e.user_id=auth.uid() and e.group_key='payment' and p=a)
       then raise exception 'invalid_payment_participant_effect' using errcode='55P03';end if;
      continue;
    end if;
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
  if app_private.budget_payment_effect('actual',new.id) is not null then return new;end if;
  if new.twd_amount_source = 'legacy' and new.actual_twd_amount is null then new.actual_twd_amount := new.twd_amount; end if;
  if new.twd_amount_source in ('actual','legacy') then
    if new.actual_twd_amount is null then raise exception 'Actual TWD amount required' using errcode = '22023'; end if;
    new.twd_amount := new.actual_twd_amount;
  else new.actual_twd_amount := null; end if;
  if tg_op = 'UPDATE' and app_private.budget_pricing_effect('actual',new.id) is null and (to_jsonb(new) - 'updated_at' - 'locked_at' - 'locked_by' - 'payment_origin')
    is distinct from (to_jsonb(old) - 'updated_at' - 'locked_at' - 'locked_by' - 'payment_origin') then new.payment_origin := 'manual'; end if;
  return new;
end $$;

create or replace function app_private.capture_budget_metadata_undo_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; rec jsonb; k text; linked uuid; effect app_private.budget_metadata_effects;
begin
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  rec:=coalesce(a,b); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  if app_private.budget_payment_effect(k,(rec->>'id')::uuid) is not null then return null;end if;
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
  if effect.group_key in ('category','payer','links','pricing','payment') then return new;end if;
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
    if app_private.budget_payment_effect(k,resource) is not null or app_private.budget_pricing_effect(k,resource) is not null then continue;end if;
    rec:=app_private.budget_metadata_record(k,resource);trip:=(rec->>'trip_id')::uuid;
    if trip is null then select trip_id into trip from app_private.budget_metadata_groups where kind=k and resource_id=resource limit 1;end if;
    perform app_private.invalidate_budget_metadata_undo(trip,k,resource);
  end loop;
  return null;
end $$;

create function app_private.track_budget_payment_versions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.payment_active,new.paid_at) is distinct from (old.payment_active,old.paid_at) then
  if app_private.budget_payment_effect('actual',new.id) is null then update app_private.budget_metadata_groups set revision=revision+1 where kind='actual' and resource_id=new.id and group_key='payment';end if;
  if new.payment_active is distinct from old.payment_active then
   update app_private.budget_metadata_groups set graph_revision=graph_revision+1 where group_key='pricing' and ((kind='actual' and resource_id=new.id) or kind='budget' and resource_id in(new.budget_item_id,old.budget_item_id,new.budget_origin_id,old.budget_origin_id));
  end if;
 end if;return null;
end $$;
revoke all on function app_private.track_budget_payment_versions() from public,anon,authenticated;
create trigger zzzz_payment_actual after update on public.actual_expenses for each row execute function app_private.track_budget_payment_versions();

create function app_private.read_budget_payment_state(p_trip_id uuid,p_session_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with allowed as materialized(select p_trip_id id where auth.uid() is not null and app_private.can_read_trip(p_trip_id,auth.uid())),
 old as materialized(select app_private.read_budget_metadata_state_v3(p_trip_id,p_session_id) v from allowed),
 records as(select r->>'kind' kind,(r->>'id')::uuid id,r from old cross join lateral jsonb_array_elements(v->'records') r),
 payments as(select r.kind,r.id,p_trip_id trip_id,app_private.budget_payment_targets(r.kind,r.id) is not null supported,g.revision,g.lease_epoch epoch,
  app_private.budget_payment_value(r.kind,r.id) value,
  coalesce(not g.is_deleted and g.user_id is not null and g.expires_at>statement_timestamp() and app_private.can_edit_trip(p_trip_id,g.user_id),false) held,g.user_id,g.session_id,g.expires_at
  from records r left join app_private.budget_metadata_groups g on g.kind=r.kind and g.resource_id=r.id and g.group_key='payment' and g.trip_id=p_trip_id)
 select jsonb_build_object('protocol',jsonb_build_object('name','budget-payment','schemaVersion',1,'enabled',app_private.budget_payment_enabled()),
  'metadataRecords',coalesce((select jsonb_agg(r||jsonb_build_object('groups',(select jsonb_agg(case when x->>'group' in('title','note') then x||jsonb_build_object('supported',app_private.budget_text_supported(kind,id,x->>'group')) else x end order by x->>'group') from jsonb_array_elements(r->'groups') x)) order by kind,id) from records),'[]'),
  'records',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'id',id,'trip_id',trip_id,'supported',supported,'revision',revision,'epoch',epoch,'value',value,'held',held,'owner_id',case when held then user_id end,'own_session',coalesce(held and user_id=auth.uid() and session_id=p_session_id,false),'expires_at',case when held then expires_at end) order by kind,id) from payments),'[]'),
  'entries',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'resource_id',id,'group_key','payment','mode','edit','user_id',user_id,'own_session',user_id=auth.uid() and session_id=p_session_id,'expires_at',expires_at) order by kind,id) from payments where held),'[]')) from allowed
$$;
revoke all on function app_private.read_budget_payment_state(uuid,uuid) from public,anon;
grant execute on function app_private.read_budget_payment_state(uuid,uuid) to authenticated;
create function public.read_budget_metadata_snapshot_v4(p_trip_id uuid,p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with financial as materialized(select public.read_budget_metadata_snapshot_v3(p_trip_id,p_session_id) v),
 payment as materialized(select app_private.read_budget_payment_state(p_trip_id,p_session_id) v)
 select f.v||jsonb_build_object('metadataProtocol',jsonb_set(f.v->'metadataProtocol','{schemaVersion}','4'),'metadataRecords',p.v->'metadataRecords',
  'paymentProtocol',p.v->'protocol','paymentRecords',p.v->'records','collaboration',jsonb_set(f.v->'collaboration','{entries}',(f.v->'collaboration'->'entries')||(p.v->'entries')),
  'nextRefreshAt',(select min((e->>'expires_at')::timestamptz) from jsonb_array_elements((f.v->'collaboration'->'entries')||(p.v->'entries')) e)) from financial f cross join payment p where f.v is not null and p.v is not null
$$;
revoke all on function public.read_budget_metadata_snapshot_v4(uuid,uuid) from public,anon;
grant execute on function public.read_budget_metadata_snapshot_v4(uuid,uuid) to authenticated;
commit;
