begin;

create table expense_stage_b.item_order (
 expense_id uuid primary key references expense_stage_b.expense_items(id) on delete cascade,
 position integer not null,
 revision bigint not null default 0
);
create table expense_stage_b.category_order (
 trip_id uuid primary key references public.trips(id) on delete cascade,
 categories text[] not null,
 revision bigint not null
);
create table expense_stage_b.drag_leases (
 trip_id uuid not null references public.trips(id) on delete cascade,
 kind text not null check(kind in ('item','category')),
 resource_id text not null,
 actor uuid not null,
 sid uuid not null,
 token_hash bytea not null,
 expires_at timestamptz not null,
 primary key(trip_id,kind,resource_id)
);
alter table expense_stage_b.item_order enable row level security;
alter table expense_stage_b.category_order enable row level security;
alter table expense_stage_b.drag_leases enable row level security;
revoke all on expense_stage_b.item_order,expense_stage_b.category_order,expense_stage_b.drag_leases from public,anon,authenticated;

create function expense_stage_b.ordered_categories(tid uuid) returns text[]
language sql stable set search_path='' as $$
 with defaults(categories) as (values(array['機票','交通','住宿','門票','餐飲','購物','其他'])),
 saved as (
  select coalesce((select c.categories from expense_stage_b.category_order c where c.trip_id=tid),defaults.categories) categories
  from defaults
 )
 select categories || array(
  select distinct i.category from expense_stage_b.expense_items i
  where i.trip_id=tid and i.deleted_at is null and not(i.category=any(saved.categories)) order by i.category
 ) from saved
$$;

-- A category change made in the sidebar appends the item to its new group.
create function expense_stage_b.reset_item_order() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from expense_stage_b.item_order where expense_id=new.id;
 return new;
end $$;
create trigger reset_expense_item_order after update of category,deleted_at on expense_stage_b.expense_items
for each row when (old.category is distinct from new.category or old.deleted_at is distinct from new.deleted_at)
execute function expense_stage_b.reset_item_order();

create function expense_stage_b.order_insert(ids text[],source text,target text,side text) returns text[]
language plpgsql immutable set search_path='' as $$
declare slot integer;
begin
 ids:=array_remove(ids,source);
 if target is null then return array_append(ids,source); end if;
 slot:=array_position(ids,target);
 if slot is null then raise exception 'Order target changed' using errcode='PT409'; end if;
 if side='after' then slot:=slot+1; end if;
 return ids[:slot-1] || array[source] || ids[slot:];
end $$;

create function public.expense_drag_lease(
 p_trip_id uuid,p_kind text,p_id text,p_session_id uuid,p_token uuid,p_action text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); token_digest bytea:=sha256(convert_to(p_token::text,'UTF8')); deadline timestamptz;
