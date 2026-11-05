import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {reviewFixture as fixture} from './helpers/expenseReviewFixture.js';
import {createExpenseEditor,expenseFieldValue} from '../src/lib/expenseEditor.js';
import {expenseSettlement} from '../src/lib/expenseItems.js';
import {expenseModels} from '../src/lib/expenseSnapshot.js';
import {expenseReleaseSettled} from '../src/lib/expenseLeaseReceipt.js';

test('new-member suggestion is local through open focus blur finish and refresh; deliberate pricing commits once',async()=>{
 const f=await fixture();try{const C=uuid();await f.sql.exec('reset role');await f.sql.query('insert into public.trip_members values($1,$2,$3,$4,$5,$6)',[f.trip,C,'C','c@qa.invalid','approved','editor']);await f.c.refresh();const g=f.c.get(f.id,'budget'),before=await f.snapshot();
  assert.deepEqual(new Set(f.c.view(g).value.participantIds),new Set([f.A,C]));assert(!f.c.view(g).value.participantIds.includes(f.B));assert.equal(f.c.status().dirty,false);
  assert(await f.c.focus(g));f.c.blur(g);assert(await f.c.finish());await f.c.refresh();assert.equal(f.c.status().dirty,false);
  const after=await f.snapshot();assert.deepEqual(after.items,before.items);assert.deepEqual(after.participants,before.participants);assert.deepEqual(after.groups.map(g=>g.revision),before.groups.map(g=>g.revision));assert.equal(f.db.expenseCalls.filter(r=>r.name==='mutate_expense_group').length,0);
  assert(await f.c.focus(g));f.c.input(g,{...f.c.view(g).value,amount:12000});assert(await f.c.save(g));const saved=await f.snapshot();assert.equal(saved.items[0].budget.amount,12000);assert.equal(saved.participants.find(p=>p.user_id===C).budget_selected,true);assert.equal(saved.participants.find(p=>p.user_id===f.B).budget_selected,false);
  f.c.input(g,{...f.c.view(g).value,participantIds:[f.A]});assert(await f.c.save(g));await f.c.release(g);await f.c.refresh();assert.deepEqual(f.c.view(g).value.participantIds,[f.A]);assert(await f.c.focus(g));assert.deepEqual(f.c.view(g).value.participantIds,[f.A]);
 }finally{f.c.dispose();await f.close();}
});
test('legacy paid with no participants keeps settlement and does not invent a selection on amount edits',async()=>{
 const f=await fixture(true);try{const before=await f.snapshot(),balances=expenseSettlement(expenseModels(before),before.members);const paid=f.c.get(f.id,'paid');assert.deepEqual(expenseFieldValue(before,f.id,'paid').participantIds,[]);
  assert(await f.c.focus(paid));f.c.blur(paid);assert(await f.c.finish());const note=f.c.get(f.id,'note');assert(await f.c.focus(note));f.c.input(note,'Safe nonfinancial edit');assert(await f.c.save(note));assert(await f.c.release(note));await f.c.refresh();
  const unchanged=await f.snapshot();assert.deepEqual(unchanged.items[0].paid,before.items[0].paid);assert.deepEqual(unchanged.participants,[]);assert.deepEqual(expenseSettlement(expenseModels(unchanged),unchanged.members),balances);
  assert(await f.c.focus(paid));f.c.input(paid,{...f.c.view(paid).value,amount:150});assert.equal(await f.c.save(paid),false);assert.equal((await f.snapshot()).items[0].paid.amount,100);assert.equal(f.c.status().dirty,true);assert.deepEqual(f.c.view(paid).value.participantIds,[]);await f.c.discard();
 }finally{f.c.dispose();await f.close();}
});
test('release proves capability inactivity without claiming a peer is released; stale own epoch is refused',async()=>{
 const f=await fixture();try{const g=f.c.get(f.id,'title');assert(await f.c.focus(g));const request={p_id:f.id,p_group:'title',p_session_id:f.sid,p_token:g.token,p_action:'release',p_base:0,p_epoch:g.epoch};
  const stale=await f.service.lease({...request,p_epoch:g.epoch-1});assert.equal(stale.data.outcome,'epoch_mismatch');assert.equal(stale.data.capability_active,true);assert.equal(expenseReleaseSettled(stale.data,{...request,p_epoch:g.epoch-1}),false);
  const otherSession={...request,p_session_id:uuid(),p_token:uuid()};const unrelated=await f.service.lease(otherSession);assert.equal(unrelated.data.outcome,'superseded');assert(expenseReleaseSettled(unrelated.data,otherSession));assert((await f.service.read(f.trip,f.sid)).data.groups.find(s=>s.id===f.id&&s.group==='title').held);
  const released=await f.service.lease(request);assert.equal(released.data.outcome,'released');assert(expenseReleaseSettled(released.data,request));assert.equal((await f.service.lease(request)).data.outcome,'inactive');assert.equal(expenseReleaseSettled({granted:true},request),false);
 }finally{f.c.dispose();await f.close();}
});
test('lost release ACK retains capability until exact duplicate confirms inactive; epoch recovery cannot unlock a peer',async()=>{
 const f=await fixture();try{const original=f.service.lease;let lose=true;f.service.lease=async r=>{const result=await original(r);if(r.p_action==='release'&&lose){lose=false;return{error:new Error('ACK lost')};}return result;};const g=f.c.get(f.id,'title');assert(await f.c.focus(g));const token=g.token;assert.equal(await f.c.release(g),false);assert.equal(g.token,token);assert(await f.c.release(g));assert.equal(g.token,null);
  assert(await f.c.focus(g));g.epoch--;assert(await f.c.release(g));assert.equal(g.token,null);
 }finally{f.c.dispose();await f.close();}
});
test('late acquire ACK cleans exactly its capability with the new receipt after the foreground timeout',async()=>{
 const f=await fixture();let deliver;try{const original=f.service.lease;f.service.lease=async r=>{const reply=await original(r);if(r.p_action==='acquire')await new Promise(resolve=>{deliver=resolve;});return reply;};
  const c=createExpenseEditor({service:f.service,actor:f.A,trip:f.trip,sessionId:f.sid,timeoutMs:20});try{await c.refresh();const g=c.get(f.id,'note');assert.equal(await c.focus(g),false);assert(g.token);deliver();
   for(let n=0;n<30&&g.token;n++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(g.token,null);assert.equal((await f.snapshot()).groups.find(r=>r.id===f.id&&r.group==='note').held,false);
  }finally{c.dispose();}
 }finally{deliver?.();f.c.dispose();await f.close();}
});
