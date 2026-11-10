import {useCallback,useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Check,Link2,Search,X} from 'lucide-react';
import {buildTimelineVisitDisplayOrder} from '../../lib/timelineUntimedOrdering.js';
import {isEstablishedTransportPair,isTransportationCard} from '../../lib/timelineTransportationRoles.js';
import {timelineTypeColor,timelineTypeLabels} from '../../lib/timelineTypeStyles.js';
import {tripDays} from '../../lib/timelineTime.js';
import BudgetCollaborationFrame from './BudgetCollaborationFrame.jsx';

const typeOf=item=>isTransportationCard(item)?'transport':item.type||'attraction';
const typeLabel=type=>timelineTypeLabels[type]||type;
const budgetCategoryAliases=new Map([['機票','transport'],['門票','attraction']]);
const matchesFilter=(item,query,type)=>(!type||typeOf(item)===type)
 &&String(item.title||'').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
const dayDate=new Intl.DateTimeFormat('zh-TW',{month:'numeric',day:'numeric'});
const scrollKeys=new Set(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ']);

function dayboardDays(trip,items){
 const dates=tripDays(trip),groups=new Map();
 dates.forEach((date,index)=>groups.set(index,{index,date,items:[]}));
 for(const item of items){
  const index=Number(item.day_index);
  if(!Number.isInteger(index)||index<0||dates.length&&index>=dates.length)continue;
  if(!groups.has(index))groups.set(index,{index,items:[]});
  groups.get(index).items.push(item);
 }
 return [...groups.values()].sort((a,b)=>a.index-b.index).map(day=>{
  const unique=[...new Map(day.items.map(item=>[item.id,item])).values()];
  const visits=buildTimelineVisitDisplayOrder(unique);
  const transports=unique.filter(isTransportationCard).sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
  const pairs=new Map(),other=[];
  const next=new Map(visits.map((item,index)=>[item.id,visits[index+1]?.id]));
  for(const transport of transports){
   if(isEstablishedTransportPair(transport)&&next.get(transport.from_item_id)===transport.to_item_id&&!pairs.has(transport.from_item_id)){
    pairs.set(transport.from_item_id,transport);
   }else other.push(transport);
  }
  return {...day,items:[...visits.flatMap(item=>pairs.has(item.id)?[item,pairs.get(item.id)]:[item]),...other]};
 });
}

function revealMatchingDay(region,days,query,type){
 const bounds=region.getBoundingClientRect();
 const matching=days.flatMap((day,index)=>day.items.some(item=>matchesFilter(item,query,type))?[region.children[index]]:[]);
 if(matching.some(lane=>{
  const rect=lane.getBoundingClientRect();
  return rect.left>=bounds.left&&rect.right<=bounds.right;
 }))return;
 if(matching.length)region.scrollLeft+=matching[0].getBoundingClientRect().left-bounds.left;
}

function LinksDialog({client,field,trip,items,budgetCategory,enabled,canInteract,session,close}){
 const titleId=useId(),dialog=useRef(null),viewport=useRef(null),closeButton=useRef(null);
 const scrollIntent=useRef(0),lastScroll=useRef({top:0,left:0});
 const scrollRecoveryUsed=useRef(false);
 const pointer=useRef(null),suppressClick=useRef(false);
 const backdropPress=useRef(false);
 const initialPositioned=useRef(false);
 const days=useMemo(()=>dayboardDays(trip,items),[trip,items]);
 const types=[...new Set(days.flatMap(day=>day.items.map(typeOf)))];
 const [filterType,setType]=useState(()=>{
  const category=budgetCategory?.trim();
  const alias=budgetCategoryAliases.get(category);
  return types.find(value=>value===alias||typeLabel(value)===category)||'';
 });
 const type=types.includes(filterType)?filterType:'';
 const [query,setQuery]=useState(''),[columns,setColumns]=useState(0);
 const [selectionNotice,setSelectionNotice]=useState('');
 const editable=enabled&&session.editable;
 const canSelect=editable||(canInteract&&!session.editable&&!session.peer&&!session.preparing&&!session.unresolved);
 const status=client.saveStatus(field.id,'links');
 let footerStatus=status;
 if(session.unresolved&&!editable){
  if(status==='連線待確認')footerStatus='連線待確認，變更已保留';
  else if(status==='尚未儲存')footerStatus='變更已保留';
 }
 else if(!session.unresolved&&!editable){
  if(session.preparing)footerStatus='準備中…';
  else if(status!=='連線待確認')footerStatus='編輯已暫停';
 }
 if(selectionNotice&&!session.unresolved&&!session.preparing)footerStatus=selectionNotice;
 const selectedIds=client.view(field).value||[];
 const selected=new Set(selectedIds);

 useLayoutEffect(()=>{
  const region=viewport.current;
  closeButton.current.focus({preventScroll:true});
  const resize=new ResizeObserver(([entry])=>setColumns(Math.max(1,Math.min(4,Math.floor(entry.contentRect.width/215)))));
  resize.observe(region);
  return()=>resize.disconnect();
 },[]);
 useLayoutEffect(()=>{
  if(!columns||initialPositioned.current)return;
  initialPositioned.current=true;
  if(type)revealMatchingDay(viewport.current,days,query,type);
 },[columns,days,query,type]);
 useLayoutEffect(()=>{
  if(!canSelect&&document.activeElement===document.body)closeButton.current.focus({preventScroll:true});
 },[canSelect]);

 function onKeyDown(event){
  if(event.key==='Escape'){
   event.preventDefault();
   event.stopPropagation();
   close();
   return;
  }
  if(event.key!=='Tab')return;
  const controls=[...dialog.current.querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]')];
  const firstControl=controls[0],lastControl=controls.at(-1);
  if(event.shiftKey&&event.target===firstControl){
   event.preventDefault();lastControl.focus();
  }else if(!event.shiftKey&&event.target===lastControl){
   event.preventDefault();firstControl.focus();
  }
 }

 function noteActivity(event,recover=true){
  if(!event.nativeEvent.isTrusted||!canInteract||session.peer)return;
  setSelectionNotice('');
  void client.actOnLinks(field,null,{recover});
 }
 function armScroll(event){
  if(!event.nativeEvent.isTrusted)return;
  const now=performance.now();
  if(now>=scrollIntent.current)scrollRecoveryUsed.current=false;
  scrollIntent.current=now+800;
 }
 function onScroll(event){
  const {scrollTop:top,scrollLeft:left}=event.currentTarget;
  const moved=top!==lastScroll.current.top||left!==lastScroll.current.left;
  if(moved&&performance.now()<scrollIntent.current){
   noteActivity(event,!scrollRecoveryUsed.current);
   if(!client.linksDialogState(field).editable)scrollRecoveryUsed.current=true;
  }
  lastScroll.current={top,left};
 }
 function startPan(event){
  if(!event.nativeEvent.isTrusted||!event.isPrimary)return;
  suppressClick.current=false;
  if(event.pointerType!=='mouse'||event.button!==0)return;
  pointer.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:event.currentTarget.scrollLeft,axis:null};
 }
 function movePan(event){
  const drag=pointer.current;
  if(!drag||drag.id!==event.pointerId||!event.nativeEvent.isTrusted)return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  const region=event.currentTarget;
  if(!drag.axis){
   if(Math.max(Math.abs(dx),Math.abs(dy))<7)return;
   suppressClick.current=true;
   drag.axis=Math.abs(dx)>Math.abs(dy)?'horizontal':'vertical';
   if(drag.axis==='horizontal'){
    region.setPointerCapture(drag.id);
    region.dataset.panning='';
   }
  }
  if(drag.axis!=='horizontal')return;
  armScroll(event);
  region.scrollLeft=drag.left-dx;
 }
 function finishPan(event){
  if(pointer.current?.id!==event.pointerId)return;
  pointer.current=null;
  delete event.currentTarget.dataset.panning;
 }
 function scrollWithKey(event){
  if(event.target!==event.currentTarget)return;
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){
   event.preventDefault();
   armScroll(event);
   const lane=event.currentTarget.querySelector('.bw-link-day');
   if(lane)event.currentTarget.scrollLeft+=(lane.offsetWidth+8)*(event.key==='ArrowLeft'?-1:1);
  }else if(scrollKeys.has(event.key))armScroll(event);
 }
 function changeFilter(event,text,category){
  noteActivity(event);
  setQuery(text);
  setType(category);
  scrollIntent.current=0;
  const region=viewport.current;
  region.scrollTop=0;
  revealMatchingDay(region,days,text,category);
 }
 async function toggle(event,item,checked){
  if(!event.nativeEvent.isTrusted||!canSelect)return;
  setSelectionNotice('');
  const result=await client.actOnLinks(field,{id:item.id,version:item.updated_at,selected:!checked});
  if(result==='changed')setSelectionNotice('行程已更新，請重新選取');
  if(result==='paused')setSelectionNotice('未變更關聯，請再試一次');
 }
 return createPortal(<div className="modal-backdrop bw-link-backdrop"
  onPointerDown={event=>{backdropPress.current=event.target===event.currentTarget;}}
  onClick={event=>{if(backdropPress.current&&event.target===event.currentTarget)close();}}>
  <section ref={dialog} className="bw-link-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
  <div className="bw-link-dialog-shell">
   <header><h2 id={titleId}>選取關聯行程</h2><button ref={closeButton} type="button" className="bw-icon" aria-label="關閉關聯行程" onClick={close}><X size={20}/></button></header>
   <div className="bw-link-toolbar">
    <label className="bw-link-search"><Search size={16} aria-hidden="true"/>
     <input aria-label="搜尋關聯行程" placeholder="搜尋行程名稱" autoComplete="off" value={query} onChange={event=>changeFilter(event,event.target.value,type)}/>
    </label>
    <div className="bw-link-type-filters" role="group" aria-label="行程分類">
     {['',...types].map(value=><button key={value} type="button" aria-pressed={type===value}
      onClick={event=>changeFilter(event,query,value)}>{value?typeLabel(value):'全部'}</button>)}
    </div>
   </div>
   <div ref={viewport} className="bw-link-dayboard" tabIndex={0} role="region" aria-label="多日行程"
    onScroll={onScroll} onWheel={armScroll} onTouchMove={armScroll} onKeyDown={scrollWithKey}
    onPointerDownCapture={startPan} onPointerMove={movePan} onPointerUp={finishPan}
    onPointerLeave={event=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))finishPan(event);}}
    onPointerCancel={finishPan} onLostPointerCapture={finishPan}
    onClickCapture={event=>{if(suppressClick.current&&event.detail>0){event.preventDefault();event.stopPropagation();}}}
    style={{'--bw-link-columns':Math.min(columns,days.length)||1}}>
    {days.map(day=>{
     const filtered=day.items.filter(item=>matchesFilter(item,query,type));
     return <section key={day.index} className="bw-link-day" aria-label={`Day ${day.index+1} 行程`}>
      <h3>Day {day.index+1}{day.date&&<small>{dayDate.format(day.date)}</small>}</h3>
      {filtered.map(item=>{
       const category=typeOf(item),checked=selected.has(item.id);
       return <button type="button" className="bw-link-card" key={item.id} aria-label={item.title||'未命名行程'} aria-pressed={checked}
        disabled={!canSelect} onClick={event=>void toggle(event,item,checked)} style={{'--bw-link-type':timelineTypeColor(category)}}>
        <span className="bw-link-card-meta">{item.start_time?.slice(0,5)||'未定時間'}<span>{typeLabel(category)}</span></span>
        <strong>{item.title||'未命名行程'}</strong>{checked&&<Check size={17} className="bw-link-card-check" aria-hidden="true"/>}
       </button>;
      })}
      {!filtered.length&&<p className="bw-link-empty">{query||type?'沒有符合的行程':'尚無行程'}</p>}
     </section>;
    })}
    {!days.length&&<p className="bw-link-empty">尚無行程</p>}
   </div>
   <footer><span>已關聯 {selectedIds.length} 項</span><span role="status" aria-label="關聯儲存狀態">{footerStatus}</span></footer>
  </div>
 </section></div>,document.body);
}

