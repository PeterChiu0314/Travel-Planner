// NON-AUTO-APPLY. This builder never opens a database/network connection.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {hash,normalize,transactionBody} from './b7-forward-artifacts.mjs';
export const stagingTarget='uyqdopksfysbobhjcepk';
export const forwardVersion='20261103113253';
const forwardName='remove_budget_custom_undo';
const schemas="('public','app_private','auth','storage')";
const changedBodies="('budget_metadata_undo_enabled','workspace_undo_enabled','read_budget_metadata_undo')";
const revokedNames="('undo_budget_metadata_group','undo_budget_workspace','budget_workspace_undo_lease','read_budget_metadata_undo','clear_budget_metadata_undo','prepare_budget_metadata_undo','workspace_undo_lease','prepare_workspace_inverse','workspace_inverse_manifest','finish_workspace_inverse','budget_receipts_lease','mutate_budget_receipts','read_budget_receipt_operation','abandon_budget_receipt','claim_budget_receipt_cleanup','claim_budget_receipt_verification','finish_budget_receipt_verification','sweep_budget_receipts','claim_budget_receipt_worker','finish_budget_receipt_cleanup')";
const removedAcl=`(p.proname in ${revokedNames} or p.proname like 'budget_receipt_worker_%')`;
const oldFunctions="n.nspname in('public','app_private') and p.prokind='f' and not(n.nspname='app_private' and p.proname='guard_removed_budget_receipts')";
const digest=q=>`(select encode(sha256(convert_to(coalesce(jsonb_agg(v order by v::text),'[]'::jsonb)::text,'UTF8')),'hex') from (${q}) d)`;
export const dataDigestQuery=digest(`select jsonb_build_object('relation',format('%I.%I',n.nspname,c.relname),'rows',
 (xpath('/row/d/text()',query_to_xml(format('select count(*) d from %I.%I',n.nspname,c.relname),true,false,'')))[1]::text,
 'sha256',(xpath('/row/d/text()',query_to_xml(format('select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''UTF8'')),''hex'') d from %I.%I t',n.nspname,c.relname),true,false,'')))[1]::text) v
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and c.relkind in('r','p')`);
const bodies=digest(`select jsonb_build_object('signature',p.oid::regprocedure::text,'body',p.prosrc) v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${oldFunctions} and not(n.nspname='app_private' and p.proname in ${changedBodies})`);
const allBodies=digest(`select jsonb_build_object('signature',p.oid::regprocedure::text,'body',p.prosrc) v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${oldFunctions}`);
const attributes=digest(`select (to_jsonb(p)-'prosrc'-'proacl') v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${oldFunctions}`);
const acls=digest(`select jsonb_build_object('signature',p.oid::regprocedure::text,'acl',p.proacl) v from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${oldFunctions} and not ${removedAcl}`);
const schemaDigest=digest(`select jsonb_build_object('relation',format('%I.%I',n.nspname,c.relname),'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) v
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and c.relkind in('r','p')
 union all select to_jsonb(p) from pg_policies p where schemaname in ${schemas} and policyname not in('removed_receipts_metadata_read','removed_receipts_storage')
 union all select to_jsonb(i) from pg_indexes i where schemaname in ${schemas} and indexname<>'actual_expenses_one_budget'
 union all select jsonb_build_object('constraint',oid::regclass::text,'definition',pg_get_constraintdef(oid),'relation',conrelid::regclass::text) from pg_constraint where connamespace in(select oid from pg_namespace where nspname in ${schemas})
 union all select jsonb_build_object('trigger',t.tgname,'relation',t.tgrelid::regclass::text,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and not t.tgisinternal and t.tgname<>'aa_removed_budget_receipts'
 union all select to_jsonb(p) from pg_publication_tables p`);
