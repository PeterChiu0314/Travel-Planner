// Isolated PostgreSQL only. No hosted target or credential accepted.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
import {nativeBootstrap} from './helpers/b7-native-bootstrap.mjs';
import {migrationSources,hash} from '../scripts/qa/b7-forward-artifacts.mjs';
const pg=await import(pathToFileURL(process.env.BUDGET_NATIVE_PG_MODULE).href),{Client}=pg.default||pg;
const cfg={host:'127.0.0.1',port:Number(process.env.BUDGET_NATIVE_PORT),database:'postgres',connectionTimeoutMillis:5000};
assert(cfg.port>1024);const db=new Client({...cfg,user:'budget_local_admin'}),a=new Client({...cfg,user:'budget_actor_a'}),b=new Client({...cfg,user:'budget_actor_b'});
const q=async(sql,args)=>(await db.query(sql,args)).rows,aq=async(sql,args)=>(await a.query(sql,args)).rows;
const A=uuid(),B=uuid(),trip=uuid(),budget=uuid(),sid=uuid(),otherSid=uuid(),results=[];
const test=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
try{
 await db.connect();assert.equal((await q("select current_setting('budget_metadata.test_cluster') m"))[0].m,process.env.BUDGET_NATIVE_MARKER);
 await q(nativeBootstrap);await q('grant authenticator to supabase_storage_admin with inherit false,set true;grant select,insert,update,delete on storage.objects to authenticated,anon');
 for(const f of (await migrationSources()).filter(f=>f.file<='20261028104333_budget_selection_activity.sql'||f.file.startsWith('20261031003000')))await q(f.source);
 const plan=JSON.parse(await fs.readFile('docs/operations/budget-b7-production/migration-plan.json','utf8'));
 for(const f of plan.pendingSources){const source=(await fs.readFile(f.path,'utf8')).replaceAll('\r','');assert.equal(hash(source),f.lfSha256);await q(source);}
 await q('insert into auth.users values($1,$3,$4),($2,$5,$4)',[A,B,'planning-a@example.invalid',{},'planning-b@example.invalid']);
 await q("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Planning','Planning','QA','2099-01-01','2099-01-03',$2)",[trip,A]);
 await q("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved'),($1,$3,'editor','approved')",[trip,A,B]);
 await q("insert into budget_items(id,trip_id,title,category,amount,twd_amount,currency,exchange_rate,payer_id) values($1,$2,'Budget','交通',100,100,'TWD',1,$3)",[budget,trip,A]);
 await q('insert into budget_item_participants(budget_item_id,user_id,share_amount) values($1,$2,100)',[budget,A]);
 const source=await fs.readFile('supabase/migrations/20261103084209_budget_planning_simplification.sql','utf8');
 await test('Forward applies without changing any protocol or latch',async()=>{const before=await q('select * from app_private.budget_receipt_protocol');await q(source);assert.deepEqual(await q('select * from app_private.budget_receipt_protocol'),before);});
 for(const [c,id]of [[a,A],[b,B]]){await c.connect();await c.query('set role authenticated');await c.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
 await test('Receipt metadata blocked even before financial activation',async()=>{await assert.rejects(()=>aq("insert into attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'actual_expense',$2,'x','x')",[trip,uuid()]),e=>e.code==='55000');});
 await test('Other workspace attachments retain normal CRUD',async()=>{const row=(await aq("insert into attachments(trip_id,target_type,target_id,file_name,file_url) values($1,'accommodation',$2,'x','x') returning id",[trip,uuid()]))[0];assert.equal((await a.query('delete from attachments where id=$1',[row.id])).rowCount,1);});
 await test('Financial Storage path insert rejected by restrictive RLS',async()=>{await assert.rejects(()=>aq("insert into storage.objects(id,bucket_id,name,owner) values($1,'trip-attachments',$2,$3)",[uuid(),`trips/${trip}/attachments/actual_expense/${uuid()}/x`,A]),e=>e.code==='42501');});
 await test('Ordinary user and Worker cannot call Receipt mutation/claim',async()=>{for(const [role,f]of [['authenticated','public.mutate_budget_receipts(uuid,text,uuid,uuid,uuid,bigint,bigint,jsonb,uuid,text)'],['budget_receipt_worker','public.claim_budget_receipt_verification()']])assert.equal((await q('select has_function_privilege($1,$2,\'execute\') v',[role,f]))[0].v,false);});
 await test('One linked Actual enforced; unrelated Actuals remain legal',async()=>{const insert=id=>aq("insert into actual_expenses(id,trip_id,budget_item_id,title,category,amount,twd_amount,currency,exchange_rate,paid_at) values($1,$2,$3,'Actual','交通',100,100,'TWD',1,clock_timestamp())",[uuid(),trip,id]);await insert(budget);await assert.rejects(()=>insert(budget),e=>e.code==='23505');await insert(null);await insert(null);});
 await q('update app_private.budget_metadata_protocol set enabled=true;update app_private.budget_finance_protocol set enabled=true;update app_private.budget_payment_protocol set enabled=true;update app_private.budget_source_protocol set enabled=true;update app_private.budget_lifecycle_protocol set enabled=true;update app_private.budget_metadata_undo_protocol set enabled=true,full_enabled=true');
 const snapshot=async(c=a,s=sid)=>(await c.query('select public.read_budget_metadata_snapshot_v10($1,$2) v',[trip,s])).rows[0].v;
 const group=async(c,g,s)=>(await snapshot(c,s)).metadataRecords.find(r=>r.id===budget).groups.find(v=>v.group===g);
 const lease=async(c,g,s,r)=>(await c.query("select public.budget_metadata_group_lease_v2($1,'budget',$2,$3,$4,$5,'acquire',$6,null,0,false,$7::jsonb) v",[trip,budget,g,s,uuid(),r.revision,JSON.stringify(r.versions)])).rows[0].v;
 const patch=async(c,g,s,value)=>{const r=await group(c,g,s),token=uuid();const l=(await c.query("select public.budget_metadata_group_lease_v2($1,'budget',$2,$3,$4,$5,'acquire',$6,null,0,false,$7::jsonb) v",[trip,budget,g,s,token,r.revision,JSON.stringify(r.versions)])).rows[0].v;assert(l.granted);await c.query("select public.patch_budget_metadata_group_v2($1,'budget',$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)",[trip,budget,g,r.revision,s,token,l.epoch,JSON.stringify({[g]:value}),uuid(),JSON.stringify(r.versions)]);await c.query("select public.budget_metadata_group_lease_v2($1,'budget',$2,$3,$4,$5,'release',$6,$7,0,false,$8::jsonb)",[trip,budget,g,s,token,r.revision,l.epoch,JSON.stringify(r.versions)]);};
 const undo=async()=>{const op=(await snapshot()).undoRecords[0].value.top.operation_id,token=uuid();const l=(await aq("select public.budget_workspace_undo_lease($1,$2,$3,$4,'acquire',null) v",[trip,sid,op,token]))[0].v;assert(l.granted);try{await aq('select public.undo_budget_workspace($1,$2,$3,$4,$5,$6)',[trip,sid,op,token,l.epoch,uuid()]);}finally{await aq("select public.budget_workspace_undo_lease($1,$2,$3,$4,'release',$5)",[trip,sid,op,token,l.epoch]);}};
 await test('Only latest save can undo once; no predecessor or Redo',async()=>{await patch(a,'title',sid,'One');await patch(a,'title',sid,'Two');assert.equal((await snapshot()).undoRecords[0].value.count,1);await undo();assert.equal((await q('select title from budget_items where id=$1',[budget]))[0].title,'One');assert.equal((await snapshot()).undoRecords[0].value.count,0);});
 await test('Other group peer save does not block undo',async()=>{await patch(a,'title',sid,'Three');await patch(b,'note',otherSid,'Peer');await undo();assert.equal((await q('select note from budget_items where id=$1',[budget]))[0].note,'Peer');});
 await test('Same-group peer save refuses stale undo with PT409 without overwrite',async()=>{await patch(a,'title',sid,'Four');await patch(b,'title',otherSid,'Peer wins');await assert.rejects(undo,e=>e.code==='PT409');assert.equal((await q('select title from budget_items where id=$1',[budget]))[0].title,'Peer wins');});
 await test('Other tab sees no capability from this session',async()=>{assert.equal((await snapshot(a,uuid())).undoRecords[0].value.count,0);});
 await test('Pricing and participants restore atomically as one operation',async()=>{
  // The existing linked manual Actual intentionally makes Pricing unsupported.
  // Create a new legal placeholder through Lifecycle for this independent case.
  const id=(await aq("select public.create_budget_workspace_placeholder($1,'budget',$2,$3) v",[trip,sid,uuid()]))[0].v.created_id;
  const read=async()=>(await snapshot()).metadataRecords.find(r=>r.id===id).groups.find(v=>v.group==='pricing');
  const r=await read(),token=uuid();const l=(await aq("select public.budget_metadata_group_lease_v2($1,'budget',$2,'pricing',$3,$4,'acquire',$5,null,0,false,$6::jsonb) v",[trip,id,sid,token,r.revision,JSON.stringify(r.value.versions)]))[0].v;assert(l.granted);
  const value={...r.value,pricing_mode:'custom',amount:120,currency:'TWD',exchange_rate:1,participantIds:[A,B],shares:{[A]:70,[B]:50}};
  await aq("select public.patch_budget_metadata_group_v2($1,'budget',$2,'pricing',$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)",[trip,id,r.revision,sid,token,l.epoch,JSON.stringify({pricing:value}),uuid(),JSON.stringify(r.value.versions)]);
  await aq("select public.budget_metadata_group_lease_v2($1,'budget',$2,'pricing',$3,$4,'release',$5,$6,0,false,$7::jsonb)",[trip,id,sid,token,r.revision,l.epoch,JSON.stringify(r.value.versions)]);
  assert.equal((await q('select count(*)::int n from budget_item_participants where budget_item_id=$1',[id]))[0].n,2);
  // Restoring an uninitialized pricing group is already rejected by the
  // calculator (no participants). Retain that integrity boundary; verify no
  // partial inverse, then test restoration of a valid saved allocation.
  await assert.rejects(undo,e=>e.code==='22023');
  const before=(await q('select amount,twd_amount from budget_items where id=$1',[id]))[0],people=await q('select user_id,share_amount from budget_item_participants where budget_item_id=$1 order by user_id',[id]);
  const next=await read(),t=uuid(),held=(await aq("select public.budget_metadata_group_lease_v2($1,'budget',$2,'pricing',$3,$4,'acquire',$5,null,0,false,$6::jsonb) v",[trip,id,sid,t,next.revision,JSON.stringify(next.value.versions)]))[0].v;assert(held.granted);
  await aq("select public.patch_budget_metadata_group_v2($1,'budget',$2,'pricing',$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)",[trip,id,next.revision,sid,t,held.epoch,JSON.stringify({pricing:{...next.value,amount:240,shares:{[A]:140,[B]:100}}}),uuid(),JSON.stringify(next.value.versions)]);
  await aq("select public.budget_metadata_group_lease_v2($1,'budget',$2,'pricing',$3,$4,'release',$5,$6,0,false,$7::jsonb)",[trip,id,sid,t,next.revision,held.epoch,JSON.stringify(next.value.versions)]);
  await undo();assert.deepEqual((await q('select amount,twd_amount from budget_items where id=$1',[id]))[0],before);assert.deepEqual(await q('select user_id,share_amount from budget_item_participants where budget_item_id=$1 order by user_id',[id]),people);
 });
 await test('Actual 30-second expiry rejects inverse',async()=>{await patch(a,'title',sid,'Expiry');await new Promise(r=>setTimeout(r,30100));await assert.rejects(undo,e=>e.code==='PT409');assert.equal((await q('select title from budget_items where id=$1',[budget]))[0].title,'Expiry');});
}finally{await Promise.allSettled([a.end(),b.end(),db.end()]);await fs.writeFile(process.env.BUDGET_NATIVE_EVIDENCE+'/planning-results.json',JSON.stringify({scope:'isolated native SQL/RLS, not Hosted/HTTP',results},null,2));}
