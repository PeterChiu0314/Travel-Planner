-- B-4b dormant expand. Source identity and committed data application are separate intents.
begin;
alter table app_private.budget_metadata_groups drop constraint budget_metadata_groups_group_key_check;
alter table app_private.budget_metadata_groups add constraint budget_metadata_groups_group_key_check check(group_key in('title','note','category','payer','links','pricing','payment','source'));
alter table app_private.budget_metadata_groups add column source_bundle jsonb;
alter table app_private.budget_metadata_effects add column source_manifest jsonb;
create table app_private.budget_source_protocol(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
alter table app_private.budget_source_protocol enable row level security;
revoke all on app_private.budget_source_protocol from public,anon,authenticated;
insert into app_private.budget_source_protocol values(true,false);
create trigger budget_source_protocol_signal after update on app_private.budget_source_protocol for each row execute function app_private.signal_budget_metadata_protocol();
insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) select 'actual',id,'source',trip_id from public.actual_expenses;

create function app_private.budget_source_enabled() returns boolean language sql stable security definer set search_path='' as $$select app_private.budget_metadata_enabled() and enabled from app_private.budget_source_protocol where singleton$$;
revoke all on function app_private.budget_source_enabled() from public,anon,authenticated;
create function app_private.budget_source_effect(k text,rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select source_manifest from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='source' and kind=k and resource_id=rid
$$;
revoke all on function app_private.budget_source_effect(text,uuid) from public,anon,authenticated;

create function app_private.budget_source_plan(trip uuid,rid uuid,action text,destination uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb:=app_private.budget_metadata_record('actual',rid);a jsonb;source public.budget_items;t public.trips;old_id uuid;origin uuid;budgets uuid[];bid uuid;
 before_people jsonb;after_people jsonb;form jsonb;calc jsonb;changed_groups text[]:='{}';targets jsonb;checks jsonb;retained jsonb;versions jsonb;topology boolean;changed boolean;ids uuid[];
begin
 if r is null or (r->>'trip_id')::uuid is distinct from trip then raise exception 'Source resource missing' using errcode='42501';end if;
 if action is null or action not in('relink_only','apply_source_data') or action='apply_source_data' and destination is null then raise exception 'Invalid Source intent' using errcode='22023';end if;
 old_id:=(r->>'budget_item_id')::uuid;origin:=(r->>'budget_origin_id')::uuid;
 if r->>'payment_origin' not in('manual','budget_toggle') or old_id is null and r->>'payment_origin'<>'manual' then raise exception 'source_provenance_unsupported' using errcode='0A000';end if;
 if old_id is not null and origin is not null and old_id<>origin then raise exception 'source_origin_mismatch' using errcode='0A000';end if;
 if old_id is distinct from destination and origin is not null and destination is not null then raise exception 'historical_origin_relink_requires_product_contract' using errcode='0A000';end if;
 if old_id is null and origin is not null and destination is not null then raise exception 'origin_only_requires_product_contract' using errcode='0A000';end if;
 select array_agg(distinct x order by x) into budgets from unnest(array[old_id,destination]) x where x is not null;
 foreach bid in array coalesce(budgets,'{}') loop
  select * into source from public.budget_items where id=bid and trip_id=trip;
  if not found or source.is_fixed then raise exception 'source_budget_missing_fixed_or_cross_trip' using errcode='0A000';end if;
  if app_private.budget_payment_targets('budget',bid) is null then raise exception 'source_payment_graph_unsupported' using errcode='0A000';end if;
  if old_id is distinct from destination and source.auto_created_actual_expense_id=rid then raise exception 'generated_backlink_detach_requires_product_contract' using errcode='0A000';end if;
 end loop;
 select * into t from public.trips where id=trip;
 if old_id is distinct from destination and t.status='settled' then raise exception 'settled_source_change_unsupported' using errcode='0A000';end if;
 a:=r||jsonb_build_object('budget_item_id',destination,'budget_origin_id',case when old_id is distinct from destination and origin is null and destination is not null then destination else origin end);
 select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'share_amount',share_amount) order by user_id),'[]') into before_people from public.actual_expense_participants where actual_expense_id=rid;
 after_people:=before_people;
 if action='apply_source_data' then
  select * into source from public.budget_items where id=destination and trip_id=trip;
  if t.status='settled' or (r->>'currency'<>'TWD' or source.currency<>'TWD') and (t.start_date is null or t.start_date::timestamp at time zone 'Asia/Taipei'<=statement_timestamp()) then raise exception 'historical_source_application_unsupported' using errcode='0A000';end if;
  form:=app_private.read_budget_pricing_value('budget',destination);calc:=app_private.calculate_budget_group_pricing(form);
  if btrim(source.title)='' or btrim(source.category)='' or (calc->>'amount')::numeric<>source.amount or (calc->>'twd_amount')::numeric<>source.twd_amount or calc->>'pricing_mode'<>source.pricing_mode or calc->>'split_type'<>source.split_type then raise exception 'Source committed pricing incomplete' using errcode='22023';end if;
  select array_agg(x::uuid order by x::uuid) into ids from jsonb_array_elements_text(form->'participantIds') x;
  if exists(select 1 from unnest(array_append(ids,source.payer_id)) u where u is not null and not exists(select 1 from public.trip_members where trip_id=trip and user_id=u and status='approved')) then raise exception 'Source member invalid' using errcode='42501';end if;
  if r->>'twd_amount_source' in('actual','legacy') and (r->>'actual_twd_amount' is null or (r->>'actual_twd_amount')::numeric<>(calc->>'twd_amount')::numeric) then raise exception 'Known actual debit cannot be revalued by Source' using errcode='22023';end if;
  a:=a||jsonb_build_object('title',source.title,'category',source.category,'note',source.note,'payer_id',source.payer_id,
   'amount',calc->'amount','unit_amount',calc->'unit_amount','currency',source.currency,'exchange_rate',calc->'exchange_rate','twd_amount',calc->'twd_amount','pricing_mode',calc->'pricing_mode','split_type',calc->'split_type');
  select jsonb_agg(jsonb_build_object('user_id',u,'share_amount',case when calc->>'pricing_mode'='custom' then calc->'shares'->u::text else 'null'::jsonb end) order by u) into after_people from unnest(ids) u;
  if (r->'amount',r->'unit_amount',r->'currency',r->'exchange_rate',r->'twd_amount',r->'pricing_mode',r->'split_type') is distinct from (a->'amount',a->'unit_amount',a->'currency',a->'exchange_rate',a->'twd_amount',a->'pricing_mode',a->'split_type') or before_people is distinct from after_people then changed_groups:=array_append(changed_groups,'pricing');end if;
  if r->'payer_id' is distinct from a->'payer_id' then changed_groups:=array_append(changed_groups,'payer');end if;
  if r->'title' is distinct from a->'title' then changed_groups:=array_append(changed_groups,'title');end if;
  if r->'category' is distinct from a->'category' then changed_groups:=array_append(changed_groups,'category');end if;
  if r->'note' is distinct from a->'note' then changed_groups:=array_append(changed_groups,'note');end if;
 end if;
 topology:=(r->'budget_item_id',r->'budget_origin_id') is distinct from (a->'budget_item_id',a->'budget_origin_id');changed:=topology or cardinality(changed_groups)>0;
 select jsonb_agg(jsonb_build_object('kind',k,'id',id,'group',g) order by k,id,g) into targets from (
  select 'actual' k,rid id,unnest(array_prepend('source',changed_groups)) g
  union select 'budget',unnest(budgets),'payment' where topology) keys;
 select coalesce(jsonb_agg(jsonb_build_object('kind',g.kind,'id',g.resource_id,'group',g.group_key,'revision',g.revision,'graph',g.graph_revision) order by g.kind,g.resource_id,g.group_key),'[]') into checks from app_private.budget_metadata_groups g where
  (g.kind='actual' and g.resource_id=rid and g.group_key=any(case when action='apply_source_data' then array['source','pricing','payer','payment','title','category','note'] else array['source','pricing','payer','payment'] end))
  or (g.kind='budget' and g.resource_id=any(budgets) and g.group_key=any(case when action='apply_source_data' and g.resource_id=destination then array['pricing','payer','payment','title','category','note'] else array['pricing','payer','payment'] end));
 select coalesce(jsonb_agg(jsonb_build_object('budget_id',b,'actuals',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'current',x.budget_item_id,'origin',x.budget_origin_id,'provenance',x.payment_origin) order by x.id),'[]') from public.actual_expenses x where x.budget_item_id=b or x.budget_origin_id=b)) order by b),'[]') into retained from unnest(budgets) b;
 select jsonb_build_object('rates',v.rates,'members',v.members,'checks',checks,'retained',retained) into versions from app_private.budget_pricing_trip_versions v where v.trip_id=trip;
 return jsonb_build_object('id',rid,'kind','actual','action',action,'budget_id',destination,'before',r,'after',a,'people_before',before_people,'people_after',after_people,'groups',to_jsonb(changed_groups),'budgets',to_jsonb(coalesce(budgets,'{}')),'topology',topology,'changed',changed,'targets',targets,'versions',versions);
