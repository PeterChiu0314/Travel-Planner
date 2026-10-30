import {calculatePricing,budgetStage} from '../lib/budgetFinance.js';
import {pricingInputs} from '../lib/budgetPricingGroups.js';
import {sourceSignature} from '../lib/budgetSourceValues.js';
const equal=(a,b)=>sourceSignature(a)===sourceSignature(b);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export function demoSourcePlan(p,id,intent,versionFor) {
 const r=p.actualExpenses.find(r=>r.id===id),destination=intent.budget_id??null,action=intent.action;
 if(!r)fail('42501','找不到實付項目。');if(!['relink_only','apply_source_data'].includes(action)||action==='apply_source_data'&&!destination)fail('22023','請選擇來源預算。');
 const old=r.budget_item_id??null,origin=r.budget_origin_id??null,provenance=r.payment_origin||'manual';
 if(!['manual','budget_toggle'].includes(provenance)||!old&&provenance!=='manual')fail('0A000','此付款來源尚未支援安全變更。');
 if(old&&origin&&old!==origin)fail('0A000','目前來源與歷史來源不一致，請先確認資料。');
 if(old!==destination&&origin&&destination)fail('0A000','歷史來源重新關聯尚待產品規則，已保留原資料。');
 const budgets=[...new Set([old,destination].filter(Boolean))].sort();
 for(const bid of budgets){const source=p.budgetItems.find(b=>b.id===bid&&b.trip_id===r.trip_id),retained=p.actualExpenses.filter(a=>a.budget_item_id===bid||a.budget_origin_id===bid);
  if(!source||source.is_fixed||retained.some(a=>a.trip_id!==r.trip_id||a.budget_item_id!==bid||a.budget_origin_id&&a.budget_origin_id!==bid)||source.auto_created_actual_expense_id&&!retained.some(a=>a.id===source.auto_created_actual_expense_id))fail('0A000','來源或付款關聯無法安全確認。');
  if(old!==destination&&source.auto_created_actual_expense_id===id)fail('0A000','自動建立付款的來源解除尚待產品規則。');
 }
 const stage=p.demoStage||budgetStage(p.activeTrip);if(old!==destination&&stage==='settled')fail('0A000','結算期來源變更尚未支援。');
 const before={...r,budget_item_id:old,budget_origin_id:origin,payment_origin:provenance},after={...before,budget_item_id:destination,budget_origin_id:old!==destination&&!origin&&destination?destination:origin};
 const normalizePeople=rows=>rows.map(p=>({user_id:p.user_id,share_amount:p.share_amount??null})).sort((a,b)=>a.user_id.localeCompare(b.user_id));
 const people_before=normalizePeople(p.actualParticipants.filter(p=>p.actual_expense_id===id));let people_after=people_before;const groups=[];
 if(action==='apply_source_data'){
  const source=p.budgetItems.find(b=>b.id===destination),people=p.budgetParticipants.filter(x=>x.budget_item_id===destination),form=pricingInputs(source,people);let calc;try{calc=calculatePricing(form);}catch(error){fail('22023',error.message);}
  if(stage==='settled'||stage!=='planning'&&(r.currency!=='TWD'||source.currency!=='TWD'))fail('0A000','歷史外幣不能套用來源重新估價。');
  if(!source.title?.trim()||!source.category?.trim()||Number(source.amount)!==calc.amount||Number(source.twd_amount)!==calc.twd_amount)fail('22023','來源計價尚未完成。');
  if([...form.participantIds,source.payer_id].filter(Boolean).some(id=>!p.members.some(m=>m.user_id===id&&m.status==='approved')))fail('42501','來源成員或付款人已變更。');
  if(['actual','legacy'].includes(r.twd_amount_source)&&(r.actual_twd_amount==null||Number(r.actual_twd_amount)!==calc.twd_amount))fail('22023','套用來源將改變已知實付台幣扣款，整筆操作已拒絕。');
  Object.assign(after,{title:source.title,category:source.category,note:source.note??null,payer_id:source.payer_id??null,amount:calc.amount,unit_amount:calc.unit_amount??null,currency:source.currency,exchange_rate:calc.exchange_rate,twd_amount:calc.twd_amount,pricing_mode:calc.pricing_mode,split_type:calc.pricing_mode==='custom'?'custom':'equal'});
  people_after=normalizePeople(form.participantIds.map(user_id=>({user_id,share_amount:calc.pricing_mode==='custom'?calc.shares[user_id]:null})));
  if(['amount','unit_amount','currency','exchange_rate','twd_amount','pricing_mode','split_type'].some(k=>!equal(before[k]??null,after[k]??null))||!equal(people_before,people_after))groups.push('pricing');
  for(const [group,field]of[['payer','payer_id'],['title','title'],['category','category'],['note','note']])if(!equal(before[field]??null,after[field]??null))groups.push(group);
 }
 const topology=old!==destination||origin!==after.budget_origin_id,changed=topology||groups.length>0;
 const targets=[{kind:'actual',id,group:'source'},...groups.map(group=>({kind:'actual',id,group})),...(topology?budgets.map(id=>({kind:'budget',id,group:'payment'})):[])].sort((a,b)=>`${a.kind}:${a.id}:${a.group}`.localeCompare(`${b.kind}:${b.id}:${b.group}`));
 const readGroups=action==='apply_source_data'?['source','pricing','payer','payment','title','category','note']:['source','pricing','payer','payment'];
 const checks=[...readGroups.map(group=>versionFor('actual',id,group)),...budgets.flatMap(bid=>(action==='apply_source_data'&&bid===destination?['pricing','payer','payment','title','category','note']:['pricing','payer','payment']).map(group=>versionFor('budget',bid,group)))].sort((a,b)=>`${a.kind}:${a.id}:${a.group}`.localeCompare(`${b.kind}:${b.id}:${b.group}`));
 const retained=budgets.map(budget_id=>({budget_id,actuals:p.actualExpenses.filter(a=>a.budget_item_id===budget_id||a.budget_origin_id===budget_id).map(a=>({id:a.id,current:a.budget_item_id??null,origin:a.budget_origin_id??null,provenance:a.payment_origin||'manual'})).sort((a,b)=>a.id.localeCompare(b.id))}));
 return {kind:'actual',id,action,budget_id:destination,before,after,people_before,people_after,groups,targets,topology,changed,revision:versionFor('actual',id,'source').revision,versions:{rates:0,members:0,checks,retained}};
}
export function attachDemoSources(service,getProps,{state,changed,commit},now=Date.now) {
 const requests=new Map(),read=service.read.bind(service),rows=kind=>getProps()[kind==='actual'?'actualExpenses':'budgetItems'];
 const group=d=>state(d.kind,rows(d.kind).find(r=>r.id===d.id),d.group);
 service.read=async trip=>{const result=await read(trip);if(!result.ok)return result;const data=result.data;data.metadataProtocol.schemaVersion=6;data.sourceProtocol={name:'budget-source',schemaVersion:1,enabled:true};data.sourceRecords=data.actualExpenses.map(r=>{const g=state('actual',r,'source'),held=Boolean(g.owner&&g.expires>now());return {kind:'actual',id:r.id,trip_id:r.trip_id,supported:true,revision:g.revision,epoch:g.epoch,value:{budget_id:r.budget_item_id??null,origin_id:r.budget_origin_id??null,payment_origin:r.payment_origin||'manual'},held,own_session:held,owner_id:held?g.owner:null,expires_at:held?new Date(g.expires).toISOString():null};});for(const r of data.metadataRecords)if(r.kind==='actual')for(const g of r.groups)if(['title','note'].includes(g.group))g.supported=true;return result;};
 service.previewSource=async args=>{try{const data=(await service.read(args.p_trip_id)).data,p={...getProps(),...data};const plan=demoSourcePlan(p,args.p_id,{action:args.p_action,budget_id:args.p_budget_id},(kind,id,group)=>{const r=group==='source'?data.sourceRecords.find(r=>r.id===id):group==='payment'?data.paymentRecords.find(r=>r.kind===kind&&r.id===id):data.metadataRecords.find(r=>r.kind===kind&&r.id===id)?.groups.find(g=>g.group===group);return {kind,id,group,revision:r.revision,graph:group==='pricing'?r.value.versions.graph:0};});return {data:plan};}catch(error){return {error:{code:error.code||'22023',message:error.message}};}};
 service.sourceLease=async args=>{
  if(args.p_kind!=='actual'||!['acquire','renew','release'].includes(args.p_action))return {error:{code:'22023'}};
  const row=rows('actual').find(r=>r.id===args.p_id&&r.trip_id===args.p_trip_id);if(!row)return {error:{code:'42501'}};const root=state('actual',row,'source'),owns=g=>g.owner===getProps().currentUserId&&g.session===args.p_session_id&&g.token===args.p_token;
  if(args.p_action==='release'){if(owns(root)&&root.epoch===args.p_epoch)for(const d of root.sourceBundle?.targets||[]){const g=group(d);if(owns(g)&&g.epoch===d.epoch)g.owner=null;}changed();return {data:{granted:true}};}
  if(args.p_action==='renew'&&(!owns(root)||root.epoch!==args.p_epoch||root.expires<=now()||!equal(root.sourceBundle?.intent,args.p_intent)||!equal(root.sourceBundle?.versions,args.p_versions)))return {data:{granted:false}};
  const preview=await service.previewSource({p_trip_id:args.p_trip_id,p_id:args.p_id,p_action:args.p_intent.action,p_budget_id:args.p_intent.budget_id});if(preview.error)return preview;const p=preview.data;
  if(root.revision!==args.p_base_revision||!equal(p.versions,args.p_versions))return {error:{code:'40001',message:'來源相依資料已變更。'}};
  if(p.action==='apply_source_data'&&p.changed&&['pricing','payer'].some(g=>{const s=group({kind:'budget',id:p.budget_id,group:g});return s.owner&&s.expires>now();}))return {data:{granted:false}};
  if(p.targets.some(d=>{const g=group(d);return g.owner&&g.expires>now()&&!owns(g);}))return {data:{granted:false}};
  for(const d of p.targets){const g=group(d);if(!g.owner||g.expires<=now())g.epoch++;Object.assign(g,{owner:getProps().currentUserId,session:args.p_session_id,token:args.p_token,expires:now()+120000});}
  root.sourceBundle={intent:args.p_intent,versions:p.versions,targets:p.targets.map(d=>({...d,epoch:group(d).epoch}))};changed();return {data:{granted:true,epoch:root.epoch,revision:root.revision,intent:args.p_intent,targets:root.sourceBundle.targets,value:{budget_id:p.after.budget_item_id,origin_id:p.after.budget_origin_id,payment_origin:p.after.payment_origin,versions:p.versions}}};
 };
 service.mutateSource=async args=>{
  if(args.p_kind!=='actual')return {error:{code:'22023'}};
  const actor=getProps().currentUserId,signature=sourceSignature([actor,args.p_trip_id,args.p_kind,args.p_id,args.p_session_id,args.p_base_revision,args.p_value]),cached=requests.get(args.p_request_id);if(cached)return cached.signature===signature?{data:structuredClone(cached.data)}:{error:{code:'22023'}};
  const row=rows('actual').find(r=>r.id===args.p_id),root=row&&state('actual',row,'source');if(!root||root.owner!==actor||root.session!==args.p_session_id||root.token!==args.p_token||root.epoch!==args.p_epoch||root.expires<=now())return {error:{code:'55P03'}};
  const result=await service.previewSource({p_trip_id:args.p_trip_id,p_id:args.p_id,p_action:args.p_value.action,p_budget_id:args.p_value.budget_id});if(result.error)return result;const p=result.data,bundle=root.sourceBundle;
  if(!equal(bundle.intent,{action:p.action,budget_id:p.budget_id})||!equal(p.versions,args.p_value.versions)||!equal(bundle.versions,p.versions)||!equal(bundle.targets.map(({epoch,...d})=>d),p.targets))return {error:{code:'40001'}};
  if(p.action==='apply_source_data'&&p.changed&&['pricing','payer'].some(g=>{const s=group({kind:'budget',id:p.budget_id,group:g});return s.owner&&s.expires>now();}))return {error:{code:'55P03'}};
  if(bundle.targets.some(d=>{const g=group(d);return g.owner!==actor||g.session!==args.p_session_id||g.token!==args.p_token||g.epoch!==d.epoch||g.expires<=now();}))return {error:{code:'55P03'}};
  if(p.changed){const fields=Object.fromEntries(Object.entries(p.after).filter(([k,v])=>!equal(v,p.before[k]))),old=getProps().actualParticipants.filter(j=>j.actual_expense_id===p.id),peopleChanged=!equal(p.people_before,p.people_after),people=peopleChanged?p.people_after.map(x=>({...old.find(j=>j.user_id===x.user_id),id:old.find(j=>j.user_id===x.user_id)?.id||crypto.randomUUID(),actual_expense_id:p.id,...x})):[];commit({tripId:row.trip_id,actuals:[{id:p.id,fields}],people,replacePeople:peopleChanged?[p.id]:undefined,created:null,budget:null});root.revision++;if(p.topology){for(const bid of new Set([p.before.budget_item_id,p.budget_id].filter(Boolean)))group({kind:'budget',id:bid,group:'payment'}).revision++;group({kind:'actual',id:p.id,group:'payment'}).revision++;}changed(p.topology||p.groups.includes('pricing'));}
  const data={id:p.id,kind:'actual',group:'source',revision:root.revision,request_id:args.p_request_id,value:{budget_id:p.after.budget_item_id,origin_id:p.after.budget_origin_id,payment_origin:p.after.payment_origin},undo_supported:false};requests.set(args.p_request_id,{signature,data});return {data:structuredClone(data)};
 };
 return service;
}
