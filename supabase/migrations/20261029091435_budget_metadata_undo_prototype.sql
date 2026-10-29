-- Local, dormant title/note Undo DB slice. No hosted rollout or UI activation.
begin;

create table app_private.budget_metadata_undo_protocol (
  singleton boolean primary key default true check(singleton), enabled boolean not null default false
);
insert into app_private.budget_metadata_undo_protocol values(true,false);
create table app_private.budget_metadata_undo_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null, trip_id uuid not null references public.trips(id) on delete cascade,
  session_id uuid not null, kind text not null check(kind in ('budget','actual')),
  resource_id uuid not null, group_key text not null check(group_key in ('title','note')),
  before_value jsonb not null, after_value jsonb not null,
  before_revision bigint not null check(before_revision>=0), after_revision bigint not null check(after_revision=before_revision+1),
  predecessor uuid, primary key(user_id,operation_id)
);
create table app_private.budget_metadata_undo_stack (
  position bigint generated always as identity primary key,
  user_id uuid not null, session_id uuid not null, trip_id uuid not null references public.trips(id) on delete cascade,
  operation_id uuid not null, expected_revision bigint not null check(expected_revision>=0),
  unique(user_id,session_id,trip_id,operation_id),
  foreign key(user_id,operation_id) references app_private.budget_metadata_undo_operations(user_id,operation_id) on delete cascade
);
create index budget_metadata_undo_stack_top on app_private.budget_metadata_undo_stack(user_id,session_id,trip_id,position desc);
create table app_private.budget_metadata_undo_lineage (
  kind text not null check(kind in ('budget','actual')), resource_id uuid not null, group_key text not null check(group_key in ('title','note')),
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null, session_id uuid not null, operation_id uuid, revision bigint not null check(revision>=0),
  primary key(kind,resource_id,group_key)
);
create table app_private.budget_metadata_undo_intents (
  transaction_id bigint not null, backend_id integer not null, user_id uuid not null,
  trip_id uuid not null, session_id uuid not null, operation_id uuid not null, request_id uuid not null,
  primary key(transaction_id,backend_id)
);
create table app_private.budget_metadata_undo_receipts (
  user_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
  trip_id uuid not null references public.trips(id) on delete cascade,
  session_id uuid not null, operation_id uuid not null, result jsonb not null,
  primary key(user_id,request_id)
);
create index budget_metadata_undo_operations_trip on app_private.budget_metadata_undo_operations(trip_id);
create index budget_metadata_undo_stack_trip on app_private.budget_metadata_undo_stack(trip_id);
create index budget_metadata_undo_lineage_trip on app_private.budget_metadata_undo_lineage(trip_id);
create index budget_metadata_undo_receipts_trip on app_private.budget_metadata_undo_receipts(trip_id);
alter table app_private.budget_metadata_effects add column undo_before_value jsonb;

alter table app_private.budget_metadata_undo_protocol enable row level security;
alter table app_private.budget_metadata_undo_operations enable row level security;
alter table app_private.budget_metadata_undo_stack enable row level security;
alter table app_private.budget_metadata_undo_lineage enable row level security;
alter table app_private.budget_metadata_undo_intents enable row level security;
alter table app_private.budget_metadata_undo_receipts enable row level security;
revoke all on app_private.budget_metadata_undo_protocol,app_private.budget_metadata_undo_operations,
  app_private.budget_metadata_undo_stack,app_private.budget_metadata_undo_lineage,
  app_private.budget_metadata_undo_intents,app_private.budget_metadata_undo_receipts from public,anon,authenticated;
revoke all on sequence app_private.budget_metadata_undo_stack_position_seq from public,anon,authenticated;

create function app_private.budget_metadata_undo_enabled() returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select enabled from app_private.budget_metadata_undo_protocol where singleton),false)
$$;
revoke all on function app_private.budget_metadata_undo_enabled() from public,anon,authenticated;

-- Only stack pointers are mutable; successful operation/receipt evidence is kept.
create function app_private.invalidate_budget_metadata_undo(p_trip uuid,p_kind text default null,p_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_trip is null then return; end if;
  if not exists(select 1 from app_private.budget_metadata_undo_lineage where trip_id=p_trip)
    and not exists(select 1 from app_private.budget_metadata_undo_stack where trip_id=p_trip) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip::text,0));
  delete from app_private.budget_metadata_undo_stack where trip_id=p_trip and user_id=auth.uid();
  delete from app_private.budget_metadata_undo_lineage where trip_id=p_trip
    and (p_kind is null or kind=p_kind and resource_id=p_id);
end $$;
revoke all on function app_private.invalidate_budget_metadata_undo(uuid,text,uuid) from public,anon,authenticated;

