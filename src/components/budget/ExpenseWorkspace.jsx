import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {ChartColumn,List,Pencil,Plus,Search} from 'lucide-react';
import {createExpenseEditor} from '../../lib/expenseEditor.js';
import {createExpenseService} from '../../lib/expenseTransport.js';
import {getBudgetMetadataSessionId} from '../../lib/budgetMetadataConfig.js';
import {expenseModels} from '../../lib/expenseSnapshot.js';
import {budgetStage,calculatePricing,calculateActualPricing,memberLabel,money} from '../../lib/budgetFinance.js';
import {pricingModeDraft} from '../../lib/budgetPricingGroups.js';
import {notify,isConnectionError} from '../../lib/notifications.js';
import BudgetPricingFields from './BudgetPricingFields.jsx';
import BudgetCollaborationFrame from './BudgetCollaborationFrame.jsx';
import {ItineraryPicker,Stats,PaymentToggle} from './BudgetWorkspace.jsx';
import {displayParticipants,expenseDisplayRows,ExpenseDetail,ExpenseTable} from './ExpensePresentation.jsx';
import MenuSelect from '../MenuSelect.jsx';
import {useSiteDialog} from '../SiteDialog.jsx';
import ExpenseRates from './ExpenseRates.jsx';
import ExpensePayers from './ExpensePayers.jsx';
import {createBudgetCollaboration} from '../../lib/budgetCollaboration.js';