export default function ExpenseLinks({client,field,trip,items,budgetCategory,enabled,canInteract,owner,ownerName}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 const working=useRef(false),trigger=useRef(null);
 const selected=client.view(field).value||[];
 const session=client.linksDialogState(field);
 useEffect(()=>()=>{void client.endLinks(field);},[client,field]);
 function show(){
  setOpen(true);
  void client.openLinks(field);
 }
 const close=useCallback(()=>{
  setOpen(false);
  void client.endLinks(field).finally(()=>requestAnimationFrame(()=>{
   if(document.activeElement===document.body){
    const target=trigger.current?.disabled?trigger.current.closest('[role="group"]'):trigger.current;
    target?.focus({preventScroll:true});
   }
  }));
 },[client,field]);
 useLayoutEffect(()=>{
  if(open&&session.peer&&!session.unresolved)close();
 },[open,session.peer,session.unresolved,close]);
 async function remove(id){
  if(working.current)return;
  working.current=true;
  setBusy(true);
  try{
   if(!await client.beginLinks(field))return;
   client.input(field,client.view(field).value.filter(value=>value!==id));
   await client.endLinks(field);
  }finally{working.current=false;setBusy(false);}
 }
 const disabled=!enabled||field.local||open||busy||Boolean(owner)||Boolean(field.linksCloseWork);
 return <>
  <BudgetCollaborationFrame role="group" aria-label="關聯行程" tabIndex={0} label="關聯行程" ownerId={owner} ownerName={ownerName}
   className={`bw-link-summary${owner?' is-peer-held':''}`}>
   <div className="bw-link-summary-header"><span>關聯行程 <small>{selected.length} 項</small></span>
    <button ref={trigger} type="button" className="bw-link-open" aria-haspopup="dialog" disabled={disabled} onClick={show}>
     <Link2 size={14} aria-hidden="true"/>{selected.length?'編輯關聯行程':'新增關聯行程'}
    </button>
   </div>
   {selected.length>0&&<ul className="bw-linked-items">{selected.map(id=>{
    const item=items.find(entry=>entry.id===id),title=item?.title||'已移除的行程';
    return <li key={id}><span>{item?`Day ${Number(item.day_index)+1} · ${title}`:title}</span>
     <button type="button" className="bw-icon" disabled={disabled||Boolean(field.request)||field.conflict}
      aria-label={`取消關聯 ${title}`} onClick={()=>void remove(id)}><X size={13}/></button></li>;
   })}</ul>}
  </BudgetCollaborationFrame>
  {open&&<LinksDialog {...{client,field,trip,items,budgetCategory,enabled,canInteract,session,close}}/>}
 </>;
}
