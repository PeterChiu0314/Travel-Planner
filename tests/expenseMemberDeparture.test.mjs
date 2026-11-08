import test from 'node:test';
import assert from 'node:assert/strict';
import { departureFixture } from './helpers/expenseDepartureFixture.js';
import { expenseModels, expenseFinancialSnapshot, expenseHistoricalMembers } from '../src/lib/expenseSnapshot.js';
import { settlementBalances } from '../src/lib/budgetFinance.js';

const model = (snapshot,id) => expenseModels(snapshot).find(item=>item.id===id);
const budget = (snapshot,id) => model(snapshot,id).budget;
const people = (snapshot,id) => snapshot.participants.filter(person=>person.expense_id===id);

test('removal reprices only selected unpaid participants, preserves paid history and repairs settlement',async()=>{
  const f=await departureFixture();
  try {
    const { A,B,C,D }=f;
    const split=await f.seed('Split',{}, { payer:[{user_id:C,amount:400,order:0},{user_id:B,amount:500,order:0}] });
    const custom=await f.seed('Custom',{pricing_mode:'custom',shares:{[A]:400,[B]:300,[C]:200}},{payer:C});
    const perPerson=await f.seed('Per person',{pricing_mode:'per_person',unit_amount:300});
    const unchanged=await f.seed('Excluded',{participantIds:[A,B]});
    const pending=await f.seed('Only Charlie',{participantIds:[C]});
    const paid=await f.seed('Paid history',{}, {paid:true,payer:C});
    const retained=await f.seed('Unpaid retained history',{}, {retained:true});
    const before=await f.snapshot();
    assert.equal(await f.remove([C],B),0);
    const lease=await f.lease(split,'budget',B);
    assert(lease.result.data?.granted);
    await assert.rejects(f.remove([C]),error=>error.code==='55P03');
    assert.deepEqual((await f.snapshot()).items,before.items);
    await lease.release();
    await f.sql.exec('reset role');
    await f.sql.query("select set_config('request.jwt.claim.sub',$1,false)",[A]);
    const luggage=(await f.sql.query("insert into public.shared_luggage_items(trip_id,title,category,assigned_to) values($1,'Bag','其他',$2) returning id",[f.trip,C])).rows[0];
    await assert.rejects(f.remove([C]),error=>error.code==='23503');
    assert.deepEqual((await f.snapshot()).items,before.items);
    await f.sql.exec('reset role');
    await f.sql.query('update public.shared_luggage_items set assigned_to=$2 where id=$1',[luggage.id,B]);
    await f.sql.query('update expense_stage_b.expense_participants set budget_share_amount=201 where expense_id=$1 and user_id=$2',[custom,C]);
    const beforeInvalidRemoval=await f.snapshot();
    await assert.rejects(f.remove([C]),error=>error.code==='22023');
    const afterInvalidRemoval=await f.snapshot();
    assert.deepEqual(afterInvalidRemoval.members,beforeInvalidRemoval.members);
    assert.deepEqual(afterInvalidRemoval.items,beforeInvalidRemoval.items);
    assert.deepEqual(afterInvalidRemoval.participants,beforeInvalidRemoval.participants);
    await f.sql.exec('reset role');
    await f.sql.query('update expense_stage_b.expense_participants set budget_share_amount=200 where expense_id=$1 and user_id=$2',[custom,C]);

    assert.equal(await f.remove([C]),1);
    const after=await f.snapshot();
    assert.equal(budget(after,split).amount,900);
    assert.deepEqual(budget(after,split).shares,{[A]:450,[B]:450});
    assert.deepEqual(model(after,split).payer_allocations,[{user_id:B,amount:900,order:0}]);
    assert.deepEqual(budget(after,custom).shares,{[A]:500,[B]:400});
    assert.equal(model(after,custom).payment_mode,'advance');
    assert.equal(model(after,custom).payer_id,null);
    assert.deepEqual(model(after,custom).payer_allocations,[]);
    assert.deepEqual(budget(after,perPerson).shares,{[A]:300,[B]:300});
    assert.equal(budget(after,perPerson).amount,600);
    for(const id of [split,custom,perPerson]) assert.equal(people(after,id).find(person=>person.user_id===D).budget_selected,false);
    assert.deepEqual(people(after,unchanged),people(before,unchanged));
    assert.deepEqual(model(after,unchanged),model(before,unchanged));
    assert.equal(budget(after,pending).amount,900);
    assert.equal(budget(after,pending).requires_participants,true);
    assert.deepEqual(budget(after,pending).participantIds,[]);
    assert.deepEqual(model(after,paid),model(before,paid));
    assert.deepEqual(people(after,paid),people(before,paid));
    assert.deepEqual(model(after,retained).paid,model(before,retained).paid);
    assert.equal(people(after,retained).find(person=>person.user_id===C).paid_selected,true);
    assert.deepEqual(after.departedMembers,[{user_id:C,display_name:'Charlie'}]);
    const projected=expenseFinancialSnapshot(after);
    const settlement=settlementBalances(projected.actualExpenses,projected.actualParticipants,after.members,expenseHistoricalMembers(after));
    assert.equal(settlement.incomplete,false);
    assert.deepEqual(settlement.balances.find(member=>member.user_id===C),{
      user_id:C,display_name:'Charlie（已退出）',paid:900,shouldPay:300,name:'Charlie（已退出）',balance:600,
    });
    const payment=await f.lease(pending,'payment');
    assert.equal((await payment.mutate({action:'paid',paid_at:'2026-01-01T00:00:00Z',budget_revision:1,paid_revision:0,payer_revision:0})).error?.code,'22023');
    await payment.release();
    const budgetEdit=await f.lease(pending,'budget',A,1);
    assert.equal((await budgetEdit.mutate({members:[A,B,D],form:{pricing_mode:'split_total',amount:900,currency:'TWD',participantIds:[A,B]}})).data?.committed,true);
    assert.equal(budget(await f.snapshot(),pending).requires_participants,undefined);
    const note=await f.lease(paid,'note',B);
    assert.equal((await note.mutate({text:'Keep historical shares'})).data?.committed,true);
    const beforeRetry=await f.snapshot();
    assert.equal(await f.remove([C]),0);
    assert.deepEqual((await f.snapshot()).participants,beforeRetry.participants);
    assert.equal((await f.rpc('read_expense_snapshot',{p_trip_id:f.trip},C)).error?.code,'42501');
  } finally { await f.close(); }
});