-- Runs after the existing exact-effect guard. Capture the DB before-image only
-- for its transaction/backend/actor-bound effect, never from a client payload.
create function app_private.capture_budget_metadata_undo_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; rec jsonb; k text; linked uuid; effect app_private.budget_metadata_effects;
begin
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  rec:=coalesce(a,b); k:=case when tg_table_name='budget_items' then 'budget' else 'actual' end;
  select * into effect from app_private.budget_metadata_effects where transaction_id=txid_current()
    and backend_id=pg_backend_pid() and user_id=auth.uid() and kind=k and resource_id=(rec->>'id')::uuid;
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
revoke all on function app_private.capture_budget_metadata_undo_row() from public,anon,authenticated;
create trigger zz_budget_metadata_undo_row after insert or update or delete on public.budget_items
for each row execute function app_private.capture_budget_metadata_undo_row();
create trigger zz_actual_metadata_undo_row after insert or update or delete on public.actual_expenses
for each row execute function app_private.capture_budget_metadata_undo_row();

create function app_private.record_budget_metadata_undo() returns trigger
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
revoke all on function app_private.record_budget_metadata_undo() from public,anon,authenticated;
create trigger budget_metadata_undo_commit before insert on app_private.budget_metadata_requests
for each row execute function app_private.record_budget_metadata_undo();

create function app_private.prepare_budget_metadata_undo(p_trip uuid,p_session uuid,p_operation uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); op app_private.budget_metadata_undo_operations;
  top_row app_private.budget_metadata_undo_stack; lineage app_private.budget_metadata_undo_lineage;
  receipt app_private.budget_metadata_undo_receipts;
