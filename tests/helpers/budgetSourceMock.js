import {paymentBackend,boot,enableMetadata} from './budgetPaymentMock.js';
import {demoSourcePlan} from '../../src/demo/budgetSourceGroups.js';
import {sourceSignature} from '../../src/lib/budgetSourceValues.js';
export {boot,enableMetadata};
export function sourceBackend(){
 const db=paymentBackend(),original=db.request.bind(db);db.sourceEnabled=true;db.sourceCalls=[];db.sourceRequests=new Map();db.sourcePending=[];
 db.releaseSource=()=>{db.sourceHold=null;db.sourcePending.splice(0).forEach(r=>r());};
 const rows=k=>db.rows[k==='actual'?'actual_expenses':'budget_items']||[];
 const state=d=>{const key=`${d.kind}:${d.id}:${d.group}`;if(!db.groupStates.has(key))db.groupStates.set(key,{revision:0,epoch:0});return db.groupStates.get(key);};
 const projection=(data,actor,session)=>{data.metadataProtocol.schemaVersion=6;data.sourceProtocol={name:'budget-source',schemaVersion:1,enabled:db.sourceEnabled};data.sourceRecords=data.actualExpenses.map(r=>{const g=state({kind:'actual',id:r.id,group:'source'}),held=Boolean(g.actor&&g.expires>db.now);return {kind:'actual',id:r.id,trip_id:r.trip_id,supported:true,revision:g.revision,epoch:g.epoch,value:{budget_id:r.budget_item_id??null,origin_id:r.budget_origin_id??null,payment_origin:r.payment_origin||'manual'},held,owner_id:held?g.actor:null,own_session:held&&g.actor===actor&&g.session===session,expires_at:held?new Date(g.expires).toISOString():null};});for(const r of data.metadataRecords)if(r.kind==='actual')for(const g of r.groups)if(['title','note'].includes(g.group))g.supported=true;return data;};
 const snapshot=async(args,actor)=>{const r=await original({op:'rpc',name:'read_budget_metadata_snapshot_v6',args:{p_trip_id:args.p_trip_id,p_session_id:args.p_session_id},actor});return r.error?r:{data:projection(r.data,actor,args.p_session_id)};};
 const plan=async(args,actor)=>{const r=await snapshot(args,actor);if(r.error)return r;const data=r.data;try{return {data:demoSourcePlan({...data,activeTrip:db.trips.find(t=>t.id===args.p_trip_id),members:db.members.filter(m=>m.trip_id===args.p_trip_id)},args.p_id,{action:args.p_action,budget_id:args.p_budget_id},(kind,id,group)=>{const record=group==='source'?data.sourceRecords.find(r=>r.id===id):group==='payment'?data.paymentRecords.find(r=>r.kind===kind&&r.id===id):data.metadataRecords.find(r=>r.kind===kind&&r.id===id).groups.find(g=>g.group===group);return {kind,id,group,revision:record.revision,graph:group==='pricing'?record.value.versions.graph:0};})};}catch(error){return {error:{code:error.code||'22023',message:error.message}};}};
 db.request=async req=>{
  const {name,args,actor}=req;
  if(name==='read_budget_metadata_snapshot_v6'){const r=await original(req);return r.error?r:{...r,data:projection(r.data,actor,args.p_session_id)};}
  if(!['read_budget_source_preview','budget_source_lease','mutate_budget_source'].includes(name))return original(req);
  db.sourceCalls.push({name,args:structuredClone(args),actor});const step=name==='mutate_budget_source'?'mutate':name==='read_budget_source_preview'?'preview':args.p_action;
  if(db.sourceHold?.actor===actor&&db.sourceHold.step===step)await new Promise(r=>db.sourcePending.push(r));
  if(db.sourceMissing)return {error:{code:'PGRST202',message:'Source API missing'}};if(db.offline)return {error:{message:'offline'}};
  const root=state({kind:'actual',id:args.p_id,group:'source'}),owns=g=>g.actor===actor&&g.session===args.p_session_id&&g.token===args.p_token;
  if(name==='budget_source_lease'&&args.p_action==='release'){if(db.sourceReleaseFailure)return {error:{message:'release pending'}};if(owns(root)&&root.epoch===args.p_epoch)for(const d of root.sourceBundle?.targets||[]){const g=state(d);if(owns(g)&&g.epoch===d.epoch)g.actor=null;}await db.emit('budget_collaboration_signals');return {data:{granted:true}};}
  if(!db.members.some(m=>m.trip_id===args.p_trip_id&&m.user_id===actor&&m.status==='approved'&&m.role!=='viewer'))return {error:{code:'42501',message:'Forbidden'}};
  const signature=sourceSignature([actor,args.p_trip_id,args.p_kind,args.p_id,args.p_session_id,args.p_base_revision,args.p_value]),cached=db.sourceRequests.get(args.p_request_id);if(cached)return cached.signature===signature?{data:structuredClone(cached.data)}:{error:{code:'22023'}};
  if(!db.sourceEnabled)return {error:{code:'55000',message:'Source disabled'}};
  const intent=name==='read_budget_source_preview'?{action:args.p_action,budget_id:args.p_budget_id}:name==='budget_source_lease'?args.p_intent:args.p_value;
  const r=await plan({...args,p_action:intent.action,p_budget_id:intent.budget_id},actor);if(r.error)return r;const p=r.data;if(name==='read_budget_source_preview')return r;
  if(args.p_base_revision!==root.revision||sourceSignature(name==='budget_source_lease'?args.p_versions:args.p_value.versions)!==sourceSignature(p.versions))return {error:{code:'40001',message:'來源資料已變更，請重新預覽。'}};
  if(p.action==='apply_source_data'&&p.changed&&['pricing','payer'].some(group=>{const g=state({kind:'budget',id:p.budget_id,group});return g.actor&&g.expires>db.now;}))return {data:{granted:false},error:name==='mutate_budget_source'?{code:'55P03'}:undefined};
  if(name==='budget_source_lease'){
   if(p.targets.some(d=>{const g=state(d);return g.actor&&g.expires>db.now&&!owns(g);})||p.versions.checks.some(d=>db.held.has(`${d.kind}:${d.id}`)))return {data:{granted:false}};
   for(const d of p.targets){const g=state(d);if(!g.actor||g.expires<=db.now)g.epoch++;Object.assign(g,{actor,session:args.p_session_id,token:args.p_token,expires:db.now+120000});}
   root.sourceBundle={intent:{action:p.action,budget_id:p.budget_id},versions:p.versions,targets:p.targets.map(d=>({...d,epoch:state(d).epoch}))};await db.emit('budget_collaboration_signals');return {data:{granted:true,epoch:root.epoch,revision:root.revision,intent:root.sourceBundle.intent,targets:root.sourceBundle.targets,value:{budget_id:p.after.budget_item_id,origin_id:p.after.budget_origin_id,payment_origin:p.after.payment_origin,versions:p.versions}}};
  }
  if(!owns(root)||root.epoch!==args.p_epoch||root.expires<=db.now||root.sourceBundle?.targets.some(d=>!owns(state(d))||state(d).epoch!==d.epoch||state(d).expires<=db.now))return {error:{code:'55P03'}};
  if(sourceSignature(root.sourceBundle.intent)!==sourceSignature({action:p.action,budget_id:p.budget_id})||sourceSignature(root.sourceBundle.versions)!==sourceSignature(p.versions))return {error:{code:'40001'}};
  if(db.sourceError)return {error:db.sourceError};
  if(p.changed){const actual=rows('actual').find(r=>r.id===p.id);Object.assign(actual,p.after);actual.updated_at=new Date(++db.now).toISOString();
   if(sourceSignature(p.people_before)!==sourceSignature(p.people_after)){const old=db.rows.actual_expense_participants||[];db.rows.actual_expense_participants=[...old.filter(j=>j.actual_expense_id!==p.id),...p.people_after.map(j=>({...old.find(p=>p.actual_expense_id===actual.id&&p.user_id===j.user_id),id:old.find(p=>p.actual_expense_id===actual.id&&p.user_id===j.user_id)?.id||crypto.randomUUID(),actual_expense_id:p.id,...j}))];}
   root.revision++;for(const group of p.groups)state({kind:'actual',id:p.id,group}).revision++;if(p.topology){for(const id of new Set([p.before.budget_item_id,p.budget_id].filter(Boolean)))state({kind:'budget',id,group:'payment'}).revision++;state({kind:'actual',id:p.id,group:'payment'}).revision++;}if(p.topology||p.groups.includes('pricing'))db.paymentGraph++;db.groupRevision++;
  }
  const data={id:p.id,kind:'actual',group:'source',revision:root.revision,request_id:args.p_request_id,value:{budget_id:p.after.budget_item_id,origin_id:p.after.budget_origin_id,payment_origin:p.after.payment_origin},undo_supported:false};db.sourceRequests.set(args.p_request_id,{signature,data});await db.emit('actual_expenses');await db.emit('budget_collaboration_signals');if(db.loseSourceAck){db.loseSourceAck=false;return {error:{message:'lost Source ACK'}};}return {data};
 };
 return db;
}
