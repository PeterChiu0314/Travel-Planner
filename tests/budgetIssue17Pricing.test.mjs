import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePricing, recordForm } from '../src/lib/budgetFinance.js';
import { initialPricingDraft, pricingModeDraft, pricingParticipantsDraft, incompletePricingInput } from '../src/lib/budgetPricingGroups.js';
const members = [{user_id:'A',status:'approved'},{user_id:'B',status:'approved'},{user_id:'C',status:'pending'}];
const base = {pricing_mode:'split_total',amount:10000,currency:'TWD',exchange_rate:1,participantIds:['A','B'],shares:{}};

test('new forms and unpriced placeholders default approved members without mutating their canonical values',()=>{
  assert.deepEqual(recordForm(null,[],'budget_item_id',members).participantIds,['A','B']);
  const value={...base,amount:'',participantIds:[]};
  const draft=initialPricingDraft(value,{record_status:'incomplete',pricing_ready:false},members);
  assert.deepEqual(draft.participantIds,['A','B']);assert.equal(draft.amount,'');assert.deepEqual(value.participantIds,[]);
  assert(incompletePricingInput(draft));
});
test('legacy selections and known historical amounts are never expanded by display defaults',()=>{
  for(const record of [{record_status:'complete'},{record_status:'incomplete',pricing_ready:true}])assert.equal(initialPricingDraft(base,record,members),base);
  const excluded={...base,participantIds:['A']};
  assert.equal(initialPricingDraft(excluded,{record_status:'incomplete',pricing_ready:false},members),excluded);
});
test('10000 split becomes editable 5000+5000 and editing one share changes total to 12000',()=>{
  const next=pricingModeDraft(base,'custom');assert.deepEqual(next.shares,{A:5000,B:5000});
  assert.equal(calculatePricing({...next,shares:{...next.shares,A:7000}}).amount,12000);
});
test('fractional largest remainder initializes every custom share and exactly preserves the total',()=>{
  const next=pricingModeDraft({...base,amount:100.01,participantIds:['A','B','C']},'custom');
  assert.deepEqual(next.shares,{A:33.34,B:33.34,C:33.33});assert.equal(calculatePricing(next).amount,100.01);
});
test('all modes retain exclusions and per-person total counts only selected people',()=>{
  const selected={...base,participantIds:['A','B'],unit_amount:1000};
  const per=pricingModeDraft(selected,'per_person');per.unit_amount=1000;
  assert.equal(calculatePricing(per).amount,2000);
  assert.deepEqual(pricingModeDraft(pricingModeDraft(per,'custom'),'split_total').participantIds,['A','B']);
});
test('custom participation changes preserve existing shares and initialize newly selected people to zero',()=>{
  const value={...base,pricing_mode:'custom',participantIds:['A'],shares:{A:7000}};
  const next=pricingParticipantsDraft(value,['A','B']);assert.deepEqual(next.shares,{A:7000,B:0});
  assert.equal(calculatePricing(next).amount,7000);assert.deepEqual(value.shares,{A:7000});
});
test('revisiting custom mode rejects a partial cache, while a complete matching split retains zero',()=>{
  const next=pricingModeDraft(base,'custom',{A:0});assert.deepEqual(next.shares,{A:5000,B:5000});
  assert.deepEqual(pricingModeDraft(base,'custom',{A:0,B:10000}).shares,{A:0,B:10000});
});
test('changing mode on a missing amount cannot silently turn it into completed zero-cost pricing',()=>{
  const next=pricingModeDraft({...base,amount:''},'custom');assert.deepEqual(next.shares,{A:'',B:''});
  assert(incompletePricingInput(next));assert.throws(()=>calculatePricing(next));
});
