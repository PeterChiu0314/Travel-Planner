import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {ChartColumn,Copy,List,Pencil,Plus,Search,SquareCheck,Trash2,X} from 'lucide-react';
import {createExpenseEditor,expenseGroupsConflict} from '../../lib/expenseEditor.js';
import {createExpenseService} from '../../lib/expenseTransport.js';
import {getBudgetMetadataSessionId} from '../../lib/budgetMetadataConfig.js';
import {expenseModels,expenseHistoricalMembers} from '../../lib/expenseSnapshot.js';
import {budgetStage,calculatePricing,calculateActualPricing,memberLabel,money} from '../../lib/budgetFinance.js';
import {pricingModeDraft,withoutBlankCustomShares} from '../../lib/budgetPricingGroups.js';
import {notify,isConnectionError} from '../../lib/notifications.js';
import BudgetPricingFields,{BudgetPricingSummary} from './BudgetPricingFields.jsx';
import BudgetCollaborationFrame from './BudgetCollaborationFrame.jsx';
import {Stats,PaymentToggle} from './ExpenseWorkspaceParts.jsx';
import ExpenseLinks from './ExpenseLinks.jsx';
import {expenseDisplayAllocations,expenseDisplayRows,ExpenseDetail,ExpenseTable} from './ExpensePresentation.jsx';
import MenuSelect from '../MenuSelect.jsx';
import {useSiteDialog} from '../SiteDialog.jsx';
import ExpenseRates from './ExpenseRates.jsx';
import ExpensePayers from './ExpensePayers.jsx';
import {createBudgetCollaboration} from '../../lib/budgetCollaboration.js';

