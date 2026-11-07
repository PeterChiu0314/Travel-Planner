import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {calculatePricing,recordAllocations} from '../src/lib/budgetFinance.js';
import {pricingModeDraft} from '../src/lib/budgetPricingGroups.js';
import {reviewFixture} from './helpers/expenseReviewFixture.js';

const migration = new URL('../supabase/migrations/20261107140000_issue25_whole_planning_pricing.sql',import.meta.url);
const wholeOriginal = {wholeOriginal:true};
const form = {pricing_mode:'split_total',currency:'TWD',amount:'1000.41',participantIds:['C','B','A']};

test('whole original shares reconcile before a single TWD conversion',()=>{
 const split=calculatePricing(form,wholeOriginal);
 assert.equal(split.amount,1000);
 assert.deepEqual(split.shares,{A:334,B:333,C:333});
 assert.deepEqual(split.allocations,split.shares);
 const custom=pricingModeDraft(form,'custom',{A:700,B:300,C:0},wholeOriginal);
 assert.deepEqual(custom.shares,split.shares);
 const unit={...form,pricing_mode:'per_person',unit_amount:'333.47'};
 assert.equal(calculatePricing(unit,wholeOriginal).amount,999);
 assert.equal(calculatePricing({...unit,participantIds:['B','A']},wholeOriginal).amount,666);
 const cents={...custom,shares:{A:'699.50',B:'499.50',C:'0.49'}};
 assert.equal(calculatePricing(cents,wholeOriginal).amount,1200);
 assert.throws(()=>calculatePricing({...form,amount:'-0.1'},wholeOriginal));
 assert.throws(()=>calculatePricing({...form,amount:'0.999'},wholeOriginal));
 assert.equal(calculatePricing(form).amount,1000.41);
 for(const [currency,exchange_rate,twd] of [['USD',32.345678,97],['JPY',0.234567,1]]){
  const fx=calculatePricing({...form,amount:'2.50',currency,exchange_rate},wholeOriginal);
  assert.equal(fx.exchange_rate,exchange_rate);
  assert.equal(fx.twd_amount,twd);
  assert.deepEqual(fx.shares,{A:1,B:1,C:1});
  const people=Object.entries(fx.shares).map(([user_id,share_amount])=>({user_id,share_amount}));
  assert.deepEqual(recordAllocations({...fx,currency},people),fx.allocations);
 }
 const small=calculatePricing({...form,amount:1,currency:'USD',exchange_rate:32.345678},wholeOriginal);
 assert.deepEqual(small.allocations,{A:32,B:0,C:0});
});

test('SQL uses the trip stage, preserves stored history and replays pre-upgrade receipts',async()=>{
 const f=await reviewFixture(false,{wholePlanning:false});
 const C=uuid(),ids=[f.A,f.B,C].sort();
 const base={...form,participantIds:ids};
 const finance=async()=>{const s=await f.snapshot();return {items:s.items,participants:s.participants};};
 const write=async(value,revision,{group='budget',planning=false}={})=>{
  const sid=uuid(),token=uuid(),requestId=uuid();
  const key={p_id:f.id,p_group:group,p_session_id:sid,p_token:token,p_base:revision};
  const lease=await f.rpc('expense_group_lease',{...key,p_action:'acquire'});
  assert(lease.data?.granted,lease.error?.message);
  const rates=(await f.snapshot()).rates;
  const req={...key,p_epoch:lease.data.epoch,p_request_id:requestId,p_value:{form:value,members:ids,planning,rates}};
  const result=await f.rpc('mutate_expense_group',req);
  await f.rpc('expense_group_lease',{...key,p_epoch:req.p_epoch,p_action:'release'});
  return {result,req};
 };
 try{
  await f.sql.exec('reset role');
  await f.sql.query("insert into public.trip_members values($1,$2,'C','c@qa.invalid','approved','editor')",[f.trip,C]);
  const legacy=await write(base,0,{planning:true});
  assert.equal(legacy.result.data.item.budget.amount,1000.41);
  const before=await finance();
  await f.sql.exec('reset role');
  await f.sql.exec(await readFile(migration,'utf8'));
  assert.deepEqual(await finance(),before);
  assert.deepEqual((await f.rpc('mutate_expense_group',{...legacy.req,p_token:null,p_epoch:null})).data,legacy.result.data);
  const split=await write(base,1);
  assert.equal(split.result.data.item.budget.original_scale,0);
  assert.equal(split.result.data.item.budget.amount,1000);
  assert.deepEqual(split.result.data.participants.map(p=>p.budget_share_amount),[334,333,333]);
  const unit={...base,pricing_mode:'per_person',unit_amount:'333.47'};
  assert.equal((await write(unit,2)).result.data.item.budget.amount,999);
  assert.equal((await write({...unit,participantIds:ids.slice(0,2)},3)).result.data.item.budget.amount,666);
  const custom={...base,pricing_mode:'custom',shares:{[ids[0]]:'699.50',[ids[1]]:'499.50',[ids[2]]:'0.49'}};
  const saved=(await write(custom,4)).result.data;
  assert.equal(saved.item.budget.amount,1200);
  assert.deepEqual(saved.participants.map(p=>p.budget_share_amount),[700,500,0]);
  assert.equal((await write({...base,amount:'-0.1'},5)).result.error.code,'22023');
  assert.equal((await finance()).items[0].budget.amount,1200);
  const rates=(await f.snapshot()).rates.rates;
  for(const [offset,currency,twd] of [[0,'USD',96],[1,'JPY',1]]){
   const fx=(await write({...base,amount:'2.50',currency,exchange_rate:rates[currency]},5+offset)).result.data;
   assert.equal(fx.item.budget.amount,3);
   assert.equal(fx.item.budget.twd_amount,twd);
   assert.equal(fx.item.budget.exchange_rate,rates[currency]);
   assert.deepEqual(fx.participants.map(p=>p.budget_share_amount),[1,1,1]);
  }
  await f.sql.exec('reset role');
  await f.sql.query("update public.trips set start_date='2020-01-01',end_date='2020-01-02' where id=$1",[f.trip]);
  const historical=(await write(base,7,{planning:true})).result.data;
  assert.equal(historical.item.budget.amount,1000.41);
  assert.equal(historical.item.budget.original_scale,undefined);
  assert.deepEqual(historical.participants.map(p=>p.budget_share_amount),[333.47,333.47,333.47]);
 }finally{f.c.dispose();await f.close();}
});
