// Single-expense domain shared by native projections, Demo and regression checks.
import { calculatePricing, calculateActualPricing, settlementBalances } from './budgetFinance.js';
import {paymentCredits} from './expensePayers.js';
const copy = value => structuredClone(value);
const scopes = new Set(['budget', 'paid']);
const checkScope = scope => { if (!scopes.has(scope)) throw new Error('Invalid pricing scope'); };

export function newExpense({id,tripId,scope='budget',members=[]}) {
  checkScope(scope);
  return {id,trip_id:tripId,title:'',category:'其他',note:'',payer_id:null,budget:null,paid:null,
    payment_state:scope==='paid'?'draft':'unpaid',paid_at:null,
    decisions:{budget:null,paid:null,[scope]:Object.fromEntries(members.filter(m=>m.status==='approved').map(m=>[m.user_id,true]))},
    revisions:{budget:0,paid:0,payment:0}};
}

export function priceExpense(item,scope,form,baseRevision) {
  checkScope(scope);
  if (item.revisions[scope]!==baseRevision) throw Object.assign(new Error('Version conflict'),{code:'PT409'});
  const pricing=scope==='paid'?calculateActualPricing({...form,twd_amount_source:form.twd_amount_source||'estimated'}):calculatePricing(form);
  const next=copy(item),previous=next.decisions[scope];
  next[scope]={...pricing,currency:form.currency,participantIds:[...new Set(form.participantIds)].sort(),shares:pricing.shares};
  // Unknown legacy exclusions remain unknown until a deliberate participant decision.
  if(previous)next.decisions[scope]=Object.fromEntries([...new Set([...Object.keys(previous),...form.participantIds])].map(id=>[id,form.participantIds.includes(id)]));
  next.revisions[scope]++;return next;
}

export function decideExpenseParticipants(item,scope,selected,members,baseRevision) {
  checkScope(scope);
  if(item.revisions[scope]!==baseRevision)throw Object.assign(new Error('Version conflict'),{code:'PT409'});
  const ids=members.filter(m=>m.status==='approved').map(m=>m.user_id);
  if(selected.some(id=>!ids.includes(id)))throw new Error('Invalid participant');
  const next=item[scope]?priceExpense(item,scope,{...item[scope],participantIds:selected,
    shares:{...item[scope].shares,...Object.fromEntries(selected.filter(id=>!Object.hasOwn(item[scope].shares,id)).map(id=>[id,0]))}},baseRevision):copy(item);
  next.decisions[scope]=Object.fromEntries(ids.map(id=>[id,selected.includes(id)]));
  if(!item[scope])next.revisions[scope]++;return next;
}

// Local proposal only, never a write. Paid decisions/history are never auto-expanded.
export function proposeExpenseMembers(item,scope,members) {
  checkScope(scope);const next=copy(item),decisions=next.decisions[scope];
  if(!decisions||scope==='paid'||item.payment_state==='paid')return next;
  for(const m of members.filter(m=>m.status==='approved'))if(!Object.hasOwn(decisions,m.user_id)){
    decisions[m.user_id]=true;
    if(next[scope]){next[scope].participantIds.push(m.user_id);if(next[scope].pricing_mode==='custom')next[scope].shares[m.user_id]=0;}
  }
  if(next[scope])next[scope]={...next[scope],...calculatePricing(next[scope])};
  return next;
}

export function confirmExpensePayment(item,{paidAt,payerId,basePayment,baseBudget,basePaid}) {
  if(basePayment!==item.revisions.payment||baseBudget!==item.revisions.budget||basePaid!==item.revisions.paid)
    throw Object.assign(new Error('Version conflict'),{code:'PT409'});
  if(item.payment_mode!=='self'&&!payerId||!Number.isFinite(Date.parse(paidAt)))throw new Error('Explicit payment details required');
  const next=copy(item);
  if(!next.paid){if(!next.budget)throw new Error('Payment amount missing');next.paid={...copy(next.budget),twd_amount_source:'estimated',actual_twd_amount:null};next.decisions.paid=copy(next.decisions.budget);next.revisions.paid++;}
  next.payment_state='paid';next.payer_id=payerId;next.paid_at=paidAt;next.revisions.payment++;return next;
}
export function cancelExpensePayment(item,basePayment) {
  if(basePayment!==item.revisions.payment)throw Object.assign(new Error('Version conflict'),{code:'PT409'});
  const next=copy(item);next.payment_state='unpaid';next.revisions.payment++;return next;
}

export function importActualExpense(actual,people) {
  // Preserve settlement eligibility exactly, including complete rows with no date.
  // Do not reconstruct budget, merge Origins, normalize money or invent decisions.
  const selected=people.filter(p=>p.actual_expense_id===actual.id);
  const {budget_item_id,budget_origin_id,...retained}=actual;
  return {id:actual.id,trip_id:actual.trip_id,title:actual.title,category:actual.category,note:actual.note,payer_id:actual.payer_id,
    budget:null,paid:{...copy(retained),participantIds:selected.map(p=>p.user_id),shares:Object.fromEntries(selected.map(p=>[p.user_id,p.share_amount]))},
    payment_state:actual.record_status==='incomplete'?'draft':actual.payment_active===false?'unpaid':'paid',paid_at:actual.paid_at??null,
    decisions:{budget:null,paid:null},revisions:{budget:0,paid:0,payment:0}};
}

export function expenseSettlement(items,members) {
  const rows=[],people=[];
  for(const item of items){if(!item.paid)continue;
    rows.push({...item.paid,id:item.id,payer_id:item.payer_id,payment_mode:item.payment_mode,payments:paymentCredits(item),record_status:item.payment_state==='draft'?'incomplete':item.paid.record_status,
      payment_active:item.payment_state==='paid'});
    for(const id of item.paid.participantIds)people.push({actual_expense_id:item.id,user_id:id,share_amount:item.paid.shares[id]});
  }
  return settlementBalances(rows,people,members);
}

// Single storage authority for participants: never persist a second selected
// list or shares dictionary inside the parent JSON financial bundles.
export function expenseRows(item) {
  const bundle=value=>{if(value===null)return null;const {participantIds,shares,id,trip_id,title,category,note,payer_id,paid_at,...money}=copy(value);return money;};
  const ids=[...new Set([...item.budget?.participantIds||[],...item.paid?.participantIds||[],
    ...Object.keys(item.decisions.budget||{}),...Object.keys(item.decisions.paid||{})])].sort();
  const selected=(scope,id)=>item.decisions[scope]?.[id]??(item[scope]?.participantIds.includes(id)?true:null);
  return {item:{id:item.id,trip_id:item.trip_id,title:item.title,category:item.category,note:item.note,payer_id:item.payer_id,
    ...(item.payment_mode?{payment_mode:item.payment_mode,payer_allocations:copy(item.payer_allocations||[]),payer_sequence:item.payer_sequence||0,planning_managed:Boolean(item.planning_managed)}:{}),
    budget:bundle(item.budget),paid:bundle(item.paid),paid_at:item.paid_at,payment_state:item.payment_state,
    budget_decisions_known:item.decisions.budget!==null,paid_decisions_known:item.decisions.paid!==null},
    participants:ids.map(user_id=>({expense_id:item.id,user_id,budget_selected:selected('budget',user_id),paid_selected:selected('paid',user_id),
      budget_share_amount:item.budget?.shares[user_id]??null,paid_share_amount:item.paid?.shares[user_id]??null}))};
}
