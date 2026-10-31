// Reconstructs source-defined dependencies ONLY; never a Staging data backup.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {nativeBootstrap} from './helpers/b7-native-bootstrap.mjs';
import {migrationSources,bundleDir,forwardFile} from '../scripts/qa/b7-forward-artifacts.mjs';
import {catalogSql} from '../scripts/qa/b7-catalog-readonly.mjs';
const marker=process.env.BUDGET_NATIVE_MARKER,port=Number(process.env.BUDGET_NATIVE_PORT);
assert(/^[a-f0-9-]{36}$/.test(marker||'')&&port>1024);
const pg=await import(pathToFileURL(process.env.BUDGET_NATIVE_PG_MODULE).href),{Client}=pg.default||pg;
const db=new Client({host:'127.0.0.1',port,user:'budget_local_admin',database:'postgres',connectionTimeoutMillis:5000});
try{await db.connect();assert.equal((await db.query("select current_setting('budget_metadata.test_cluster') v")).rows[0].v,marker);await db.query(nativeBootstrap);
 const files=(await migrationSources()).filter(f=>!f.file.startsWith('20260811150000')&&(f.file<='20261028104333_budget_selection_activity.sql'||f.file.startsWith('20261031003000')));
 assert.equal(files.length,47);for(const f of files)await db.query(f.source);
 const rows=(await db.query(catalogSql)).rows;
 await fs.writeFile(path.join(process.env.BUDGET_NATIVE_EVIDENCE,'catalog-reference.json'),JSON.stringify({marker,scope:'source-defined native reference only, no real user data',files:files.map(f=>f.file),sections:rows},null,2)+'\n');
 console.log(JSON.stringify(rows.map(({objects,...r})=>r)));
 if(process.env.BUDGET_STAGING_DEFAULTS==='1'){
  const before=(await db.query("select oid from pg_proc where pronamespace='public'::regnamespace")).rows.map(r=>r.oid);
  // Actual observed managed postgres defaults, applied ONLY to this empty native
  // reference cluster. This is neither a backup nor a managed DDL-role rehearsal.
  await db.query('alter default privileges in schema public grant all on tables to anon,authenticated,service_role;alter default privileges in schema public grant all on functions to anon,authenticated,service_role;alter default privileges in schema public grant all on sequences to anon,authenticated,service_role');
  for(const f of (await migrationSources()).filter(f=>f.file.startsWith('20260811150000')||/^202610(?:29|30)/.test(f.file)))await db.query(f.source);
  await db.query(await fs.readFile(`${bundleDir}/${forwardFile}`,'utf8'));
  const unexpected=(await db.query("select oid::regprocedure::text signature from pg_proc where pronamespace='public'::regnamespace and oid<>all($1::oid[]) and has_function_privilege('anon',oid,'EXECUTE') order by 1",[before])).rows;
  const privateGrants=(await db.query("select table_name,privilege_type,grantee from information_schema.role_table_grants where table_schema='app_private' and grantee in('anon','authenticated','budget_receipt_worker','PUBLIC')")).rows;
  const missingRls=(await db.query("select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private') and c.relkind='r' and not c.relrowsecurity")).rows;
  const flags=(await db.query("select 'metadata' k,enabled v from app_private.budget_metadata_protocol union all select 'finance',enabled or activated from app_private.budget_finance_protocol union all select 'payment',enabled from app_private.budget_payment_protocol union all select 'source',enabled from app_private.budget_source_protocol union all select 'receipt',enabled or activated from app_private.budget_receipt_protocol union all select 'lifecycle',enabled or activated from app_private.budget_lifecycle_protocol union all select 'undo',enabled or full_enabled from app_private.budget_metadata_undo_protocol")).rows;
  const result={scope:'Offline observed-default-ACL rehearsal only; no managed ownership or real data restore',unexpectedAnonNewPublicRpcs:unexpected,privateRawClientWorkerGrants:privateGrants,tablesWithoutRls:missingRls,flags};
  await fs.writeFile(path.join(process.env.BUDGET_NATIVE_EVIDENCE,'managed-defaults.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  assert.deepEqual(unexpected,[]);assert.deepEqual(privateGrants,[]);assert.deepEqual(missingRls,[]);assert.equal(flags.length,7);assert(flags.every(r=>r.v===false));
 }
}finally{await db.end();}
