-- Dormant unused reverse only; no historical/financial rollback.
begin;
do $$begin if exists(select 1 from app_private.budget_finance_protocol where enabled or activated) or exists(select 1 from app_private.budget_rates_leases) or exists(select 1 from app_private.budget_metadata_groups where metadata_bundle is not null) or exists(select 1 from app_private.budget_metadata_effects) then raise exception 'Finance protocol used or activated: forward repair required';end if;end $$;
drop trigger zz_finance_boundary on public.trips;
drop trigger zz_finance_boundary on public.budget_items;
drop trigger zz_finance_boundary on public.actual_expenses;
drop trigger rates_lease_signal on app_private.budget_rates_leases;drop trigger finance_signal on app_private.budget_finance_protocol;drop trigger finance_latch on app_private.budget_finance_protocol;
create or replace function app_private.guard_budget_metadata_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_data jsonb; after_data jsonb; data jsonb; k text; active boolean; g text; independent_text boolean:=false;
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
    independent_text:=k='actual' and effect.group_key in('title','note') and app_private.budget_source_enabled();
  elsif active then raise exception 'group_locked' using errcode='55P03';
  end if;
  -- New Actual links must not bypass a budget's metadata wildcard exclusion.
  if k='actual' and not independent_text then
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
  if effect.group_key in ('category','payer','links','pricing','payment','source','receipts') then return new;end if;
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
  if app_private.receipt_effect() is not null then return null;end if;
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

create or replace function app_private.budget_pricing_effect(k text,rid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select x from app_private.budget_metadata_effects e cross join lateral jsonb_array_elements(e.pricing_manifest) x
 where e.transaction_id=txid_current() and e.backend_id=pg_backend_pid() and e.user_id=auth.uid() and e.group_key='pricing' and x->>'kind'=k and x->>'id'=rid::text
$$;

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

create or replace function public.update_trip_budget_rates(p_trip_id uuid,p_quote jsonb,p_initialize boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_trip public.trips; v_currency text; v_rate numeric; v_quote jsonb;
begin
  if auth.uid() is null or not app_private.can_edit_trip(p_trip_id,auth.uid()) then raise exception 'Forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_trip_id::text,0));
  select * into v_trip from public.trips where id=p_trip_id for update;
  if v_trip.start_date is null or v_trip.start_date::timestamp at time zone 'Asia/Taipei'<=clock_timestamp() or v_trip.status='settled' or exists(select 1 from public.trip_budget_baselines where trip_id=p_trip_id and departure_at<=clock_timestamp()) then raise exception '只有行前規劃可更新旅程預算匯率。' using errcode='22023'; end if;
  if p_initialize and v_trip.budget_exchange_rates ? 'rates' then return v_trip.budget_exchange_rates; end if;
  if jsonb_typeof(p_quote->'rates') is distinct from 'object' or p_quote->>'source' is distinct from 'ExchangeRate-API' or (p_quote->>'quoted_at')::timestamptz is null or (p_quote->>'quoted_at')::timestamptz>clock_timestamp()+interval '1 day' then raise exception 'Invalid rate quote' using errcode='22023'; end if;
  foreach v_currency in array array['JPY','USD','EUR','KRW','HKD'] loop
    if not(p_quote->'rates' ? v_currency) then raise exception 'Missing currency quote' using errcode='22023'; end if;
  end loop;
  for v_currency in select jsonb_object_keys(p_quote->'rates') loop
    v_rate:=(p_quote->'rates'->>v_currency)::numeric;
    if v_currency !~ '^[A-Z]{3}$' or v_rate is null or v_rate<=0 or v_rate>1000000 or v_rate<>round(v_rate,6) then raise exception 'Invalid currency rate' using errcode='22023'; end if;
  end loop;
  perform 1 from public.budget_items where trip_id=p_trip_id order by id for update;
  if exists(select 1 from public.budget_items where trip_id=p_trip_id and locked_by is not null and locked_by<>auth.uid() and locked_at>clock_timestamp()-interval '7 minutes') then raise exception '其他成員正在編輯預算，請稍後更新匯率。' using errcode='55P03'; end if;
  if exists(select 1 from public.budget_items b where b.trip_id=p_trip_id and b.currency<>'TWD' and not(p_quote->'rates' ? b.currency)) then raise exception 'Missing currency quote' using errcode='22023'; end if;
  v_quote:=jsonb_build_object('rates',p_quote->'rates','source',p_quote->>'source','quoted_at',(p_quote->>'quoted_at')::timestamptz,'updated_at',clock_timestamp());
  update public.trips set budget_exchange_rates=v_quote where id=p_trip_id;
  update public.budget_items b set exchange_rate=(v_quote->'rates'->>b.currency)::numeric,twd_amount=round(b.amount*(v_quote->'rates'->>b.currency)::numeric)
    where b.trip_id=p_trip_id and b.currency<>'TWD' and not exists(select 1 from public.actual_expenses e where e.trip_id=p_trip_id and e.budget_item_id=b.id);
  return v_quote;
end $$;
drop function public.read_budget_metadata_snapshot_v8(uuid,uuid);
drop function app_private.read_budget_finance_state(uuid,uuid);
drop function app_private.budget_finance_undo_context();
drop function app_private.guard_budget_finance_boundary();
drop function public.update_trip_budget_rates_v2(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid);
drop function app_private.apply_budget_rates_quote();
drop function app_private.finish_budget_rates();
drop function app_private.prepare_budget_rates(uuid,uuid,uuid,bigint,bigint,jsonb,uuid);
drop function public.budget_rates_lease(uuid,text,uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb);
drop function app_private.budget_rates_admission(uuid,uuid,uuid,text,bigint,bigint,jsonb,jsonb);
drop function app_private.budget_rates_plan(uuid,jsonb);
drop function app_private.budget_rate_quote(jsonb);
drop function app_private.budget_rates_versions(uuid);
drop function public.patch_budget_metadata_group_v2(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid,jsonb);
drop function app_private.finish_budget_field();
drop function app_private.validate_budget_field_parent(text,uuid,jsonb,jsonb);
drop function app_private.prepare_budget_field(uuid,text,uuid,text,bigint,uuid,uuid,bigint,jsonb,uuid,jsonb);
drop function public.budget_metadata_group_lease_v2(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean,jsonb);
drop function app_private.budget_field_admission(uuid,text,uuid,text,uuid,uuid,text,bigint,bigint,bigint,boolean,jsonb);
drop function app_private.lock_budget_field_parents(uuid,jsonb);
drop function app_private.budget_finance_membership(uuid);
drop function app_private.budget_field_effect(text,uuid);
drop function app_private.budget_field_versions(text,uuid,text);
drop function app_private.budget_field_targets(text,uuid,text);
drop function app_private.latch_budget_finance();
drop function app_private.budget_finance_activated();
drop function app_private.budget_finance_enabled();
drop table app_private.budget_rates_leases,app_private.budget_finance_protocol;alter table app_private.budget_metadata_groups drop column metadata_bundle;alter table app_private.budget_metadata_effects drop column metadata_manifest,drop column rates_manifest;commit;
