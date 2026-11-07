begin;

-- An unfrozen baseline is an automatically maintained planning projection.
-- Its existing FK deletes it with the trip. Only a frozen snapshot is history.
-- Preserve the legacy finance, receipt and dormant-cascade checks verbatim.
do $migration$
declare
  guard_oid oid := to_regprocedure('app_private.guard_budget_external_parent()');
  guard_source text;
  guard_attributes jsonb;
  snapshot_clause constant text := 'from public.trip_budget_baselines where trip_id=old.id)';
begin
  select replace(p.prosrc, chr(13), ''), to_jsonb(p) - 'prosrc'
    into guard_source, guard_attributes from pg_proc p where p.oid=guard_oid;
  if guard_source is null or encode(sha256(convert_to(guard_source, 'UTF8')), 'hex') not in (
    '339372306c750fb35c826502db586f8760c9d98c6ce157885cc4c42adf66a32a', -- repository baseline
    '33250f5f38a512114aff9577caf01d4f2e87a9492f212311cf760c8d21df7d8a'  -- hosted dormant-cascade repair
  ) then
    raise exception 'Unreviewed trip delete guard; refusing to change its protections';
  end if;
  if not exists (
    select 1 from pg_trigger where tgrelid='public.trips'::regclass
      and tgname='z_remove_native_expenses_before_trip_delete' and tgenabled in ('O','A')
      and tgfoid=to_regprocedure('app_private.remove_trip_expense_graph()')
  ) or not exists (
    select 1 from pg_constraint where conrelid='public.trip_budget_baselines'::regclass
      and confrelid='public.trips'::regclass and contype='f' and confdeltype='c' and convalidated
  ) then
    raise exception 'Expected native trip cleanup and snapshot cascade are required';
  end if;

  execute replace(pg_get_functiondef(guard_oid), snapshot_clause,
    'from public.trip_budget_baselines where trip_id=old.id and departure_at<=clock_timestamp())');

  if (select to_jsonb(p) - 'prosrc' from pg_proc p where p.oid=guard_oid) is distinct from guard_attributes then
    raise exception 'Trip delete guard attributes changed';
  end if;
end;
$migration$;

commit;