test('bulk departure conserves whole and cent amounts and explicit edits clear legacy ghost shares only in their group',async()=>{
  const f=await departureFixture();
  try {
    const { A,B,C,D }=f;
    const whole=await f.seed('Whole',{pricing_mode:'custom',participantIds:[A,B,C,D],shares:{[A]:400,[B]:300,[C]:100,[D]:101}});
    const cents=await f.seed('Cents',{pricing_mode:'custom',participantIds:[A,B,C,D],shares:{[A]:4.01,[B]:3.02,[C]:1,[D]:1.01}},{wholeOriginal:false});
    const historical=await f.seed('Former allocation',{}, {paid:true,payer:A});
    await f.sql.query("update public.trips set status='traveling', start_date='2020-01-01' where id=$1",[f.trip]);
    assert.equal(await f.remove([C,D]),2);
    const after=await f.snapshot(),[first,second]=[A,B].sort();
    const base={[A]:400,[B]:300},centBase={[A]:401,[B]:302};
    assert.deepEqual(budget(after,whole).shares,{[first]:base[first]+101,[second]:base[second]+100});
    assert.deepEqual(budget(after,cents).shares,{[first]:(centBase[first]+101)/100,[second]:(centBase[second]+100)/100});
    assert.equal(budget(after,whole).amount,901);
    assert.equal(budget(after,cents).amount,9.04);
    const change=await f.lease(historical,'budget');
    const value={members:[A,B],form:{pricing_mode:'split_total',amount:800,currency:'TWD',participantIds:[A,B]}};
    const receipt=await change.mutate(value);
    assert.equal(receipt.data?.committed,true);
    const ghost=receipt.data.participants.find(person=>person.user_id===C);
    assert.equal(ghost.budget_selected,false);
    assert.equal(ghost.budget_share_amount,null);
    assert.equal(ghost.paid_selected,true);
    assert.equal(ghost.paid_share_amount,300);
    assert.deepEqual(model(await f.snapshot(),historical).paid,model(after,historical).paid);
  } finally { await f.close(); }
});

test('settlement still rejects missing participants and nonconserving payment credits',()=>{
  const members=[{user_id:'A'}], history=[{user_id:'C',display_name:'Charlie'}];
  const expense={id:'one',amount:900,twd_amount:900,payment_mode:'advance',payments:[{user_id:'C',twd_amount:900}]};
  const participants=[{actual_expense_id:'one',user_id:'A'}];
  assert.equal(settlementBalances([expense],[],members,history).incomplete,true);
  assert.equal(settlementBalances([{...expense,record_status:'incomplete',payment_active:true}],participants,members,history).incomplete,true);
  assert.equal(settlementBalances([expense],[...participants,...participants],members,history).incomplete,true);
  assert.equal(settlementBalances([{...expense,payments:[{user_id:'C',twd_amount:899}]}],participants,members,history).incomplete,true);
  assert.equal(settlementBalances([expense],participants,members,history).incomplete,false);
});
