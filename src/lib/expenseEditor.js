import {withBudgetAuthorityTimeout} from './budgetMetadataService.js';
import {expenseModels,validExpenseSnapshot} from './expenseSnapshot.js';
import {calculatePricing,calculateActualPricing} from './budgetFinance.js';
import {proposeExpenseMembers,expenseRows,newExpense} from './expenseItems.js';
import {expenseReleaseReceipt,expenseReleaseSettled} from './expenseLeaseReceipt.js';
import {payerForm,reconcilePayers,validPayers} from './expensePayers.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const compatiblePayer=(value,item)=>typeof value==='string'?payerForm({...item,payment_mode:value?'advance':'self',payer_id:value||null,payer_allocations:[],payer_sequence:0}):value;
export function expenseFieldValue(data,id,group){
 const item=expenseModels(data).find(i=>i.id===id);if(!item)return null;
 if(['budget','paid'].includes(group)){
  const bundle=item[group];const selected=Object.entries(item.decisions[group]||{}).filter(([,yes])=>yes).map(([id])=>id);
  const storedSource=bundle?.twd_amount_source||'legacy',source=group==='paid'&&storedSource==='legacy'&&Number.isInteger(Number(bundle?.twd_amount))?'actual':storedSource;
  return bundle?{amount:bundle.amount,unit_amount:bundle.unit_amount,pricing_mode:bundle.pricing_mode,currency:bundle.currency,exchange_rate:bundle.exchange_rate,
   participantIds:bundle.participantIds,shares:bundle.shares,twd_amount_source:source,actual_twd_amount:bundle.actual_twd_amount??bundle.twd_amount??''}
   :{amount:'',unit_amount:'',pricing_mode:'split_total',currency:'TWD',exchange_rate:1,participantIds:selected,shares:{},twd_amount_source:'estimated',actual_twd_amount:''};
 }
 if(group==='payer')return payerForm(item);
 if(group==='payment')return {action:item.payment_state==='paid'?'paid':'unpaid',paid_at:item.paid_at,budget_revision:item.revisions.budget||0,paid_revision:item.revisions.paid||0,payer_revision:item.revisions.payer||0};
 if(group==='lifecycle')return null;
 if(group==='links')return data.links.filter(l=>l.expense_id===id).map(l=>l.itinerary_item_id).sort();
 return item[group]??'';
}
export function createExpenseEditor({service,actor,trip,sessionId,storage,planning=()=>false,makeId=()=>crypto.randomUUID(),timeoutMs=10000,onError=()=>{},onSnapshot=()=>{}}){
 let graph=null,verified=false,active=true,disposed=false,version=0,readWork=null,lastRecovery=0,createWork=null,pendingCreate=null,localDraft=null,createTimer=null,mountGeneration=0;const fields=new Map(),listeners=new Set();
 const createKey=`travel-planner-expense-create:${actor}:${trip}`;
 try{const saved=JSON.parse(storage?.getItem(createKey)||'null');if(saved?.p_trip_id===trip&&typeof saved.p_request_id==='string')pendingCreate=saved;}catch{/* Invalid persisted request ignored. */}
 const draftKey=createKey+':draft';
 try{const saved=JSON.parse(storage?.getItem(draftKey)||'null');if(saved?.trip===trip&&typeof saved.id==='string'&&saved.values)localDraft=saved;}catch{/* Account/trip scoped local input only. */}
 function draftGraph(){const model=newExpense({id:localDraft.id,tripId:trip,members:graph?.members||[]});model.decisions.paid={...model.decisions.budget};const row=expenseRows(model);return{...graph,items:[row.item],participants:row.participants,links:[]};}
 function draftValue(group){return expenseFieldValue(draftGraph(),localDraft.id,group);}
 function persistDraft(){try{if(localDraft&&(draftDirty()||pendingCreate))storage?.setItem(draftKey,JSON.stringify(localDraft));else storage?.removeItem(draftKey);}catch{/* Keep in memory. */}}
 const draftDirty=()=>Boolean(localDraft&&Object.entries(localDraft.values).some(([group,value])=>group==='title'||group==='note'?Boolean(String(value||'').trim()):!same(value,draftValue(group))));
 function clearDraft(){clearTimeout(createTimer);if(localDraft)for(const [key,g] of fields)if(g.local)fields.delete(key);localDraft=null;persistDraft();}
 const emit=()=>{if(!disposed){version++;listeners.forEach(fn=>fn());}};
 const current=()=>!disposed;
 const owns=g=>active&&verified&&g.token&&g.epoch!==null&&g.state==='held'&&!g.releasing&&g.expires>Date.now()&&!g.conflict;
 const dirty=g=>!same(g.value,g.canonical);
 const display=g=>{
  if(g.local)return g.value;
  if(g.group!=='budget'||dirty(g)||g.request)return g.value;
  const item=expenseModels(graph).find(i=>i.id===g.id);if(!item)return g.value;
  const proposed=expenseRows(proposeExpenseMembers(item,'budget',graph.members));
  return expenseFieldValue({...graph,items:graph.items.map(i=>i.id===g.id?proposed.item:i),participants:[...graph.participants.filter(p=>p.expense_id!==g.id),...proposed.participants]},g.id,g.group);
 };
 const storageKey=g=>`travel-planner-expense:${actor}:${trip}:${g.id}:${g.group}`;
 function persist(g){try{if(!dirty(g)&&!g.request)storage?.removeItem(storageKey(g));else storage?.setItem(storageKey(g),JSON.stringify({value:g.value,base:g.base,request:g.request?{...g.request,p_token:null,p_epoch:null}:null}));}catch{/* Memory draft remains. */}}
 const remote=g=>graph?.groups.find(s=>s.id===g.id&&s.group===g.group);
 const args=(g,action)=>({p_id:g.id,p_group:g.group,p_session_id:sessionId,p_token:g.token,p_action:action,p_base:g.base,p_epoch:g.epoch,p_seq:g.activity,p_dirty:dirty(g)});
 const bounded=work=>withBudgetAuthorityTimeout(work,{timeoutMs});
 function renew(g){
  if(g.renewWork)return g.renewWork;
  if(!owns(g)||(Date.now()-g.lastRenew<5000&&g.expires-Date.now()>15000))return;
  const request=args(g,'renew');
  g.renewWork=(async()=>{const r=await bounded(service.lease(request));
   if(!current()||!active||g.releasing||g.token!==request.p_token||g.epoch!==request.p_epoch||g.state!=='held')return;
   if(r.error?.code==='PT409'&&(g.saving||g.request||g.base!==request.p_base))return;
   const expires=Date.parse(r.data?.expires_at);
   if(!r.error&&r.data?.granted&&r.data.epoch===request.p_epoch&&expires>Date.now()){g.expires=expires;g.lastRenew=Date.now();}else{g.state='lost';persist(g);emit();}
  })().finally(()=>{g.renewWork=null;});return g.renewWork;
 }
 const report=(g,error)=>{g.error=error;persist(g);onError(error);emit();};
 function ingest(data,{authoritative=true}={}){
  if(!current()||!validExpenseSnapshot(data,trip))return false;
  if(!authoritative&&graph){verified=false;emit();return true;}
  graph=data;verified=authoritative&&active&&globalThis.navigator?.onLine!==false;
  for(const g of fields.values()){
   if(g.local)continue;
   const r=remote(g);if(!r){g.conflict=true;g.state='lost';continue;}
   if(r.revision<g.base)continue;
   if(r.revision===g.base&&dirty(g)&&!g.request&&!g.saving){g.canonical=expenseFieldValue(data,g.id,g.group);g.conflict=false;persist(g);}
   if(r.revision!==g.base&&dirty(g)&&!g.request){g.conflict=true;report(g,new Error('內容已更新，變更已保留；離開項目時可選擇保留或不儲存。'));}
   else if(!dirty(g)&&!g.request){g.canonical=expenseFieldValue(data,g.id,g.group);g.value=structuredClone(g.canonical);g.base=r.revision;g.conflict=false;}
   if(g.state==='held'&&(!r.own_session||r.epoch!==g.epoch||!r.held))g.state='lost';
  }
  emit();return true;
 }
 async function refresh(){if(readWork)return readWork;readWork=(async()=>{try{if(!(await service.authorized(actor)))return false;const r=await bounded(service.read(trip,sessionId));if(r.error||!ingest(r.data)){verified=false;if(r.error)onError(r.error);emit();return false;}onSnapshot(r.data);return true;}finally{readWork=null;}})();return readWork;}
 function get(id,group){const key=id+':'+group;if(fields.has(key))return fields.get(key);const r=graph?.groups.find(g=>g.id===id&&g.group===group);const value=expenseFieldValue(graph,id,group);
  if(localDraft?.id===id){const canonical=draftValue(group);let value=structuredClone(localDraft.values[group]??canonical);if(group==='payer')value=compatiblePayer(value,expenseModels(draftGraph())[0]);const g={id,group,local:true,canonical,value,state:'local',revision:0};fields.set(key,g);return g;}
  const g={id,group,value,canonical:structuredClone(value),base:r?.revision??0,state:'idle',token:null,epoch:null,activity:0,focused:false,conflict:false,request:null,revision:0};
  try{const draft=JSON.parse(storage?.getItem(storageKey(g))||'null');if(draft&&Number.isSafeInteger(draft.base)){g.value=draft.value;g.base=draft.base;g.request=draft.request;g.conflict=Boolean(!g.request&&verified&&r&&r.revision!==g.base);
   if(g.request){const v=g.request.p_value;const original=['budget','paid'].includes(group)?v.form:group==='payer'?v.form||v.user_id||'':group==='links'?v.ids:['payment','lifecycle'].includes(group)?v:v.text;g.submitted=same(original,g.value)?0:-1;}
  }}catch{/* Invalid persisted input never grants authority. */}
  if(group==='payer')g.value=compatiblePayer(g.value,expenseModels(graph).find(i=>i.id===id));
  fields.set(key,g);return g;
 }
 async function release(g){if(g.local){g.focused=false;return true;}if(g.releaseWork)return g.releaseWork;clearTimeout(g.timer);g.focused=false;g.releasing=true;
  g.releaseWork=(async()=>{if(g.acquiring)await g.acquiring;if(g.request||g.saving)return false;if(!g.token){g.releasing=false;return true;}if(g.epoch===null)return false;
   let request=args(g,'release'),r=await bounded(service.lease(request));if(!current())return false;
   if(!r.error&&expenseReleaseReceipt(r.data,request)&&r.data.outcome==='epoch_mismatch'&&r.data.capability_active===true&&Number.isSafeInteger(r.data.epoch)){
    g.epoch=r.data.epoch;request=args(g,'release');r=await bounded(service.lease(request));if(!current())return false;
   }
   if(!r.error&&expenseReleaseSettled(r.data,request)){g.token=null;g.epoch=null;g.state='idle';g.releasing=false;g.error=null;emit();return true;}
   report(g,r.error||new Error('暫時無法完成同步，變更已保留。'));return false;
  })().finally(()=>{g.releaseWork=null;emit();});return g.releaseWork;
 }
 async function focus(g){if(g.local){g.focused=true;return active;}if(['budget','paid','payer'].includes(g.group)){for(const other of fields.values())if(other!==g&&other.id===g.id&&['budget','paid','payer'].includes(other.group)&&other.saveWork&&!await other.saveWork)return false;}if(!current()||!active||!verified||g.conflict||g.request)return false;g.focused=true;
  if(g.releasing){if(!await release(g))return false;g.focused=true;}
  if(owns(g))return true;if(g.acquiring)return g.acquiring;
  g.token ||= makeId();g.state='pending';emit();const request=args(g,'acquire'),token=g.token;
  g.acquiring=(async()=>{if(!(await service.authorized(actor)))return false;
   const r=await withBudgetAuthorityTimeout(service.lease(request),{timeoutMs,late:async late=>{if(late.data?.granted){
    const relevant=current()&&g.token===token; if(relevant){g.epoch=late.data.epoch;g.releasing=true;}
    const cleaned=await service.lease({...request,p_action:'release',p_epoch:late.data.epoch});
    if(relevant&&current()&&g.token===token&&expenseReleaseSettled(cleaned.data,{...request,p_epoch:late.data.epoch})){g.token=null;g.epoch=null;g.releasing=false;g.state='idle';emit();}
   }}});
   if(!current()){if(r.data?.granted)void service.lease({...request,p_action:'release',p_epoch:r.data.epoch});return false;}
   if(r.error||!r.data?.granted){if(r.data?.granted===false||r.error?.code==='PT409')g.token=null;g.state='blocked';if(r.error?.code==='PT409'&&dirty(g))g.conflict=true;if(r.error&&r.error.code!=='PT409')report(g,r.error);void refresh();return false;}
   if(g.token!==token)return false;g.epoch=r.data.epoch;g.expires=Date.parse(r.data.expires_at);g.state='held';g.lastRenew=Date.now();
   if(!active){g.focused=false;queueMicrotask(()=>void release(g));emit();return false;}
   emit();return true;
  })().finally(()=>{g.acquiring=null;emit();});return g.acquiring;
 }
 function input(g,value,{immediate=false}={}){if(g.group==='payer'&&typeof value==='string'){const item=expenseModels(graph).find(i=>i.id===g.id);value={mode:value?'advance':'self',rows:value?[{user_id:value,amount:Math.round(Number((item?.budget||item?.paid)?.amount||0)),order:0}]:[],sequence:0};}if(g.local){if(!active)return;localDraft.refused=false;g.value=structuredClone(value);localDraft.values[g.group]=g.value;persistDraft();emit();clearTimeout(createTimer);createTimer=setTimeout(()=>void create(),1000);return;}if(g.conflict||g.releasing||!owns(g)&&g.state!=='pending')return;g.value=structuredClone(value);g.revision++;g.activity++;g.error=null;g.autoBlocked=false;persist(g);emit();clearTimeout(g.timer);g.timer=setTimeout(()=>void save(g,false),immediate?0:1000);}
 function body(g){if(['budget','paid'].includes(g.group))return {form:g.value,members:graph.members.filter(m=>m.status==='approved').map(m=>m.user_id).sort(),rates:graph.rates,planning:planning()};if(['payment','lifecycle'].includes(g.group))return {...g.value,planning:planning()};if(g.group==='payer'){if(!planning()&&g.value.mode==='advance'&&g.value.rows.length===1)return{user_id:g.value.rows[0].user_id};const item=expenseModels(graph).find(i=>i.id===g.id);return{planning:planning(),form:reconcilePayers(g.value,(item.budget||item.paid)?.amount),budget_revision:item.revisions.budget||0,paid_revision:item.revisions.paid||0};}if(g.group==='links')return{ids:g.value};return{text:g.value};}
 function save(g,flush=true){if(g.saveWork)return g.saveWork;clearTimeout(g.timer);
  if(g.local)return create();
  let confirmedRevision=null;
  g.saveWork=(async()=>{if(g.acquiring)await g.acquiring;if(!current()||g.conflict||g.composing)return false;if(!g.request&&!dirty(g))return true;if(!active&&!g.request)return false;
   if(!g.request){if(!owns(g))return false;
    if(g.group==='payer'&&!validPayers(g.value,graph.members))return false;
    if(['budget','paid'].includes(g.group)){if(!flush&&(g.value.pricing_mode==='custom'?g.value.participantIds.some(id=>String(g.value.shares[id]??'')===''):String(g.value.pricing_mode==='per_person'?g.value.unit_amount??'':g.value.amount??'')===''))return false;try{(g.group==='paid'?calculateActualPricing:calculatePricing)(g.value);}catch(error){report(g,error);return false;}}
    g.request={p_id:g.id,p_group:g.group,p_session_id:sessionId,p_token:g.token,p_epoch:g.epoch,p_base:g.base,p_value:body(g),p_request_id:makeId()};g.submitted=g.revision;
   }
   if(!(await service.authorized(actor)))return false;const request=g.request;g.saving=true;persist(g);emit();
   const transport=g.transport ||= service.mutate(request);const r=await bounded(transport);if(!r.error||r.error.code!=='METADATA_TIMEOUT')g.transport=null;
   if(!current())return false;g.saving=false;
   if(r.error){if(['PT409','22023','42501','55P03','55000'].includes(r.error.code)){g.request=null;g.state='lost';g.conflict=r.error.code==='PT409';g.autoBlocked=r.error.code!=='55P03';}report(g,r.error);return false;}
   const receipt=r.data;if(!receipt?.committed||receipt.request_id!==request.p_request_id||receipt.expense_id!==g.id||receipt.group!==g.group||receipt.revision!==request.p_base+1||receipt.item?.id!==g.id||receipt.item.trip_id!==trip||!Array.isArray(receipt.participants)||receipt.participants.some(p=>p.expense_id!==g.id)){report(g,new Error('儲存結果待確認，變更已保留。'));return false;}
   const receiptGraph={...graph,items:graph.items.map(i=>i.id===g.id?receipt.item:i),participants:[...graph.participants.filter(p=>p.expense_id!==g.id),...receipt.participants],
    links:g.group==='links'?[...graph.links.filter(l=>l.expense_id!==g.id),...request.p_value.ids.map(itinerary_item_id=>({expense_id:g.id,itinerary_item_id}))]:graph.links};
   confirmedRevision=g.submitted;g.base=receipt.revision;g.request=null;g.canonical=expenseFieldValue(receiptGraph,g.id,g.group);
   if(g.revision===g.submitted)g.value=structuredClone(g.canonical);persist(g);
   const after=await bounded(service.read(trip,sessionId));if(!current())return false;
   if(after.error){verified=false;report(g,after.error);return false;}
   // A confirmed receipt retires the submitted draft before installing the
   // canonical snapshot; subsequent typing remains buffered independently.
   g.conflict=false;g.error=null;ingest(after.data);onSnapshot(after.data);persist(g);
   if(dirty(g))return false;if(!g.focused)await release(g);return true;
  })().finally(()=>{g.saveWork=null;
   // A debounce can expire while this request is in flight. Once its receipt
   // is confirmed, drain later input even when the focused row was removed.
   if(confirmedRevision!==null&&g.revision>confirmedRevision&&dirty(g)&&owns(g)&&!g.request&&!g.error&&!g.autoBlocked&&!g.composing){clearTimeout(g.timer);g.timer=setTimeout(()=>void save(g,false),0);}
   emit();});return g.saveWork;
 }
 async function create(){if(createWork)return createWork;if(!active||localDraft?.refused)return false;if(!pendingCreate){const title=String(localDraft?.values.title||'').trim();if(!title)return !draftDirty();pendingCreate={p_trip_id:trip,p_id:localDraft.id,p_session_id:sessionId,p_request_id:makeId(),p_title:title};try{storage?.setItem(createKey,JSON.stringify(pendingCreate));}catch{/* In-memory retained. */}}
  createWork=(async()=>{if(!(await service.authorized(actor)))return false;const request=pendingCreate,r=await bounded(service.create(request));if(!current())return false;
   if(r.error||!r.data?.committed||r.data.request_id!==request.p_request_id||r.data.expense_id!==request.p_id){if(['22023','42501','PT409','55000','23505'].includes(r.error?.code)){pendingCreate=null;if(localDraft)localDraft.refused=true;try{storage?.removeItem(createKey);}catch{/* Retain local content. */}persistDraft();}onError(r.error||new Error('新增結果尚未確認，請保持連線。'));emit();return false;}
   if(!await refresh()||!graph.items.some(i=>i.id===request.p_id))return false;
   // Keep the same request until both its receipt and authoritative row are known.
   // Copy all later typing into the existing group editor, never into another item.
   if(localDraft?.id===request.p_id){for(const group of Object.keys(localDraft.values))get(localDraft.id,group);for(const g of fields.values())if(g.local){g.local=false;g.state='idle';g.base=0;g.epoch=null;g.token=null;g.activity=0;g.canonical=expenseFieldValue(graph,g.id,g.group);if(g.group==='title'&&String(g.value).trim()===request.p_title&&remote(g)?.revision===0)g.value=structuredClone(g.canonical);g.conflict=Boolean(remote(g)?.revision>0&&dirty(g));persist(g);}localDraft=null;persistDraft();}
   pendingCreate=null;try{storage?.removeItem(createKey);}catch{/* No credentials stored. */}for(const g of fields.values())if(g.id===request.p_id&&!g.conflict){if(g.focused){if(active)await focus(g);else{g.resumeFocus=true;g.focused=false;}}if(dirty(g)&&active){clearTimeout(g.timer);g.timer=setTimeout(()=>void save(g,false),1000);}}emit();return request.p_id;
  })().finally(()=>{createWork=null;emit();});return createWork;
 }
 async function finish(){if(localDraft&&!draftDirty()&&!pendingCreate){clearDraft();emit();}if((pendingCreate||localDraft)&&!await create())return false;for(const g of fields.values()){g.resumeFocus=false;if(g.saveWork)await g.saveWork;if(dirty(g)||g.request){if(!g.request&&!owns(g)&&!await focus(g))return false;if(!await save(g))return false;}if(!await release(g))return false;}return true;}
 async function discard(){if(pendingCreate||createWork)return false;clearDraft();for(const g of fields.values()){g.resumeFocus=false;if(g.request||g.saving)return false;if(!await release(g))return false;g.value=structuredClone(g.canonical);g.conflict=false;g.error=null;persist(g);}await refresh();emit();return true;}
 const client={attach(){const generation=++mountGeneration;return()=>queueMicrotask(()=>{if(generation===mountGeneration)client.dispose();});},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},getVersion:()=>version,get,ingest,refresh,focus,input,save,release,finish,discard,
  status:()=>({graph,verified,draftId:localDraft?.id,dirty:Boolean(pendingCreate)||draftDirty()||[...fields.values()].some(g=>!g.local&&(dirty(g)||g.request||g.saving)),pending:Boolean(pendingCreate)||[...fields.values()].some(g=>g.request||g.releasing)}),
  saveStatus(id){
   const relevant=[...fields.values()].filter(g=>g.id===id);
   if(relevant.some(g=>g.request&&g.error)||pendingCreate&&localDraft?.id===id)return '儲存結果待確認';
   if(relevant.some(g=>g.saving))return '儲存中…';
   if(relevant.some(g=>g.error||g.conflict))return '儲存失敗，變更已保留';
   if(!verified)return '連線待確認';
   if(localDraft?.id===id||relevant.some(g=>dirty(g)||g.request))return '尚未儲存';
   return '已儲存';
  },
  draftItem:()=>localDraft?{...newExpense({id:localDraft.id,tripId:trip,members:graph?.members||[]}),...Object.fromEntries(Object.entries(localDraft.values).filter(([k])=>['title','note','category'].includes(k)))}:null,
  begin(){if(localDraft)return localDraft.id;localDraft={id:makeId(),trip,values:{}};emit();return localDraft.id;},
  view:g=>({value:display(g),dirty:dirty(g),editable:g.local?active:owns(g)||g.state==='pending',remote:g.local?null:remote(g),busy:g.saving||g.state==='pending',conflict:g.conflict}),
  blur(g){g.focused=false;g.resumeFocus=false;if(g.local){if(String(localDraft?.values.title||'').trim())void create();return;}void(async()=>{if(g.acquiring)await g.acquiring;if(dirty(g)||g.request)await save(g);else await release(g);})();},
  async tick(){if(!current())return;if(!active){for(const g of fields.values())if(g.releasing&&!g.releaseWork&&!g.request&&!g.saving)await release(g);return;}await Promise.all([...fields.values()].filter(g=>!g.local).map(renew));if(!current()||!active||Date.now()-lastRecovery<5000)return;lastRecovery=Date.now();if((pendingCreate||localDraft)&&!createWork)await create();await refresh();for(const g of fields.values()){
   if(g.local)continue;if(g.releasing&&!g.releaseWork&&!g.request&&!g.saving)await release(g);
   if(g.request&&!g.saveWork)await save(g);
   if(!g.request&&!g.saveWork&&!g.conflict&&!g.autoBlocked&&g.state!=='held'&&dirty(g)&&!g.releasing&&!g.acquiring&&(!remote(g)?.held||remote(g)?.own_session)){const focused=g.focused;if(await focus(g)){g.focused=focused;await save(g);}}
  }},
  invalidate(){verified=false;emit();},
  suspend(){if(!active)return;active=false;verified=false;clearTimeout(createTimer);for(const g of fields.values()){if(g.local)continue;clearTimeout(g.timer);g.resumeFocus=g.focused;g.focused=false;persist(g);if(!g.request&&!g.saving)void release(g);}emit();},
  async resume(){active=true;if(!await refresh()||!active)return false;for(const g of fields.values())if(g.resumeFocus&&!g.request){g.resumeFocus=false;await focus(g);}return true;},
  create,
  async execute(id,group,value){const g=get(id,group);if(!await focus(g))return false;input(g,value);const ok=await save(g);if(ok)await release(g);return ok;},
  dispose(){disposed=true;clearTimeout(createTimer);for(const g of fields.values()){if(g.local)continue;clearTimeout(g.timer);persist(g);if(g.token&&g.epoch!==null&&!g.request)void service.lease(args(g,'release'));}listeners.clear();}
 };return client;
}