end $$;
revoke all on function app_private.budget_source_plan(uuid,uuid,text,uuid) from public,anon,authenticated;

create function app_private.budget_source_preview(p_trip_id uuid,p_id uuid,p_action text,p_budget_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p jsonb;
begin
 if auth.uid() is null or not app_private.can_edit_trip(p_trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 if not app_private.budget_source_enabled() then raise exception 'source_protocol_disabled' using errcode='55000';end if;
 p:=app_private.budget_source_plan(p_trip_id,p_id,p_action,p_budget_id);
 return p-array['budgets']||jsonb_build_object('revision',(select revision from app_private.budget_metadata_groups where kind='actual' and resource_id=p_id and group_key='source'));
end $$;
revoke all on function app_private.budget_source_preview(uuid,uuid,text,uuid) from public,anon;
grant execute on function app_private.budget_source_preview(uuid,uuid,text,uuid) to authenticated;
create function public.read_budget_source_preview(p_trip_id uuid,p_id uuid,p_action text,p_budget_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select app_private.budget_source_preview(p_trip_id,p_id,p_action,p_budget_id)$$;
revoke all on function public.read_budget_source_preview(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.read_budget_source_preview(uuid,uuid,text,uuid) to authenticated;

create function app_private.budget_source_admission(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_revision bigint,p_epoch bigint,p_versions jsonb,p_intent jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();root app_private.budget_metadata_groups;g app_private.budget_metadata_groups;p jsonb;d jsonb;epochs jsonb:='[]';bundle jsonb;stamp timestamptz;rec jsonb;bid uuid;
begin
 if actor is null then raise exception 'Forbidden' using errcode='42501';end if;
 if p_trip_id is null or p_kind is distinct from 'actual' or p_id is null or p_session_id is null or p_token is null or p_action is null or p_action not in('acquire','renew','release','validate') then raise exception 'Invalid Source lease' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 if p_action='release' then
  select * into root from app_private.budget_metadata_groups where kind='actual' and resource_id=p_id and trip_id=p_trip_id and group_key='source' for update;
  if root.user_id=actor and root.session_id=p_session_id and root.token_hash=sha256(convert_to(p_token::text,'UTF8')) and root.lease_epoch=p_epoch and root.source_bundle->>'id'=p_id::text then
   update app_private.budget_metadata_groups held_row set user_id=null,session_id=null,token_hash=null,expires_at=null,source_bundle=null where held_row.trip_id=p_trip_id and held_row.source_bundle=root.source_bundle and held_row.user_id=actor and held_row.session_id=p_session_id and held_row.token_hash=root.token_hash and exists(select 1 from jsonb_array_elements(root.source_bundle->'epochs') x where x->>'kind'=held_row.kind and (x->>'id')::uuid=held_row.resource_id and x->>'group'=held_row.group_key and (x->>'epoch')::bigint=held_row.lease_epoch);
  end if;return jsonb_build_object('granted',true);
 end if;
 if not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 perform 1 from public.trip_members where trip_id=p_trip_id and user_id=actor for share nowait;
 if not app_private.budget_source_enabled() then raise exception 'source_protocol_disabled' using errcode='55000';end if;
 perform 1 from app_private.budget_source_protocol where singleton for share nowait;
 if jsonb_typeof(p_intent) is distinct from 'object' or p_intent-array['action','budget_id']<>'{}' or not(p_intent ? 'budget_id') then raise exception 'Invalid Source intent' using errcode='22023';end if;
 p:=app_private.budget_source_plan(p_trip_id,p_id,p_intent->>'action',(p_intent->>'budget_id')::uuid);
 if p_versions is distinct from p->'versions' or p_base_revision is distinct from (select revision from app_private.budget_metadata_groups where kind='actual' and resource_id=p_id and group_key='source') then raise exception 'source_dependency_changed' using errcode='40001';end if;
 -- Lock the complete graph in the shared global kind/id order, then children.
 for d in select jsonb_build_object('kind',k,'id',i) from (select distinct x->>'kind' k,(x->>'id')::uuid i from jsonb_array_elements(p->'versions'->'checks') x) keys order by k,i loop
  if d->>'kind'='actual' then perform 1 from public.actual_expenses where id=(d->>'id')::uuid for update nowait;perform 1 from public.actual_expense_participants where actual_expense_id=(d->>'id')::uuid order by user_id for share nowait;
  else perform 1 from public.budget_items where id=(d->>'id')::uuid for update nowait;perform 1 from public.budget_item_participants where budget_item_id=(d->>'id')::uuid order by user_id for share nowait;end if;
  rec:=app_private.budget_metadata_record(d->>'kind',(d->>'id')::uuid);
  if exists(select 1 from app_private.budget_edit_leases where kind=d->>'kind' and resource_id=(d->>'id')::uuid and expires_at>clock_timestamp()) or rec->>'locked_by' is not null and (rec->>'locked_at')::timestamptz>clock_timestamp()-interval '7 minutes' then return jsonb_build_object('granted',false,'reason','legacy_locked');end if;
 end loop;
 if p_intent->>'action'='apply_source_data' and (p->>'changed')::boolean and exists(select 1 from app_private.budget_metadata_groups where kind='budget' and resource_id=(p_intent->>'budget_id')::uuid and group_key in('pricing','payer') and user_id is not null and expires_at>clock_timestamp()) then return jsonb_build_object('granted',false,'reason','source_input_editing');end if;
 select * into root from app_private.budget_metadata_groups where kind='actual' and resource_id=p_id and group_key='source' for update;
 if p_action in('renew','validate') and (root.source_bundle->'versions' is distinct from p_versions or (select jsonb_agg(x-'epoch' order by x->>'kind',x->>'id',x->>'group') from jsonb_array_elements(root.source_bundle->'epochs') x) is distinct from p->'targets') then raise exception 'Source bundle changed' using errcode='40001';end if;
 if p_action in('renew','validate') and (root.user_id is distinct from actor or root.session_id is distinct from p_session_id or root.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) or root.lease_epoch is distinct from p_epoch or root.expires_at is null or root.expires_at<=clock_timestamp()) then return jsonb_build_object('granted',false);end if;
 if root.user_id=actor and root.session_id=p_session_id and root.token_hash=sha256(convert_to(p_token::text,'UTF8')) and root.expires_at>clock_timestamp() and root.source_bundle->'intent' is distinct from p_intent then raise exception 'Source intent changed' using errcode='40001';end if;
 for d in select x from jsonb_array_elements(p->'targets') x loop
  select * into g from app_private.budget_metadata_groups where kind=d->>'kind' and resource_id=(d->>'id')::uuid and group_key=d->>'group' for update;
  if g.resource_id is null or g.is_deleted then raise exception 'Source state missing' using errcode='40001';end if;
  if g.user_id is not null and g.expires_at>clock_timestamp() and (g.user_id is distinct from actor or g.session_id is distinct from p_session_id or g.token_hash is distinct from sha256(convert_to(p_token::text,'UTF8')) or g.source_bundle->>'id' is distinct from p_id::text) then return jsonb_build_object('granted',false,'reason','source_group_locked');end if;
  if p_action in('renew','validate') and (g.expires_at is null or g.expires_at<=clock_timestamp() or g.source_bundle is distinct from root.source_bundle) then return jsonb_build_object('granted',false);end if;
  epochs:=epochs||jsonb_build_array(d||jsonb_build_object('epoch',g.lease_epoch+case when g.user_id is null or g.expires_at is null or g.expires_at<=clock_timestamp() then 1 else 0 end));
 end loop;
 if p_versions is distinct from app_private.budget_source_plan(p_trip_id,p_id,p_intent->>'action',(p_intent->>'budget_id')::uuid)->'versions' then raise exception 'source_dependency_changed' using errcode='40001';end if;
 if p_action='validate' then return jsonb_build_object('granted',true);end if;
 stamp:=clock_timestamp();bundle:=jsonb_build_object('id',p_id,'intent',p_intent,'versions',p_versions,'epochs',epochs);
 for d in select x from jsonb_array_elements(epochs) x loop
  update app_private.budget_metadata_groups set user_id=actor,session_id=p_session_id,token_hash=sha256(convert_to(p_token::text,'UTF8')),expires_at=stamp+interval '2 minutes',lease_epoch=(d->>'epoch')::bigint,source_bundle=bundle,payment_bundle=null,pricing_bundle=null,dirty=false,last_activity_at=stamp where kind=d->>'kind' and resource_id=(d->>'id')::uuid and group_key=d->>'group';
 end loop;
 select * into root from app_private.budget_metadata_groups where kind='actual' and resource_id=p_id and group_key='source';
 return jsonb_build_object('granted',true,'epoch',root.lease_epoch,'revision',root.revision,'intent',p_intent,'targets',epochs,'value',jsonb_build_object('budget_id',p->'after'->'budget_item_id','origin_id',p->'after'->'budget_origin_id','payment_origin',p->'after'->'payment_origin','versions',p_versions));
end $$;
revoke all on function app_private.budget_source_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb) from public,anon;
grant execute on function app_private.budget_source_admission(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb) to authenticated;
create function public.budget_source_lease(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_action text,p_base_revision bigint,p_epoch bigint,p_versions jsonb,p_intent jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$begin if p_action is null or p_action not in('acquire','renew','release') then raise exception 'Invalid Source lease action' using errcode='22023';end if;return app_private.budget_source_admission(p_trip_id,p_kind,p_id,p_session_id,p_token,p_action,p_base_revision,p_epoch,p_versions,p_intent);end $$;
revoke all on function public.budget_source_lease(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.budget_source_lease(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb) to authenticated;

create function app_private.prepare_budget_source(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_epoch bigint,p_base_revision bigint,p_value jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();signature jsonb;cached app_private.budget_metadata_requests;p jsonb;grant_result jsonb;person jsonb;people jsonb:='[]';existing public.actual_expense_participants;intent jsonb;ids uuid[];
begin
 if actor is null or not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 if p_kind is distinct from 'actual' or p_id is null or p_session_id is null or p_request_id is null or p_base_revision is null or p_base_revision<0 or jsonb_typeof(p_value) is distinct from 'object' or p_value-array['action','budget_id','versions']<>'{}' or not(p_value ? 'budget_id') then raise exception 'Invalid Source payload' using errcode='22023';end if;
 intent:=p_value-array['versions'];signature:=jsonb_build_object('protocol','source-v1','trip',p_trip_id,'kind',p_kind,'id',p_id,'session',p_session_id,'base',p_base_revision,'value',p_value);
 perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
 if not app_private.can_edit_trip(p_trip_id,actor) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into cached from app_private.budget_metadata_requests where user_id=actor and request_id=p_request_id;
 if found then if cached.signature is distinct from signature or cached.trip_id<>p_trip_id or cached.session_id<>p_session_id then raise exception 'request_mismatch' using errcode='22023';end if;return jsonb_build_object('replayed',true,'result',cached.result);end if;
 grant_result:=app_private.budget_source_admission(p_trip_id,p_kind,p_id,p_session_id,p_token,'validate',p_base_revision,p_epoch,p_value->'versions',intent);
 if not coalesce((grant_result->>'granted')::boolean,false) then raise exception 'Source lease lost' using errcode='55P03';end if;
 p:=app_private.budget_source_plan(p_trip_id,p_id,p_value->>'action',(p_value->>'budget_id')::uuid);
 if p_value->>'action'='apply_source_data' then
  select array_agg(distinct u) into ids from (select (x->>'user_id')::uuid u from jsonb_array_elements(p->'people_after') x union select (p->'after'->>'payer_id')::uuid) members where u is not null;
  perform 1 from public.trip_members where trip_id=p_trip_id and user_id=any(ids) order by user_id for share nowait;
  if exists(select 1 from unnest(ids) u where not exists(select 1 from public.trip_members where trip_id=p_trip_id and user_id=u and status='approved')) then raise exception 'Source member invalid' using errcode='42501';end if;
 end if;
 for person in select x from jsonb_array_elements(p->'people_after') x loop
  select * into existing from public.actual_expense_participants where actual_expense_id=p_id and user_id=(person->>'user_id')::uuid;
  people:=people||jsonb_build_array(jsonb_build_object('id',coalesce(existing.id,gen_random_uuid()),'actual_expense_id',p_id,'user_id',person->'user_id','share_amount',person->'share_amount','created_at',coalesce(existing.created_at,clock_timestamp())));
 end loop;
 p:=p||jsonb_build_object('people_rows',people);
 insert into app_private.budget_metadata_effects(transaction_id,backend_id,user_id,trip_id,kind,resource_id,group_key,session_id,request_id,base_revision,lease_epoch,value,signature,source_manifest)
 values(txid_current(),pg_backend_pid(),actor,p_trip_id,p_kind,p_id,'source',p_session_id,p_request_id,p_base_revision,p_epoch,p_value,signature,p);
 return jsonb_build_object('replayed',false,'manifest',p);
end $$;
revoke all on function app_private.prepare_budget_source(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) from public,anon;
grant execute on function app_private.prepare_budget_source(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) to authenticated;

create function app_private.validate_budget_source_parent(k text,rid uuid,b jsonb,a jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare e app_private.budget_metadata_effects;g app_private.budget_metadata_groups;
begin
 select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='source' and kind=k and resource_id=rid;
 if not found then return false;end if;
 select * into g from app_private.budget_metadata_groups where kind=k and resource_id=rid and group_key='source';
 if not app_private.budget_source_enabled() or not app_private.can_edit_trip(e.trip_id,auth.uid()) or g.user_id is distinct from auth.uid() or g.session_id is distinct from e.session_id or g.lease_epoch is distinct from e.lease_epoch or g.expires_at is null or g.expires_at<=clock_timestamp() or (b-'updated_at') is distinct from ((e.source_manifest->'before')-'updated_at') or (a-'updated_at') is distinct from ((e.source_manifest->'after')-'updated_at') then raise exception 'invalid_source_effect' using errcode='55P03';end if;
 return true;
end $$;
revoke all on function app_private.validate_budget_source_parent(text,uuid,jsonb,jsonb) from public,anon,authenticated;

create function app_private.finish_budget_source() returns jsonb language plpgsql security definer set search_path='' as $$
declare e app_private.budget_metadata_effects;root app_private.budget_metadata_groups;held app_private.budget_metadata_groups;d jsonb;actual jsonb;result jsonb;rev bigint;g text;bid uuid;
begin
 select * into e from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and group_key='source';
 if not found or not app_private.can_edit_trip(e.trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into root from app_private.budget_metadata_groups where kind='actual' and resource_id=e.resource_id and group_key='source';
 if not app_private.budget_source_enabled() or root.user_id is distinct from e.user_id or root.session_id is distinct from e.session_id or root.lease_epoch is distinct from e.lease_epoch or root.source_bundle->'intent' is distinct from e.value-array['versions'] then raise exception 'Source lease lost' using errcode='55P03';end if;
 for d in select x from jsonb_array_elements(root.source_bundle->'epochs') x loop
  select * into held from app_private.budget_metadata_groups where kind=d->>'kind' and resource_id=(d->>'id')::uuid and group_key=d->>'group';
  if held.user_id is distinct from e.user_id or held.session_id is distinct from e.session_id or held.token_hash is distinct from root.token_hash or held.source_bundle is distinct from root.source_bundle or held.lease_epoch is distinct from (d->>'epoch')::bigint or held.expires_at is null or held.expires_at<=clock_timestamp() then raise exception 'Source peer lease lost' using errcode='55P03';end if;
 end loop;
 actual:=app_private.budget_metadata_record('actual',e.resource_id);
 if (actual-'updated_at') is distinct from ((e.source_manifest->'after')-'updated_at') then raise exception 'Incomplete Source parent' using errcode='40001';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id),'[]') into actual from public.actual_expense_participants x where actual_expense_id=e.resource_id;
 if actual is distinct from e.source_manifest->'people_rows' then raise exception 'Incomplete Source participants' using errcode='40001';end if;
 if (e.source_manifest->>'changed')::boolean then
  update app_private.budget_metadata_groups set revision=revision+1 where kind='actual' and resource_id=e.resource_id and (group_key='source' or group_key in(select jsonb_array_elements_text(e.source_manifest->'groups')));
  if (e.source_manifest->>'topology')::boolean or (e.source_manifest->'groups') ? 'pricing' then
   update app_private.budget_metadata_groups set graph_revision=graph_revision+1 where group_key='pricing' and ((kind='actual' and resource_id=e.resource_id) or kind='budget' and resource_id in(select x::uuid from jsonb_array_elements_text(e.source_manifest->'budgets') x));
  end if;
  if (e.source_manifest->>'topology')::boolean then
   update app_private.budget_metadata_groups set revision=revision+1 where group_key='payment' and ((kind='actual' and resource_id=e.resource_id) or kind='budget' and resource_id in(select x::uuid from jsonb_array_elements_text(e.source_manifest->'budgets') x));
  end if;
  delete from app_private.budget_metadata_undo_lineage where (kind='actual' and resource_id=e.resource_id) or kind='budget' and resource_id in(select x::uuid from jsonb_array_elements_text(e.source_manifest->'budgets') x);
  delete from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id;
 end if;
 select revision into rev from app_private.budget_metadata_groups where kind='actual' and resource_id=e.resource_id and group_key='source';actual:=app_private.budget_metadata_record('actual',e.resource_id);
 result:=jsonb_build_object('id',e.resource_id,'kind','actual','group','source','revision',rev,'request_id',e.request_id,'value',jsonb_build_object('budget_id',actual->'budget_item_id','origin_id',actual->'budget_origin_id','payment_origin',actual->'payment_origin'),'undo_supported',false);
 insert into app_private.budget_metadata_requests(user_id,request_id,trip_id,session_id,signature,result) values(e.user_id,e.request_id,e.trip_id,e.session_id,e.signature,result);
 delete from app_private.budget_metadata_effects where transaction_id=e.transaction_id and backend_id=e.backend_id;return result;
end $$;
revoke all on function app_private.finish_budget_source() from public,anon;
grant execute on function app_private.finish_budget_source() to authenticated;

create function public.mutate_budget_source(p_trip_id uuid,p_kind text,p_id uuid,p_session_id uuid,p_token uuid,p_epoch bigint,p_base_revision bigint,p_value jsonb,p_request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prepared jsonb;p jsonb;a public.actual_expenses;person public.actual_expense_participants;x jsonb;
begin
 prepared:=app_private.prepare_budget_source(p_trip_id,p_kind,p_id,p_session_id,p_token,p_epoch,p_base_revision,p_value,p_request_id);
 if (prepared->>'replayed')::boolean then return prepared->'result';end if;p:=prepared->'manifest';
 if p->'before' is distinct from p->'after' then
  a:=jsonb_populate_record(null::public.actual_expenses,p->'after');
  if p_value->>'action'='relink_only' then update public.actual_expenses set budget_item_id=a.budget_item_id,budget_origin_id=a.budget_origin_id where id=p_id and trip_id=p_trip_id;
  else update public.actual_expenses set budget_item_id=a.budget_item_id,budget_origin_id=a.budget_origin_id,title=a.title,category=a.category,note=a.note,payer_id=a.payer_id,amount=a.amount,unit_amount=a.unit_amount,currency=a.currency,exchange_rate=a.exchange_rate,twd_amount=a.twd_amount,pricing_mode=a.pricing_mode,split_type=a.split_type where id=p_id and trip_id=p_trip_id;end if;
 end if;
 if p->'people_before' is distinct from p->'people_after' then
  delete from public.actual_expense_participants where actual_expense_id=p_id and user_id not in(select (v->>'user_id')::uuid from jsonb_array_elements(p->'people_rows') v);
  for x in select v from jsonb_array_elements(p->'people_rows') v loop person:=jsonb_populate_record(null::public.actual_expense_participants,x);
   insert into public.actual_expense_participants select (person).* on conflict(actual_expense_id,user_id) do update set share_amount=excluded.share_amount where actual_expense_participants.share_amount is distinct from excluded.share_amount;
  end loop;
 end if;
 return app_private.finish_budget_source();
end $$;
revoke all on function public.mutate_budget_source(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) from public,anon;
grant execute on function public.mutate_budget_source(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid) to authenticated;

create function app_private.track_budget_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then insert into app_private.budget_metadata_groups(kind,resource_id,group_key,trip_id) values('actual',new.id,'source',new.trip_id) on conflict(kind,resource_id,group_key) do update set is_deleted=false,trip_id=excluded.trip_id,revision=budget_metadata_groups.revision+1,lease_epoch=budget_metadata_groups.lease_epoch+1,user_id=null,session_id=null,token_hash=null,expires_at=null,source_bundle=null;
 elsif tg_op='DELETE' then update app_private.budget_metadata_groups set is_deleted=true,revision=revision+1,lease_epoch=lease_epoch+1,user_id=null,session_id=null,token_hash=null,expires_at=null,source_bundle=null where kind='actual' and resource_id=old.id and group_key='source';
 elsif app_private.budget_source_effect('actual',new.id) is null and (new.budget_item_id,new.budget_origin_id,new.payment_origin,new.trip_id) is distinct from (old.budget_item_id,old.budget_origin_id,old.payment_origin,old.trip_id) then update app_private.budget_metadata_groups set revision=revision+1,trip_id=new.trip_id where kind='actual' and resource_id=new.id and group_key='source';end if;return null;
end $$;
revoke all on function app_private.track_budget_source() from public,anon,authenticated;
create trigger zzzzz_source_actual after insert or update or delete on public.actual_expenses for each row execute function app_private.track_budget_source();

create function app_private.guard_budget_source_boundary() returns trigger language plpgsql security definer set search_path='' as $$
declare r jsonb:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
 if not app_private.budget_source_enabled() then if tg_op='DELETE' then return old;else return new;end if;end if;
 if app_private.budget_source_effect('actual',(r->>'id')::uuid) is not null or app_private.budget_payment_effect('actual',(r->>'id')::uuid) is not null or app_private.budget_pricing_effect('actual',(r->>'id')::uuid) is not null then if tg_op='DELETE' then return old;else return new;end if;end if;
 if (tg_op='INSERT' and (new.budget_item_id is not null or new.budget_origin_id is not null))
  or (tg_op='UPDATE' and (new.budget_item_id,new.budget_origin_id) is distinct from (old.budget_item_id,old.budget_origin_id))
  or (tg_op='DELETE' and (old.budget_item_id is not null or old.budget_origin_id is not null)) then raise exception 'source_protocol_required_for_link_or_lifecycle' using errcode='55000';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function app_private.guard_budget_source_boundary() from public,anon,authenticated;
create trigger zz_source_boundary before insert or update or delete on public.actual_expenses for each row execute function app_private.guard_budget_source_boundary();
-- Source integration definitions
create or replace function app_private.guard_budget_metadata_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_data jsonb; after_data jsonb; data jsonb; k text; active boolean; g text;
  price jsonb; effect app_private.budget_metadata_effects; held app_private.budget_metadata_groups;
begin
  if tg_op<>'INSERT' then before_data:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then after_data:=to_jsonb(new); end if;
  data:=coalesce(after_data,before_data); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  if app_private.validate_budget_source_parent(k,(data->>'id')::uuid,before_data,after_data) then return null;end if;
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
    if k='actual' and effect.group_key in('title','note') and app_private.budget_source_enabled() then return null;end if;
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
    if tg_table_name='actual_expense_participants' and app_private.budget_source_effect(k,resource) is not null then
      if tg_op='DELETE' then
        if exists(select 1 from jsonb_array_elements(app_private.budget_source_effect(k,resource)->'people_rows') x where x->>'user_id'=b->>'user_id') then raise exception 'invalid_source_participant_delete' using errcode='55P03';end if;
      elsif not exists(select 1 from jsonb_array_elements(app_private.budget_source_effect(k,resource)->'people_rows') x where x=a) then raise exception 'invalid_source_participant_effect' using errcode='55P03';end if;
      continue;
    end if;
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
  if app_private.budget_source_effect('actual',new.id) is not null then return new;end if;
  if app_private.budget_source_enabled() and exists(select 1 from app_private.budget_metadata_effects where transaction_id=txid_current() and backend_id=pg_backend_pid() and user_id=auth.uid() and kind='actual' and resource_id=new.id and group_key in('title','note')) then return new;end if;
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
create or replace function app_private.keep_actual_budget_origin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app_private.budget_source_effect('actual',new.id) is not null then return new;end if;
  if new.budget_item_id is not null then new.budget_origin_id := new.budget_item_id;
  elsif tg_op = 'UPDATE' then new.budget_origin_id := old.budget_origin_id;
  else new.budget_origin_id := null; end if;
  return new;
end $$;
create or replace function app_private.track_budget_pricing_versions() returns trigger
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
 if app_private.budget_source_effect(k,rid) is not null then return null;end if;
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
create or replace function app_private.capture_budget_metadata_undo_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; rec jsonb; k text; linked uuid; effect app_private.budget_metadata_effects;
begin
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  rec:=coalesce(a,b); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  if app_private.budget_source_effect(k,(rec->>'id')::uuid) is not null then return null;end if;
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
  if effect.group_key in ('category','payer','links','pricing','payment','source') then return new;end if;
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
    if app_private.budget_source_effect(k,resource) is not null then continue;end if;
    if app_private.budget_payment_effect(k,resource) is not null or app_private.budget_pricing_effect(k,resource) is not null then continue;end if;
    rec:=app_private.budget_metadata_record(k,resource);trip:=(rec->>'trip_id')::uuid;
    if trip is null then select trip_id into trip from app_private.budget_metadata_groups where kind=k and resource_id=resource limit 1;end if;
    perform app_private.invalidate_budget_metadata_undo(trip,k,resource);
  end loop;
  return null;
end $$;
create or replace function app_private.budget_text_supported(k text,rid uuid,g text) returns boolean language sql stable security definer set search_path='' as $$
 select (app_private.budget_source_enabled() and k='actual' and g in('title','note') and exists(select 1 from public.actual_expenses where id=rid)) or app_private.budget_metadata_supported(k,rid) or app_private.budget_payment_enabled() and k='budget' and g in('title','note') and exists(select 1 from public.budget_items where id=rid and not is_fixed)
$$;

create function app_private.read_budget_source_state(p_trip_id uuid,p_session_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with allowed as materialized(select p_trip_id id where auth.uid() is not null and app_private.can_read_trip(p_trip_id,auth.uid())),records as (
 select a.id,a.trip_id,a.budget_item_id,a.budget_origin_id,a.payment_origin,g.revision,g.lease_epoch epoch,
 coalesce(not g.is_deleted and g.user_id is not null and g.expires_at>statement_timestamp() and app_private.can_edit_trip(p_trip_id,g.user_id),false) held,g.user_id,g.session_id,g.expires_at
 from public.actual_expenses a join allowed t on a.trip_id=t.id left join app_private.budget_metadata_groups g on g.kind='actual' and g.resource_id=a.id and g.group_key='source' and g.trip_id=t.id)
 select jsonb_build_object('protocol',jsonb_build_object('name','budget-source','schemaVersion',1,'enabled',app_private.budget_source_enabled()),'records',coalesce((select jsonb_agg(jsonb_build_object('kind','actual','id',id,'trip_id',trip_id,'supported',revision is not null,'revision',revision,'epoch',epoch,'value',jsonb_build_object('budget_id',budget_item_id,'origin_id',budget_origin_id,'payment_origin',payment_origin),'held',held,'owner_id',case when held then user_id end,'own_session',coalesce(held and user_id=auth.uid() and session_id=p_session_id,false),'expires_at',case when held then expires_at end) order by id) from records),'[]'),
 'entries',coalesce((select jsonb_agg(jsonb_build_object('kind','actual','resource_id',id,'group_key','source','mode','edit','user_id',user_id,'own_session',user_id=auth.uid() and session_id=p_session_id,'expires_at',expires_at) order by id) from records where held),'[]')) from allowed
$$;
revoke all on function app_private.read_budget_source_state(uuid,uuid) from public,anon;
grant execute on function app_private.read_budget_source_state(uuid,uuid) to authenticated;
create function public.read_budget_metadata_snapshot_v6(p_trip_id uuid,p_session_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 with financial as materialized(select public.read_budget_metadata_snapshot_v5(p_trip_id,p_session_id) v),source as materialized(select app_private.read_budget_source_state(p_trip_id,p_session_id) v)
 select f.v||jsonb_build_object('metadataProtocol',jsonb_set(f.v->'metadataProtocol','{schemaVersion}','6'),'sourceProtocol',s.v->'protocol','sourceRecords',s.v->'records',
 'collaboration',jsonb_set(f.v->'collaboration','{entries}',(f.v->'collaboration'->'entries')||(s.v->'entries')),'nextRefreshAt',(select min((e->>'expires_at')::timestamptz) from jsonb_array_elements((f.v->'collaboration'->'entries')||(s.v->'entries')) e)) from financial f cross join source s where f.v is not null and s.v is not null
$$;
revoke all on function public.read_budget_metadata_snapshot_v6(uuid,uuid) from public,anon;
grant execute on function public.read_budget_metadata_snapshot_v6(uuid,uuid) to authenticated;
commit;
