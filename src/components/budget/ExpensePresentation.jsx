import {Fragment,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown, ChevronRight, Circle, CircleCheck, Package, Pencil, Trash2} from 'lucide-react';
import {budgetDay, memberLabel, money, pricingLabels, recordAllocations} from '../../lib/budgetFinance.js';
import {rowCollaborators,RowCollaboratorOutline,RowCollaboratorAvatars} from './BudgetRowCollaborators.jsx';
import {categoryOrder as order,categoryIcons as icons,categoryColor,PricingSummary} from './BudgetWorkspace.jsx';

// Presentation-only projection: missing budget stays missing, even for paid items.
export function expenseDisplayRows(models,scope){
 return models.map(item=>({...item[scope],id:item.id,title:item.title,category:item.category||'其他',note:item.note,payer_id:item.payer_id,
  hasActual:item.payment_state==='paid',payment_state:item.payment_state,participantIds:item[scope]?.participantIds||[],shares:item[scope]?.shares||{},
  record_status:item[scope]&&item.title.trim()&&(scope==='budget'||item.payment_state!=='draft')?'complete':'incomplete'}));
}
export function displayParticipants(rows){return rows.flatMap(row=>row.participantIds.map(user_id=>({budget_item_id:row.id,actual_expense_id:row.id,user_id,share_amount:row.shares[user_id]})));}
function rowPeerPosition(row){
 const rect=(row.querySelector('.bw-collaboration-outline')||row).getBoundingClientRect();
 return {left:rect.left,top:rect.bottom+2};
}
export function ExpenseTable({rows,members,links,items,collaborators=[],selected,collapsed,setCollapsed,viewpoint,actual,onSelect}){
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
 const fold=(values,close)=>setCollapsed(current=>close?[...new Set([...current,...values])]:current.filter(c=>!values.includes(c)));
 const person=members.some(m=>m.user_id===viewpoint)?viewpoint:null;
 const people=row=>row.participantIds.map(user_id=>({user_id,share_amount:row.shares[user_id]}));
 const cell=(row,text,kind='')=><button type="button" className={`bw-cell ${kind}`} onClick={event=>{event.stopPropagation();onSelect(row.id);}}>{text}</button>;
 return <div className="bw-table-scroll">{tooltipUsers.length?createPortal(<div id={`expense-peers-${tooltip.id}`} role="tooltip" className="bw-collaboration-tooltip bw-row-peer-tooltip" style={{left:tooltip.left,top:tooltip.top}}><RowCollaboratorAvatars users={tooltipUsers} members={members}/></div>,document.body):null}<table className="bw-table" aria-label={actual?'實付明細':'預算明細'}><thead><tr onClick={()=>fold(categories,!allCollapsed)}><th className="bw-day">Day</th><th className="bw-title">項目</th><th className="bw-number">{actual?'每人負擔':'每人預算'}<small>TWD</small></th><th className="bw-number">總額<small>TWD</small></th><th><button type="button" className="bw-fold-all" aria-label={allCollapsed?'展開所有分類':'收合所有分類'} aria-expanded={!allCollapsed} onClick={e=>{e.stopPropagation();fold(categories,!allCollapsed);}}>狀態</button></th></tr></thead>
 <tbody>{categories.map(category=>{
  const grouped=rows.filter(r=>r.category===category),complete=grouped.filter(r=>r.record_status==='complete'),total=complete.reduce((sum,r)=>sum+Number(r.twd_amount),0);
  const allocations=person?complete.map(r=>recordAllocations(r,people(r))):[];
  const perPerson=person?allocations.some(a=>a===null)?null:allocations.reduce((sum,a)=>sum+(a[person]||0),0):members.length?total/members.length:null;
  const Icon=icons[category]||Package,closed=collapsed.includes(category),Fold=closed?ChevronRight:ChevronDown;
  return <Fragment key={category}><tr className="bw-group" style={{'--bw-category-color':categoryColor(category)}} onClick={()=>fold([category],!closed)}><th colSpan={2} scope="rowgroup"><button className="bw-group-label" type="button" aria-expanded={!closed} aria-label={`${closed?'展開':'收合'}${category}`}><Icon size={14} strokeWidth={1.8}/><span>{category}</span><small>{grouped.length} 筆</small></button></th><td className="bw-number bw-group-person">{perPerson===null?'—':`${Number.isInteger(perPerson)?'':'≈ '}${money(perPerson)}`}</td><td className="bw-number">{money(total)}</td><td><Fold size={14}/></td></tr>
  {!closed&&grouped.map(row=>{
   const remote=rowCollaborators(collaborators.filter(e=>e.resource_id===row.id));
   const show=event=>{if(!remote.length)return;setTooltip({id:row.id,...rowPeerPosition(event.currentTarget)});};
   return <tr key={row.id} data-expense-id={row.id} className={`bw-row${selected===row.id?' is-selected':''}${remote.length?' has-collaborators':''}`} tabIndex={remote.length?0:undefined} aria-describedby={tooltip?.id===row.id&&tooltipUsers.length?`expense-peers-${row.id}`:undefined} onMouseEnter={show} onMouseLeave={event=>{if(!event.currentTarget.contains(document.activeElement))setTooltip(null);}} onFocus={show} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setTooltip(null);}} onClick={()=>onSelect(row.id)}>
    <td className="bw-day">{budgetDay(row,links,items)}<RowCollaboratorOutline users={remote}/></td>
    <td>{cell(row,row.title||'未命名項目')}</td>
    <td className="bw-number">{row.record_status!=='complete'?'—':cell(row,row.pricing_mode==='custom'?'依成員':row.participantIds.length?`${row.twd_amount%row.participantIds.length?'≈ ':''}${money(row.twd_amount/row.participantIds.length)}`:'—','bw-person')}</td>
    <td className="bw-number bw-total">{row.record_status!=='complete'?'尚未填寫':cell(row,money(row.twd_amount))}</td>
    <td><span className={`bw-status${row.hasActual?' paid':''}`}>{row.hasActual?'已付款':'未付款'}</span></td>
   </tr>;
  })}</Fragment>;
 })}</tbody></table>{!rows.length?<div className="bw-empty">沒有符合條件的項目</div>:null}</div>;
}
export function ExpenseDetail({item,scope,members,links,items,editable,paymentDisabled,onEdit,onRemove,onPayment}){
 const bundle=item[scope],count=bundle?.participantIds.length||0,Icon=item.payment_state==='paid'?CircleCheck:Circle;
 return <section className="bw-detail"><div className="bw-detail-heading"><div className="bw-detail-title"><span>{item.category}</span><h3>{item.title||'未命名項目'}</h3></div><button className="bw-icon bw-edit-item" aria-label="編輯項目" type="button" disabled={!editable} onClick={onEdit}><Pencil size={18}/></button></div>
 {bundle?<PricingSummary amount={bundle.amount} twdAmount={bundle.twd_amount} currency={bundle.currency} mode={bundle.pricing_mode} count={count}/>:<p>未填，尚未計入財務統計</p>}
 <dl><div><dt>計價方式</dt><dd>{bundle?pricingLabels[bundle.pricing_mode]:'未填'}</dd></div><div><dt>參與成員</dt><dd>{bundle?`${count} 人`:'未填'}</dd></div><div><dt>付款人</dt><dd>{memberLabel(members.find(m=>m.user_id===item.payer_id))}</dd></div><div><dt>關聯行程</dt><dd>{budgetDay(item,links,items)}</dd></div></dl>
 <section><h4>各人負擔 <small>TWD</small></h4>{bundle?.participantIds.map(id=><div className="bw-stat-line" key={id}><span>{memberLabel(members.find(m=>m.user_id===id))}</span><b>{bundle.shares[id]===null?'待確認':money(bundle.shares[id])}</b></div>)}</section>
 {item.note?<section><h4>備註</h4><p>{item.note}</p></section>:null}
 <div className="bw-metadata-summary"><span>預算 · {item.budget?`${item.budget.currency} ${money(item.budget.amount)}`:'未填'}</span><span>實付 · {item.paid?`${item.paid.currency} ${money(item.paid.amount)}`:'未填'}</span>{item.payment_state==='paid'&&item.budget&&item.paid?<span>實付與預算差額 · NT$ {money(item.paid.twd_amount-item.budget.twd_amount)}</span>:null}</div>
 <div className="bw-detail-actions"><button type="button" className={`bw-payment-toggle${item.payment_state==='paid'?' is-paid':''}`} aria-label="付款狀態" aria-pressed={item.payment_state==='paid'} disabled={paymentDisabled} onClick={onPayment}><Icon size={14}/><span>{item.payment_state==='paid'?'已付款':'未付款'}</span></button><button className="bw-icon bw-danger" aria-label="刪除項目" type="button" disabled={!editable} onClick={onRemove}><Trash2 size={16}/></button></div>
 </section>;
}
