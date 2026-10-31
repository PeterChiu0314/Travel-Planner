import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {transactionBody} from './b7-forward-artifacts.mjs';
export const cascadeDir='docs/operations/drafts/budget-b7-cascade-forward';
export const cascadeHead='20261031130000';
export const cascadeName='budget_dormant_parent_cascade_guard';
export const normalized=s=>s.replace(/\r\n/g,'\n');
export const sha=s=>createHash('sha256').update(s).digest('hex');
export async function cascadeSource(){
 const source=normalized(await fs.readFile(`${cascadeDir}/source.sql`,'utf8'));
 const manifest=JSON.parse(await fs.readFile(`${cascadeDir}/source-manifest.json`,'utf8'));
 if(sha(source)!==manifest.sourceSha256||Buffer.byteLength(source)!==manifest.sourceBytes)throw Error('Reviewed Cascade source drift; do not reseal automatically');
 return source;
}
export function validateCascadeVersion(version){
 if(!/^\d{14}$/.test(version)||version<=cascadeHead)throw Error('Official CLI version must be strictly later than installed head '+cascadeHead);
 const iso=version.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,'$1-$2-$3T$4:$5:$6Z');
 if(!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,19)!==iso.slice(0,19))throw Error('Invalid calendar version');
}
// An offline builder, not a DB executor. A future reviewed psql Session must
// independently verify the project-bound endpoint/login, then set the target.
export async function cascadeDeploymentSql(version){
 validateCascadeVersion(version);const source=await cascadeSource(),digest=sha(source);
 if(source.includes('$b7_cascade_source$'))throw Error('Source delimiter collision');
 return `-- NON-AUTO-APPLY. Requires separate Staging authorization. No executor.\n-- Complete LF source SHA-256 ${digest}\n\\set ON_ERROR_STOP on\nbegin;\nset local lock_timeout='5s';set local statement_timeout='30s';\nlock table supabase_migrations.schema_migrations in exclusive mode nowait;\ndo $ledger_gate$\ndeclare r supabase_migrations.schema_migrations; n integer; h text;begin\n if current_setting('app.b7_install_target',true) is distinct from 'uyqdopksfysbobhjcepk' then raise exception 'Explicit Staging target required';end if;\n select count(*),max(version) into n,h from supabase_migrations.schema_migrations;\n select * into r from supabase_migrations.schema_migrations where version='${version}';\n if found then\n  if n<>63 or h<>'${version}' or r.name is distinct from '${cascadeName}' or cardinality(r.statements) is distinct from 1 or encode(sha256(convert_to(replace(r.statements[1],chr(13),''),'UTF8')),'hex') is distinct from '${digest}' then raise exception 'Forward ledger identity/source collision';end if;\n  if (select encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex') from pg_proc where oid='app_private.guard_incomplete_child()'::regprocedure)<>'ecd7888508e91b6df351a9ab4e95cf1a3facc426316ee68a868e622b1cdfda51' then raise exception 'Applied forward body drift';end if;\n elsif n<>62 or h<>'${cascadeHead}' then raise exception 'Unexpected starting ledger';end if;\nend $ledger_gate$;\n${transactionBody(source)}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${cascadeName}',array[$b7_cascade_source$${source}$b7_cascade_source$]) on conflict(version) do nothing;\ndo $ledger_after$begin\n if (select count(*) from supabase_migrations.schema_migrations)<>63 or (select max(version) from supabase_migrations.schema_migrations)<>'${version}' then raise exception 'Forward ledger readback mismatch';end if;\nend $ledger_after$;\ncommit;\n`;
}
