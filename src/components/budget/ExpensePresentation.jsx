import {Fragment,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown, ChevronRight, Circle, CircleCheck, Package, Trash2, X} from 'lucide-react';
import {budgetDay, memberLabel, money, originalMoney, pricingLabels, recordAllocations} from '../../lib/budgetFinance.js';
import {rowCollaborators,RowCollaboratorOutline,RowCollaboratorAvatars} from './BudgetRowCollaborators.jsx';
import {categoryOrder as order,categoryIcons as icons,categoryColor,PricingSummary} from './ExpenseWorkspaceParts.jsx';

export function expenseDisplayAllocations(bundle) {
 if (!bundle?.participantIds.length || bundle.twd_amount == null || bundle.twd_amount === ''
   || !Number.isFinite(Number(bundle.twd_amount)) || Number(bundle.twd_amount) < 0) return null;
 const participants = bundle.participantIds.map(user_id => ({user_id, share_amount:bundle.shares[user_id]}));
 try {
  return recordAllocations(bundle, participants);
 } catch {
  return null;
 }
}

// Presentation-only projection: missing budget stays missing, even for paid items.
export function expenseDisplayRows(models,scope){
 return models.map(item=>({...item[scope],id:item.id,title:item.title,category:item.category||'其他',note:item.note,payer_id:item.payer_id,
  hasActual:item.payment_state==='paid',payment_state:item.payment_state,participantIds:item[scope]?.participantIds||[],shares:item[scope]?.shares||{},
  allocations:expenseDisplayAllocations(item[scope]),
  record_status:item[scope]&&item.title.trim()&&(scope==='budget'||item.payment_state!=='draft')?'complete':'incomplete'}));
}
function rowPeerPosition(row){
 const rect=(row.querySelector('.bw-collaboration-outline')||row).getBoundingClientRect();
 return {left:rect.left,top:rect.bottom+2};
}
function SelectRowsCheckbox({label,count,selectedCount,disabled,onChange}){
 return <label className="bw-action-check"><input type="checkbox" aria-label={label} disabled={disabled||!count}
  ref={node=>{if(node)node.indeterminate=selectedCount>0&&selectedCount<count;}}
  checked={count>0&&selectedCount===count} onChange={onChange}/></label>;
}
export function ExpenseTable({rows,members,links,items,collaborators=[],selected,collapsed,setCollapsed,currentUserId,actual,onSelect,checked,visibleCount,checkedCount,onToggleAll,onToggleGroup,actionBusy,canRemove,onRemove}){
 const [tooltip,setTooltip]=useState(null);
 const tooltipUsers=tooltip&&rows.some(row=>row.id===tooltip.id&&!collapsed.includes(row.category))?rowCollaborators(collaborators.filter(entry=>entry.resource_id===tooltip.id)):[];
 useEffect(()=>{
  const clear=()=>setTooltip(null),key=event=>{if(event.key==='Escape')clear();};
  const reposition=()=>setTooltip(current=>{
   const row=document.activeElement?.closest('.bw-row');
   if(!current||row?.dataset.expenseId!==current.id)return null;
   const rect=row.getBoundingClientRect();
   return rect.bottom<0||rect.top>window.innerHeight?null:{...current,...rowPeerPosition(row)};
  });
  window.addEventListener('scroll',reposition,true);window.addEventListener('resize',reposition);window.addEventListener('pointerdown',clear);window.addEventListener('keydown',key);
  return()=>{window.removeEventListener('scroll',reposition,true);window.removeEventListener('resize',reposition);window.removeEventListener('pointerdown',clear);window.removeEventListener('keydown',key);};
 },[]);
 const categories=[...new Set(rows.map(r=>r.category))].sort((a,b)=>(order.includes(a)?order.indexOf(a):99)-(order.includes(b)?order.indexOf(b):99)||a.localeCompare(b));
 const allCollapsed=categories.length>0&&categories.every(c=>collapsed.includes(c));
 const FoldAll=allCollapsed?ChevronRight:ChevronDown;
 const fold=(values,close)=>setCollapsed(current=>close?[...new Set([...current,...values])]:current.filter(c=>!values.includes(c)));
 const cell=(row,text,kind='')=><button type="button" className={`bw-cell ${kind}`} onClick={event=>{event.stopPropagation();onSelect(row.id);}}>{text}</button>;
 return <div className="bw-table-scroll">{tooltipUsers.length?createPortal(<div id={`expense-peers-${tooltip.id}`} role="tooltip" className="bw-collaboration-tooltip bw-row-peer-tooltip" style={{left:tooltip.left,top:tooltip.top}}><RowCollaboratorAvatars users={tooltipUsers} members={members}/></div>,document.body):null}<table className="bw-table bw-expense-table" aria-label={actual?'實付明細':'預算明細'}><thead><tr onClick={()=>fold(categories,!allCollapsed)}><th className="bw-day">Day</th><th className="bw-title">項目</th><th className="bw-number">{actual?'個人負擔':'個人預算'}<small>TWD</small></th><th className="bw-number">總額<small>TWD</small></th><th className="bw-status-cell">狀態</th><th className="bw-action-cell" aria-label={checked?'多選':'操作'} onClick={e=>e.stopPropagation()}>
  {checked?<SelectRowsCheckbox label="全選可見項目" count={visibleCount} selectedCount={checkedCount} disabled={actionBusy} onChange={onToggleAll}/>
   :<button type="button" className="bw-action-icon bw-group-toggle" aria-label={allCollapsed?'展開所有分類':'收合所有分類'} aria-expanded={categories.length>0&&!allCollapsed} disabled={actionBusy||!categories.length} onClick={()=>fold(categories,!allCollapsed)}><FoldAll size={14}/></button>}
 </th></tr></thead>
 <tbody>{categories.map(category=>{
  const grouped=rows.filter(r=>r.category===category),complete=grouped.filter(r=>r.record_status==='complete'),total=complete.reduce((sum,r)=>sum+Number(r.twd_amount),0);
  const missingShare=complete.some(row=>row.allocations===null&&(!row.participantIds.length||row.participantIds.includes(currentUserId)));
  const personalSubtotal=missingShare?null:complete.reduce((sum,row)=>sum+(row.allocations?.[currentUserId]??0),0);
  const Icon=icons[category]||Package,closed=collapsed.includes(category),Fold=closed?ChevronRight:ChevronDown;
  return <Fragment key={category}><tr className="bw-group" style={{'--bw-category-color':categoryColor(category)}} onClick={()=>fold([category],!closed)}><th colSpan={2} scope="rowgroup"><span className="bw-group-label"><Icon size={14} strokeWidth={1.8}/><span>{category}</span><small>{grouped.length} 筆</small></span></th><td className="bw-number bw-group-person">{personalSubtotal===null?'—':money(personalSubtotal)}</td><td className="bw-number">{money(total)}</td><td className="bw-status-cell"></td><td className="bw-action-cell" onClick={event=>event.stopPropagation()}>
   {checked?<SelectRowsCheckbox label={`全選「${category}」`} count={closed?0:grouped.length} selectedCount={grouped.filter(row=>checked.has(row.id)).length} disabled={actionBusy} onChange={()=>onToggleGroup(category)}/>
    :<button type="button" className="bw-action-icon bw-group-toggle" aria-expanded={!closed} aria-label={`${closed?'展開':'收合'}${category}`} disabled={actionBusy} onClick={()=>fold([category],!closed)}><Fold size={14}/></button>}
  </td></tr>
  {!closed&&grouped.map(row=>{
   const remote=rowCollaborators(collaborators.filter(e=>e.resource_id===row.id));
   const personalAmount=row.allocations?.[currentUserId];
   const show=event=>{if(!remote.length)return;setTooltip({id:row.id,...rowPeerPosition(event.currentTarget)});};
   const label=row.title||'未命名項目';
   return <tr key={row.id} data-expense-id={row.id} className={`bw-row${selected===row.id?' is-selected':''}${checked?.has(row.id)?' is-checked':''}${remote.length?' has-collaborators':''}`} tabIndex={remote.length?0:undefined} aria-describedby={tooltip?.id===row.id&&tooltipUsers.length?`expense-peers-${row.id}`:undefined} onMouseEnter={show} onMouseLeave={event=>{if(!event.currentTarget.contains(document.activeElement))setTooltip(null);}} onFocus={show} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setTooltip(null);}} onClick={()=>onSelect(row.id)}>
    <td className="bw-day">{budgetDay(row,links,items)}<RowCollaboratorOutline users={remote}/></td>
    <td>{cell(row,row.title||'未命名項目')}</td>
    <td className="bw-number">{row.record_status!=='complete'||personalAmount==null?'—':cell(row,money(personalAmount),'bw-person')}</td>
    <td className="bw-number bw-total">{row.record_status!=='complete'?'尚未填寫':cell(row,money(row.twd_amount))}</td>
    <td className="bw-status-cell"><span className={`bw-status${row.hasActual?' paid':''}`}>{row.hasActual?'已付款':row.requires_participants?'需指定參與者':'未付款'}</span></td>
    <td className="bw-action-cell" onClick={event=>event.stopPropagation()}>
     {checked?<label className="bw-action-check"><input type="checkbox" aria-label={`選取「${label}」`} checked={checked.has(row.id)} disabled={actionBusy} onChange={()=>onSelect(row.id)}/></label>
      :canRemove&&<button type="button" className="bw-action-icon bw-row-remove is-danger" aria-label={`刪除「${label}」`} title={`刪除「${label}」`} disabled={actionBusy} onClick={()=>onRemove(row)}><X size={14}/></button>}
    </td>
   </tr>;
  })}</Fragment>;
 })}</tbody></table>{!rows.length?<div className="bw-empty">沒有符合條件的項目</div>:null}</div>;
}
export function ExpenseDetail({item,scope,planning=false,members,links,items,editable,participantsRequired,payerRequired,paymentDisabled,onRemove,onPayment,currentUserId}){
 const bundle=item[scope],count=bundle?.participantIds.length||0,Icon=item.payment_state==='paid'?CircleCheck:Circle;
 const CategoryIcon=icons[item.category]||Package;
 const payerBundle=item.budget||item.paid;
 const payers=item.payer_allocations?.length?item.payer_allocations
  :item.payer_id?[{user_id:item.payer_id,amount:payerBundle?.amount}]:[];
 const showPayers=item.payment_mode!=='self'&&payers.length>0;
 const payerName=id=>memberLabel(members.find(member=>member.user_id===id));
 const payerAmount=payer=>payer.amount==null?'—':[payerBundle?.currency,originalMoney(payer.amount)].filter(Boolean).join(' ');
 return <section className="bw-detail bw-native-panel"><div className="bw-detail-heading"><div className="bw-detail-title"><span className="bw-detail-category"><CategoryIcon size={14} style={{color:categoryColor(item.category||'其他')}} aria-hidden="true" />{item.category}</span><h3>{item.title||'未命名項目'}</h3></div></div>
 {bundle?<PricingSummary amount={bundle.amount} twdAmount={bundle.twd_amount} currency={bundle.currency}
   showOriginalPrecision={planning} personalAmount={expenseDisplayAllocations(bundle)?.[currentUserId]??null}/>:<p>未填，尚未計入財務統計</p>}
 {participantsRequired&&<p className="bw-warning">請重新指定參與者，再標記已付款。</p>}
 {payerRequired&&<p className="bw-warning">請重新指定付款人，再標記已付款。</p>}
 <dl className="bw-detail-facts">
  <div className="bw-detail-payment">
   <dt>付款方式</dt><dd>{item.payment_mode==='self'?'各自付':showPayers?`指定付款人 · ${payers.length}人`:'未指定'}</dd>
   {showPayers&&<dd className="bw-detail-payment-breakdown"><ul className="bw-detail-payers" aria-label="代付金額">
    {payers.map(payer=><li key={payer.user_id}><span>{payerName(payer.user_id)}</span><b>{payerAmount(payer)}</b></li>)}
   </ul></dd>}
  </div>
  <div className="bw-detail-itinerary"><dt>關聯行程</dt><dd>{budgetDay(item,links,items)}</dd></div>
  <div><dt>計算方式</dt><dd>{bundle?pricingLabels[bundle.pricing_mode]:'未填'}</dd></div>
  <div><dt>參與成員</dt><dd>{bundle?`${count} 人`:'未填'}</dd></div>
 </dl>
 {item.note?<section><h4>備註</h4><p>{item.note}</p></section>:null}
 {count>0&&<details key={`${item.id}:${scope}`} className="bw-detail-shares">
  <summary><h4><ChevronRight size={14} aria-hidden="true" />每人負擔 <small>{count} 人 · {planning?bundle.currency:'TWD'}</small></h4></summary>
  {bundle.participantIds.map(id=><div className="bw-stat-line" key={id}><span>{memberLabel(members.find(m=>m.user_id===id))}</span><b>{bundle.shares[id]==null?'待確認':planning?originalMoney(bundle.shares[id]):money(bundle.shares[id])}</b></div>)}
 </details>}
 {!planning?<div className="bw-metadata-summary"><span>預算 · {item.budget?`${item.budget.currency} ${money(item.budget.amount)}`:'未填'}</span><span>實付 · {item.paid?`${item.paid.currency} ${money(item.paid.amount)}`:'未填'}</span>{item.payment_state==='paid'&&item.budget&&item.paid?<span>實付與預算差額 · NT$ {money(item.paid.twd_amount-item.budget.twd_amount)}</span>:null}</div>:null}
 <div className="bw-detail-actions bw-side-footer"><button type="button" className={`bw-payment-toggle${item.payment_state==='paid'?' is-paid':''}`} aria-label="付款狀態" aria-pressed={item.payment_state==='paid'} disabled={paymentDisabled} onClick={onPayment}><Icon size={14}/><span>{item.payment_state==='paid'?'已付款':'未付款'}</span></button><button className="bw-icon bw-danger" aria-label="刪除項目" type="button" disabled={!editable} onClick={onRemove}><Trash2 size={16}/></button></div>
 </section>;
}
