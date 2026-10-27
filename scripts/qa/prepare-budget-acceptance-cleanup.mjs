import {budgetSnapshotSQL,preservedBudgetTables} from './prepare-budget-collaboration-rollout.mjs';
export const acceptanceTrips=[{id:'fcb837a1-24f9-4410-9800-6aa2f83d5507',title:'QA #10 完整驗收 20261027'},{id:'b271db8f-e261-4b93-b04f-ebddf7b80e4c',title:'QA #10 授權隔離 20261027'}];
export function prepareAcceptanceCleanup(expected){
  if(!Array.isArray(expected)||expected.length!==11||new Set(expected.map(r=>r.object_name)).size!==11||expected.some(r=>!preservedBudgetTables.includes(r.object_name)||!/^[a-f0-9]{32}$/.test(r.digest)||!Number.isSafeInteger(Number(r.row_count))))throw Error('Invalid originals manifest');
  const ids=acceptanceTrips.map(t=>`'${t.id}'::uuid`).join(',');
  const originalsSQL=preservedBudgetTables.map(table=>{
    const scope=table==='trips'?`t.id not in (${ids})`:['budget_item_participants','itinerary_budget_items'].includes(table)?`exists(select 1 from public.budget_items b where b.id=t.budget_item_id and b.trip_id not in (${ids}))`:table==='actual_expense_participants'?`exists(select 1 from public.actual_expenses a where a.id=t.actual_expense_id and a.trip_id not in (${ids}))`:`t.trip_id not in (${ids})`;
    return `select '${table}'::text object_name,count(*)::bigint row_count,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) digest from public.${table} t where ${scope}`;
  }).join('\nunion all\n');
  const compare=source=>`exists((select * from (${source}) actual except select * from jsonb_to_recordset($manifest$${JSON.stringify(expected)}$manifest$::jsonb) as e(object_name text,row_count bigint,digest text)) union all (select * from jsonb_to_recordset($manifest$${JSON.stringify(expected)}$manifest$::jsonb) as e(object_name text,row_count bigint,digest text) except select * from (${source}) actual))`;
  return {originalsSQL,sql:`-- Only the two user-approved disposable #10 acceptance trips. Never use on original trips.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
lock table ${preservedBudgetTables.map(t=>`public.${t}`).join(',')} in share row exclusive mode;
do $guard$ begin
 if (select count(*) from public.trips where ${acceptanceTrips.map(t=>`(id='${t.id}' and title='${t.title}' and owner_id='eb16ad00-aef3-4dfb-a0c5-874b2d5aef5d')`).join(' or ')})<>2 then raise exception 'QA identity changed';end if;
 if exists(select 1 from public.attachments where trip_id in (${ids})) or exists(select 1 from storage.objects where bucket_id='trip-attachments' and (${acceptanceTrips.map(t=>`name like 'trips/${t.id}/%'`).join(' or ')})) then raise exception 'Remove QA receipts through the application first';end if;
 if ${compare(originalsSQL)} then raise exception 'Original data changed before cleanup';end if;
end $guard$;
delete from public.trips where id in (${ids});
-- ACCEPTANCE_VERIFY
do $verify$ begin
 if ${compare(budgetSnapshotSQL)} then raise exception 'Original data changed by cleanup';end if;
 if exists(select 1 from public.trips where id in (${ids})) or exists(select 1 from app_private.budget_edit_leases where trip_id in (${ids})) or exists(select 1 from app_private.budget_selections where trip_id in (${ids})) then raise exception 'QA cascade incomplete';end if;
end $verify$;
commit;
select 'only_two_approved_QA_trips_removed_originals_preserved' result;
`,verifySQL:`-- Independent readonly final comparison. All originals must match the preflight.
select 'all_eleven_originals_preserved' check_name,not ${compare(budgetSnapshotSQL)} passed
union all select 'no_QA_trips',not exists(select 1 from public.trips where id in (${ids}))
union all select 'no_QA_private_state',not exists(select 1 from app_private.budget_edit_leases where trip_id in (${ids})) and not exists(select 1 from app_private.budget_selections where trip_id in (${ids}))
union all select 'no_QA_receipt_bytes',not exists(select 1 from storage.objects where bucket_id='trip-attachments' and (${acceptanceTrips.map(t=>`name like 'trips/${t.id}/%'`).join(' or ')}));`};
}
