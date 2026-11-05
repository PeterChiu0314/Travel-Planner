import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {X} from 'lucide-react';
import {createExpenseEditor} from '../../lib/expenseEditor.js';
import {createExpenseService} from '../../lib/expenseTransport.js';
import {getBudgetMetadataSessionId} from '../../lib/budgetMetadataConfig.js';
import {expenseModels} from '../../lib/expenseSnapshot.js';
import {expenseSettlement} from '../../lib/expenseItems.js';
import {calculatePricing,calculateActualPricing,memberLabel,money} from '../../lib/budgetFinance.js';
import {pricingModeDraft} from '../../lib/budgetPricingGroups.js';
import {notify,isConnectionError} from '../../lib/notifications.js';
import BudgetPricingFields from './BudgetPricingFields.jsx';
import BudgetCollaborationFrame from './BudgetCollaborationFrame.jsx';
import {ItineraryPicker} from './BudgetWorkspace.jsx';
import MenuSelect from '../MenuSelect.jsx';
import {useSiteDialog} from '../SiteDialog.jsx';
import ExpenseRates from './ExpenseRates.jsx';

function errorToast(error){if(isConnectionError(error))notify.error(error);else notify.error(error.code==='PT409'?'內容已更新，未儲存的變更已保留；離開時可選擇不儲存。':error.code==='55P03'?'暫時無法儲存，變更已保留，系統會重新確認。':error.code==='22023'?'請確認金額、付款人與參與成員是否完整。':error,{id:'budget-editor-error'});}
function Pricing({client,field,view,members,scope,rates,locked}){
 const [open,setOpen]=useState(false),custom=useRef(null);const form=view.value;let pricing;
 try{pricing=(scope==='paid'?calculateActualPricing:calculatePricing)(form);}catch{/* Incomplete input stays a local draft. */}
 const setForm=value=>client.input(field,value);
 const changeMode=mode=>{if(form.pricing_mode==='custom')custom.current={...form.shares};setForm(pricingModeDraft(form,mode,custom.current));if(mode==='custom')setOpen(true);};
 return <><BudgetPricingFields form={form} pricing={pricing} members={members} locked={locked} historical={false} tripRates={rates}
  update={(key,value)=>setForm({...form,[key]:value})} setForm={setForm} membersOpen={open} setMembersOpen={setOpen} changeMode={changeMode} groupMode editRate={scope==='paid'} />
  {scope==='paid'?<fieldset className="bw-cost-source"><legend>台幣金額</legend><div><button type="button" disabled={locked} aria-pressed={form.twd_amount_source==='estimated'} onClick={()=>setForm({...form,twd_amount_source:'estimated',actual_twd_amount:''})}>依匯率估算</button><button type="button" disabled={locked} aria-pressed={form.twd_amount_source==='actual'} onClick={()=>setForm({...form,twd_amount_source:'actual',actual_twd_amount:pricing?.twd_amount??''})}>實際扣款</button></div>
   {form.twd_amount_source==='actual'?<label>實際台幣扣款<input type="number" min="0" step="1" readOnly={locked} value={form.actual_twd_amount} onChange={e=>setForm({...form,actual_twd_amount:e.target.value})}/></label>:null}
  </fieldset>:null}</>;
}
export default function ExpenseWorkspace(props){
 const propsRef=useRef(props);propsRef.current=props;
 const transport=useMemo(()=>createExpenseService(props.supabase),[props.supabase]);
 const client=useMemo(()=>{return createExpenseEditor({service:{...transport,read:async()=>{const r=await propsRef.current.onRefreshBudget(propsRef.current.activeTrip.id);return r.ok?{data:r.data.expenseGraph}:{error:r.error||new Error('資料尚未同步，變更已保留。')};}},
  actor:props.currentUserId,trip:props.activeTrip.id,sessionId:getBudgetMetadataSessionId(),storage:sessionStorage,onError:errorToast});},[props.supabase,props.currentUserId,props.activeTrip.id]);
 const version=useSyncExternalStore(client.subscribe,client.getVersion),[selected,setSelected]=useState(null),[view,setView]=useState('budget'),[query,setQuery]=useState('');
 const {ask,dialog}=useSiteDialog();
 useEffect(()=>{if(props.metadataSnapshot?.expenseGraph)client.ingest(props.metadataSnapshot.expenseGraph);},[client,props.metadataSnapshot]);
 useEffect(()=>{const detach=client.attach();const offline=()=>client.invalidate(),online=()=>void client.refresh(),timer=setInterval(()=>void client.tick(),1000);window.addEventListener('offline',offline);window.addEventListener('online',online);window.addEventListener('focus',online);return()=>{clearInterval(timer);window.removeEventListener('offline',offline);window.removeEventListener('online',online);window.removeEventListener('focus',online);detach();};},[client]);
 const state=client.status(),graph=state.graph;
 props.services.useGuard(`expense-workspace:${props.currentUserId}:${props.activeTrip.id}`,useMemo(()=>({isActive:true,isDirty:state.dirty||state.pending,
  prepare:()=>client.finish(),finish:()=>client.finish(),save:()=>client.finish(),discard:()=>client.discard()}),[client,version,state.dirty,state.pending]));
 if(!graph)return <p className="bw-muted">讀取支出項目…</p>;
 const models=expenseModels(graph),item=models.find(i=>i.id===selected),members=graph.members||[],approved=members.filter(m=>m.status==='approved'),balances=expenseSettlement(models,approved);
 const editable=props.canEdit&&state.verified&&navigator.onLine!==false;
 async function handoff(action){if(await props.services.handoff({tripId:props.activeTrip.id}))action();}
 async function add(){if(!await props.services.handoff({tripId:props.activeTrip.id}))return;const id=await client.create(view);if(id)setSelected(id);}
 async function payment(){if(!await props.services.handoff({tripId:props.activeTrip.id}))return;const current=client.status().graph,model=expenseModels(current).find(i=>i.id===selected);if(!model)return;
  const ok=await client.execute(model.id,'payment',{action:model.payment_state==='paid'?'unpaid':'paid',paid_at:new Date().toISOString(),budget_revision:model.revisions.budget||0,paid_revision:model.revisions.paid||0,payer_revision:model.revisions.payer||0});if(!ok)void client.refresh();}
 async function remove(){if(!await props.services.handoff({tripId:props.activeTrip.id}))return;if(!await ask({title:'刪除支出項目？',message:'此項目將不再計入預算與結算。',confirmLabel:'刪除',danger:true}))return;if(await client.execute(item.id,'lifecycle',{action:'delete'}))setSelected(null);}
 function frame(group,label,render){const field=client.get(item.id,group),v=client.view(field),owner=v.remote?.held&&!v.remote.own_session?v.remote.owner:null;
  const locked=!editable||!v.editable;
  return <BudgetCollaborationFrame key={group} role="group" aria-label={label} tabIndex={0} label={label} ownerId={owner} ownerName={memberLabel(members.find(m=>m.user_id===owner))}
   className={locked?'is-unclaimed':''} onPointerDownCapture={()=>{if(editable)void client.focus(field);}} onFocusCapture={()=>{if(editable)void client.focus(field);}}
   onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)&&!e.relatedTarget?.closest('[data-budget-metadata-portal]'))client.blur(field);}}
   onCompositionStart={()=>{field.composing=true;}} onCompositionEnd={()=>{field.composing=false;client.input(field,field.value);}}>
   <label>{label}</label>{render({field,v,locked,set:value=>client.input(field,value)})}
  </BudgetCollaborationFrame>;
 }
 const total=models.reduce((sum,i)=>sum+Number((view==='budget'?i.budget:i.payment_state==='paid'?i.paid:null)?.twd_amount||0),0);
 return <section className="budget-panel budget-workspace" aria-label="支出工作區">{dialog}
  <div className="bw-main"><div className="bw-toolbar"><div className="bw-tabs" role="tablist" aria-label="費用資料檢視">{[['budget','預算'],['paid','實付']].map(([key,label])=><button type="button" role="tab" key={key} aria-selected={view===key} onClick={()=>void handoff(()=>setView(key))}>{label}</button>)}</div>
   <div className="bw-filters"><input aria-label="搜尋項目" placeholder="搜尋項目" value={query} onChange={e=>setQuery(e.target.value)}/><button type="button" className="primary-button compact" disabled={!editable} onClick={()=>void add()}>＋ {view==='budget'?'新增預算':'新增實付'}</button></div></div>
   <ExpenseRates service={transport} client={client} actor={props.currentUserId} trip={props.activeTrip.id} sessionId={getBudgetMetadataSessionId()} storage={sessionStorage} onError={errorToast} services={props.services} editable={editable}/>
   <div className="bw-table-scroll"><table className="bw-table" aria-label={view==='budget'?'預算明細':'實付明細'}><thead><tr><th>分類</th><th>項目</th><th>{view==='budget'?'預算金額':'實付金額'}</th><th>狀態</th></tr></thead><tbody>{models.filter(i=>!query||i.title.includes(query)||i.category.includes(query)).map(i=>{const b=i[view];return <tr key={i.id} className={`bw-row${selected===i.id?' is-selected':''}`} onClick={()=>void handoff(()=>setSelected(i.id))}><td>{i.category}</td><td><button className="bw-cell" type="button">{i.title||'未命名項目'}</button></td><td>{b?`${b.currency} ${money(b.amount)}`:'未填'}</td><td>{i.payment_state==='paid'?'已付款':i.payment_state==='draft'?'未完成':'未付款'}</td></tr>;})}</tbody></table></div>
  </div>
  <aside className="bw-side">{item?<section className="bw-editor bw-metadata-editor" aria-label="支出項目編輯"><div className="bw-detail-heading"><h3>編輯項目</h3><button type="button" className="bw-icon" aria-label="關閉編輯" onClick={()=>void handoff(()=>setSelected(null))}><X size={17}/></button></div>
   <div className="bw-metadata-summary"><span>預算 · {item.budget?`${item.budget.currency} ${money(item.budget.amount)}`:'未填'}</span><span>實付 · {item.paid?`${item.paid.currency} ${money(item.paid.amount)}`:'未填'}</span>{item.budget&&item.paid?<span>差額 · NT$ {money(item.paid.twd_amount-item.budget.twd_amount)}</span>:null}</div>
   {frame('title','項目名稱',({v,locked,set})=><input aria-label="項目名稱" value={v.value} readOnly={locked} onChange={e=>set(e.target.value)}/>)}
   {frame('note','備註',({v,locked,set})=><textarea aria-label="備註" value={v.value||''} rows={3} readOnly={locked} onChange={e=>set(e.target.value)}/>)}
   {frame('category','分類',({v,locked,set})=><MenuSelect label="分類" value={v.value} editable readOnly={locked} metadataPortal onValueChange={set} options={['機票','交通','住宿','門票','餐飲','購物','其他'].map(value=>({value,label:value}))}/>)}
   {frame('payer','付款人',({v,locked,set})=><MenuSelect label="付款人" value={v.value} readOnly={locked} metadataPortal onValueChange={set} options={[{value:'',label:'未指定'},...approved.map(m=>({value:m.user_id,label:memberLabel(m)}))]}/>)}
   {frame('links','關聯行程',({v,locked,set})=><ItineraryPicker items={graph.itineraryItems||[]} category={item.category} selectedIds={v.value} readOnly={locked} onChange={set}/>)}
   {frame(view,view==='budget'?'預算計價與分攤':'實付計價與分攤',({field,v,locked})=><Pricing client={client} field={field} view={v} scope={view} members={members} rates={graph.rates} locked={locked}/>)}
   <div className="bw-editor-actions"><button type="button" className="ghost-button compact" disabled={!editable||item.payment_state!=='paid'&&(!item.title.trim()||!item.payer_id||!item.paid&&!item.budget)} onClick={()=>void payment()}>{item.payment_state==='paid'?'改為未付款':'標記已付款'}</button><button type="button" className="ghost-button compact" disabled={!editable} onClick={()=>void remove()}>刪除項目</button></div>
  </section>:<section className="bw-stats" aria-label="支出統計"><h3>{view==='budget'?'預算':'有效實付'}總額</h3><strong>NT$ {money(total)}</strong>{balances.incomplete?<p className="bw-warning">部分實付分攤資料待確認。</p>:null}{balances.balances.map(m=><div className="bw-stat-line" key={m.user_id}><span>{m.name}</span><b>{money(m.balance)}</b></div>)}</section>}</aside>
 </section>;
}