begin
 if actor_id is null then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_trip_id is null or p_kind is null or p_kind not in ('item','category') or p_id is null
  or p_session_id is null or p_token is null or p_action is null or p_action not in ('acquire','release') then
  raise exception 'Invalid drag lease' using errcode='22023';
 end if;
 if p_kind='item' then p_id:=p_id::uuid::text; end if;
 perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||p_trip_id::text,0));
 if p_action='release' then
  delete from expense_stage_b.drag_leases l where l.trip_id=p_trip_id and l.kind=p_kind and l.resource_id=p_id
   and l.actor=actor_id and l.sid=p_session_id and l.token_hash=token_digest;
  if found then perform expense_stage_b.signal(p_trip_id); end if;
  return jsonb_build_object('granted',true);
 end if;
 if not app_private.can_edit_trip(p_trip_id,actor_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_kind='item' then
  if not exists(select 1 from expense_stage_b.expense_items where id=p_id::uuid and trip_id=p_trip_id and deleted_at is null) then
   raise exception 'Order source removed' using errcode='PT409';
  end if;
 elsif not (p_id=any(expense_stage_b.ordered_categories(p_trip_id))) then
  raise exception 'Order category removed' using errcode='PT409';
 end if;
 delete from expense_stage_b.drag_leases l where l.trip_id=p_trip_id
  and (l.expires_at<=clock_timestamp() or not app_private.can_edit_trip(p_trip_id,l.actor));
 insert into expense_stage_b.drag_leases(trip_id,kind,resource_id,actor,sid,token_hash,expires_at)
 values(p_trip_id,p_kind,p_id,actor_id,p_session_id,token_digest,clock_timestamp()+interval '30 seconds')
 on conflict(trip_id,kind,resource_id) do nothing returning expires_at into deadline;
 if deadline is null then return jsonb_build_object('granted',false); end if;
 perform expense_stage_b.signal(p_trip_id);
 return jsonb_build_object('granted',true,'expires_at',deadline,'server_now',clock_timestamp());
end $$;

create function public.move_expense_order(
 p_trip_id uuid,p_kind text,p_id text,p_session_id uuid,p_token uuid,p_request_id uuid,p_intent jsonb,p_confirm boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor_id uuid:=auth.uid();
 token_digest bytea:=sha256(convert_to(p_token::text,'UTF8'));
 held expense_stage_b.drag_leases;
 saved expense_stage_b.receipts;
 source expense_stage_b.expense_items;
 category_group expense_stage_b.groups;
 signature jsonb;
 receipt jsonb;
 ids text[];
 target text:=p_intent->>'target';
 destination text:=p_intent->>'category';
 side text:=p_intent->>'side';
 base bigint:=(p_intent->>'revision')::bigint;
 current_revision bigint;
begin
 if actor_id is null then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_trip_id is null or p_kind is null or p_kind not in ('item','category') or p_id is null
  or p_session_id is null or p_token is null or p_request_id is null or p_confirm is null
  or jsonb_typeof(p_intent) is distinct from 'object' or base is null
  or (target is null and side is distinct from 'end') or
  (target is not null and (side is null or side not in ('before','after'))) then
  raise exception 'Invalid order request' using errcode='22023';
 end if;
 if p_kind='item' then
  p_id:=p_id::uuid::text;
  target:=target::uuid::text;
 end if;
 if target=p_id then raise exception 'Invalid order target' using errcode='22023'; end if;
 signature:=jsonb_build_object('operation','order','trip',p_trip_id,'kind',p_kind,'id',p_id,
  'session',p_session_id,'capability',encode(token_digest,'hex'),'intent',p_intent);
 perform pg_advisory_xact_lock(hashtextextended(actor_id::text||p_request_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('expense-trip:'||p_trip_id::text,0));
 if not app_private.can_edit_trip(p_trip_id,actor_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into saved from expense_stage_b.receipts r where r.actor=actor_id and r.request_id=p_request_id;
 if found then
  if saved.signature<>signature then raise exception 'Request mismatch' using errcode='22023'; end if;
  return saved.result;
 end if;
 select * into held from expense_stage_b.drag_leases l where l.trip_id=p_trip_id and l.kind=p_kind and l.resource_id=p_id;
 if held.actor is distinct from actor_id or held.sid is distinct from p_session_id or held.token_hash is distinct from token_digest then
  held:=null;
 end if;
 if p_confirm then
  -- Confirmation fences an in-flight request before reporting it did not commit.
  if held.actor is not null then perform public.expense_drag_lease(p_trip_id,p_kind,p_id,p_session_id,p_token,'release'); end if;
  receipt:=jsonb_build_object('committed',false,'request_id',p_request_id);
  insert into expense_stage_b.receipts values(actor_id,p_request_id,signature,receipt);
  return receipt;
 end if;
 if held.actor is null or held.expires_at<=clock_timestamp() then raise exception 'Drag lease required' using errcode='55P03'; end if;

 if p_kind='category' then
  ids:=expense_stage_b.ordered_categories(p_trip_id);
  select coalesce((select revision from expense_stage_b.category_order where trip_id=p_trip_id),0) into current_revision;
  if current_revision<>base or not (p_id=any(ids)) or target is null then
   raise exception 'Category order changed' using errcode='PT409';
  end if;
  insert into expense_stage_b.category_order(trip_id,categories,revision)
  values(p_trip_id,expense_stage_b.order_insert(ids,p_id,target,side),current_revision+1)
  on conflict(trip_id) do update set categories=excluded.categories,revision=excluded.revision;
 else
  select * into source from expense_stage_b.expense_items where id=p_id::uuid and trip_id=p_trip_id and deleted_at is null for update;
  if not found or source.category is distinct from (p_intent->>'sourceCategory') or destination is null
   or not (destination=any(expense_stage_b.ordered_categories(p_trip_id))) then
   raise exception 'Expense category changed' using errcode='PT409';
  end if;
  select coalesce((select revision from expense_stage_b.item_order where expense_id=source.id),0) into current_revision;
  if current_revision<>base then raise exception 'Expense order changed' using errcode='PT409'; end if;
  if target is not null and not exists(
   select 1 from expense_stage_b.expense_items i left join expense_stage_b.groups g on g.expense_id=i.id and g.group_key='category'
   where i.id=target::uuid and i.trip_id=p_trip_id and i.deleted_at is null and i.category=destination
    and coalesce(g.revision,0)=(p_intent->>'targetCategoryRevision')::bigint
  ) then raise exception 'Order target changed' using errcode='PT409'; end if;
  if source.category<>destination then
   insert into expense_stage_b.groups(expense_id,group_key) values(source.id,'category') on conflict do nothing;
   select * into category_group from expense_stage_b.groups where expense_id=source.id and group_key='category' for update;
  else
   select * into category_group from expense_stage_b.groups where expense_id=source.id and group_key='category';
  end if;
  if coalesce(category_group.revision,0) is distinct from (p_intent->>'categoryRevision')::bigint then
   raise exception 'Category version changed' using errcode='PT409';
  end if;
  if source.category<>destination then
   if category_group.expires_at>clock_timestamp() and app_private.can_edit_trip(p_trip_id,category_group.actor) then
    raise exception 'Category is being edited' using errcode='55P03';
   end if;
   update expense_stage_b.expense_items set category=destination where id=source.id;
   update expense_stage_b.groups set revision=revision+1,actor=null,sid=null,token_hash=null,expires_at=null
    where expense_id=source.id and group_key='category';
  end if;
  select coalesce(array_agg(i.id::text order by o.position nulls last,i.id),'{}') into ids
  from expense_stage_b.expense_items i left join expense_stage_b.item_order o on o.expense_id=i.id
  where i.trip_id=p_trip_id and i.category=destination and i.deleted_at is null;
  insert into expense_stage_b.item_order(expense_id,position,revision)
  select id::uuid,slot::integer,case when id=p_id then current_revision+1 else 0 end
  from unnest(expense_stage_b.order_insert(ids,p_id,target,side)) with ordinality as list(id,slot)
  on conflict(expense_id) do update set position=excluded.position,
   revision=case when excluded.expense_id=source.id then excluded.revision else item_order.revision end;
 end if;
 receipt:=jsonb_build_object('committed',true,'request_id',p_request_id,'revision',current_revision+1);
 insert into expense_stage_b.receipts values(actor_id,p_request_id,signature,receipt);
 perform public.expense_drag_lease(p_trip_id,p_kind,p_id,p_session_id,p_token,'release');
 return receipt;
end $$;

create or replace function public.read_expense_snapshot(p_trip_id uuid,p_session_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select expense_stage_b.snapshot(p_trip_id,p_session_id) || jsonb_build_object(
  'snapshotRevision',coalesce((select revision from public.expense_signals where trip_id=p_trip_id),0),
  'ordering',jsonb_build_object(
   'categories',expense_stage_b.ordered_categories(p_trip_id),
   'revision',coalesce((select revision from expense_stage_b.category_order where trip_id=p_trip_id),0),
   'items',coalesce((select jsonb_object_agg(i.id,jsonb_build_object('position',o.position,'revision',o.revision))
    from expense_stage_b.item_order o join expense_stage_b.expense_items i on i.id=o.expense_id
    where i.trip_id=p_trip_id and i.deleted_at is null),'{}'),
   'drags',coalesce((select jsonb_agg(jsonb_build_object('kind',l.kind,'id',l.resource_id,'user_id',l.actor,
    'own_session',l.actor=auth.uid() and l.sid=p_session_id,'expires_at',l.expires_at))
    from expense_stage_b.drag_leases l where l.trip_id=p_trip_id and l.expires_at>now()
    and app_private.can_edit_trip(p_trip_id,l.actor)
    and (l.kind='category' or exists(select 1 from expense_stage_b.expense_items i
      where i.id::text=l.resource_id and i.trip_id=p_trip_id and i.deleted_at is null))),'[]')
  ))
$$;
revoke all on function expense_stage_b.ordered_categories(uuid),expense_stage_b.reset_item_order(),
 expense_stage_b.order_insert(text[],text,text,text) from public,anon,authenticated;
revoke all on function public.expense_drag_lease(uuid,text,text,uuid,uuid,text),
 public.move_expense_order(uuid,text,text,uuid,uuid,uuid,jsonb,boolean) from public,anon;
grant execute on function public.expense_drag_lease(uuid,text,text,uuid,uuid,text),
 public.move_expense_order(uuid,text,text,uuid,uuid,uuid,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