const roles=digest(`select jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'login',rolcanlogin,'bypassRls',rolbypassrls,'config',rolconfig) v from pg_roles union all select to_jsonb(m) from pg_auth_members m`);
const protocolRows=`jsonb_build_object('metadata',(select to_jsonb(t) from app_private.budget_metadata_protocol t),'finance',(select to_jsonb(t) from app_private.budget_finance_protocol t),'payment',(select to_jsonb(t) from app_private.budget_payment_protocol t),'source',(select to_jsonb(t) from app_private.budget_source_protocol t),'receipt',(select to_jsonb(t) from app_private.budget_receipt_protocol t),'lifecycle',(select to_jsonb(t) from app_private.budget_lifecycle_protocol t),'undo',(select to_jsonb(t) from app_private.budget_metadata_undo_protocol t))`;
const ledgerDigest=filter=>digest(`select to_jsonb(m) v from supabase_migrations.schema_migrations m ${filter}`);
export const captureUndoRemovalContractQuery=`select jsonb_build_object('target','${stagingTarget}','capturedAt',clock_timestamp(),'identity',current_user,'fixtureMarker',current_setting('budget_metadata.test_cluster',true),'ledgerCount',(select count(*) from supabase_migrations.schema_migrations),'ledgerHead',(select max(version) from supabase_migrations.schema_migrations),'ledgerDigest',${ledgerDigest('')},'dataDigest',${dataDigestQuery},'allFunctionBodies',${allBodies},'changedBodyBefore',(select jsonb_object_agg(p.proname,encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in ${changedBodies}),'functionBodies',${bodies},'functionAttributes',${attributes},'unaffectedAcls',${acls},'schemaDigest',${schemaDigest},'roleDigest',${roles},'protocolRows',${protocolRows}) contract`;
const literal=s=>`'${String(s).replaceAll("'","''")}'`;
export async function undoRemovalStagingPacket(profile){
 assert.equal(profile.target,stagingTarget);assert.equal(profile.ledgerCount,65);assert.equal(profile.ledgerHead,'20261101032853');
 for(const field of ['ledgerDigest','dataDigest','allFunctionBodies','functionBodies','functionAttributes','unaffectedAcls','schemaDigest','roleDigest'])assert(/^[a-f0-9]{64}$/.test(profile[field]),field);
 assert(Number.isFinite(Date.parse(profile.capturedAt)));assert(profile.protocolRows);
 const fixture=Boolean(profile.fixtureMarker);
 if(fixture){assert(/^[a-f0-9-]{36}$/.test(profile.fixtureMarker));assert.equal(profile.identity,'budget_local_admin');}
 else assert.equal(profile.identity,'postgres');
 assert(Object.values(profile.protocolRows).every(p=>p.enabled===false));assert.equal(profile.protocolRows.undo.full_enabled,false);
 // The three intentionally replaced bodies must match immutable installed
 // sources, not merely an arbitrary newly captured database state.
 for(const file of ['20261029091435_budget_metadata_undo_prototype.sql','20261030082712_budget_workspace_undo.sql']){
 const old=normalize(await fs.readFile(`supabase/migrations/${file}`,'utf8'));
 for(const name of file.includes('prototype')?['budget_metadata_undo_enabled','read_budget_metadata_undo']:['workspace_undo_enabled']){
 const start=old.indexOf(`create function app_private.${name}(`),bodyStart=old.indexOf('$$',start)+2,bodyEnd=old.indexOf('$$;',bodyStart);
 assert(start>=0&&bodyStart>1&&bodyEnd>bodyStart,name);
 assert.equal(profile.changedBodyBefore?.[name],hash(old.slice(bodyStart,bodyEnd)),`Installed helper body drift: ${name}`);
 }}
 const source=normalize(await fs.readFile(`supabase/migrations/${forwardVersion}_${forwardName}.sql`,'utf8'));
 assert(!source.includes('$undo_forward_source$'));
 const definitions=[...source.matchAll(/create(?: or replace)? function app_private\.(\w+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)];
 assert.deepEqual(definitions.map(m=>m[1]),['budget_metadata_undo_enabled','workspace_undo_enabled','read_budget_metadata_undo','guard_removed_budget_receipts']);
 const manifest={target:stagingTarget,version:forwardVersion,sourceSha256:hash(source),fixtureOnly:fixture,capturedAt:profile.capturedAt,profileSha256:hash(JSON.stringify(profile)),status:'NON-AUTO-APPLY / NO HOSTED EXECUTION AUTHORITY'};
 const compare=(query,key,label)=>`if (${query}) is distinct from ${literal(profile[key])} then raise exception '${label} drift';end if;`;
 const invariants=`${compare(dataDigestQuery,'dataDigest','Protected data')}
 ${compare(bodies,'functionBodies','Unchanged function body')}
 ${compare(attributes,'functionAttributes','Function identity attributes')}
 ${compare(acls,'unaffectedAcls','Unchanged function ACL')}
 ${compare(schemaDigest,'schemaDigest','Schema RLS policy trigger index')}
 ${compare(roles,'roleDigest','Role membership')}
 if ${protocolRows} is distinct from ${literal(JSON.stringify(profile.protocolRows))}::jsonb then raise exception 'Protocol latch readiness drift';end if;`;
 let sql=`-- Staging only; single Forward; NO RESET / NO ACTIVATION / NO STORAGE BYTES.
-- Transport identity/ref/TLS must be independently verified; target GUC alone is not proof.
-- ${fixture?'ISOLATED FIXTURE ONLY, cannot run Hosted.':'LIVE CANDIDATE, requires exact Review and execution authorization.'}
begin;
set local lock_timeout='3s';set local statement_timeout='60s';
do $undo_preflight$ declare r record;begin
 if current_setting('app.undo_removal_target',true) is distinct from '${stagingTarget}' then raise exception 'Staging target binding required';end if;
 if current_user<>${literal(profile.identity)} or current_database()<>'postgres' or auth.uid() is not null then raise exception 'Administrative identity mismatch';end if;
 ${fixture?`if current_setting('budget_metadata.test_cluster',true) is distinct from ${literal(profile.fixtureMarker)} then raise exception 'Fixture cluster only';end if;`:`if coalesce(current_setting('budget_metadata.test_cluster',true),'')<>'' then raise exception 'Unexpected fixture identity';end if;`}
 if clock_timestamp()<${literal(profile.capturedAt)}::timestamptz or clock_timestamp()>${literal(profile.capturedAt)}::timestamptz+interval '15 minutes' then raise exception 'Fresh contract required';end if;
 lock table supabase_migrations.schema_migrations in share row exclusive mode;
 if exists(select 1 from supabase_migrations.schema_migrations where version in('${forwardVersion}','20261103084209')) then raise exception 'Forward already installed or cancelled source installed; replay refused';end if;
 if (select count(*) from supabase_migrations.schema_migrations)<>65 or (select max(version) from supabase_migrations.schema_migrations)<>'20261101032853' then raise exception 'Ledger baseline drift';end if;
 ${compare(ledgerDigest(''),'ledgerDigest','Raw ledger source')}
 ${compare(allBodies,'allFunctionBodies','Complete before function body')}
 -- Deterministic full relation locks, including auth/storage catalog. Failure
 -- to lock a managed relation is a hard stop, never a grant/role workaround.
 for r in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${schemas} and c.relkind in('r','p') order by n.nspname,c.relname loop
 execute format('lock table %I.%I in share row exclusive mode',r.nspname,r.relname);
 end loop;
 if exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and backend_type='client backend' and xact_start is not null and state<>'idle') then raise exception 'Concurrent transaction; install refused';end if;
 if exists(select 1 from app_private.budget_edit_leases where expires_at>clock_timestamp()) or exists(select 1 from app_private.budget_metadata_groups where expires_at>clock_timestamp())
 or exists(select 1 from public.budget_items where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes') or exists(select 1 from public.actual_expenses where locked_by is not null and locked_at>clock_timestamp()-interval '7 minutes') then raise exception 'Active editor; install refused';end if;
 if exists(select 1 from app_private.budget_receipt_intents where status='pending') or exists(select 1 from app_private.budget_receipt_cleanup where status<>'done') or exists(select 1 from app_private.budget_metadata_undo_intents) then raise exception 'In-flight Receipt or Undo work';end if;
 if exists(select 1 from public.actual_expenses where budget_item_id is not null group by budget_item_id having count(*)>1) then raise exception 'Duplicate current Actual; preserve and review';end if;
 if to_regclass('public.actual_expenses_one_budget') is not null or to_regprocedure('app_private.guard_removed_budget_receipts()') is not null
 or exists(select 1 from pg_policies where policyname in('removed_receipts_metadata_read','removed_receipts_storage')) or exists(select 1 from pg_trigger where tgname='aa_removed_budget_receipts') then raise exception 'Forward artifact already present';end if;
 ${invariants}
end $undo_preflight$;
${transactionBody(source)}
insert into supabase_migrations.schema_migrations(version,name,statements) values('${forwardVersion}','${forwardName}',array[$undo_forward_source$${source}$undo_forward_source$]);
do $undo_readback$ declare f record;begin
 ${compare(ledgerDigest(`where version<>'${forwardVersion}'`),'ledgerDigest','Original ledger')}
 if (select count(*) from supabase_migrations.schema_migrations)<>66 or not exists(select 1 from supabase_migrations.schema_migrations where version='${forwardVersion}' and name='${forwardName}' and cardinality(statements)=1 and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${hash(source)}') then raise exception 'Forward ledger/source mismatch';end if;
 ${invariants}
 ${definitions.map(m=>`if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='${m[1]}' and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${hash(m[2])}') then raise exception 'Forward body mismatch: ${m[1]}';end if;`).join('\n')}
 if app_private.budget_metadata_undo_enabled() or app_private.workspace_undo_enabled() then raise exception 'Undo remains enabled';end if;
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and ${removedAcl} and (n.nspname='public' or p.proname in('clear_budget_metadata_undo','read_budget_metadata_undo','prepare_budget_metadata_undo','workspace_undo_lease','prepare_workspace_inverse','workspace_inverse_manifest','finish_workspace_inverse')) loop
 if has_function_privilege('anon',f.oid,'execute') or has_function_privilege('authenticated',f.oid,'execute') or has_function_privilege('budget_receipt_worker',f.oid,'execute') then raise exception 'Removed client entry remains executable';end if;
 end loop;
 if not exists(select 1 from pg_indexes where schemaname='public' and indexname='actual_expenses_one_budget' and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%WHERE (budget_item_id IS NOT NULL)%') then raise exception 'Unique current Actual index missing';end if;
 if (select count(*) from pg_policies where policyname in('removed_receipts_metadata_read','removed_receipts_storage') and permissive='RESTRICTIVE')<>2 then raise exception 'Receipt restrictive policies missing';end if;
end $undo_readback$;
notify pgrst,'reload schema';
commit;
`;
 manifest.packetSha256=hash(sql);return {sql,manifest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.includes('--capture'))console.log(`begin transaction read only;set local statement_timeout='30s';${captureUndoRemovalContractQuery};commit;`);
 else {const file=process.argv[2];assert(file,'Pass a fresh contract JSON file, or --capture');const packet=await undoRemovalStagingPacket(JSON.parse(await fs.readFile(file,'utf8')));const dir='.tmp-undo-removal-staging-packet';await fs.mkdir(dir,{recursive:true});await fs.writeFile(`${dir}/packet.sql`,packet.sql);await fs.writeFile(`${dir}/manifest.json`,JSON.stringify(packet.manifest,null,2)+'\n');console.log(JSON.stringify(packet.manifest));}
}
