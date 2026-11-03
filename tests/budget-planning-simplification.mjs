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
 const source=await fs.readFile('supabase/migrations/20261103113253_remove_budget_custom_undo.sql','utf8');
 await test('Late Forward failure rolls back ACL body index and all financial rows',async()=>{
 const seal=async()=>({functions:await q("select oid::regprocedure::text signature,prosrc,proacl::text from pg_proc where pronamespace in('public'::regnamespace,'app_private'::regnamespace) order by signature"),rows:await q('select * from budget_items order by id')});
 const before=await seal();await assert.rejects(()=>q(source.replace(/commit;\s*$/, 'select 1/0;commit;')),e=>e.code==='22012');await q('rollback');assert.deepEqual(await seal(),before);assert.equal((await q("select to_regclass('public.actual_expenses_one_budget') v"))[0].v,null);
 });
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
 await test('All public Undo RPCs and private inverse entries deny ordinary roles',async()=>{
 const entries=await q("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.proname in('undo_budget_workspace','undo_budget_metadata_group','budget_workspace_undo_lease','workspace_undo_lease','prepare_workspace_inverse','workspace_inverse_manifest','finish_workspace_inverse','prepare_budget_metadata_undo','read_budget_metadata_undo','clear_budget_metadata_undo')");
 assert(entries.length>=12);
 for(const f of entries)for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,$2,'execute') v",[role,f.signature]))[0].v,false,f.signature);
 await assert.rejects(()=>aq('select public.undo_budget_workspace($1,$2,$3,$4,1,$5)',[trip,sid,uuid(),uuid(),uuid()]),e=>e.code==='42501');
 });
 await test('Protocol row cannot reactivate Undo and v10 compatibility remains readable',async()=>{
 assert.equal((await q('select app_private.workspace_undo_enabled() v'))[0].v,false);
 assert.equal((await q('select app_private.budget_metadata_undo_enabled() v'))[0].v,false);
 const s=await snapshot();assert.equal(s.undoRecords[0].value.enabled,false);assert.equal(s.undoRecords[0].value.count,0);
 });
 await test('Saved metadata and peer independent group writes still work without Undo capture',async()=>{
 const before=await q('select count(*)::int n from app_private.budget_metadata_undo_operations');
 await patch(a,'title',sid,'Saved permanently');await patch(b,'note',otherSid,'Peer note');
 assert.equal((await q('select title from budget_items where id=$1',[budget]))[0].title,'Saved permanently');
 assert.equal((await q('select note from budget_items where id=$1',[budget]))[0].note,'Peer note');
 assert.deepEqual(await q('select count(*)::int n from app_private.budget_metadata_undo_operations'),before);
 });
 await test('Same group lease excludes peer without weakening version safety',async()=>{
 const r=await group(a,'note',sid),held=await lease(a,'note',sid,r);assert(held.granted);
 const denied=await lease(b,'note',otherSid,r);assert.equal(denied.granted,false);
 });
 await test('Pricing participants and Lifecycle remain atomic without Undo',async()=>{
 const id=(await aq("select public.create_budget_workspace_placeholder($1,'budget',$2,$3) v",[trip,sid,uuid()]))[0].v.created_id;
 const r=(await snapshot()).metadataRecords.find(v=>v.id===id).groups.find(v=>v.group==='pricing'),token=uuid();
 const l=(await aq("select public.budget_metadata_group_lease_v2($1,'budget',$2,'pricing',$3,$4,'acquire',$5,null,0,false,$6::jsonb) v",[trip,id,sid,token,r.revision,JSON.stringify(r.value.versions)]))[0].v;assert(l.granted);
 const args=[trip,id,r.revision,sid,token,l.epoch,JSON.stringify({pricing:{...r.value,pricing_mode:'custom',amount:120,currency:'TWD',exchange_rate:1,participantIds:[A,B],shares:{[A]:70,[B]:50}}}),uuid(),JSON.stringify(r.value.versions)];
 const sql="select public.patch_budget_metadata_group_v2($1,'budget',$2,'pricing',$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)";
 await aq(sql,args);assert.equal((await q('select count(*)::int n from budget_item_participants where budget_item_id=$1',[id]))[0].n,2);
 assert.equal(Number((await q('select amount from budget_items where id=$1',[id]))[0].amount),120);
 const before=await q('select * from budget_item_participants where budget_item_id=$1 order by user_id',[id]);
 await assert.rejects(()=>aq(sql,[...args.slice(0,6),JSON.stringify({pricing:{...r.value,amount:999,participantIds:[]}}),uuid(),args[8]]));
 assert.deepEqual(await q('select * from budget_item_participants where budget_item_id=$1 order by user_id',[id]),before);
 });
}finally{await Promise.allSettled([a.end(),b.end(),db.end()]);await fs.writeFile(process.env.BUDGET_NATIVE_EVIDENCE+'/planning-results.json',JSON.stringify({scope:'isolated native SQL/RLS, not Hosted/HTTP',results},null,2));}
