import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID as uuid} from 'node:crypto';import {reviewFixture} from './helpers/expenseReviewFixture.js';
async function fixture(){return reviewFixture();}
const request=(f,actor,sid,token,action,epoch=null,dirty=false,seq=0)=>f.rpc('expense_group_lease',{p_id:f.id,p_group:'note',p_session_id:sid,p_token:token,p_action:action,p_base:0,p_epoch:epoch,p_dirty:dirty,p_seq:seq},actor);
test('a late renewal cannot restore released authority after another account takes over',async()=>{
 const f=await fixture(),g=f.c.get(f.id,'note');let resume;try{assert(await f.c.focus(g));g.lastRenew=Date.now()-5001;const original=f.service.lease;let started;const ready=new Promise(r=>started=r),gate=new Promise(r=>resume=r);f.service.lease=async args=>{const r=await original(args);if(args.p_action==='renew'){started();await gate;}return r;};const tick=f.c.tick();await ready;assert(await f.c.release(g));const b=await request(f,f.B,uuid(),uuid(),'acquire');assert(b.data.granted);resume();await tick;assert.equal(f.c.view(g).editable,false);assert.equal((await f.snapshot()).groups.find(s=>s.id===f.id&&s.group==='note').owner,f.B);
 }finally{resume?.();f.c.dispose();await f.close();}
});
test('clean20s dirty60s, same-sequence renewal extends; expired renewal cannot evict a new account',async()=>{
 const f=await fixture(),sid=uuid(),token=uuid();try{
  const a=await request(f,f.A,sid,token,'acquire');assert(a.data.granted);assert(Date.parse(a.data.expires_at)-Date.now()>18000&&Date.parse(a.data.expires_at)-Date.now()<=20000);
  await f.sql.exec('reset role');await f.sql.query("update expense_stage_b.groups set expires_at=clock_timestamp()+interval '1 second' where expense_id=$1 and group_key='note'",[f.id]);const renew=await request(f,f.A,sid,token,'renew',a.data.epoch);assert(renew.data.granted);assert(Date.parse(renew.data.expires_at)-Date.now()>18000);
  const dirty=await request(f,f.A,sid,token,'renew',a.data.epoch,true,1);assert(Date.parse(dirty.data.expires_at)-Date.now()>58000);assert.equal((await request(f,f.B,uuid(),uuid(),'acquire')).data.granted,false);
  assert.equal((await request(f,f.A,sid,token,'renew',a.data.epoch,false,0)).data.granted,false);
  await f.sql.exec('reset role');await f.sql.query("update expense_stage_b.groups set expires_at=clock_timestamp()-interval '1 second' where expense_id=$1 and group_key='note'",[f.id]);assert.equal((await request(f,f.A,sid,token,'renew',a.data.epoch,true,2)).data.granted,false);
  const sidB=uuid(),tokenB=uuid(),b=await request(f,f.B,sidB,tokenB,'acquire');assert(b.data.epoch>a.data.epoch);assert.equal((await request(f,f.A,sid,token,'renew',a.data.epoch)).data.granted,false);await request(f,f.A,sid,token,'release',a.data.epoch);assert((await request(f,f.B,sidB,tokenB,'renew',b.data.epoch)).data.granted);
 }finally{f.c.dispose();await f.close();}
});
test('client renews after five seconds before snapshot read; blur saves and releases; background keeps draft',async()=>{
 const f=await fixture(),g=f.c.get(f.id,'note');try{assert(await f.c.focus(g));g.lastRenew=Date.now()-5001;const before=f.db.expenseCalls.length;await f.c.tick();const calls=f.db.expenseCalls.slice(before);assert.equal(calls[0].args.p_action,'renew');assert(f.c.view(g).editable);
  f.c.input(g,'Saved on blur');f.c.blur(g);await f.c.finish();assert.equal((await f.snapshot()).items[0].note,'Saved on blur');assert.equal((await f.snapshot()).groups.find(s=>s.id===f.id&&s.group==='note').held,false);
  assert(await f.c.focus(g));f.c.input(g,'Background draft');f.c.suspend();await f.c.release(g);assert(f.c.status().dirty);assert.equal((await f.snapshot()).items[0].note,'Saved on blur');
 }finally{f.c.dispose();await f.close();}
});
