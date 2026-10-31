// Offline deterministic SQL builder. No network, DB connection or execution.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {bundleDir,forwardFile,migrationSources,transactionBody,hash,normalize} from './b7-forward-artifacts.mjs';
export const protectedTables=['trips','trip_members','itinerary_items','itinerary_alternatives','budget_items','budget_item_participants','actual_expenses','actual_expense_participants','itinerary_budget_items','attachments','trip_budget_baselines','luggage_items','shared_luggage_items'];
export async function captureProtection(db){const out=[];for(const name of protectedTables){const r=(await db.query(`select count(*)::int rows,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') rowset_sha256 from public.${name} t`)).rows[0];out.push({name,...r});}return out;}
export async function packet({protection,baselineSeal}={}){
 const audit=JSON.parse(await fs.readFile('docs/qa/2026-10-31-budget-b7-preflight-audit.json','utf8'));
 protection??=audit.staging.protection.protected_tables;baselineSeal??=JSON.parse(await fs.readFile(`${bundleDir}/baseline-seal.json`,'utf8'));
 const all=await migrationSources();
 const known=new Map(audit.staging.missing.map(f=>[f.file,f.sha256]));
 const chosen=all.filter(f=>f.file==='20260811150000_atomic_apply_itinerary_alternative.sql'||/^202610(?:29|30)/.test(f.file));
 if(chosen.length!==14||chosen.some(f=>known.get(f.file)!==hash(f.source)))throw Error('Immutable migration source drift');
 const forward=normalize(await fs.readFile(`${bundleDir}/${forwardFile}`,'utf8'));chosen.push({file:forwardFile,version:forwardFile.split('_')[0],source:forward});
 const expected=audit.staging.ledger;
 let sql=`-- NON-AUTO-APPLY Staging dormant packet; target uyqdopksfysbobhjcepk.
-- Review and explicit Hosted authorization required. No URL/credential/executor.
begin;
set local lock_timeout='5s';set local statement_timeout='60s';
-- Hold reviewed rows and ledger stable from preflight through commit. Readers
-- can continue. Other writers/DDL must wait; lock acquisition fails after 5s.
lock table supabase_migrations.schema_migrations,${protectedTables.map(n=>`public.${n}`).join(',')},auth.users,storage.objects,storage.buckets in share row exclusive mode;
do $preflight$ begin
 if current_setting('app.b7_install_target',true) is distinct from 'uyqdopksfysbobhjcepk' then raise exception 'Operator must explicitly bind the reviewed Staging target';end if;
 if (select count(*) from auth.users)<>1 or (select max(version) from supabase_migrations.schema_migrations)<>'20261031003000'
  or (select count(*) from supabase_migrations.schema_migrations)<>47 then raise exception 'Unexpected Staging baseline';end if;
 if to_regprocedure('public.apply_itinerary_alternative(uuid,uuid,timestamptz,timestamptz)') is not null
  or to_regclass('app_private.budget_metadata_protocol') is not null then raise exception 'Unreviewed prior installation';end if;
end $preflight$;
do $history$ declare r record; s text; n text; begin
 for r in select * from jsonb_to_recordset($ledger$${JSON.stringify(expected)}$ledger$::jsonb) x(version text,name text,source_sha256 text) loop
  select m.name,m.statements[1] into n,s from supabase_migrations.schema_migrations m where m.version=r.version;
  if not found or n is distinct from r.name then raise exception 'Ledger identity drift: %',r.version;end if;
  if r.source_sha256 is not null and encode(sha256(convert_to(replace(s,chr(13),''),'UTF8')),'hex') is distinct from r.source_sha256 then raise exception 'Recorded source drift: %',r.version;end if;
 end loop;
end $history$;
do $baseline$ declare r record; b text; begin
 for r in select * from jsonb_to_recordset($seal$${JSON.stringify(baselineSeal)}$seal$::jsonb) x(signature text,sha256 text) loop
  select replace(p.prosrc,chr(13),'') into b from pg_proc p where p.oid=to_regprocedure(r.signature);
  if b is null or encode(sha256(convert_to(b,'UTF8')),'hex')<>r.sha256 then raise exception 'Baseline hotfix/catalog drift: %',r.signature;end if;
 end loop;
end $baseline$;
create temporary table b7_original_data(name text,cols text[],digest text) on commit drop;
alter table b7_original_data enable row level security;
do $protect$ declare r record; d text; keys text[]; begin
 for r in select * from jsonb_to_recordset($protect_data$${JSON.stringify(protection)}$protect_data$::jsonb) x(name text,rows int,rowset_sha256 text) loop
  execute format('select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''UTF8'')),''hex'') from public.%I t',r.name) into d;
  if d<>r.rowset_sha256 then raise exception 'Protected Staging rowset drift: %',r.name;end if;
 end loop;
 for r in select 'public' schema_name,unnest(array[${protectedTables.map(n=>`'${n}'`).join(',')}]) table_name union all select 'auth','users' union all select 'storage','objects' union all select 'storage','buckets' loop
  select array_agg(column_name::text order by ordinal_position) into keys from information_schema.columns where table_schema=r.schema_name and table_name=r.table_name;
  execute format('select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''UTF8'')),''hex'') from %I.%I t',r.schema_name,r.table_name) into d;
  insert into b7_original_data values(r.schema_name||'.'||r.table_name,keys,d);
 end loop;
end $protect$;
`;
 for(const f of chosen){if(f.source.includes('$migration_source$'))throw Error('Ledger delimiter collision');sql+=`\n-- INSTALL ${f.file}\n${transactionBody(f.source)}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values('${f.version}','${f.file.slice(f.version.length+1,-4)}',array[$migration_source$${f.source}$migration_source$]);\n`;}
 sql+=`
set constraints all immediate;
do $preserve$ declare r record; d text; begin
 for r in select * from b7_original_data loop
  execute format('select encode(sha256(convert_to(coalesce(jsonb_agg(v order by v::text),''[]''::jsonb)::text,''UTF8'')),''hex'') from (select (select jsonb_object_agg(k,x) from jsonb_each(to_jsonb(t)) e(k,x) where k=any($1)) v from %I.%I t) q',split_part(r.name,'.',1),split_part(r.name,'.',2)) into d using r.cols;
  if d is distinct from r.digest then raise exception 'Original data changed: %',r.name;end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prosrc ~* $code$errcode[[:space:]]*=[[:space:]]*'40001'$code$) then raise exception 'Custom 40001 remains';end if;
 if (select count(*) from supabase_migrations.schema_migrations)<>62 then raise exception 'Unexpected final ledger';end if;
end $preserve$;
notify pgrst,'reload schema';
commit;
`;
 const supportingFiles=['compiled-seal.json','compiled-definitions.json','baseline-seal.json','error-classification.json'];
 const supportingHashes=Object.fromEntries(await Promise.all(supportingFiles.map(async file=>[file,hash(normalize(await fs.readFile(`${bundleDir}/${file}`,'utf8')))])));
 return {sql,manifest:{target:'uyqdopksfysbobhjcepk',baselineHead:'20261031003000',baselineLedgerRows:47,finalLedgerRows:62,packetSha256:hash(sql),packetBytes:Buffer.byteLength(sql),sources:chosen.map(f=>({file:f.file,sha256:hash(f.source)})),retainedHotfix:{file:all.at(-1).file,sha256:hash(all.at(-1).source),replayed:false},supportingHashes,protocols:'all disabled; never activates',historicalSourceFilesChanged:false}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await packet();await fs.writeFile(`${bundleDir}/dormant-schema.sql`,r.sql);await fs.writeFile(`${bundleDir}/packet-manifest.json`,JSON.stringify(r.manifest,null,2)+'\n');console.log(JSON.stringify(r.manifest));}
