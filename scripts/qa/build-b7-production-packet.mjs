// Production-specific NON-AUTO-APPLY builder. Never connects to any database.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {hash,normalize,transactionBody} from './b7-forward-artifacts.mjs';

export const productionTarget='lqvuqamzmchepgxkftcw';
export const resetTables=['public.actual_expense_participants','public.actual_expenses','public.budget_item_participants','public.itinerary_budget_items','public.budget_items','public.trip_budget_baselines','app_private.budget_edit_leases','app_private.budget_selections','app_private.budget_workspace_requests','public.budget_collaboration_signals'];
export const catalogContractQuery=`select jsonb_build_object(
'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'attributes',to_jsonb(p)-'prosrc','bodySha256',encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prokind='f'),
'tables',(select jsonb_agg(jsonb_build_object('oid',c.oid,'schema',n.nspname,'name',c.relname,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','storage') and c.relkind in('r','p')),
'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p where schemaname in('public','app_private','storage')),
'triggers',(select jsonb_agg(jsonb_build_object('oid',t.oid,'table',t.tgrelid,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in('public','app_private','storage')),
'memberships',(select jsonb_agg(to_jsonb(m) order by roleid,member,grantor) from pg_auth_members m),
'publications',(select jsonb_agg(to_jsonb(p) order by pubname,schemaname,tablename) from pg_publication_tables p))`;
const literal=s=>`'${s.replaceAll("'","''")}'`;
const json=(value,tag)=>`$${tag}$${JSON.stringify(value)}$${tag}$::jsonb`;
export async function productionPacket(profile){
 const plan=JSON.parse(await fs.readFile('docs/operations/budget-b7-production/migration-plan.json','utf8'));
 assert.equal(plan.target,productionTarget);assert.equal(plan.pendingSources.length,17);
 assert.equal(profile.ledger.length,48);assert.equal(profile.hotfix.length,13);
 assert(profile.protection.length>=10);assert(profile.catalogContract);
 const sources=[];
 for(const item of plan.pendingSources){
  const source=normalize(await fs.readFile(item.path,'utf8'));
  assert.equal(hash(source),item.lfSha256,`Immutable source drift: ${item.path}`);
  assert(!source.includes('$b7_source$'));
  sources.push({...item,source});
 }
 const locks=[...profile.protection.map(t=>t.relation),'auth.users','storage.buckets','storage.objects','supabase_migrations.schema_migrations'];
 for(const name of locks)assert(/^[a-z_]+\.[a-z_]+$/.test(name));
 for(const table of resetTables)assert(locks.includes(table));
 let sql=`-- Production-only budget test-data reset + Dormant B7 install. NON-AUTO-APPLY.
-- User waived backups and authorized BUDGET data only. No trip/account reset.
-- Source migrations are immutable; no T0/import alias/old hotfix replay.
begin;
set local lock_timeout='5s'; set local statement_timeout='60s';
lock table ${[...new Set(locks)].join(',')} in share row exclusive mode;
do $identity$ begin
 if current_setting('app.b7_install_target',true) is distinct from '${productionTarget}' then raise exception 'Production target binding required';end if;
 if current_user<>'postgres' or current_database()<>'postgres' or current_setting('role') not in('none','postgres') or auth.uid() is not null then raise exception 'Reviewed administrative identity required';end if;
 if (select count(*) from supabase_migrations.schema_migrations)<>48 or (select max(version) from supabase_migrations.schema_migrations)<>'20261031003000' then raise exception 'Production ledger baseline drift';end if;
 if to_regclass('app_private.budget_metadata_protocol') is not null or to_regclass('app_private.budget_receipt_legacy_cutover') is not null then raise exception 'Prior B7 installation; never replay';end if;
 if (select count(*) from storage.objects)<>0 or exists(select 1 from public.attachments where target_type in('budget_item','actual_expense')) then raise exception 'Receipt HTTP cleanup required before reset; no metadata-only deletion';end if;
 if exists(select 1 from app_private.budget_edit_leases where expires_at>clock_timestamp()) or exists(select 1 from public.budget_items where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes') or exists(select 1 from public.actual_expenses where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes') then raise exception 'Active editor; reset refused';end if;
 if exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and backend_type='client backend' and (state='idle in transaction' or (state='active' and query !~* '^\\s*(select|show|begin|commit|rollback)'))) then raise exception 'Unreviewed concurrent transaction';end if;
end $identity$;
create temporary table b7_prod_original_ledger as select * from supabase_migrations.schema_migrations;
alter table b7_prod_original_ledger enable row level security;
do $ledger$ declare r record;d text;begin
 for r in select * from jsonb_to_recordset(${json(profile.ledger,'ledger_seals')}) x(version text,"rawRowSha256" text) loop
  select encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') into d from supabase_migrations.schema_migrations m where m.version=r.version;
  if d is distinct from r."rawRowSha256" then raise exception 'Original ledger raw row drift: %',r.version;end if;
 end loop;
end $ledger$;
do $hotfix$ declare r record;d text;begin
 for r in select * from jsonb_to_recordset(${json(profile.hotfix,'before_seals')}) x(signature text,sha256 text) loop
  select encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex') into d from pg_proc where oid=to_regprocedure(r.signature);
  if d is distinct from r.sha256 then raise exception 'Production hotfix body drift: %',r.signature;end if;
 end loop;
end $hotfix$;
-- Exact catalog observations supplied by fresh native read-only preflight.
-- No baseline seal is automatically refreshed by this builder.
do $catalog$ declare observed jsonb;begin
 ${catalogContractQuery.replace('select jsonb_build_object(','select jsonb_build_object(')} into observed;
 if observed is distinct from ${json(profile.catalogContract,'catalog_contract')} then raise exception 'Production catalog/RLS/ACL drift';end if;
end $catalog$;
create temporary table b7_prod_keep(relation text,cols text[],digest text) on commit drop;
alter table b7_prod_keep enable row level security;
do $data$ declare r record;d text;cols text[];begin
 for r in select * from jsonb_to_recordset(${json(profile.protection,'data_seals')}) x(relation text,"old_column_sha256" text) loop
  select array_agg(a.attname::text order by a.attnum) into cols from pg_attribute a where a.attrelid=r.relation::regclass and a.attnum>0 and not a.attisdropped;
  execute format('select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''UTF8'')),''hex'') from %s t',r.relation::regclass) into d;
  if d is distinct from r."old_column_sha256" then raise exception 'Protected baseline data drift: %',r.relation;end if;
  if not r.relation=any(array[${resetTables.map(literal)}]) then
   if r.relation='public.accommodations' then cols:=array_remove(array_remove(cols,'budget_item_id'),'updated_at');end if;
   execute format('select encode(sha256(convert_to(coalesce(jsonb_agg(v order by v::text),''[]''::jsonb)::text,''UTF8'')),''hex'') from (select (select jsonb_object_agg(k,x) from jsonb_each(to_jsonb(t)) e(k,x) where k=any($1)) v from %s t)q',r.relation::regclass) into d using cols;
   insert into b7_prod_keep values(r.relation,cols,d);
  end if;
 end loop;
 for r in select unnest(array['auth.users','storage.objects','storage.buckets']) relation loop
  select array_agg(attname::text order by attnum) into cols from pg_attribute where attrelid=r.relation::regclass and attnum>0 and not attisdropped;
  execute format('select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''UTF8'')),''hex'') from %s t',r.relation::regclass) into d;
  insert into b7_prod_keep values(r.relation,cols,d);
 end loop;
end $data$;
-- Normal DELETE with existing guards, constraints and triggers enabled.
delete from public.actual_expense_participants;
delete from public.actual_expenses;
delete from public.budget_item_participants;
delete from public.itinerary_budget_items;
delete from public.budget_items;
-- Flush normal deferred Baseline refreshes, then remove only budget snapshots.
set constraints all immediate;
delete from public.trip_budget_baselines;
delete from app_private.budget_edit_leases;
delete from app_private.budget_selections;
delete from app_private.budget_workspace_requests;
delete from public.budget_collaboration_signals;
`;
 for(const s of sources){sql+=`\n-- INSTALL ${s.version} ${s.name}\n${transactionBody(s.source)}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${literal(s.version)},${literal(s.name)},array[$b7_source$${s.source}$b7_source$]);\n`;}
 sql+=`
set constraints all immediate;
do $final$ declare r record;d text;begin
 if (select count(*) from supabase_migrations.schema_migrations)<>65 or (select max(version) from supabase_migrations.schema_migrations)<>'20261101032853' then raise exception 'Final ledger count/head mismatch';end if;
 if exists(select to_jsonb(m) from b7_prod_original_ledger m except select to_jsonb(m) from supabase_migrations.schema_migrations m) then raise exception 'Original ledger source rewritten';end if;
 for r in select * from b7_prod_keep loop
  execute format('select encode(sha256(convert_to(coalesce(jsonb_agg(v order by v::text),''[]''::jsonb)::text,''UTF8'')),''hex'') from (select (select jsonb_object_agg(k,x) from jsonb_each(to_jsonb(t)) e(k,x) where k=any($1)) v from %s t)q',r.relation::regclass) into d using r.cols;
  if d is distinct from r.digest then raise exception 'Non-budget data changed: %',r.relation;end if;
 end loop;
 if exists(select 1 from public.accommodations where budget_item_id is not null) then raise exception 'Accommodation budget backlink survived';end if;
 for r in select unnest(array[${resetTables.map(literal)}]) relation loop
  execute format('select count(*)::text from %s',r.relation::regclass) into d;
  if d<>'0' then raise exception 'Budget reset not empty: %',r.relation;end if;
 end loop;
 for r in select * from jsonb_to_recordset(${json(plan.stagingFinal38Expected,'final_seals')}) x(signature text,"bodySha256" text) loop
  select encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex') into d from pg_proc where oid=to_regprocedure(r.signature);
  if d is distinct from r."bodySha256" then raise exception 'Final B7 body drift: %',r.signature;end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prosrc ~* $code$errcode[[:space:]]*=[[:space:]]*'40001'$code$) then raise exception 'Custom business 40001 remains';end if;
 for r in select unnest(array['budget_metadata_protocol','budget_payment_protocol','budget_source_protocol','budget_finance_protocol','budget_receipt_protocol','budget_lifecycle_protocol','budget_metadata_undo_protocol']) name loop
  execute format('select count(*)::text from app_private.%I',r.name) into d;
  if d<>'1' then raise exception 'Protocol singleton missing: %',r.name;end if;
 end loop;
 if exists(select 1 from app_private.budget_metadata_protocol where enabled) or exists(select 1 from app_private.budget_payment_protocol where enabled) or exists(select 1 from app_private.budget_source_protocol where enabled) or exists(select 1 from app_private.budget_finance_protocol where enabled or activated) or exists(select 1 from app_private.budget_receipt_protocol where enabled or activated or storage_verified or cleanup_worker_verified or content_worker_verified or legacy_grants_expire_at is not null) or exists(select 1 from app_private.budget_lifecycle_protocol where enabled or activated) or exists(select 1 from app_private.budget_metadata_undo_protocol where enabled or full_enabled) then raise exception 'Protocols/latches/readiness must remain false';end if;
end $final$;
drop table b7_prod_original_ledger;
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{target:productionTarget,status:'candidate; requires fresh preflight and isolated rehearsal',budgetResetAuthorized:true,backupWaivedByUser:true,packetSha256:hash(sql),packetBytes:Buffer.byteLength(sql),ledgerBefore:48,ledgerAfter:65,sources:sources.map(({order,version,name,path,lfSha256,lfBytes})=>({order,version,name,path,lfSha256,lfBytes})),resetTables,nonBudgetPreservation:'all observed public/private old columns; accommodation budget backlink and its update timestamp may change; auth/storage metadata retained',noStorageBytesDeletion:true,noActivation:true,sourceMigrationsModified:false}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert(process.argv[2]&&process.argv[3],'Explicit local profile and output directory required');
 const profile=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 const out=await productionPacket(profile);await fs.mkdir(process.argv[3],{recursive:true});
 await fs.writeFile(process.argv[3]+'/candidate-production.sql',out.sql);
 await fs.writeFile(process.argv[3]+'/candidate-manifest.json',JSON.stringify(out.manifest,null,2)+'\n');
 console.log(JSON.stringify({target:productionTarget,packetSha256:out.manifest.packetSha256,sources:17,hostedWrites:false}));
}
