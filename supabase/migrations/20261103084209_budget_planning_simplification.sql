-- REVIEW ONLY: never applied Hosted by this task. Preserve history and latches.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Existing capabilities expire; audit records and payment history remain intact.
alter table app_private.budget_metadata_undo_operations add column saved_at timestamptz not null default '-infinity';
alter table app_private.budget_metadata_undo_operations alter column saved_at set default clock_timestamp();
delete from app_private.budget_metadata_undo_stack;
create or replace function app_private.record_workspace_undo(e app_private.budget_metadata_effects,result jsonb) returns void language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare items jsonb:='[]';expected jsonb:='[]';x jsonb;v jsonb;s app_private.budget_metadata_groups;changed boolean:=false;deps jsonb;
begin
 if exists(select 1 from app_private.budget_metadata_undo_intents where transaction_id=txid_current() and backend_id=pg_backend_pid()) then return;end if;
 if e.lifecycle_manifest->>'action'='set_paid_at' then
  if e.lifecycle_manifest->'before'->'paid_at' is distinct from app_private.budget_metadata_record(e.kind,e.resource_id)->'paid_at' then delete from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id;end if;return;
 end if;
 if e.lifecycle_manifest->>'action'='create' then
  items:=jsonb_build_array(jsonb_build_object('kind',e.kind,'id',e.resource_id,'group','lifecycle','before','null'::jsonb,'after',app_private.budget_metadata_record(e.kind,e.resource_id),'before_revision',0,'revision',0,'graph',0,'predecessor',null));expected:=jsonb_build_array(jsonb_build_object('kind',e.kind,'id',e.resource_id,'group','lifecycle','revision',0,'graph',0));changed:=true;
 elsif e.undo_bundle is not null then
  for x in select v from jsonb_array_elements(e.undo_bundle) v loop
   select * into s from app_private.budget_metadata_groups where kind=x->>'kind' and resource_id=(x->>'id')::uuid and group_key=e.group_key;
   v:=app_private.undo_group_value(s.kind,s.resource_id,s.group_key);
   if x->'before' is distinct from v then changed:=true;end if;
   items:=items||jsonb_build_array(x||jsonb_build_object('after',v,'revision',s.revision));
   expected:=expected||jsonb_build_array(jsonb_build_object('kind',s.kind,'id',s.resource_id,'group',s.group_key,'revision',s.revision,'graph',x->'graph'));
  end loop;
 else return;end if;
 if not changed then return;end if;
 deps:=app_private.undo_dependencies(e.kind,e.resource_id,e.group_key);
 insert into app_private.budget_metadata_undo_operations(user_id,operation_id,trip_id,session_id,kind,resource_id,group_key,before_value,after_value,before_revision,after_revision,predecessor,bundle,dependencies)
 values(e.user_id,e.request_id,e.trip_id,e.session_id,e.kind,e.resource_id,e.group_key,(select t->'before' from jsonb_array_elements(items) t where t->>'kind'=e.kind and t->>'id'=e.resource_id::text),(select t->'after' from jsonb_array_elements(items) t where t->>'kind'=e.kind and t->>'id'=e.resource_id::text),e.base_revision,coalesce((result->>'revision')::bigint,0),null,items,deps);
 insert into app_private.budget_metadata_undo_stack(user_id,session_id,trip_id,operation_id,expected_revision,expected_bundle) values(e.user_id,e.session_id,e.trip_id,e.request_id,coalesce((result->>'revision')::bigint,0),expected);
 delete from app_private.budget_metadata_undo_stack where position in(select position from app_private.budget_metadata_undo_stack where user_id=e.user_id and session_id=e.session_id and trip_id=e.trip_id order by position desc offset 1);
 for x in select v from jsonb_array_elements(items) v loop
  insert into app_private.budget_metadata_undo_lineage values(x->>'kind',(x->>'id')::uuid,x->>'group',e.trip_id,e.user_id,e.session_id,e.request_id,(x->>'revision')::bigint)
  on conflict(kind,resource_id,group_key) do update set user_id=excluded.user_id,session_id=excluded.session_id,operation_id=excluded.operation_id,revision=excluded.revision;
 end loop;
