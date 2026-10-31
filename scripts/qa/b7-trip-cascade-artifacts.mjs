// Offline artifact builder; no DB connections, no automatic application.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {transactionBody} from './b7-forward-artifacts.mjs';
export const tripDir='docs/operations/drafts/budget-b7-trip-cascade';
export const tripHead='20261031130414',tripName='budget_trip_cascade_lease_admission';
export const sha=s=>createHash('sha256').update(s).digest('hex');
export async function tripSource(){const s=(await fs.readFile(tripDir+'/source.sql','utf8')).replace(/\r\n/g,'\n'),m=JSON.parse(await fs.readFile(tripDir+'/source-manifest.json','utf8'));if(sha(s)!==m.sourceSha256||Buffer.byteLength(s)!==m.sourceBytes)throw Error('Reviewed Trip source drift; do not reseal automatically');return s;}
export function validateTripVersion(v){if(!/^\d{14}$/.test(v)||v<=tripHead)throw Error('Official UTC version must be later than '+tripHead);const iso=v.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,'$1-$2-$3T$4:$5:$6Z');if(!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,19)!==iso.slice(0,19))throw Error('Invalid calendar version');}
export async function tripDeploymentSql(version){validateTripVersion(version);const s=await tripSource(),h=sha(s);if(s.includes('$trip_source$'))throw Error('Delimiter collision');return `-- NON-AUTO-APPLY; a new exact-artifact Review and explicit Staging authority are required.
\\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode nowait;
do $ledger$
declare r supabase_migrations.schema_migrations;n int;h text;begin
 if current_setting('app.b7_install_target',true) is distinct from 'uyqdopksfysbobhjcepk' then raise exception 'Explicit Staging target required';end if;
 select count(*),max(version) into n,h from supabase_migrations.schema_migrations;
 select * into r from supabase_migrations.schema_migrations where version='${version}';
 if found then
  if n<>64 or h<>'${version}' or r.name is distinct from '${tripName}' or cardinality(r.statements) is distinct from 1 or encode(sha256(convert_to(replace(r.statements[1],chr(13),''),'UTF8')),'hex') is distinct from '${h}' then raise exception 'Trip Forward ledger/source collision';end if;
 elsif n<>63 or h<>'${tripHead}' then raise exception 'Unexpected starting Trip ledger';end if;
end $ledger$;
${transactionBody(s)}
insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${tripName}',array[$trip_source$${s}$trip_source$]) on conflict(version) do nothing;
do $after$begin if (select count(*) from supabase_migrations.schema_migrations)<>64 or (select max(version) from supabase_migrations.schema_migrations)<>'${version}' then raise exception 'Trip Forward ledger readback mismatch';end if;end $after$;
commit;
`;}