begin
  if actor is null or not app_private.can_edit_trip(p_trip,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_trip is null or p_session is null or p_operation is null or p_request is null then raise exception 'invalid_undo_request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip::text,0));
  if not app_private.can_edit_trip(p_trip,actor) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform 1 from public.trip_members where trip_id=p_trip and user_id=actor and status='approved' for share nowait;
  if not found then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into receipt from app_private.budget_metadata_undo_receipts where user_id=actor and request_id=p_request;
  if found then
    if receipt.trip_id<>p_trip or receipt.session_id<>p_session or receipt.operation_id<>p_operation then
      raise exception 'request_mismatch' using errcode='22023'; end if;
    return jsonb_build_object('replayed',true,'result',receipt.result);
  end if;
  if not app_private.budget_metadata_undo_enabled() or not app_private.budget_metadata_enabled() then
    raise exception 'undo_protocol_disabled' using errcode='55000'; end if;
  if exists(select 1 from app_private.budget_metadata_requests where user_id=actor and request_id=p_request) then
    raise exception 'request_mismatch' using errcode='22023'; end if;
  select * into top_row from app_private.budget_metadata_undo_stack where user_id=actor and session_id=p_session
    and trip_id=p_trip order by position desc limit 1 for update;
  if not found or top_row.operation_id<>p_operation then raise exception 'undo_target_not_top' using errcode='40001'; end if;
  select * into op from app_private.budget_metadata_undo_operations where user_id=actor and operation_id=p_operation;
  select * into lineage from app_private.budget_metadata_undo_lineage where kind=op.kind and resource_id=op.resource_id and group_key=op.group_key;
  if not found or lineage.user_id<>actor or lineage.session_id<>p_session or lineage.operation_id is distinct from p_operation
    or lineage.revision<>top_row.expected_revision then raise exception 'undo_lineage_conflict' using errcode='40001'; end if;
  insert into app_private.budget_metadata_undo_intents values(txid_current(),pg_backend_pid(),actor,p_trip,p_session,p_operation,p_request);
  return jsonb_build_object('replayed',false,'kind',op.kind,'id',op.resource_id,'group',op.group_key,
    'base',top_row.expected_revision,'patch',jsonb_build_object(op.group_key,op.before_value));
end $$;
revoke all on function app_private.prepare_budget_metadata_undo(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function app_private.prepare_budget_metadata_undo(uuid,uuid,uuid,uuid) to authenticated;

create function public.undo_budget_metadata_group(p_trip_id uuid,p_session_id uuid,p_operation_id uuid,
  p_token uuid,p_epoch bigint,p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare admission jsonb; result jsonb;
begin
  admission:=app_private.prepare_budget_metadata_undo(p_trip_id,p_session_id,p_operation_id,p_request_id);
  if (admission->>'replayed')::boolean then return admission->'result'; end if;
  result:=public.patch_budget_metadata_group(p_trip_id,admission->>'kind',(admission->>'id')::uuid,admission->>'group',
    (admission->>'base')::bigint,p_session_id,p_token,p_epoch,admission->'patch',p_request_id);
  return result||jsonb_build_object('undo_of',p_operation_id);
end $$;
revoke all on function public.undo_budget_metadata_group(uuid,uuid,uuid,uuid,bigint,uuid) from public,anon;
grant execute on function public.undo_budget_metadata_group(uuid,uuid,uuid,uuid,bigint,uuid) to authenticated;

create function app_private.read_budget_metadata_undo(p_trip uuid,p_session uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare top_row app_private.budget_metadata_undo_stack; op app_private.budget_metadata_undo_operations; n integer;
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_session is null then raise exception 'invalid_undo_session' using errcode='22023'; end if;
  select count(*) into n from app_private.budget_metadata_undo_stack where user_id=auth.uid() and trip_id=p_trip and session_id=p_session;
  select * into top_row from app_private.budget_metadata_undo_stack where user_id=auth.uid() and trip_id=p_trip and session_id=p_session order by position desc limit 1;
  select * into op from app_private.budget_metadata_undo_operations where user_id=auth.uid() and operation_id=top_row.operation_id;
  return jsonb_build_object('protocol','metadata-undo-prototype','enabled',app_private.budget_metadata_undo_enabled(),
    'tripId',p_trip,'count',n,'top',case when top_row.operation_id is null then null else
      jsonb_build_object('operation_id',op.operation_id,'kind',op.kind,'id',op.resource_id,'group',op.group_key,'expected_revision',top_row.expected_revision) end);
end $$;
revoke all on function app_private.read_budget_metadata_undo(uuid,uuid) from public,anon;
grant execute on function app_private.read_budget_metadata_undo(uuid,uuid) to authenticated;
create function public.read_budget_metadata_undo(p_trip_id uuid,p_session_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select app_private.read_budget_metadata_undo(p_trip_id,p_session_id)$$;
revoke all on function public.read_budget_metadata_undo(uuid,uuid) from public,anon;
grant execute on function public.read_budget_metadata_undo(uuid,uuid) to authenticated;

create function app_private.clear_budget_metadata_undo(p_trip uuid,p_session uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_session is null then raise exception 'invalid_undo_session' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip::text,0));
  if not app_private.can_edit_trip(p_trip,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  delete from app_private.budget_metadata_undo_stack where user_id=auth.uid() and trip_id=p_trip and session_id=p_session;
  return true;
end $$;
revoke all on function app_private.clear_budget_metadata_undo(uuid,uuid) from public,anon;
grant execute on function app_private.clear_budget_metadata_undo(uuid,uuid) to authenticated;
create function public.clear_budget_metadata_undo(p_trip_id uuid,p_session_id uuid) returns boolean
language sql security invoker set search_path='' as $$select app_private.clear_budget_metadata_undo(p_trip_id,p_session_id)$$;
revoke all on function public.clear_budget_metadata_undo(uuid,uuid) from public,anon;
grant execute on function public.clear_budget_metadata_undo(uuid,uuid) to authenticated;

create function app_private.assert_budget_metadata_undo_finished() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from app_private.budget_metadata_undo_intents where transaction_id=new.transaction_id and backend_id=new.backend_id) then
    raise exception 'unfinished_metadata_undo' using errcode='40001'; end if;
  return null;
end $$;
revoke all on function app_private.assert_budget_metadata_undo_finished() from public,anon,authenticated;
create constraint trigger budget_metadata_undo_finished after insert on app_private.budget_metadata_undo_intents
deferrable initially deferred for each row execute function app_private.assert_budget_metadata_undo_finished();

-- Child/payment/rate changes are hard boundaries for the local metadata slice.
create function app_private.guard_budget_metadata_undo_boundary() returns trigger
language plpgsql security definer set search_path='' as $$
declare b jsonb; a jsonb; rec jsonb; k text; ids uuid[]; resource uuid; trip uuid;
begin
  if tg_op<>'INSERT' then b:=to_jsonb(old); end if;
  if tg_op<>'DELETE' then a:=to_jsonb(new); end if;
  if tg_op='UPDATE' and b is not distinct from a then return null; end if;
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
    rec:=app_private.budget_metadata_record(k,resource);trip:=(rec->>'trip_id')::uuid;
    if trip is null then select trip_id into trip from app_private.budget_metadata_groups where kind=k and resource_id=resource limit 1;end if;
    perform app_private.invalidate_budget_metadata_undo(trip,k,resource);
  end loop;
  return null;
end $$;
revoke all on function app_private.guard_budget_metadata_undo_boundary() from public,anon,authenticated;
create trigger budget_metadata_undo_people after insert or update or delete on public.budget_item_participants for each row execute function app_private.guard_budget_metadata_undo_boundary();
create trigger budget_metadata_undo_actual_people after insert or update or delete on public.actual_expense_participants for each row execute function app_private.guard_budget_metadata_undo_boundary();
create trigger budget_metadata_undo_links after insert or update or delete on public.itinerary_budget_items for each row execute function app_private.guard_budget_metadata_undo_boundary();
create trigger budget_metadata_undo_receipts after insert or update or delete on public.attachments for each row execute function app_private.guard_budget_metadata_undo_boundary();
create trigger budget_metadata_undo_members after insert or update or delete on public.trip_members for each row execute function app_private.guard_budget_metadata_undo_boundary();
create trigger budget_metadata_undo_trip after update of budget_exchange_rates,start_date,end_date on public.trips for each row execute function app_private.guard_budget_metadata_undo_boundary();
commit;
