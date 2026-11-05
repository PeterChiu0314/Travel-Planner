import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID as uuid} from 'node:crypto';
import {reviewFixture} from './helpers/expenseReviewFixture.js';
import {primaryBudgetCollaborators} from '../src/lib/budgetCollaboration.js';
import {withoutBudgetMetadata} from '../src/lib/budgetMetadataService.js';
import {expenseFinancialSnapshot,expenseTimelineCosts} from '../src/lib/expenseSnapshot.js';
import {createExpenseEditor} from '../src/lib/expenseEditor.js';
const select=(f,sid,activity,id=f.id,action='select',actor=f.A)=>f.rpc('update_expense_selection',{p_trip_id:f.trip,p_session_id:sid,p_kind:'expense',p_id:id,p_activity_id:activity,p_action:action},actor);
const read=(f,actor=f.B,sid=uuid())=>f.rpc('read_expense_collaboration',{p_trip_id:f.trip,p_session_id:sid},actor);
test('selection publishes a member hint and signal, never a financial mutation or edit authority',async()=>{
 const f=await reviewFixture();try{const before=await f.snapshot(),sid=uuid(),activity=uuid();assert(!(await select(f,sid,activity)).error);const entries=(await read(f)).data.entries;assert.equal(entries.length,1);assert.equal(entries[0].mode,'selection');assert.equal(entries[0].user_id,f.A);assert.equal(entries[0].own_session,false);
  const after=await f.snapshot();assert.deepEqual(after.items,before.items);assert.deepEqual(after.participants,before.participants);assert.deepEqual(after.groups.map(g=>g.revision),before.groups.map(g=>g.revision));
  const g=f.c.get(f.id,'title');assert.equal(f.c.view(g).editable,false);assert(await f.c.focus(g));const combined=(await read(f)).data.entries;assert.equal(primaryBudgetCollaborators(combined)[0].mode,'edit');
 }finally{f.c.dispose();await f.close();}
});
test('latest genuine selection wins across same-account tabs; refresh and late clear do not steal it',async()=>{
 const f=await reviewFixture();try{const second=uuid(),sid1=uuid(),sid2=uuid(),a1=uuid(),a2=uuid(),a3=uuid();await f.sql.exec('reset role');await f.sql.query("insert into expense_stage_b.expense_items(id,trip_id,title,payment_state) values($1,$2,'Second','unpaid')",[second,f.trip]);
  await select(f,sid1,a1);await select(f,sid2,a2,second);await select(f,sid1,a1,f.id,'refresh');let entries=(await read(f)).data.entries;assert.equal(primaryBudgetCollaborators(entries)[0].resource_id,second);
  await select(f,sid1,a3);await select(f,sid1,a1,f.id,'clear');entries=(await read(f)).data.entries;assert.equal(primaryBudgetCollaborators(entries)[0].resource_id,f.id);
  const own=(await read(f,f.A,sid1)).data.entries;assert(primaryBudgetCollaborators(own)[0].own_session);await select(f,sid1,a3,f.id,'clear');entries=(await read(f)).data.entries;assert.equal(primaryBudgetCollaborators(entries)[0].resource_id,second);
 }finally{f.c.dispose();await f.close();}
});
test('viewer can select but cannot lease; outsider/cross-trip/deleted rows and direct private writes are refused',async()=>{
 const f=await reviewFixture();try{const V=uuid();await f.sql.exec('reset role');await f.sql.query('insert into public.trip_members values($1,$2,$3,$4,$5,$6)',[f.trip,V,'Viewer','v@qa.invalid','approved','viewer']);assert(!(await select(f,uuid(),uuid(),f.id,'select',V)).error);
  const lease=await f.rpc('expense_group_lease',{p_id:f.id,p_group:'title',p_session_id:uuid(),p_token:uuid(),p_action:'acquire',p_base:0,p_epoch:null},V);assert.equal(lease.error.code,'42501');assert.equal((await read(f,uuid())).data,null);
  assert.equal((await select(f,uuid(),uuid(),f.id,'select',uuid())).error.code,'42501');assert.equal((await select(f,uuid(),uuid(),uuid())).error.code,'PT409');
  await f.sql.exec('reset role');await f.sql.query('update expense_stage_b.expense_items set deleted_at=clock_timestamp() where id=$1',[f.id]);assert.equal((await select(f,uuid(),uuid())).error.code,'PT409');assert.deepEqual((await read(f)).data.entries,[]);
  await f.sql.exec('set role authenticated');await assert.rejects(f.sql.exec('select * from expense_stage_b.selections'),e=>e.code==='42501');
 }finally{f.c.dispose();await f.close();}
});
test('expired hints disappear and cache cannot restore authority; suspension preserves drafts and releases own lease',async()=>{
 const f=await reviewFixture();try{const sid=uuid(),activity=uuid();await select(f,sid,activity);await f.sql.exec('reset role');await f.sql.exec("update expense_stage_b.selections set expires_at=clock_timestamp()-interval '1 second'");assert.deepEqual((await read(f)).data.entries,[]);
  const g=f.c.get(f.id,'title');assert(await f.c.focus(g));const cached=withoutBudgetMetadata(expenseFinancialSnapshot(f.c.status().graph));assert.equal(cached.expenseVerified,false);assert.deepEqual(cached.expenseGraph.groups,[]);f.c.ingest(cached.expenseGraph,{authoritative:false});assert.equal(f.c.status().verified,false);assert.equal(f.c.view(g).editable,false);
  await f.c.resume();assert(await f.c.focus(g));f.c.input(g,'Draft survives hiding');f.c.suspend();await f.c.release(g);await f.c.tick();assert.equal(f.c.status().dirty,true);assert.equal((await f.snapshot()).items[0].title,'Review');assert.equal((await f.snapshot()).groups.find(s=>s.id===f.id&&s.group==='title').held,false);
  await f.c.resume();assert.equal(f.c.view(g).value,'Draft survives hiding');assert(await f.c.focus(g));assert(await f.c.save(g));assert.equal((await f.snapshot()).items[0].title,'Draft survives hiding');
 }finally{f.c.dispose();await f.close();}
});
test('Timeline cost projection includes paid-only items and keeps cancellation distinct from budget',()=>{
 const base={id:'e',trip_id:'t',title:'Lunch',category:'餐飲',payment_state:'paid',budget:null,paid:{amount:800,twd_amount:800,currency:'TWD'}};
 const graph={items:[base],groups:[],participants:[],links:[]};assert.equal(expenseTimelineCosts(graph)[0].twd_amount,800);graph.items[0]={...base,payment_state:'unpaid'};assert.deepEqual(expenseTimelineCosts(graph),[]);graph.items[0]={...base,budget:{amount:1000,twd_amount:1000,currency:'TWD'}};assert.equal(expenseTimelineCosts(graph)[0].twd_amount,800);
});
test('restored draft opened against an offline cache waits for the exact authoritative base without a false conflict',async()=>{
 const f=await reviewFixture();let c;try{const graph=await f.snapshot(),values=new Map([[`travel-planner-expense:${f.A}:${f.trip}:${f.id}:title`,JSON.stringify({base:0,value:'Recovered draft',request:null})]]);c=createExpenseEditor({service:f.service,actor:f.A,trip:f.trip,sessionId:uuid(),storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}});
  const cached=withoutBudgetMetadata(expenseFinancialSnapshot(graph));c.ingest(cached.expenseGraph,{authoritative:false});const g=c.get(f.id,'title');assert.equal(c.status().verified,false);assert.equal(c.view(g).conflict,false);assert.equal(c.view(g).editable,false);assert.equal(c.view(g).value,'Recovered draft');await c.resume();assert.equal(c.view(g).conflict,false);assert.equal(c.view(g).value,'Recovered draft');assert(await c.focus(g));assert(await c.save(g));assert.equal((await f.snapshot()).items[0].title,'Recovered draft');
 }finally{c?.dispose();f.c.dispose();await f.close();}
});