end $$;
create or replace function app_private.workspace_undo_top(trip uuid,sid uuid,operation uuid default null) returns app_private.budget_metadata_undo_operations language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare top app_private.budget_metadata_undo_stack;op app_private.budget_metadata_undo_operations;x jsonb;g app_private.budget_metadata_groups;l app_private.budget_metadata_undo_lineage;item jsonb;targets jsonb;
begin
 if auth.uid() is null or sid is null or not app_private.can_edit_trip(trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(trip::text,0));perform app_private.lifecycle_membership(trip);
 if not app_private.workspace_undo_enabled() then raise exception 'Undo protocol disabled' using errcode='55000';end if;
 select * into top from app_private.budget_metadata_undo_stack where user_id=auth.uid() and trip_id=trip and session_id=sid order by position desc limit 1 for update;
 if not found or operation is not null and top.operation_id<>operation then raise exception 'Undo target is not stack top' using errcode='PT409';end if;
 select * into op from app_private.budget_metadata_undo_operations where user_id=auth.uid() and operation_id=top.operation_id;
 if op.saved_at + interval '30 seconds' <= clock_timestamp() then raise exception 'Undo expired' using errcode='PT409';end if;
 if op.bundle is null then raise exception 'Legacy Undo entry requires its original protocol' using errcode='0A000';end if;
 perform app_private.lock_budget_field_parents(trip,op.bundle);
 if app_private.undo_dependencies(op.kind,op.resource_id,op.group_key) is distinct from op.dependencies then raise exception 'Undo dependency changed' using errcode='PT409';end if;
 if op.group_key='lifecycle' then
  if app_private.budget_metadata_record(op.kind,op.resource_id) is distinct from op.bundle->0->'after' then raise exception 'Placeholder has changed' using errcode='PT409';end if;
  perform app_private.lifecycle_delete_plan(trip,op.kind,op.resource_id);
 elsif op.group_key in('title','note','category','payer') then
  targets:=app_private.budget_field_targets(op.kind,op.resource_id,op.group_key);
  if (select jsonb_agg(v order by v->>'kind',v->>'id') from jsonb_array_elements(targets) v) is distinct from (select jsonb_agg(jsonb_build_object('kind',x->>'kind','id',x->>'id') order by x->>'kind',x->>'id') from jsonb_array_elements(op.bundle) x) then raise exception 'Undo target graph changed' using errcode='PT409';end if;
 end if;
 for x in select v from jsonb_array_elements(top.expected_bundle) v order by v->>'kind',v->>'id' loop
  select * into g from app_private.budget_metadata_groups where kind=x->>'kind' and resource_id=(x->>'id')::uuid and group_key=op.group_key for update;
  select * into l from app_private.budget_metadata_undo_lineage where kind=g.kind and resource_id=g.resource_id and group_key=g.group_key;
  select v into item from jsonb_array_elements(op.bundle) v where v->>'kind'=g.kind and v->>'id'=g.resource_id::text;
  if g.is_deleted or g.revision is distinct from (x->>'revision')::bigint or l.user_id is distinct from auth.uid() or l.session_id is distinct from sid or l.operation_id is distinct from op.operation_id or l.revision<>g.revision or op.group_key<>'lifecycle' and ((select graph_revision from app_private.budget_metadata_groups where kind=g.kind and resource_id=g.resource_id and group_key='pricing') is distinct from (x->>'graph')::bigint or app_private.undo_group_value(g.kind,g.resource_id,g.group_key) is distinct from item->'after') then raise exception 'Undo effect/lineage changed' using errcode='PT409';end if;
 end loop;return op;
end $$;
-- NULL permits independent travel expenses. Duplicates abort the whole Forward;
-- never merge/delete financial rows to satisfy this constraint.
create unique index actual_expenses_one_budget on public.actual_expenses(budget_item_id) where budget_item_id is not null;
-- Financial attachments are removed regardless of Protocol/latch state.
create function app_private.guard_removed_budget_receipts() returns trigger
language plpgsql set search_path='' as $$
begin
 if (tg_op<>'INSERT' and old.target_type in('budget_item','actual_expense'))
 or (tg_op<>'DELETE' and new.target_type in('budget_item','actual_expense')) then
 raise exception 'Financial receipts removed' using errcode='55000';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function app_private.guard_removed_budget_receipts() from public,anon,authenticated,service_role;
create trigger aa_removed_budget_receipts before insert or update or delete on public.attachments for each row execute function app_private.guard_removed_budget_receipts();
create policy removed_receipts_metadata_read on public.attachments as restrictive for select to anon,authenticated using(target_type not in('budget_item','actual_expense'));
-- Intersect existing policies; grants for accommodation and other attachments unchanged.
create policy removed_receipts_storage on storage.objects as restrictive for all to anon,authenticated,budget_receipt_worker
 using(bucket_id<>'trip-attachments' or coalesce((storage.foldername(name))[4],'') not in('budget_item','actual_expense'))
 with check(bucket_id<>'trip-attachments' or coalesce((storage.foldername(name))[4],'') not in('budget_item','actual_expense'));
-- Retain implementations for dependency/audit compatibility, remove client entry points.
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and (p.proname in('undo_budget_metadata_group','budget_receipts_lease','mutate_budget_receipts','read_budget_receipt_operation','abandon_budget_receipt','claim_budget_receipt_cleanup','claim_budget_receipt_verification','finish_budget_receipt_verification','sweep_budget_receipts','claim_budget_receipt_worker','finish_budget_receipt_cleanup') or p.proname like 'budget_receipt_worker_%') loop
 execute format('revoke execute on function %s from public,anon,authenticated,budget_receipt_worker',f.signature);
 end loop;
end $$;
commit;
