import {newExpense,priceExpense,confirmExpensePayment,cancelExpensePayment,expenseRows} from '../lib/expenseItems.js';
import {createDemoExpenseModels} from './budgetFixtures.js';
import {demoBudgetQuote} from '../lib/tripBudgetRates.js';
import {payerForm,reconcilePayers,validPayers} from '../lib/expensePayers.js';
import {calculatePricing} from '../lib/budgetFinance.js';
import {expenseCategories,insertExpenseOrder,orderedExpenseRows} from '../lib/expenseOrdering.js';

const groups=['title','note','category','payer','links','budget','paid','payment','lifecycle'];
const copy=value=>structuredClone(value);
const fail=(message,code='22023')=>{throw Object.assign(new Error(message),{code});};
export function createDemoExpenseService({trip,members,getItems}){
 const leases=new Map(),receipts=new Map();let rateRevision=0,rates=copy(demoBudgetQuote),rateHeld=null;
 const drags=new Map(),positions={};
 let categories=[...expenseCategories],categoryRevision=0;
 let models=createDemoExpenseModels(trip,getItems()).map(item=>{const form=payerForm(item);return{...item,payment_mode:form.mode,payer_allocations:form.rows,payer_sequence:form.sequence,revisions:{...Object.fromEntries(groups.map(g=>[g,0])),...item.revisions}};});
 const categoryList=()=>[...new Set([...categories,...models.map(item=>item.category)])];
 function snapshot(session){const rows=models.map(expenseRows);return {schemaVersion:1,tripId:trip.id,items:rows.map(r=>r.item),participants:rows.flatMap(r=>r.participants),
  serverNow:new Date().toISOString(),ordering:{categories:categoryList(),revision:categoryRevision,items:copy(positions),drags:[]},
  links:models.flatMap(i=>(i.links||[]).map(itinerary_item_id=>({expense_id:i.id,itinerary_item_id}))),members:copy(members),itineraryItems:copy(getItems()),rates:copy(rates),
  groups:models.flatMap(i=>groups.map(group=>{const l=leases.get(i.id+':'+group),held=Boolean(l&&l.expires>Date.now());return{id:i.id,group,revision:i.revisions[group]||0,epoch:l?.epoch||0,held,owner:held?'demo-peter':null,own_session:held&&l.session===session,expires_at:held?new Date(l.expires).toISOString():null};})),
  rateState:{revision:rateRevision,held:Boolean(rateHeld),targets:models.filter(i=>i.budget&&i.budget.currency!=='TWD'&&i.payment_state!=='paid').map(i=>({id:i.id,revision:i.revisions.budget}))}};}
 const result=fn=>async(...args)=>{try{return{data:copy(await fn(...args))};}catch(error){return{error};}};
 const once=(key,signature,run)=>{if(receipts.has(key)){const saved=receipts.get(key);if(saved.signature!==signature)fail('Request mismatch');return saved.result;}const value=run();receipts.set(key,{signature,result:copy(value)});return value;};
 const dragKey=r=>JSON.stringify([r.p_kind,r.p_id]);
 const ownsDrag=(r,held)=>held&&held.session===r.p_session_id&&held.token===r.p_token;
 const service={instanceId:crypto.randomUUID(),authorized:async()=>true,quote:async()=>copy(demoBudgetQuote),snapshot:()=>snapshot('demo-session'),read:result((_,session)=>snapshot(session)),
  dragLease:result(r=>{
   const key=dragKey(r),held=drags.get(key);
   if(r.p_action==='release'){
    if(ownsDrag(r,held))drags.delete(key);
    return {granted:true};
   }
   if(held?.expires>Date.now())return {granted:false};
   if(r.p_kind==='item'?!models.some(item=>item.id===r.p_id):!categoryList().includes(r.p_id))fail('Source removed','PT409');
   const now=Date.now(),expires=now+30000;
   drags.set(key,{session:r.p_session_id,token:r.p_token,expires});
   return {granted:true,expires_at:new Date(expires).toISOString(),server_now:new Date(now).toISOString()};
  }),
  moveOrder:result(r=>{
   const key=dragKey(r),held=drags.get(key),intent=r.p_intent;
   const signature=JSON.stringify({...r,p_confirm:false});
   if(r.p_confirm&&!receipts.has(r.p_request_id)){
    if(ownsDrag(r,held))drags.delete(key);
    return once(r.p_request_id,signature,()=>({committed:false,request_id:r.p_request_id}));
   }
   return once(r.p_request_id,signature,()=>{
    if(!ownsDrag(r,held)||held.expires<=Date.now())fail('Drag lease required','55P03');
    let revision;
    if(r.p_kind==='category'){
     const list=categoryList();
     if(intent.revision!==categoryRevision||!list.includes(r.p_id))fail('Order changed','PT409');
     const next=insertExpenseOrder(list,r.p_id,intent.target,intent.side);
     if(!next)fail('Order target changed','PT409');
     categories=next;
     revision=++categoryRevision;
    }else{
     const item=models.find(item=>item.id===r.p_id),anchor=models.find(item=>item.id===intent.target);
     const base=positions[r.p_id]?.revision??0;
     if(!item||item.category!==intent.sourceCategory||item.revisions.category!==intent.categoryRevision||base!==intent.revision
      ||!categoryList().includes(intent.category)||intent.target&&(!anchor||anchor.category!==intent.category||anchor.revisions.category!==intent.targetCategoryRevision))fail('Order changed','PT409');
     if(item.category!==intent.category){
      if(leases.get(item.id+':category')?.expires>Date.now())fail('Category is being edited','55P03');
      item.category=intent.category;
      item.revisions.category++;
     }
     const ids=orderedExpenseRows(models.filter(row=>row.category===intent.category),positions).map(row=>row.id);
     const next=insertExpenseOrder(ids,item.id,intent.target,intent.side);
     revision=base+1;
     next.forEach((id,index)=>{positions[id]={position:index+1,revision:id===item.id?revision:positions[id]?.revision??0};});
    }
    drags.delete(key);
    return {committed:true,request_id:r.p_request_id,revision};
   });
  }),
  lease:result(r=>{const key=r.p_id+':'+r.p_group,item=models.find(i=>i.id===r.p_id),l=leases.get(key),active=Boolean(l&&l.expires>Date.now());
   if(r.p_action==='release'){
    const reply=(outcome,settled,extra={})=>({schemaVersion:1,action:'release',id:r.p_id,group:r.p_group,session_id:r.p_session_id,requested_epoch:r.p_epoch,granted:settled,settled,capability_active:!settled,outcome,...extra});
    if(!active)return reply('inactive',true);
    if(l.session===r.p_session_id&&l.token===r.p_token){if(l.epoch!==r.p_epoch)return reply('epoch_mismatch',false,{epoch:l.epoch});l.expires=0;return reply('released',true);}
    return reply('superseded',true);
   }
   if(!item)fail('Item removed','55000');if((item.revisions[r.p_group]||0)!==r.p_base)fail('Version conflict','PT409');
   if(active&&(l.session!==r.p_session_id||l.token!==r.p_token))return{granted:false};
   if(r.p_action==='renew'&&(!active||l.epoch!==r.p_epoch))return{granted:false};
   const ttl=r.p_group==='links'?(r.p_dirty?60000:20000):420000;
   const held={session:r.p_session_id,token:r.p_token,epoch:active?l.epoch:(l?.epoch||0)+1,expires:Date.now()+ttl};leases.set(key,held);return{granted:true,epoch:held.epoch,revision:r.p_base,expires_at:new Date(held.expires).toISOString()};
  }),
  create:result(r=>once(r.p_request_id,JSON.stringify(r),()=>{if(!r.p_title?.trim())fail('Name required');if(models.some(i=>i.id===r.p_id))fail('Duplicate item');const item=newExpense({id:r.p_id,tripId:trip.id,members});item.decisions.paid={...item.decisions.budget};models.push({...item,title:r.p_title.trim(),payment_state:'draft',payment_mode:'self',payer_allocations:[],payer_sequence:0,planning_managed:true,revisions:Object.fromEntries(groups.map(g=>[g,0])),links:[]});return{committed:true,request_id:r.p_request_id,expense_id:r.p_id};})),
  copy:result(r=>once(r.p_request_id,JSON.stringify(r),()=>{
   const source=models.find(i=>i.id===r.p_source_id);
   if(!source||r.p_trip_id!==trip.id)fail('Item removed','55000');
   if(models.some(i=>i.id===r.p_id))fail('Duplicate item','23505');
   const eligible=new Set(members.filter(m=>m.status==='approved').map(m=>m.user_id));
   if(source.budget?.participantIds.some(id=>!eligible.has(id)))fail('Budget participants must be current members');
   const duplicate=copy(source);
   const decisions=duplicate.decisions.budget;
   models.push({...duplicate,id:r.p_id,title:(source.title.trim()||'未命名項目')+'（副本）',
    paid:null,paid_at:null,payment_state:'unpaid',payment_mode:'self',payer_id:null,payer_allocations:[],payer_sequence:0,
    decisions:{budget:decisions&&Object.fromEntries(Object.entries(decisions).filter(([id])=>eligible.has(id))),paid:null},
    revisions:Object.fromEntries(groups.map(g=>[g,0]))});
   return{committed:true,request_id:r.p_request_id,expense_id:r.p_id};
  })),
  mutate:result(r=>once(r.p_request_id,JSON.stringify({id:r.p_id,group:r.p_group,session:r.p_session_id,base:r.p_base,value:r.p_value}),()=>{
   const index=models.findIndex(i=>i.id===r.p_id),item=models[index],held=leases.get(r.p_id+':'+r.p_group),v=r.p_value;
   if(!item)fail('Item removed','55000');if(!held||held.session!==r.p_session_id||held.token!==r.p_token||held.epoch!==r.p_epoch||held.expires<=Date.now())fail('Lease required','55P03');
   if(item.revisions[r.p_group]!==r.p_base)fail('Version conflict','PT409');let next=copy(item);
   if(['budget','paid'].includes(r.p_group)){
    const eligible=members.filter(m=>m.status==='approved').map(m=>m.user_id).sort();if(JSON.stringify(v.members)!==JSON.stringify(eligible))fail('Members changed','PT409');if(v.form.participantIds.some(id=>!eligible.includes(id)))fail('Invalid participant');
    next=priceExpense(item,r.p_group,v.form,r.p_base,{wholeOriginal:r.p_group==='budget'&&v.planning});next.decisions[r.p_group]=Object.fromEntries(eligible.map(id=>[id,v.form.participantIds.includes(id)]));
   }else if(r.p_group==='payment')next=v.action==='unpaid'?cancelExpensePayment(item,r.p_base):confirmExpensePayment(item,{paidAt:v.paid_at,payerId:item.payer_id,basePayment:r.p_base,baseBudget:v.budget_revision,basePaid:v.paid_revision});
   else if(r.p_group==='lifecycle'){if(v.action!=='delete')fail('Invalid action');models.splice(index,1);delete positions[item.id];}
   else if(r.p_group==='links'){
    const itinerary=new Map(getItems().map(stop=>[stop.id,stop]));
    if(v.ids.some(id=>!itinerary.has(id)||itinerary.get(id).updated_at!==v.itinerary_versions?.[id])){
     fail('Itinerary changed before expense links were saved','PT409');
    }
    next.links=copy(v.ids);
   }
   else if(r.p_group==='payer'){if(!v.form){if(!members.some(m=>m.user_id===v.user_id&&m.status==='approved'))fail('Invalid payer');next.payment_mode='advance';next.payer_id=v.user_id;next.payer_allocations=[{user_id:v.user_id,amount:Math.round(Number((item.paid||item.budget)?.amount||0)),order:0}];}else{if(!validPayers(v.form,members))fail('Invalid payer');if(v.budget_revision!==(item.revisions.budget||0)||v.paid_revision!==(item.revisions.paid||0))fail('Pricing changed','PT409');const form=reconcilePayers(v.form,(item.budget||item.paid)?.amount);next.payment_mode=form.mode;next.payer_allocations=form.rows;next.payer_sequence=form.sequence;next.payer_id=form.mode==='advance'?form.rows[0]?.user_id:null;next.planning_managed=true;}}
   else if(['title','category','note'].includes(r.p_group)){
    if(r.p_group==='category'&&item.category!==v.text)delete positions[item.id];
    next[r.p_group]=v.text;
   }else fail('Invalid group');
   if(['budget','paid','payer','payment'].includes(r.p_group)){
    if(v.planning&&r.p_group==='budget')next.planning_managed=true;
    if(v.planning&&next.payment_state==='paid'&&next.budget&&['budget','payment'].includes(r.p_group)&&JSON.stringify(next.paid)!==JSON.stringify(next.budget)){next.paid=copy(next.budget);next.decisions.paid=copy(next.decisions.budget);next.revisions.paid++;}
    if(next.planning_managed||r.p_group==='payer'){const form=reconcilePayers(payerForm(next),(next.budget||next.paid)?.amount);if(JSON.stringify(next.payer_allocations)!==JSON.stringify(form.rows)){next.payer_allocations=form.rows;if(r.p_group!=='payer')next.revisions.payer++;}}
   }
   next.revisions[r.p_group]=r.p_base+1;if(r.p_group!=='lifecycle')models[index]=next;const rows=expenseRows(next);
   return{committed:true,request_id:r.p_request_id,expense_id:r.p_id,group:r.p_group,revision:r.p_base+1,item:rows.item,participants:rows.participants};
  })),
  rateLease:result(r=>{if(r.p_action==='release'){rateHeld=null;return{granted:true};}rateHeld=r;return{granted:true,epoch:1};}),
  rates:result(r=>once(r.p_request_id,JSON.stringify(r.p_value),()=>{
   if(r.p_base!==rateRevision)fail('Rates changed','PT409');
   const quote=copy(r.p_value.quote);
   models=models.map(i=>{
    if(!i.budget||i.payment_state==='paid'||i.budget.currency==='TWD')return i;
    const exchange_rate=quote.rates[i.budget.currency];
    const {twd_amount,allocations}=calculatePricing({...i.budget,exchange_rate},{wholeOriginal:i.budget.original_scale===0});
    return {...i,budget:{...i.budget,exchange_rate,twd_amount,allocations},revisions:{...i.revisions,budget:i.revisions.budget+1}};
   });
   rates=quote;rateRevision++;return{committed:true,request_id:r.p_request_id,trip_id:trip.id,revision:rateRevision};
  }))
 };return service;
}