function errorToast(error,group){
 if(isConnectionError(error)){notify.error(error);return;}
 const invalid=group==='links'?'部分行程已無法關聯，變更已保留。':'請確認金額、付款人與參與成員是否完整。';
 const conflict=group==='links'&&/itinerary/i.test(error.message||'')?'行程已變更，請重新選取受影響的行程。未儲存的關聯已保留。'
  :'內容已更新，未儲存的變更已保留；離開時可選擇不儲存。';
 const message=error.code==='PT409'?conflict
  :error.code==='55P03'?'暫時無法儲存，變更已保留，系統會重新確認。':error.code==='22023'?invalid:error;
 notify.error(message,{id:'budget-editor-error'});
}
const isPricingModeButton=target=>Boolean(target?.closest('.bw-modes button'));
function Pricing({client,field,view,members,scope,rates,locked,canChooseMode,showModeLegend=true,showSummary=true,planningIntegers=false,pricingHeading,currentUserId,storedBundle}){
 const [open,setOpen]=useState(false),custom=useRef(null);const form=view.value;let pricing;
 const previewForm=view.dirty?withoutBlankCustomShares(form):form;
 try{pricing=scope==='paid'?calculateActualPricing(previewForm):calculatePricing(previewForm,{wholeOriginal:planningIntegers&&(view.dirty||form.original_scale===0)});}catch{/* Incomplete input stays a local draft. */}
 const setForm=(value,options)=>client.input(field,value,options);
 async function changeMode(mode){
  if(client.view(field).value.pricing_mode===mode){
   if(field.focused)client.blur(field);
   return;
  }
  if(!await client.focus(field,{retainFocus:false}))return;
  const {value,dirty}=client.view(field);
  const ready=dirty?withoutBlankCustomShares(value):value;
  const current=ready.participantIds.length?ready:value;
  if(current.pricing_mode==='custom')custom.current={...current.shares};
  setForm(pricingModeDraft(current,mode,custom.current,{wholeOriginal:planningIntegers}));
  if(mode==='custom'||current.pricing_mode==='custom')setOpen(mode==='custom');
 }
 const allocations = showSummary ? (view.dirty ? pricing?.allocations : expenseDisplayAllocations(storedBundle)) : null;
 return <><BudgetPricingFields form={form} pricing={pricing} members={members} locked={locked} modeLocked={!canChooseMode} modeBusy={Boolean(field.request||field.releasing)} showModeLegend={showModeLegend} showSummary={showSummary} personalAmount={allocations?.[currentUserId]??null} requestParticipantForm={async()=>(client.view(field).editable||await client.focus(field))?client.view(field).value:null} historical={false} tripRates={rates}
  update={(key,value,options)=>setForm({...form,[key]:value},options)} setForm={setForm} membersOpen={open} setMembersOpen={setOpen} changeMode={changeMode} groupMode editRate={scope==='paid'}
  planningIntegers={planningIntegers} finishAmountInput={()=>client.finishAmountInput(field)} pricingHeading={pricingHeading} />
  {scope==='paid'?<fieldset className="bw-cost-source"><legend>台幣金額</legend><div><button type="button" disabled={locked} aria-pressed={form.twd_amount_source==='estimated'} onClick={()=>setForm({...form,twd_amount_source:'estimated',actual_twd_amount:''})}>依匯率估算</button><button type="button" disabled={locked} aria-pressed={form.twd_amount_source==='actual'} onClick={()=>setForm({...form,twd_amount_source:'actual',actual_twd_amount:pricing?.twd_amount??''})}>實際扣款</button></div>
   {form.twd_amount_source==='actual'?<label>實際台幣扣款<input type="number" autoComplete="off" min="0" step="1" readOnly={locked} value={form.actual_twd_amount} onChange={e=>setForm({...form,actual_twd_amount:e.target.value})}/></label>:null}
  </fieldset>:null}</>;
}
function PlanningSummary({view:{value:form,dirty},storedBundle,currentUserId}){
 let pricing;try{pricing=calculatePricing(dirty?withoutBlankCustomShares(form):form,{wholeOriginal:dirty||form.original_scale===0});}catch{/* Incomplete input stays a local draft. */}
 const allocations = dirty ? pricing?.allocations : expenseDisplayAllocations(storedBundle);
 return <BudgetPricingSummary form={form} pricing={pricing} showOriginalPrecision keepVisible storedAmount={storedBundle?.amount} personalAmount={allocations?.[currentUserId]??null}/>;
}
export default function ExpenseWorkspace(props){
 const propsRef=useRef(props);propsRef.current=props;
 const titleInput=useRef(null);
 const transport=useMemo(()=>props.expenseService||createExpenseService(props.supabase),[props.expenseService,props.supabase]);
 const sessionId=props.demo?'demo-session':getBudgetMetadataSessionId(),storage=props.demo?null:sessionStorage;
 const client=useMemo(()=>{return createExpenseEditor({service:{...transport,read:async(trip,session)=>{const current=propsRef.current;if(current.demo)return transport.read(trip,session);if(current.activeTrip.id!==trip||current.currentUserId!==props.currentUserId)return{error:new Error('旅程已切換，變更已保留。')};const r=await current.onRefreshBudget(trip);return r.ok?{data:r.data.expenseGraph}:{error:r.error||new Error('資料尚未同步，變更已保留。')};}},
  actor:props.currentUserId,trip:props.activeTrip.id,sessionId,storage,planning:()=> (propsRef.current.demoStage||budgetStage(propsRef.current.activeTrip))==='planning',onError:errorToast,onSnapshot:data=>propsRef.current.onExpenseSnapshot?.(data)});},[transport,props.currentUserId,props.activeTrip.id,sessionId,storage]);
 const planning=(props.demoStage||budgetStage(props.activeTrip))==='planning';
 const version=useSyncExternalStore(client.subscribe,client.getVersion),[selected,setSelected]=useState(()=>client.status().draftId||null),[view,setView]=useState(()=>planning?'budget':'paid'),[query,setQuery]=useState('');
 const [panel,setPanel]=useState(()=>client.status().draftId?'edit':'stats'),[paymentFilter,setPaymentFilter]=useState(''),[collapsed,setCollapsed]=useState([]),[viewpoint,setViewpoint]=useState(props.currentUserId),panelChosen=useRef(false),adding=useRef(false);
 const [collaborators,setCollaborators]=useState([]);
 const [checked,setChecked]=useState(null),[actionBusy,setActionBusy]=useState(false),actionRunning=useRef(false),actionDone=useRef(null);
 const workspaceActive=props.workspaceActive??props.restoreDrafts!==false;
 const approvedActor=(props.metadataSnapshot?.expenseGraph?.members||props.members||[]).some(m=>m.user_id===props.currentUserId&&m.status==='approved');
 const collaboration=useMemo(()=>props.demo?null:createBudgetCollaboration({supabase:props.supabase,sessionId,onChange:setCollaborators,
  protocol:{read:'read_expense_collaboration',write:'update_expense_selection',signals:'expense_signals',channel:'expense-collaboration',selectionProtocol:2}}),[props.demo,props.supabase,sessionId]);
 const {ask,dialog}=useSiteDialog();
 useEffect(()=>{setSelected(client.status().draftId||null);setPanel(client.status().draftId?'edit':'stats');setChecked(null);},[client]);
 useEffect(()=>{setView(planning?'budget':'paid');setChecked(null);},[planning]);
 const snapshot=props.metadataSnapshot;
 const unavailableWithoutGraph=snapshot?.expenseUnavailable&&!snapshot.expenseGraph;
 useEffect(()=>{
  if(props.demo&&client.status().graph)return;
  if(snapshot?.expenseGraph)client.ingest(snapshot.expenseGraph,{authoritative:snapshot.expenseVerified!==false});
  else if(unavailableWithoutGraph)client.invalidate();
 },[client,snapshot,props.demo,unavailableWithoutGraph]);
 useEffect(()=>{const detach=client.attach(),timer=setInterval(()=>void client.tick(),1000);return()=>{clearInterval(timer);detach();};},[client]);
 useEffect(()=>{void collaboration?.configure(props.currentUserId,props.activeTrip.id,workspaceActive&&approvedActor);},[collaboration,props.currentUserId,props.activeTrip.id,workspaceActive,approvedActor]);
 useEffect(()=>()=>{void collaboration?.dispose();},[collaboration]);
 useEffect(()=>{
  const reconcile=event=>{if(!workspaceActive||event?.type==='offline'||document.visibilityState==='hidden'||navigator.onLine===false){client.suspend();collaboration?.hide();}else{void client.resume();collaboration?.reconcile();}};
  reconcile();window.addEventListener('offline',reconcile);window.addEventListener('online',reconcile);window.addEventListener('focus',reconcile);document.addEventListener('visibilitychange',reconcile);
  return()=>{window.removeEventListener('offline',reconcile);window.removeEventListener('online',reconcile);window.removeEventListener('focus',reconcile);document.removeEventListener('visibilitychange',reconcile);};
 },[client,collaboration,workspaceActive]);
 const state=client.status(),graph=unavailableWithoutGraph?null:state.graph;
 const selectedExists=Boolean(graph?.items.some(i=>i.id===selected));
 useEffect(()=>{if(workspaceActive)collaboration?.select(selectedExists?{kind:'expense',id:selected,tripId:props.activeTrip.id,userId:props.currentUserId}:null);},[collaboration,workspaceActive,selected,selectedExists,props.activeTrip.id,props.currentUserId]);
 props.services.useGuard(`expense-workspace:${props.currentUserId}:${props.activeTrip.id}`,{tripId:props.activeTrip.id,workspace:'budget'},
  useMemo(()=>{
   const finish=async()=>{await actionDone.current;return client.finish();};
   return {isActive:true,readState:()=>{const state=client.guardState();return {...state,isPending:state.isPending||Boolean(actionDone.current)};},cleanupInWorkspaceOnly:true,prepareFinishes:true,
    prepare:finish,finish,save:finish,discard:()=>actionDone.current?false:client.discard(),
    focusMissingExpenseTitle:()=>titleInput.current?.focus()};
  },[client,version]));
 if (!graph) return props.metadataSnapshot?.expenseUnavailable
  ? <div role="status"><p className="bw-muted">目前無法讀取支出，草稿已保留。</p><button type="button" className="ghost-button" onClick={() => void props.onRefreshBudget(props.activeTrip.id)}>重新讀取支出</button></div>
  : <p className="bw-muted" role="status">讀取支出項目…</p>;
 const models=expenseModels(graph),item=client.draftItem()?.id===selected?client.draftItem():models.find(i=>i.id===selected),members=graph.members||[],approved=members.filter(m=>m.status==='approved');
 const historical=expenseHistoricalMembers(graph).map(member=>({...member,display_name:`${member.display_name}（已退出）`}));
 const expenseMembers=[...approved,...historical];
 const editable=props.canEdit&&snapshot?.expenseVerified!==false&&state.verified&&navigator.onLine!==false;
 const handoffBudget=()=>props.services.handoff({tripId:props.activeTrip.id,workspace:'budget'});
 async function handoff(action){if(await handoffBudget())action();}
 async function add(){if(adding.current||actionRunning.current)return;adding.current=true;try{if(client.status().draftId){setSelected(client.status().draftId);setPanel('edit');return;}if(!await handoffBudget()||actionRunning.current)return;setSelected(client.begin());setPanel('edit');}finally{adding.current=false;}}
 async function payment(){if(actionRunning.current||!await handoffBudget()||actionRunning.current)return;const current=client.status().graph,model=expenseModels(current).find(i=>i.id===selected);if(!model)return;
  const ok=await client.execute(model.id,'payment',{action:model.payment_state==='paid'?'unpaid':'paid',paid_at:new Date().toISOString(),budget_revision:model.revisions.budget||0,paid_revision:model.revisions.paid||0,payer_revision:model.revisions.payer||0});if(!ok)void client.refresh();}
 async function runAction(action,targets,batch=false){
  if(!editable||actionRunning.current||!targets.length)return;
  actionRunning.current=true;
  let done;
  try{
   if(!await handoffBudget())return;
   if(action==='delete'&&!await ask({
    title:batch?`刪除 ${targets.length} 筆支出項目？`:'刪除支出項目？',
    message:batch?'所選項目將不再計入預算與結算。':`「${targets[0].title||'未命名項目'}」將不再計入預算與結算。`,
    confirmLabel:'刪除',danger:true
   }))return;
   actionDone.current=new Promise(resolve=>{done=resolve;});
   setActionBusy(true);
   const succeeded=new Set(),failed=[],unconfirmed=[];
   for(const target of targets){
    let outcome;
    try{
     if(action==='copy')outcome=await client.copyExpense(target.id);
     else if(await client.execute(target.id,'lifecycle',{action:'delete'}))outcome='success';
     else outcome=client.get(target.id,'lifecycle').request?'unconfirmed':'failed';
    }catch{outcome='unconfirmed';}
    if(outcome==='success')succeeded.add(target.id);
    else (outcome==='unconfirmed'?unconfirmed:failed).push(target.title||'未命名項目');
   }
   if(action==='copy'||failed.length||unconfirmed.length)await client.refresh();
   if(action==='delete'&&succeeded.has(selected)){setSelected(null);setPanel('stats');}
   if(batch)setChecked(current=>current&&new Set([...current].filter(id=>!succeeded.has(id))));
   const label=action==='copy'?'複製':'刪除';
   const summary=[succeeded.size?`已${label} ${succeeded.size} 筆`:null,failed.length?`失敗 ${failed.length} 筆`:null,unconfirmed.length?`待確認 ${unconfirmed.length} 筆`:null].filter(Boolean).join('，');
   if(failed.length||unconfirmed.length){
    const description=[failed.length?`失敗：${failed.join('、')}`:null,unconfirmed.length?`待確認：${unconfirmed.join('、')}`:null].filter(Boolean).join('；');
    notify.error(summary,{description});
   }else notify.success(summary,{description:action==='copy'&&(actual||paymentFilter==='paid')?'副本已新增至預算，狀態為未付款。':undefined});
  }finally{actionRunning.current=false;actionDone.current=null;done?.();setActionBusy(false);}
 }
 const groupOwner=group=>collaborators.find(e=>e.kind==='expense'&&e.resource_id===item.id&&expenseGroupsConflict(group,e.group_key)&&e.mode==='edit')?.user_id||client.peerOwner(item.id,group);
 const ownerName=owner=>memberLabel(members.find(member=>member.user_id===owner));
 function frame(group,label,render){const field=client.get(item.id,group),v=client.view(field),owner=groupOwner(group);
  const locked=!editable||actionBusy||!v.editable||Boolean(owner);
  const isPricing=group==='budget'||group==='paid';
  const compactSpacing=planning&&(group==='category'||group==='note');
  return <BudgetCollaborationFrame key={group} role="group" aria-label={label} tabIndex={0} label={label} ownerId={owner} ownerName={ownerName(owner)}
   className={`${owner?'is-peer-held':locked?'is-unclaimed':''}${isPricing?' bw-pricing-group':''}${compactSpacing?' bw-compact-metadata':''}`}
   onPointerDownCapture={e=>{if(editable&&!actionBusy&&!owner&&!isPricingModeButton(e.target))void client.focus(field);}}
   onFocusCapture={e=>{if(editable&&!actionBusy&&!isPricingModeButton(e.target)&&(!isPricing||e.target!==e.currentTarget))void client.focus(field);}}
   onBlur={e=>{if(isPricingModeButton(e.target)&&!field.focused)return;if(!e.currentTarget.contains(e.relatedTarget)&&!e.relatedTarget?.closest('[data-budget-metadata-portal]'))client.blur(field);}}
   onCompositionStart={()=>{field.composing=true;}} onCompositionEnd={()=>{field.composing=false;client.input(field,field.value);}}>
   {!(planning&&isPricing)&&<label>{label}</label>}{render({field,v,locked,canChooseMode:editable&&!actionBusy&&!owner&&state.verified&&!v.conflict&&(isPricing||!field.request&&!field.releasing),set:value=>client.input(field,value)})}
  </BudgetCollaborationFrame>;
 }
 function linksEditor(){
  const owner=groupOwner('links');
  return <ExpenseLinks key={item.id} client={client} field={client.get(item.id,'links')} trip={props.activeTrip}
   items={graph.itineraryItems||[]} enabled={editable&&workspaceActive&&!actionBusy} owner={owner} ownerName={ownerName(owner)}/>;
 }
 const actual=view==='paid',pricingLabel=actual?'實付計價與分攤':'預算計價與分攤',rows=expenseDisplayRows(models.filter(i=>!actual||i.paid&&i.payment_state==='paid'||i.payment_state==='draft'),view);
 const links=graph.links.map(l=>({budget_item_id:l.expense_id,itinerary_item_id:l.itinerary_item_id}));
 const displayRows=rows.filter(i=>(!paymentFilter||(i.payment_state==='paid')===(paymentFilter==='paid'))&&`${i.title} ${i.category} ${i.note}`.toLowerCase().includes(query.toLowerCase()));
 const multi=checked!==null,visibleRows=displayRows.filter(row=>!collapsed.includes(row.category)),targets=visibleRows.filter(row=>checked?.has(row.id));
 const clearChecked=()=>setChecked(current=>current&&new Set());
 const toggleChecked=id=>{if(!actionRunning.current)setChecked(current=>{if(!current)return current;const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});};
 const toggleAll=()=>{if(!actionRunning.current)setChecked(new Set(targets.length===visibleRows.length?[]:visibleRows.map(row=>row.id)));};
 const toggleGroup=category=>{
  if(actionRunning.current)return;
  const group=visibleRows.filter(row=>row.category===category);
  setChecked(current=>{
   if(!current)return current;
   const next=new Set(current);
   const allSelected=group.every(row=>current.has(row.id));
   for(const {id} of group){
    if(allSelected)next.delete(id);
    else next.add(id);
   }
   return next;
  });
 };
 const changeCollapsed=update=>{
  if(actionRunning.current)return;
  void handoff(()=>{const next=update(collapsed);setCollapsed(next);setChecked(current=>current&&new Set(displayRows.filter(row=>!next.includes(row.category)&&current.has(row.id)).map(row=>row.id)));});
 };
 const select=id=>void handoff(()=>{setSelected(selected===id?null:id);if(!panelChosen.current&&panel!=='edit')setPanel('detail');});
 const close=()=>void handoff(()=>{setPanel('detail');if(!client.status().graph.items.some(i=>i.id===selected))setSelected(null);});
 const changePanel=key=>void handoff(()=>{panelChosen.current=true;setPanel(key);});
 const participantsRequired=item?.payment_state!=='paid'&&Boolean(item?.budget?.requires_participants
  ||item?.budget?.participantIds.some(id=>historical.some(member=>member.user_id===id)));
 const payerRequired=item?.payment_state!=='paid'&&item?.payment_mode==='advance'&&(
  !item.payer_id&&!item.payer_allocations?.length||historical.some(member=>member.user_id===item.payer_id
    ||item.payer_allocations?.some(payer=>payer.user_id===member.user_id)));
 const paymentDisabled=!editable||!item||Boolean(item&&(client.peerOwner(item.id,'payment')||collaborators.some(e=>e.kind==='expense'&&e.resource_id===item.id&&e.mode==='edit'&&expenseGroupsConflict('payment',e.group_key))))||item.payment_state!=='paid'&&(participantsRequired||payerRequired||!item.title.trim()||!item.paid&&!item.budget);
 return <section className="budget-panel budget-workspace" aria-label="支出工作區">{dialog}
  <div className="bw-main bw-expense-main"><div className={`bw-toolbar bw-expense-toolbar${multi?' is-multi':''}`}>{!planning?<div className="bw-tabs" role="tablist" aria-label="費用資料檢視">{[['budget','預算'],['paid','實付']].map(([key,label])=><button type="button" role="tab" key={key} disabled={actionBusy} aria-selected={view===key} onClick={()=>void handoff(()=>{setView(key);clearChecked();})}>{label}</button>)}</div>:null}
   <div className="bw-filters"><label><Search size={15}/><input aria-label="搜尋項目" placeholder="搜尋項目" autoComplete="off" value={query} disabled={actionBusy} onChange={e=>{setQuery(e.target.value);clearChecked();}}/></label><MenuSelect label="付款篩選" value={paymentFilter} disabled={actionBusy} onValueChange={value=>{setPaymentFilter(value);clearChecked();}} options={[{value:'',label:'全部項目'},{value:'unpaid',label:'未付款'},{value:'paid',label:'已付款'}]}/>{!multi&&<span>{displayRows.length} 筆</span>}</div>
   {multi?<div className="bw-batch-actions" role="group" aria-label="多選工具" aria-busy={actionBusy}>
    <span aria-live="polite">已選 {targets.length} 筆</span>
    <button type="button" className="bw-action-icon" aria-label="複製所選項目" title="複製所選項目" disabled={!editable||actionBusy||!targets.length} onClick={()=>void runAction('copy',targets,true)}><Copy size={17}/></button>
    <button type="button" className="bw-action-icon is-danger" aria-label="刪除所選項目" title="刪除所選項目" disabled={!editable||actionBusy||!targets.length} onClick={()=>void runAction('delete',targets,true)}><Trash2 size={17}/></button>
    <button type="button" className="bw-action-icon bw-batch-close" aria-label="關閉多選" title="關閉多選" disabled={actionBusy} onClick={()=>setChecked(null)}><X size={18}/></button>
   </div>:<div className="bw-batch-actions">
    <button type="button" className="bw-multi-trigger" disabled={!editable||actionBusy||!displayRows.length} onClick={()=>void handoff(()=>setChecked(new Set()))}><SquareCheck size={15}/>多選</button>
    <button type="button" className="primary-button compact bw-add" disabled={!editable||actionBusy} onClick={()=>void add()}><Plus size={15}/>新增項目</button>
   </div>}</div>
   <ExpenseTable rows={displayRows} members={approved} links={links} items={graph.itineraryItems||[]} collaborators={collaborators} selected={multi?null:selected} collapsed={collapsed} setCollapsed={changeCollapsed} currentUserId={props.currentUserId} actual={actual} onSelect={multi?toggleChecked:select}
    ordering={{graph,active:workspaceActive,enabled:workspaceActive&&editable&&Boolean(graph.ordering)&&!query&&!paymentFilter&&!multi&&!actionBusy,
     unfiltered:!query&&!paymentFilter&&!multi,viewKey:view,service:transport,actor:props.currentUserId,session:sessionId,storage,refresh:client.refreshAfterMutation}}
    checked={checked} visibleCount={visibleRows.length} checkedCount={targets.length} onToggleAll={toggleAll} onToggleGroup={toggleGroup} actionBusy={actionBusy} canRemove={editable} onRemove={row=>void runAction('delete',[row])}/>
  </div>
  <aside className="bw-side"><div className="bw-side-tabs" role="tablist" aria-label="右側面板">{[['stats','旅程統計',ChartColumn],['detail','項目明細',List],['edit','編輯項目',Pencil]].map(([key,label,Icon])=><button key={key} role="tab" type="button" aria-label={label} aria-selected={panel===key} onClick={()=>changePanel(key)}><Icon size={14} strokeWidth={1.8}/><span>{label}</span></button>)}</div>
  <div hidden={panel!=='stats'}><Stats records={rows} members={approved} actual={actual} budgets={rows} viewpoint={viewpoint} setViewpoint={setViewpoint} ratesSummary={<span/>}/><div className="bw-restored-rates" hidden={actual}><ExpenseRates service={transport} client={client} actor={props.currentUserId} trip={props.activeTrip.id} sessionId={sessionId} storage={storage} onError={errorToast} services={props.services} editable={editable} planning={planning&&Boolean(props.activeTrip.start_date)} active={workspaceActive}/></div></div>
  {panel==='detail'?(item?<ExpenseDetail item={item} scope={view} planning={planning} currentUserId={props.currentUserId} members={expenseMembers} links={links} items={graph.itineraryItems||[]} editable={editable&&!actionBusy} participantsRequired={participantsRequired} payerRequired={payerRequired} paymentDisabled={paymentDisabled||actionBusy} onRemove={()=>void runAction('delete',[item])} onPayment={()=>{if(!paymentDisabled&&!actionBusy)void payment();}}/>:<div className="bw-empty">選取項目查看明細</div>):null}
  {panel==='edit'&&item?<section className={`bw-editor bw-metadata-editor bw-native-panel${planning?' is-planning':''}`} aria-label="支出項目編輯">
   {participantsRequired&&<p className="bw-warning">請重新指定參與者，再標記已付款。</p>}
   {payerRequired&&<p className="bw-warning">請重新指定付款人，再標記已付款。</p>}
   {planning?<PlanningSummary view={client.view(client.get(item.id,'budget'))} storedBundle={item.budget} currentUserId={props.currentUserId}/>:null}
   {frame('title','項目名稱',({v,locked,set})=><input ref={titleInput} aria-label="項目名稱" autoComplete="off" value={v.value} readOnly={locked} onChange={e=>set(e.target.value)}/>)}
   {frame('category','分類',({v,locked,set})=><MenuSelect label="分類" value={v.value} editable inputProps={{autoComplete:'off'}} readOnly={locked} metadataPortal onValueChange={set} options={['機票','交通','住宿','門票','餐飲','購物','其他'].map(value=>({value,label:value}))}/>)}
   {frame('note','備註',({v,locked,set})=><textarea aria-label="備註" autoComplete="off" value={v.value||''} rows={3} readOnly={locked} onChange={e=>set(e.target.value)}/>)}

   {!planning&&linksEditor()}
   {frame(view,pricingLabel,({field,v,locked,canChooseMode})=><Pricing key={field.id} client={client} field={field} view={v} scope={view} members={expenseMembers} rates={graph.rates} locked={locked} canChooseMode={canChooseMode} showModeLegend={!planning} showSummary={!planning} planningIntegers={planning&&view==='budget'} pricingHeading={planning?'金額與分攤':undefined} storedBundle={item[view]} currentUserId={props.currentUserId}/>)}
   {frame('payer','付款方式',({field,v,locked,canChooseMode})=>planning?<ExpensePayers client={client} field={field} view={v} members={approved} historical={historical} total={(item.budget||item.paid)?.amount??0} currency={(item.budget||item.paid)?.currency||'TWD'} locked={locked} canChooseMode={canChooseMode}/>:v.value.rows.length<=1?<MenuSelect label="付款人" value={v.value.rows[0]?.user_id||''} readOnly={locked} metadataPortal onValueChange={value=>client.input(field,value)} options={[{value:'',label:'未指定'},...historical.filter(m=>m.user_id===v.value.rows[0]?.user_id).map(m=>({value:m.user_id,label:memberLabel(m),disabled:true})),...approved.map(m=>({value:m.user_id,label:memberLabel(m)}))]}/>:<p>{v.value.mode==='self'?'各自付':v.value.rows.map(r=>memberLabel(expenseMembers.find(m=>m.user_id===r.user_id))).join('、')}</p>)}
   {!planning?<div className="bw-metadata-summary"><span>分類 · {item.category}</span><span>金額 · {item[view]?`${item[view].currency} ${money(item[view].amount)}`:'尚未填寫'}</span></div>:null}
   {!planning?<details className="bw-secondary-fields"><summary>{actual?'預算金額與分攤':'實付金額與分攤'}</summary>{frame(actual?'budget':'paid',actual?'預算計價與分攤':'實付計價與分攤',({field,v,locked,canChooseMode})=><Pricing key={field.id} client={client} field={field} view={v} scope={actual?'budget':'paid'} storedBundle={item[actual?'budget':'paid']} currentUserId={props.currentUserId} members={expenseMembers} rates={graph.rates} locked={locked} canChooseMode={canChooseMode}/>)}</details>:null}
   {planning&&linksEditor()}
   <div className="bw-editor-actions bw-side-footer">{planning?<><PaymentToggle checked={item.payment_state==='paid'} disabled={paymentDisabled} onChange={()=>void payment()}/><span className="bw-save-state" role="status" aria-label="儲存狀態">{client.saveStatus(item.id)}</span></>:<><button type="button" className="ghost-button compact" disabled={paymentDisabled} onClick={()=>void payment()}>{item.payment_state==='paid'?'改為未付款':'標記已付款'}</button><button type="button" className="ghost-button compact" onClick={close}>取消</button><button type="button" className="primary-button compact" disabled={!editable} onClick={close}>完成</button></>}</div>
  </section>:panel==='edit'?<div className="bw-empty">選取項目開始編輯</div>:null}</aside>
 </section>;
}
