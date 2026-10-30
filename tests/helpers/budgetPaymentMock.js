import { metadataBackend, boot, enableMetadata } from './budgetMetadataMock.js';
import { saveDemoBudgetRecord } from '../../src/demo/saveBudgetRecord.js';
export { boot, enableMetadata };
export function paymentBackend() {
 const db=metadataBackend(),original=db.request.bind(db);db.extendedMetadata=true;db.pricingMetadata=true;db.paymentEnabled=true;db.paymentCalls=[];db.paymentRequests=new Map();db.paymentGraph=0;db.paymentPending=[];
 db.releasePayment=()=>{db.paymentHold=null;db.paymentPending.splice(0).forEach(r=>r());};
 const rows=kind=>db.rows[kind==='budget'?'budget_items':'actual_expenses']||[];
 const state=(kind,id,group)=>{const key=`${kind}:${id}:${group}`;if(!db.groupStates.has(key))db.groupStates.set(key,{revision:0,epoch:0});return db.groupStates.get(key);};
 const targets=(kind,id)=>[{kind,id},...(kind==='budget'?rows('actual').filter(a=>a.budget_item_id===id).map(a=>({kind:'actual',id:a.id})):[])];
 const deps=(kind,id,intent='paid')=>targets(kind,id).flatMap(t=>(kind==='budget'&&targets(kind,id).length===1&&intent==='paid'?['payment','pricing','payer']:['payment']).map(group=>({...t,group})));
 const value=(kind,id)=>({active:kind==='actual'?rows(kind).find(r=>r.id===id).payment_active!==false:rows('actual').some(a=>a.budget_item_id===id&&a.payment_active!==false),paid_at:kind==='actual'?rows(kind).find(r=>r.id===id).paid_at:null,
  versions:{graph:db.paymentGraph,rates:0,members:0,source:0,targets:deps(kind,id).map(d=>({...d,revision:state(d.kind,d.id,d.group).revision})),checks:[...targets(kind,id),...(kind==='actual'&&rows(kind).find(r=>r.id===id).budget_item_id?[{kind:'budget',id:rows(kind).find(r=>r.id===id).budget_item_id}]:[])].flatMap(t=>['pricing','payer'].map(group=>({...t,group,revision:state(t.kind,t.id,group).revision,graph:db.paymentGraph})))}});
 db.request=async req=>{
  const {name,args,actor}=req;
  if(name==='patch_budget_metadata_group'&&args.p_group==='pricing'&&args.p_patch.pricing.versions.graph!==db.paymentGraph)return {error:{code:'40001',message:'計價相依版本已變更，草稿已保留。'}};
  if(['read_budget_metadata_snapshot_v5','read_budget_metadata_snapshot_v6'].includes(name)){
   const result=await original(req);if(result.error||!result.data)return result;const data=result.data;data.metadataProtocol.schemaVersion=5;data.paymentProtocol={name:'budget-payment',schemaVersion:2,enabled:db.paymentEnabled};
   for(const r of data.metadataRecords)for(const g of r.groups)if(g.group==='pricing'){g.value.versions.graph=db.paymentGraph;g.supported=r.kind==='budget'&&!rows('budget').find(b=>b.id===r.id).is_fixed;}
   for(const r of data.metadataRecords)if(r.kind==='budget')for(const g of r.groups)if(['title','note'].includes(g.group))g.supported=true;
   data.paymentRecords=['budget','actual'].flatMap(kind=>rows(kind).filter(r=>r.trip_id===args.p_trip_id).map(row=>{const g=state(kind,row.id,'payment'),held=Boolean(g.actor&&g.expires>db.now);return {kind,id:row.id,trip_id:row.trip_id,supported:!row.is_fixed&&!(kind==='actual'&&!row.budget_item_id&&row.budget_origin_id),revision:g.revision,epoch:g.epoch,value:value(kind,row.id),held,owner_id:held?g.actor:null,own_session:held&&g.actor===actor&&g.session===args.p_session_id,expires_at:held?new Date(g.expires).toISOString():null};}));return result;
  }
  if(!['budget_payment_lease_v2','mutate_budget_payment_v2'].includes(name))return original(req);
  db.paymentCalls.push({name,args:structuredClone(args),actor});
  if(db.paymentHold?.actor===actor&&db.paymentHold.step===(name==='budget_payment_lease_v2'?args.p_action:'mutate'))await new Promise(r=>db.paymentPending.push(r));
  if(db.paymentMissing)return {error:{code:'PGRST202',message:'payment RPC missing'}};
  if(db.offline)return {error:{message:'offline'}};
  const row=rows(args.p_kind).find(r=>r.id===args.p_id&&r.trip_id===args.p_trip_id),root=row&&state(args.p_kind,row.id,'payment');if(!root)return {error:{code:'42501'}};
  const owns=g=>g.actor===actor&&g.session===args.p_session_id&&g.token===args.p_token;
  if(args.p_action==='release'){if(owns(root)&&root.epoch===args.p_epoch)for(const d of root.bundle||[]){const g=state(d.kind,d.id,d.group);if(owns(g)&&g.epoch===d.epoch)g.actor=null;}await db.emit('budget_collaboration_signals');return {data:{granted:true}};}
  if(!db.members.some(m=>m.trip_id===row.trip_id&&m.user_id===actor&&m.status==='approved'&&m.role!=='viewer'))return {error:{code:'42501'}};
  const signature=JSON.stringify([args.p_trip_id,args.p_kind,args.p_id,args.p_session_id,args.p_base_revision,args.p_value]);
  const cached=db.paymentRequests.get(args.p_request_id);if(cached)return signature===cached.signature?{data:cached.data}:{error:{code:'22023'}};
  if(!db.paymentEnabled)return {error:{code:'55000'}};
  const current=value(args.p_kind,row.id);if(args.p_base_revision!==root.revision||JSON.stringify(name==='budget_payment_lease_v2'?args.p_versions:args.p_value.versions)!==JSON.stringify(current.versions))return {error:{code:'40001'}};
  if(name==='budget_payment_lease_v2'){
   if(!(args.p_kind==='budget'?['paid','unpaid']:['set_paid_at']).includes(args.p_intent))return {error:{code:'22023'}};
   const dependencies=deps(args.p_kind,row.id,args.p_intent);if(dependencies.some(d=>{const g=state(d.kind,d.id,d.group);return g.actor&&g.expires>db.now&&!owns(g);})||targets(args.p_kind,row.id).some(t=>db.held.has(`${t.kind}:${t.id}`)))return {data:{granted:false}};
   for(const d of dependencies){const g=state(d.kind,d.id,d.group);if(!g.actor||g.expires<=db.now)g.epoch++;Object.assign(g,{actor,session:args.p_session_id,token:args.p_token,expires:db.now+120000});}root.bundle=dependencies.map(d=>({...d,epoch:state(d.kind,d.id,d.group).epoch}));root.intent=args.p_intent;await db.emit('budget_collaboration_signals');return {data:{granted:true,revision:root.revision,epoch:root.epoch,intent:root.intent,targets:root.bundle,value:current,expires_at:new Date(root.expires).toISOString()}};
  }
  if(db.paymentError)return {error:db.paymentError};if(!owns(root)||root.epoch!==args.p_epoch||root.expires<=db.now)return {error:{code:'55P03'}};
  if(root.intent!==args.p_value.action)return {error:{code:'40001'}};
  let created=null,changed=false;
  if(args.p_kind==='actual'){changed=Date.parse(row.paid_at)!==Date.parse(args.p_value.paid_at);row.paid_at=new Date(args.p_value.paid_at).toISOString();}
  else {
   const retained=rows('actual').filter(r=>r.budget_item_id===row.id),finance={budgetItems:rows('budget'),actualExpenses:rows('actual'),budgetParticipants:db.rows.budget_item_participants||[],actualParticipants:db.rows.actual_expense_participants||[],itineraryBudgetLinks:db.rows.itinerary_budget_items||[],attachments:db.rows.attachments||[],tripBudgetRates:db.trips.find(t=>t.id===row.trip_id).budget_exchange_rates};
   const result=saveDemoBudgetRecord(finance,'budget',{payment_only:true,payment_action:args.p_value.action,unified_planning:true,payment_expected:retained.map(r=>({id:r.id,updated_at:r.updated_at}))},row.id,{tripId:row.trip_id,baseUpdatedAt:row.updated_at,operationId:args.p_request_id},db.trips.find(t=>t.id===row.trip_id),db.members.filter(m=>m.trip_id===row.trip_id&&m.status==='approved'));
   if(!result.ok)return {error:{code:result.error?.code||'22023',message:result.error?.message}};
   created=result.nextState.actualExpenses.find(a=>!rows('actual').some(b=>b.id===a.id))?.id||null;changed=Boolean(created||retained.some(r=>(r.payment_active!==false)!==(args.p_value.action==='paid')));
   Object.assign(db.rows,{budget_items:result.nextState.budgetItems,actual_expenses:result.nextState.actualExpenses.map(a=>({...a,payment_active:a.payment_active!==false,payment_history:a.payment_history||[]})),actual_expense_participants:result.nextState.actualParticipants});
  }
  if(changed){db.paymentGraph++;for(const t of targets(args.p_kind,row.id))state(t.kind,t.id,'payment').revision++;}
  const data={id:row.id,kind:args.p_kind,group:'payment',revision:root.revision,value:value(args.p_kind,row.id),request_id:args.p_request_id,created_id:created};db.paymentRequests.set(args.p_request_id,{signature,data});
  await db.emit('actual_expenses');await db.emit('budget_collaboration_signals');if(db.losePaymentAck){db.losePaymentAck=false;return {error:{message:'ack lost'}};}return {data};
 };
 return db;
}