function errorToast(error){if(isConnectionError(error))notify.error(error);else notify.error(error.code==='PT409'?'內容已更新，未儲存的變更已保留；離開時可選擇不儲存。':error.code==='55P03'?'暫時無法儲存，變更已保留，系統會重新確認。':error.code==='22023'?'請確認金額、付款人與參與成員是否完整。':error,{id:'budget-editor-error'});}
function Pricing({client,field,view,members,scope,rates,locked,canChooseMode}){
 const [open,setOpen]=useState(false),custom=useRef(null);const form=view.value;let pricing;
 try{pricing=(scope==='paid'?calculateActualPricing:calculatePricing)(form);}catch{/* Incomplete input stays a local draft. */}
 const setForm=value=>client.input(field,value);
 const changeMode=async mode=>{if(!await client.focus(field))return;const current=client.view(field).value;if(current.pricing_mode==='custom')custom.current={...current.shares};setForm(pricingModeDraft(current,mode,custom.current));if(mode==='custom')setOpen(true);};
 return <><BudgetPricingFields form={form} pricing={pricing} members={members} locked={locked} modeLocked={!canChooseMode} historical={false} tripRates={rates}
  update={(key,value)=>setForm({...form,[key]:value})} setForm={setForm} membersOpen={open} setMembersOpen={setOpen} changeMode={changeMode} groupMode editRate={scope==='paid'} />
  {scope==='paid'?<fieldset className="bw-cost-source"><legend>台幣金額</legend><div><button type="button" disabled={locked} aria-pressed={form.twd_amount_source==='estimated'} onClick={()=>setForm({...form,twd_amount_source:'estimated',actual_twd_amount:''})}>依匯率估算</button><button type="button" disabled={locked} aria-pressed={form.twd_amount_source==='actual'} onClick={()=>setForm({...form,twd_amount_source:'actual',actual_twd_amount:pricing?.twd_amount??''})}>實際扣款</button></div>
   {form.twd_amount_source==='actual'?<label>實際台幣扣款<input type="number" min="0" step="1" readOnly={locked} value={form.actual_twd_amount} onChange={e=>setForm({...form,actual_twd_amount:e.target.value})}/></label>:null}
  </fieldset>:null}</>;
}
export default function ExpenseWorkspace(props){
 const propsRef=useRef(props);propsRef.current=props;
 const transport=useMemo(()=>props.expenseService||createExpenseService(props.supabase),[props.expenseService,props.supabase]);
 const sessionId=props.demo?'demo-session':getBudgetMetadataSessionId(),storage=props.demo?null:sessionStorage;
 const client=useMemo(()=>{return createExpenseEditor({service:{...transport,read:async(trip,session)=>{if(propsRef.current.demo)return transport.read(trip,session);const r=await propsRef.current.onRefreshBudget(propsRef.current.activeTrip.id);return r.ok?{data:r.data.expenseGraph}:{error:r.error||new Error('資料尚未同步，變更已保留。')};}},
  actor:props.currentUserId,trip:props.activeTrip.id,sessionId,storage,planning:()=> (propsRef.current.demoStage||budgetStage(propsRef.current.activeTrip))==='planning',onError:errorToast,onSnapshot:data=>propsRef.current.onExpenseSnapshot?.(data)});},[transport,props.currentUserId,props.activeTrip.id,sessionId,storage]);
 const planning=(props.demoStage||budgetStage(props.activeTrip))==='planning';
 const version=useSyncExternalStore(client.subscribe,client.getVersion),[selected,setSelected]=useState(()=>client.status().draftId||null),[view,setView]=useState(()=>planning?'budget':'paid'),[query,setQuery]=useState('');
 const [panel,setPanel]=useState(()=>client.status().draftId?'edit':'stats'),[paymentFilter,setPaymentFilter]=useState(''),[collapsed,setCollapsed]=useState([]),[viewpoint,setViewpoint]=useState('average'),panelChosen=useRef(false),adding=useRef(false);
 const [collaborators,setCollaborators]=useState([]);
 const workspaceActive=props.workspaceActive??props.restoreDrafts!==false;
 const approvedActor=(props.metadataSnapshot?.expenseGraph?.members||props.members||[]).some(m=>m.user_id===props.currentUserId&&m.status==='approved');
 const collaboration=useMemo(()=>props.demo?null:createBudgetCollaboration({supabase:props.supabase,sessionId,onChange:setCollaborators,
  protocol:{read:'read_expense_collaboration',write:'update_expense_selection',signals:'expense_signals',channel:'expense-collaboration',selectionProtocol:2}}),[props.demo,props.supabase,sessionId]);
 const {ask,dialog}=useSiteDialog();
 useEffect(()=>{setSelected(client.status().draftId||null);setPanel(client.status().draftId?'edit':'stats');},[client]);
 useEffect(()=>{setView(planning?'budget':'paid');},[planning]);
 useEffect(()=>{if(props.demo&&client.status().graph)return;if(props.metadataSnapshot?.expenseGraph)client.ingest(props.metadataSnapshot.expenseGraph,{authoritative:props.metadataSnapshot.expenseVerified!==false});},[client,props.metadataSnapshot,props.demo]);
 useEffect(()=>{const detach=client.attach(),timer=setInterval(()=>void client.tick(),1000);return()=>{clearInterval(timer);detach();};},[client]);
 useEffect(()=>{void collaboration?.configure(props.currentUserId,props.activeTrip.id,workspaceActive&&approvedActor);},[collaboration,props.currentUserId,props.activeTrip.id,workspaceActive,approvedActor]);
 useEffect(()=>()=>{void collaboration?.dispose();},[collaboration]);
 useEffect(()=>{
  const reconcile=event=>{if(!workspaceActive||event?.type==='offline'||document.visibilityState==='hidden'||navigator.onLine===false){client.suspend();collaboration?.hide();}else{void client.resume();collaboration?.reconcile();}};
  reconcile();window.addEventListener('offline',reconcile);window.addEventListener('online',reconcile);window.addEventListener('focus',reconcile);document.addEventListener('visibilitychange',reconcile);
  return()=>{window.removeEventListener('offline',reconcile);window.removeEventListener('online',reconcile);window.removeEventListener('focus',reconcile);document.removeEventListener('visibilitychange',reconcile);};
 },[client,collaboration,workspaceActive]);
 const state=client.status(),graph=state.graph;
 const selectedExists=Boolean(graph?.items.some(i=>i.id===selected));
 useEffect(()=>{if(workspaceActive)collaboration?.select(selectedExists?{kind:'expense',id:selected,tripId:props.activeTrip.id,userId:props.currentUserId}:null);},[collaboration,workspaceActive,selected,selectedExists,props.activeTrip.id,props.currentUserId]);
 props.services.useGuard(`expense-workspace:${props.currentUserId}:${props.activeTrip.id}`,useMemo(()=>({isActive:true,isDirty:state.dirty||state.pending,
  prepare:()=>client.finish(),finish:()=>client.finish(),save:()=>client.finish(),discard:()=>client.discard()}),[client,version,state.dirty,state.pending]));
 if(!graph)return <p className="bw-muted">讀取支出項目…</p>;
 const models=expenseModels(graph),item=client.draftItem()?.id===selected?client.draftItem():models.find(i=>i.id===selected),members=graph.members||[],approved=members.filter(m=>m.status==='approved');
 const editable=props.canEdit&&state.verified&&navigator.onLine!==false;
 async function handoff(action){if(await props.services.handoff({tripId:props.activeTrip.id}))action();}
 async function add(){if(adding.current)return;adding.current=true;try{if(client.status().draftId){setSelected(client.status().draftId);setPanel('edit');return;}if(!await props.services.handoff({tripId:props.activeTrip.id}))return;setSelected(client.begin());setPanel('edit');}finally{adding.current=false;}}
 async function payment(){if(!await props.services.handoff({tripId:props.activeTrip.id}))return;const current=client.status().graph,model=expenseModels(current).find(i=>i.id===selected);if(!model)return;
  const ok=await client.execute(model.id,'payment',{action:model.payment_state==='paid'?'unpaid':'paid',paid_at:new Date().toISOString(),budget_revision:model.revisions.budget||0,paid_revision:model.revisions.paid||0,payer_revision:model.revisions.payer||0});if(!ok)void client.refresh();}
 async function remove(){if(!await props.services.handoff({tripId:props.activeTrip.id}))return;if(!await ask({title:'刪除支出項目？',message:'此項目將不再計入預算與結算。',confirmLabel:'刪除',danger:true}))return;if(await client.execute(item.id,'lifecycle',{action:'delete'})){setSelected(null);setPanel('stats');}}
 function frame(group,label,render){const field=client.get(item.id,group),v=client.view(field),owner=collaborators.find(e=>e.resource_id===item.id&&e.group_key===group&&e.mode==='edit')?.user_id||(v.remote?.held&&!v.remote.own_session?v.remote.owner:null);
  const locked=!editable||!v.editable||Boolean(owner);
  return <BudgetCollaborationFrame key={group} role="group" aria-label={label} tabIndex={0} label={label} ownerId={owner} ownerName={memberLabel(members.find(m=>m.user_id===owner))}
   className={owner?'is-peer-held':locked?'is-unclaimed':''} onPointerDownCapture={()=>{if(editable)void client.focus(field);}} onFocusCapture={()=>{if(editable)void client.focus(field);}}
   onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)&&!e.relatedTarget?.closest('[data-budget-metadata-portal]'))client.blur(field);}}
   onCompositionStart={()=>{field.composing=true;}} onCompositionEnd={()=>{field.composing=false;client.input(field,field.value);}}>
   <label>{label}</label>{render({field,v,locked,canChooseMode:editable&&!owner&&state.verified&&!v.conflict&&!field.request&&!field.releasing,set:value=>client.input(field,value)})}
  </BudgetCollaborationFrame>;
 }
 const actual=view==='paid',rows=expenseDisplayRows(models.filter(i=>!actual||i.paid&&i.payment_state==='paid'||i.payment_state==='draft'),view);
 const participantRows=displayParticipants(rows),links=graph.links.map(l=>({budget_item_id:l.expense_id,itinerary_item_id:l.itinerary_item_id}));
 const displayRows=rows.filter(i=>(!paymentFilter||(i.payment_state==='paid')===(paymentFilter==='paid'))&&`${i.title} ${i.category} ${i.note}`.toLowerCase().includes(query.toLowerCase()));
 const select=id=>void handoff(()=>{setSelected(selected===id?null:id);if(!panelChosen.current&&panel!=='edit')setPanel('detail');});
 const close=()=>void handoff(()=>{setPanel('detail');if(!client.status().graph.items.some(i=>i.id===selected))setSelected(null);});
 const changePanel=key=>void handoff(()=>{panelChosen.current=true;setPanel(key);});
 const paymentDisabled=!editable||!item||item.payment_state!=='paid'&&(!item.title.trim()||item.payment_mode!=='self'&&!item.payer_id&&!item.payer_allocations?.length||!item.paid&&!item.budget);
 return <section className="budget-panel budget-workspace" aria-label="支出工作區">{dialog}
  <div className="bw-main"><div className="bw-toolbar">{!planning?<div className="bw-tabs" role="tablist" aria-label="費用資料檢視">{[['budget','預算'],['paid','實付']].map(([key,label])=><button type="button" role="tab" key={key} aria-selected={view===key} onClick={()=>void handoff(()=>setView(key))}>{label}</button>)}</div>:null}
   <div className="bw-filters"><label><Search size={15}/><input aria-label="搜尋項目" placeholder="搜尋項目" value={query} onChange={e=>setQuery(e.target.value)}/></label><MenuSelect label="付款篩選" value={paymentFilter} onValueChange={setPaymentFilter} options={[{value:'',label:'全部項目'},{value:'unpaid',label:'未付款'},{value:'paid',label:'已付款'}]}/><span>{displayRows.length} 筆</span></div><button type="button" className="primary-button compact bw-add" disabled={!editable} onClick={()=>void add()}><Plus size={15}/>新增項目</button></div>
   <ExpenseTable rows={displayRows} members={approved} links={links} items={graph.itineraryItems||[]} collaborators={collaborators} selected={selected} collapsed={collapsed} setCollapsed={next=>void handoff(()=>setCollapsed(next))} viewpoint={viewpoint} actual={actual} onSelect={select}/>
  </div>
  <aside className="bw-side"><div className="bw-side-tabs" role="tablist" aria-label="右側面板">{[['stats','旅程統計',ChartColumn],['detail','項目明細',List],['edit','編輯項目',Pencil]].map(([key,label,Icon])=><button key={key} role="tab" type="button" aria-label={label} aria-selected={panel===key} onClick={()=>changePanel(key)}><Icon size={14} strokeWidth={1.8}/><span>{label}</span></button>)}</div>
  <div hidden={panel!=='stats'}><Stats records={rows} rows={participantRows} members={approved} actual={actual} budgets={rows} viewpoint={viewpoint} setViewpoint={setViewpoint} ratesSummary={<span/>}/><div className="bw-restored-rates" hidden={actual}><ExpenseRates service={transport} client={client} actor={props.currentUserId} trip={props.activeTrip.id} sessionId={sessionId} storage={storage} onError={errorToast} services={props.services} editable={editable} planning={planning&&Boolean(props.activeTrip.start_date)} active={workspaceActive}/></div></div>
  {panel==='detail'?(item?<ExpenseDetail item={item} scope={view} planning={planning} members={members} links={links} items={graph.itineraryItems||[]} editable={editable} paymentDisabled={paymentDisabled} onRemove={()=>void remove()} onPayment={()=>{if(!paymentDisabled)void payment();}}/>:<div className="bw-empty">選取項目查看明細</div>):null}
  {panel==='edit'&&item?<section className={`bw-editor bw-metadata-editor bw-native-panel${planning?' is-planning':''}`} aria-label="支出項目編輯">
   {frame('title','項目名稱',({v,locked,set})=><input aria-label="項目名稱" value={v.value} readOnly={locked} onChange={e=>set(e.target.value)}/>)}
   {frame('note','備註',({v,locked,set})=><textarea aria-label="備註" value={v.value||''} rows={3} readOnly={locked} onChange={e=>set(e.target.value)}/>)}
   {frame('category','分類',({v,locked,set})=><MenuSelect label="分類" value={v.value} editable readOnly={locked} metadataPortal onValueChange={set} options={['機票','交通','住宿','門票','餐飲','購物','其他'].map(value=>({value,label:value}))}/>)}

   {frame('links','關聯行程',({v,locked,set})=><ItineraryPicker items={graph.itineraryItems||[]} category={item.category} selectedIds={v.value} readOnly={locked} onChange={set}/>)}
   {frame(view,view==='budget'?'預算計價與分攤':'實付計價與分攤',({field,v,locked,canChooseMode})=><Pricing client={client} field={field} view={v} scope={view} members={members} rates={graph.rates} locked={locked} canChooseMode={canChooseMode}/>)}
   {frame('payer','付款方式',({field,v,locked,canChooseMode})=>planning?<ExpensePayers client={client} field={field} view={v} members={approved} total={(item.budget||item.paid)?.amount??0} currency={(item.budget||item.paid)?.currency||'TWD'} locked={locked} canChooseMode={canChooseMode}/>:v.value.rows.length<=1?<MenuSelect label="付款人" value={v.value.rows[0]?.user_id||''} readOnly={locked} metadataPortal onValueChange={value=>client.input(field,value)} options={[{value:'',label:'未指定'},...approved.map(m=>({value:m.user_id,label:memberLabel(m)}))]}/>:<p>{v.value.mode==='self'?'各自付':v.value.rows.map(r=>memberLabel(approved.find(m=>m.user_id===r.user_id))).join('、')}</p>)}
   {!planning?<div className="bw-metadata-summary"><span>分類 · {item.category}</span><span>金額 · {item[view]?`${item[view].currency} ${money(item[view].amount)}`:'尚未填寫'}</span></div>:null}
   {!planning?<details className="bw-secondary-fields"><summary>{actual?'預算金額與分攤':'實付金額與分攤'}</summary>{frame(actual?'budget':'paid',actual?'預算計價與分攤':'實付計價與分攤',({field,v,locked,canChooseMode})=><Pricing client={client} field={field} view={v} scope={actual?'budget':'paid'} members={members} rates={graph.rates} locked={locked} canChooseMode={canChooseMode}/>)}</details>:null}
   <div className="bw-editor-actions bw-side-footer">{planning?<><PaymentToggle checked={item.payment_state==='paid'} disabled={paymentDisabled} onChange={()=>void payment()}/><span className="bw-save-state" role="status" aria-label="儲存狀態">{client.saveStatus(item.id)}</span></>:<><button type="button" className="ghost-button compact" disabled={paymentDisabled} onClick={()=>void payment()}>{item.payment_state==='paid'?'改為未付款':'標記已付款'}</button><button type="button" className="ghost-button compact" onClick={close}>取消</button><button type="button" className="primary-button compact" disabled={!editable} onClick={close}>完成</button></>}</div>
  </section>:panel==='edit'?<div className="bw-empty">選取項目開始編輯</div>:null}</aside>
 </section>;
}
