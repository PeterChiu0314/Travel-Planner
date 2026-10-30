-- Incident hotfix: business-version conflicts are not serialization failures.
-- Deliberately independent of dormant B-1..B-7 migrations. Only the 13 existing
-- baseline routines observed in the hosted inventory are eligible. No data,
-- grants, policies, triggers, feature flags, or request receipts are rewritten.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $hotfix$
declare target record; before_row jsonb; after_row jsonb; old_body text;
  new_body text; old_definition text; new_definition text; changed integer:=0;
begin
  if to_regprocedure('public.delete_budget_workspace_record(uuid,text,uuid,timestamptz)') is null then
    raise exception 'Budget baseline missing; do not install unrelated prerequisite migrations for this hotfix';
  end if;
  for target in
    select p.oid, p.oid::regprocedure::text signature
    from (values
      ('app_private.budget_edit_lease_action(text,uuid,uuid,uuid,text,timestamptz)'),
      ('app_private.budget_workspace_request(uuid,uuid,text,text,uuid)'),
      ('app_private.update_budget_selection(uuid,uuid,text,uuid)'),
      ('app_private.update_budget_selection_v2(uuid,uuid,text,uuid,uuid,text)'),
      ('public.assign_luggage_item(uuid,text,uuid,timestamptz,uuid)'),
      ('public.delete_budget_workspace_record(uuid,text,uuid,timestamptz)'),
      ('public.mutate_budget_receipt(uuid,uuid,text,jsonb,uuid,uuid)'),
      ('public.mutate_luggage_item(uuid,text,text,uuid,timestamptz,jsonb)'),
      ('public.privatize_luggage_item(uuid,uuid,timestamptz,text)'),
      ('public.reorder_luggage_items(uuid,text,uuid,uuid,text,jsonb)'),
      ('public.save_budget_workspace_record(uuid,text,uuid,timestamptz,jsonb)'),
      ('public.save_budget_workspace_record_v2(uuid,text,uuid,timestamptz,jsonb,uuid)'),
      ('public.save_budget_workspace_record_v3(uuid,text,uuid,timestamptz,jsonb,uuid)')
    ) allowlist(signature)
    join pg_proc p on p.oid=to_regprocedure(allowlist.signature)
    order by p.oid
  loop
    select to_jsonb(p), p.prosrc, pg_get_functiondef(p.oid)
      into before_row,old_body,old_definition from pg_proc p where p.oid=target.oid;
    -- Change only explicit business RAISE assignments. Engine-generated 40001
    -- and deadlock errors retain their native semantics.
    new_body:=regexp_replace(old_body,
      $pattern$(errcode[[:space:]]*=[[:space:]]*)'40001'$pattern$,
      $replacement$\1'PT409'$replacement$,'gi');
    if new_body=old_body then continue; end if;
    if position(old_body in old_definition)=0 then raise exception 'Cannot locate routine body: %',target.signature; end if;
    new_definition:=replace(old_definition,old_body,new_body);
    execute new_definition;
    select to_jsonb(p) into after_row from pg_proc p where p.oid=target.oid;
    if after_row->>'prosrc'<>new_body or (after_row-'prosrc') is distinct from (before_row-'prosrc') then
      raise exception 'Routine identity/security attributes changed: %',target.signature;
    end if;
    changed:=changed+1;
    raise notice 'Business conflict hotfix: %',target.signature;
  end loop;
  raise notice 'Business conflict hotfix changed % routines; repeated application is a no-op',changed;
end $hotfix$;
commit;
