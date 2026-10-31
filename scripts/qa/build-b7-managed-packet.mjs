// Offline reviewed replacement: never connects to a database or executes SQL.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {hash,normalize,transactionBody} from './b7-forward-artifacts.mjs';
import {packet as originalPacket} from './build-b7-staging-packet.mjs';
export const managedDir='docs/operations/budget-b7-staging-managed';
export const replacementFile='20261031083437_budget_managed_worker_role_path.sql';
export const supersededFile='20261030125028_budget_workspace_integration_safety.sql';
const originalSha='4d43bddf6ed7853daa3008c51b58d76b868553330b919f885d82a200f546698b';
const oldRoleBlock=`do $$declare r text;begin
 foreach r in array array['authenticator','supabase_storage_admin'] loop
  if exists(select 1 from pg_roles where rolname=r) then execute format('grant budget_receipt_worker to %I',r);end if;
 end loop;
end $$;`;
export const newRoleBlock=`-- Use the existing Managed SET path; never modify a reserved role.
-- NOINHERIT and per-membership INHERIT FALSE preserve explicit impersonation.
do $$begin
 if not exists(select 1 from pg_roles where rolname='authenticator' and not rolsuper and not rolbypassrls)
  or not exists(select 1 from pg_roles where rolname='supabase_storage_admin' and not rolsuper)
  or not coalesce(pg_has_role('supabase_storage_admin','authenticator','SET'),false) then
  raise exception 'Existing Managed Storage-to-authenticator SET path required' using errcode='55000';
 end if;
end $$;
grant budget_receipt_worker to authenticator with inherit false, set true;
do $$begin
 if not pg_has_role('authenticator','budget_receipt_worker','SET')
  or not pg_has_role('supabase_storage_admin','budget_receipt_worker','SET')
  or pg_has_role('authenticator','budget_receipt_worker','USAGE')
  or exists(select 1 from unnest(array['public','app_private','storage']) n where not has_schema_privilege('budget_receipt_worker',n,'USAGE'))
  or exists(select 1 from unnest(array['public','app_private','storage']) n where has_schema_privilege('budget_receipt_worker',n,'CREATE'))
  or not has_table_privilege('budget_receipt_worker','storage.objects','SELECT')
  or not has_table_privilege('budget_receipt_worker','storage.objects','DELETE')
  or has_table_privilege('budget_receipt_worker','storage.objects','INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
  or not has_table_privilege('budget_receipt_worker','storage.buckets','SELECT')
  or has_table_privilege('budget_receipt_worker','storage.buckets','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid
    where r.rolname='budget_receipt_worker' and m.member<>'authenticator'::regrole
    and not(m.member=current_user::regrole and m.admin_option and not m.inherit_option and not m.set_option))
  or exists(select 1 from pg_auth_members where member='budget_receipt_worker'::regrole) then
  raise exception 'Dedicated Worker role path or least-privilege invariant failed' using errcode='55000';
 end if;
end $$;`;
function replaceOnce(text,before,after){if(text.split(before).length!==2)throw Error('Expected exact single replacement block');return text.replace(before,()=>after);}
export async function managedArtifacts(options={}){
 const base=await originalPacket(options);
 const reviewed=JSON.parse(await fs.readFile('docs/operations/budget-b7-staging/packet-manifest.json','utf8'));
 const onDisk=normalize(await fs.readFile('docs/operations/budget-b7-staging/dormant-schema.sql','utf8'));
 if(hash(onDisk)!==originalSha||reviewed.packetSha256!==originalSha)throw Error('Original packet drift');
 const origin=normalize(await fs.readFile(`supabase/migrations/${supersededFile}`,'utf8'));
 const entry=reviewed.sources.find(x=>x.file===supersededFile);
 if(!entry||hash(origin)!==entry.sha256)throw Error('Immutable origin source drift');
 const version=replacementFile.split('_')[0],oldVersion=supersededFile.split('_')[0];
 const header=`-- NON-AUTO-APPLY candidate; no Hosted execution authorization.
-- Replaces ONLY the never-committed ${supersededFile}.
-- Immutable origin SHA-256: ${entry.sha256}
-- No original ledger row is fabricated; this complete source has its own version.
`;
 const source=header+replaceOnce(origin,oldRoleBlock,newRoleBlock);
 const install=(file,body)=>{const v=file.split('_')[0];return `\n-- INSTALL ${file}\n${transactionBody(body)}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${v}','${file.slice(v.length+1,-4)}',array[$migration_source$${body}$migration_source$]);\n`;};
 let sql=replaceOnce(base.sql,install(supersededFile,origin),install(replacementFile,source));
 sql=replaceOnce(sql,'do $preflight$ begin',`-- Managed-compatible candidate: explicit supersession, not source rewriting.
do $managed_path$ begin
 if to_regrole('supabase_storage_admin') is null or to_regrole('authenticator') is null then
  raise exception 'Managed Storage and authenticator roles required' using errcode='55000';
 end if;
 if not pg_has_role('supabase_storage_admin','authenticator','SET') then
  raise exception 'Existing Managed Storage-to-authenticator SET path required' using errcode='55000';
 end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version in('${oldVersion}','${version}')) then
  raise exception 'Superseded or replacement migration already recorded; separate upgrade Review required';
 end if;
end $managed_path$;
do $preflight$ begin`);
 const manifest={...base.manifest,scope:'NON-AUTO-APPLY managed-compatible candidate; not Hosted-validated',originalPacketSha256:originalSha,
  packetSha256:hash(sql),packetBytes:Buffer.byteLength(sql),
  supersession:{unappliedOriginal:{file:supersededFile,sha256:entry.sha256,version:oldVersion},replacement:{file:replacementFile,version,sha256:hash(source)},originalLedgerRowMustRemainAbsent:true},
  sources:base.manifest.sources.map(x=>x.file===supersededFile?{file:replacementFile,sha256:hash(source)}:x),
  rolePath:{existing:'supabase_storage_admin -> authenticator (SET)',newGrant:'budget_receipt_worker to authenticator WITH INHERIT FALSE, SET TRUE',creatorAdmin:'PostgreSQL16+ implicit creator ADMIN allowed only without INHERIT/SET',reservedRoleModified:false,workerInheritsRoles:false},
  deploymentAuthorization:false,realStorageHttpVerified:false,workerScheduleVerified:false};
 return {sql,source,manifest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await managedArtifacts();await fs.mkdir(managedDir,{recursive:true});
 await fs.writeFile(`${managedDir}/${replacementFile}`,result.source);
 await fs.writeFile(`${managedDir}/dormant-schema.sql`,result.sql);
 await fs.writeFile(`${managedDir}/packet-manifest.json`,JSON.stringify(result.manifest,null,2)+'\n');
 console.log(JSON.stringify({packetSha256:result.manifest.packetSha256,bytes:result.manifest.packetBytes,sources:result.manifest.sources.length,replacement:result.manifest.supersession.replacement,hostedAccess:false}));
}
