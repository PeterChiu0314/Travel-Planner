import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {migrationSources,normalize,hash} from '../scripts/qa/b7-forward-artifacts.mjs';
import {captureUndoRemovalContractQuery,undoRemovalStagingPacket,stagingTarget,forwardVersion} from '../scripts/qa/build-undo-removal-staging-packet.mjs';
export async function undoRemovalPacketCases({q,db,b,trip,budget,A,sid,historyTrip,historyActual,test}){
 const plan=JSON.parse(await fs.readFile('docs/operations/budget-b7-production/migration-plan.json','utf8'));
 for(const f of (await migrationSources()).filter(f=>f.file<='20261028104333_budget_selection_activity.sql'||f.file.startsWith('20261031003000')))
  await q('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[f.version==='20260819125851'?'20260819134935':f.version,f.file.slice(f.version.length+1,-4),[f.source]]);
 for(const f of plan.pendingSources){const source=normalize(await fs.readFile(f.path,'utf8'));assert.equal(hash(source),f.lfSha256);await q('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',[f.version,f.path.split('/').at(-1).replace(/^\d+_|\.sql$/g,''),[source]]);}
 assert.equal((await q('select count(*)::int n from supabase_migrations.schema_migrations'))[0].n,65);
 // Catalog objects only. This never claims to simulate/download Storage bytes.
 const p1=`trips/${historyTrip}/attachments/actual_expense/${historyActual}/control-a.pdf`,p2=`trips/${historyTrip}/attachments/actual_expense/${historyActual}/control-b.pdf`;
 await q("insert into storage.objects(id,bucket_id,name,owner,metadata) values($1,'trip-attachments',$3,$5,'{\"size\":42}'),($2,'trip-attachments',$4,$5,'{\"size\":43}')",[uuid(),uuid(),p1,p2,A]);
 await q("insert into public.attachments(trip_id,target_type,target_id,file_name,file_url,file_type,file_size,uploaded_by) values($1,'actual_expense',$2,'control-a.pdf',$3,'application/pdf',42,$4)",[historyTrip,historyActual,p1,A]);
 const capture=async()=>(await q(captureUndoRemovalContractQuery))[0].contract;
 const state=async()=>{const p=await capture();delete p.capturedAt;return p;};
 const rejected=async(sql,pattern)=>{const before=await state();await assert.rejects(()=>q(sql),e=>pattern.test(e.message));await q('rollback');assert.deepEqual(await state(),before);};
 await q("select set_config('app.undo_removal_target',$1,false)",[stagingTarget]);
 const dormantPacket=await undoRemovalStagingPacket(await capture());
 await test('Packet refuses transaction-local active editor and rolls back the fixture',async()=>{
 const injected=`update public.budget_items set locked_by='${A}',locked_at=clock_timestamp() where id='${budget}';\n`;
 await rejected(dormantPacket.sql.replace('do $undo_preflight$',injected+'do $undo_preflight$'),/Active editor/);
 });
 await test('Packet refuses duplicate Actuals without merging or deleting financial rows',async()=>{
 const injected=[uuid(),uuid()].map(id=>`insert into public.actual_expenses(id,trip_id,budget_item_id,title,category,amount,twd_amount,currency,exchange_rate,paid_at) values('${id}','${trip}','${budget}','Duplicate fixture','交通',1,1,'TWD',1,clock_timestamp());`).join('\n');
 await rejected(dormantPacket.sql.replace('do $undo_preflight$',injected+'\ndo $undo_preflight$'),/Duplicate current Actual/);
 });
 // Reproduce the existing Stage Pause shape, not new readiness evidence.
 await q('update app_private.budget_finance_protocol set activated=true;update app_private.budget_lifecycle_protocol set activated=true;update app_private.budget_receipt_protocol set activated=true,storage_verified=true,cleanup_worker_verified=true,content_worker_verified=true');
 const profile=await capture(),packet=await undoRemovalStagingPacket(profile);
 await test('Packet is one Forward with no reset protocol update source replay or byte operation',async()=>{
 assert.equal(packet.manifest.version,forwardVersion);assert.equal(packet.manifest.fixtureOnly,true);assert(!/delete\s+from|truncate\s|update\s+app_private\.\w+_protocol/i.test(packet.sql));
 assert.equal((packet.sql.match(/insert into supabase_migrations\.schema_migrations/g)||[]).length,1);
 });
 await test('Packet refuses incorrect target before any changes',async()=>{await q("set app.undo_removal_target='wrong'");await rejected(packet.sql,/target binding/);await q("select set_config('app.undo_removal_target',$1,false)",[stagingTarget]);});
 await test('Packet refuses stale contract',async()=>{const old={...profile,capturedAt:new Date(Date.parse(profile.capturedAt)-3600000).toISOString()};await rejected((await undoRemovalStagingPacket(old)).sql,/Fresh contract/);});
 await test('Builder rejects unknown drift in a helper it would replace',async()=>{const drift=structuredClone(profile);drift.changedBodyBefore.workspace_undo_enabled='0'.repeat(64);await assert.rejects(()=>undoRemovalStagingPacket(drift),/Installed helper body drift/);});
 for(const [key,label] of [['ledgerDigest','ledger'],['dataDigest','data'],['schemaDigest','schema'],['allFunctionBodies','complete body'],['functionBodies','body'],['functionAttributes','attributes'],['unaffectedAcls','ACL'],['roleDigest','role']])
  await test(`Packet rejects ${label} drift without partial changes`,async()=>{await rejected((await undoRemovalStagingPacket({...profile,[key]:'0'.repeat(64)})).sql,/drift/);});
 await test('Packet refuses actual peer writer lock without terminating it',async()=>{
 await b.connect();await b.query('begin');await b.query('lock table public.budget_items in row exclusive mode');
 try{await assert.rejects(()=>q(packet.sql),e=>e.code==='55P03');await q('rollback');}finally{await b.query('rollback');}
 assert.deepEqual(await state(),Object.fromEntries(Object.entries(profile).filter(([k])=>k!=='capturedAt')));
 });
 await test('Packet refuses in-flight Undo intent without clearing it',async()=>{
 // Existing deferred integrity guards correctly forbid committing an
 // unfinished intent. Inject it inside the disposable packet transaction,
 // not as a forged durable production state; refusal rolls back the fixture.
 const injected=`insert into app_private.budget_metadata_undo_intents(transaction_id,backend_id,user_id,trip_id,session_id,operation_id,request_id) values(txid_current(),pg_backend_pid(),'${A}','${trip}','${sid}','${uuid()}','${uuid()}');\n`;
 await rejected(packet.sql.replace('do $undo_preflight$',injected+'do $undo_preflight$'),/In-flight/);
 });
 await test('Packet late fault rolls back schema grants ledger and preserved receipt/history rows',async()=>{await rejected(packet.sql.replace("notify pgrst,'reload schema';",'select 1/0;'),/division by zero/);});
 await test('Packet commits65 to66 while preserving nonempty receipts financial history and all latches',async()=>{
 await q(packet.sql);const after=await capture();assert.equal(after.ledgerCount,66);assert.equal(after.ledgerHead,forwardVersion);
 for(const k of ['dataDigest','functionBodies','functionAttributes','unaffectedAcls','schemaDigest','roleDigest'])assert.equal(after[k],profile[k],k);
 assert.deepEqual(after.protocolRows,profile.protocolRows);
 assert.equal((await q('select count(*)::int n from storage.objects'))[0].n,2);
 assert.equal((await q('select count(*)::int n from public.attachments'))[0].n,1);
 const row=(await q('select statements from supabase_migrations.schema_migrations where version=$1',[forwardVersion]))[0];assert.equal(hash(row.statements[0]),packet.manifest.sourceSha256);
 });
 await test('Packet replay refuses without modifying installed state',async()=>{await rejected(packet.sql,/already installed/);});
 await fs.writeFile(process.env.BUDGET_NATIVE_EVIDENCE+'/undo-packet-manifest.json',JSON.stringify(packet.manifest,null,2));
}
