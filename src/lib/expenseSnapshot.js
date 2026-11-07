import {isBudgetComplete} from './budgetLifecycleValues.js';
import {paymentCredits} from './expensePayers.js';
export function expenseModels(data){
 return data.items.map(row=>{
  const people=data.participants.filter(p=>p.expense_id===row.id),groups=data.groups.filter(g=>g.id===row.id);
  const bundle=scope=>row[scope]===null?null:{...row[scope],participantIds:people.filter(p=>p[scope+'_selected']===true).map(p=>p.user_id),shares:Object.fromEntries(people.filter(p=>p[scope+'_selected']===true).map(p=>[p.user_id,p[scope+'_share_amount']]))};
  const decisions=scope=>row[scope+'_decisions_known']?Object.fromEntries(people.filter(p=>p[scope+'_selected']!==null).map(p=>[p.user_id,p[scope+'_selected']])):null;
  return {...row,budget:bundle('budget'),paid:bundle('paid'),decisions:{budget:decisions('budget'),paid:decisions('paid')},revisions:Object.fromEntries(groups.map(g=>[g.group,g.revision]))};
 });
}
// Read projections for existing Timeline/settlement consumers, never dual writes.
export function expenseFinancialSnapshot(data){
 const models=expenseModels(data),budgetItems=[],actualExpenses=[],budgetParticipants=[],actualParticipants=[];
 for(const i of models){
  if(i.budget||!i.paid&&i.payment_state==='unpaid'){
   budgetItems.push({...i.budget,id:i.id,trip_id:i.trip_id,title:i.title,category:i.category,note:i.note,payer_id:i.payer_id,
    record_status:i.budget&&i.title.trim()?'complete':'incomplete',pricing_ready:Boolean(i.budget),amount:i.budget?.amount??0,currency:i.budget?.currency||'TWD',twd_amount:i.budget?.twd_amount??0});
   for(const p of data.participants.filter(p=>p.expense_id===i.id&&p.budget_selected))budgetParticipants.push({budget_item_id:i.id,user_id:p.user_id,share_amount:p.budget_share_amount});
  }
  if(i.paid||i.payment_state==='draft'){
   actualExpenses.push({...i.paid,id:i.id,trip_id:i.trip_id,title:i.title,category:i.category,note:i.note,payer_id:i.payer_id,payment_mode:i.payment_mode,payments:paymentCredits(i),paid_at:i.paid_at,
    record_status:i.payment_state==='draft'?'incomplete':i.paid?.record_status,pricing_ready:Boolean(i.paid),payment_active:i.payment_state==='paid'});
   for(const p of data.participants.filter(p=>p.expense_id===i.id&&p.paid_selected))actualParticipants.push({actual_expense_id:i.id,user_id:p.user_id,share_amount:p.paid_share_amount});
  }
 }
 return {tripId:data.tripId,budgetItems,budgetParticipants,actualExpenses,actualParticipants,itineraryBudgetLinks:data.links.map(l=>({budget_item_id:l.expense_id,itinerary_item_id:l.itinerary_item_id})),
  items:data.itineraryItems||[],members:data.members||[],attachments:[],tripBudgetRates:data.rates,expenseGraph:data,expenseVerified:true};
}
export function expenseTimelineCosts(data){return expenseModels(data).flatMap(item=>{const bundle=item.payment_state==='paid'&&item.paid?item.paid:item.budget;return bundle?[{...bundle,expenseScope:item.payment_state==='paid'&&item.paid?'paid':'budget',id:item.id,title:item.title,category:item.category,payer_id:item.payer_id,trip_id:item.trip_id}]:[];});}
export const validExpenseSnapshot=(data,trip)=>data?.schemaVersion===1&&data.tripId===trip&&['items','participants','groups','links'].every(k=>Array.isArray(data[k]))
 &&new Set(data.items.map(i=>i.id)).size===data.items.length&&data.items.every(i=>i.trip_id===trip&&['draft','unpaid','paid'].includes(i.payment_state))
 &&data.participants.every(p=>data.items.some(i=>i.id===p.expense_id))&&data.groups.every(g=>data.items.some(i=>i.id===g.id)&&Number.isSafeInteger(g.revision));
