import {cloneElement,useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {DndContext,DragOverlay,KeyboardSensor,MouseSensor,pointerWithin,
 TouchSensor,useSensor,useSensors} from '@dnd-kit/core';
import {SortableContext,useSortable} from '@dnd-kit/sortable';
import {GripVertical,Move} from 'lucide-react';
import {withBudgetAuthorityTimeout} from '../../lib/budgetMetadataService.js';
import {collaboratorColor} from '../../lib/collaboratorColors.js';
import {expenseOrderProjection} from '../../lib/expenseOrdering.js';
import {notify} from '../../lib/notifications.js';

const dragId=({kind,id})=>JSON.stringify([kind,id]);
const definiteFailure=new Set(['PT409','55P03','42501','22023','55000']);
const toastId='budget-order-error';
const dropTargets=(active,containers)=>containers.filter(container=>
 active.data.current?.kind==='item'||container.data.current?.kind==='category');

export function ExpenseDragRow({resource,enabled,peer,indicator,children}){
 const id=dragId(resource);
 const drag=useSortable({id,data:resource,disabled:{draggable:!enabled||Boolean(peer),droppable:false}});
 const handle=peer?<span className="bw-drag-handle bw-remote-move" aria-hidden="true"
  style={{color:collaboratorColor(peer.user_id)}}><Move size={14}/></span>:
  <button ref={drag.setActivatorNodeRef} type="button" className="bw-drag-handle" disabled={!enabled}
   {...drag.attributes} {...drag.listeners} aria-label={`拖曳${resource.kind==='category'?'分類':'項目'}「${resource.label}」`}
   onClick={event=>event.stopPropagation()}><GripVertical size={15}/></button>;
 const row=children(handle);
 return cloneElement(row,{
  ref:drag.setNodeRef,
  'data-expense-drag-id':id,
  className:[row.props.className,drag.isDragging?'is-drag-source':'',peer?'has-remote-drag':'',indicator?`is-drop-${indicator}`:''].filter(Boolean).join(' '),
 });
}

function DragPreview({preview}){
 const mount=useRef(null);
 useLayoutEffect(()=>{
  const node=mount.current;
  node.replaceChildren(preview.row);
  return()=>node.replaceChildren();
 },[preview]);
 return <table aria-hidden="true" inert="" className="bw-table bw-expense-table bw-drag-preview"
  style={{width:preview.width,height:preview.height}}><tbody ref={mount}/></table>;
}

function previewOf(node){
 const {width,height}=node.getBoundingClientRect();
 const row=node.cloneNode(true);
 row.classList.remove('is-selected','has-collaborators','is-drag-source','has-remote-drag');
 row.querySelectorAll('.bw-collaboration-outline').forEach(element=>element.remove());
 row.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));
 Array.from(row.cells).forEach((cell,index)=>{cell.style.width=`${node.cells[index].getBoundingClientRect().width}px`;});
 return {row,width,height};
}

export default function ExpenseDragBoard({rows,categories,enabled,active,viewKey,graph,service,actor,session,storage,refresh,children}){
 const storageKey=`travel-planner-expense-order:${actor}:${graph.tripId}`;
 const [pending,setPending]=useState(()=>{
  try{return JSON.parse(storage?.getItem(storageKey)||'null');}catch{return null;}
 });
 const [drag,setDrag]=useState(null),[optimistic,setOptimistic]=useState(null),[indicator,setIndicator]=useState(null);
 const [generation,setGeneration]=useState(0),[time,setTime]=useState(Date.now);
 const current=useRef(null),hit=useRef(null),work=useRef(false),mounted=useRef(false),refreshRef=useRef(refresh);
 refreshRef.current=refresh;
 const keyboardCoordinates=useCallback((event,{context})=>{
  if(!['ArrowUp','ArrowDown'].includes(event.code)||!context.active)return;
  event.preventDefault();
  const candidates=dropTargets(context.active,context.droppableContainers.getEnabled())
   .map(container=>({id:container.id,target:container.data.current,rect:container.node.current?.getBoundingClientRect()}))
   .filter(entry=>entry.rect).sort((a,b)=>a.rect.top-b.rect.top);
  const origin=candidates.findIndex(entry=>entry.id===context.active.id);
  const index=candidates.findIndex(entry=>entry.id===(hit.current?.id||context.active.id));
  const nextIndex=index+(event.code==='ArrowUp'?-1:1),next=candidates[nextIndex];
  if(!next||origin<0)return;
  const side=next.target.kind==='category'&&context.active.data.current.kind==='item'?'end':nextIndex<origin?'before':'after';
  hit.current=nextIndex===origin?null:{id:next.id,target:next.target,side};
  setIndicator(hit.current);
  return {x:next.rect.left,y:next.rect.top};
 },[]);
 const sensors=useSensors(useSensor(MouseSensor,{activationConstraint:{distance:5}}),
  useSensor(TouchSensor,{activationConstraint:{delay:180,tolerance:7}}),
  useSensor(KeyboardSensor,{coordinateGetter:keyboardCoordinates}));
 const release=request=>service.dragLease({...request,p_action:'release'});
 const remember=request=>{
  try{if(request)storage?.setItem(storageKey,JSON.stringify(request));else storage?.removeItem(storageKey);}catch{/* Recovery remains in memory. */}
  if(mounted.current)setPending(request);
 };
 function cancel(reset=false){
  const entry=current.current;
  if(!entry)return;
  current.current=null;
  clearTimeout(entry.timer);
  if(entry.granted)void release(entry.request);
  if(mounted.current){
   setDrag(null);
   setIndicator(null);
   if(reset)setGeneration(value=>value+1);
  }
 }
 useEffect(()=>{
  mounted.current=true;
  return()=>{mounted.current=false;cancel();};
 },[service,storageKey,session]);
 useEffect(()=>{
  if(!active||!enabled||drag&&drag.viewKey!==viewKey)cancel(true);
 },[active,enabled,viewKey,drag]);
 useEffect(()=>{
  const cancelHidden=()=>{if(document.visibilityState==='hidden')cancel(true);};
  const stop=()=>cancel(true);
  window.addEventListener('pagehide',stop);
  window.addEventListener('offline',stop);
  window.addEventListener('blur',stop);
  document.addEventListener('visibilitychange',cancelHidden);
  return()=>{
   window.removeEventListener('pagehide',stop);
   window.removeEventListener('offline',stop);
   window.removeEventListener('blur',stop);
   document.removeEventListener('visibilitychange',cancelHidden);
  };
 },[service]);

 const serverOffset=Date.parse(graph.serverNow)-Date.now();
 const presence=(graph.ordering?.drags||[]).filter(entry=>!entry.own_session&&Date.parse(entry.expires_at)>Date.parse(graph.serverNow));
 // Anchor expiry to the time this snapshot arrived, so a quiet connection still clears a peer drag.
 const clock=useRef(null);
 if(clock.current?.snapshot!==graph)clock.current={snapshot:graph,offset:serverOffset,received:Date.now()};
 const peerTime=Math.max(time,clock.current.received)+clock.current.offset;
 const peers=new Map(presence.filter(entry=>Date.parse(entry.expires_at)>peerTime).map(entry=>[dragId(entry),entry]));
 const nextExpiry=Math.min(...Array.from(peers.values(),entry=>Date.parse(entry.expires_at)-clock.current.offset));
 useEffect(()=>{
  if(!Number.isFinite(nextExpiry))return;
  const timer=setTimeout(()=>setTime(Date.now()),Math.max(0,nextExpiry-Date.now())+20);
  return()=>clearTimeout(timer);
 },[nextExpiry]);

 async function submit(request,confirm){
  if(work.current||navigator.onLine===false)return;
  work.current=true;
  try{
   if(!await service.authorized(actor))return;
   const result=await withBudgetAuthorityTimeout(service.moveOrder({...request,p_confirm:confirm}));
   const receipt=result.data;
   const recognized=receipt?.request_id===request.p_request_id&&(receipt.committed===true||confirm&&receipt.committed===false);
   if(!recognized&&!definiteFailure.has(result.error?.code)){
    if(mounted.current){
     setOptimistic(null);
     if(!confirm)notify.error('排序結果待確認，重新連線後會查證。',{id:toastId});
    }
    return;
   }
   if(receipt?.committed!==true){
    if(mounted.current)setOptimistic(null);
    const {p_trip_id,p_kind,p_id,p_session_id,p_token}=request;
    await withBudgetAuthorityTimeout(release({p_trip_id,p_kind,p_id,p_session_id,p_token}));
    if(mounted.current)notify.error(result.error?.code==='55P03'?'項目正在被操作或拖曳已逾時，排序未儲存。':'排序未儲存，已重新確認最新順序。',{id:toastId});
   }
   if(mounted.current)await refreshRef.current();
   remember(null);
   if(mounted.current)setOptimistic(null);
  }finally{work.current=false;}
 }
 useEffect(()=>{
  if(!pending||!active)return;
  const reconcile=()=>{if(document.visibilityState!=='hidden')void submit(pending,true);};
  const timer=setInterval(reconcile,5000);
  window.addEventListener('online',reconcile);
  window.addEventListener('focus',reconcile);
  return()=>{clearInterval(timer);window.removeEventListener('online',reconcile);window.removeEventListener('focus',reconcile);};
 },[pending,active,service,actor]);

 function start({active:source,activatorEvent}){
  const resource=source.data.current;
  const node=source.node?.current||document.querySelector(`[data-expense-drag-id="${CSS.escape(source.id)}"]`);
  if(!enabled||pending||current.current||!node)return;
  const request={p_trip_id:graph.tripId,p_kind:resource.kind,p_id:resource.id,p_session_id:session,p_token:crypto.randomUUID()};
  hit.current=null;
  const entry={resource,request,viewKey,rows,categories,preview:previewOf(node),keyboard:activatorEvent.type==='keydown',granted:false};
  current.current=entry;
  setDrag(entry);
  entry.admission=withBudgetAuthorityTimeout(service.dragLease({...request,p_action:'acquire'}),{
   late:result=>{if(result.data?.granted)void release(request);},
  }).then(result=>{
   if(!result.data?.granted){
    if(current.current===entry){
     notify.error('目前無法拖曳此項目，請重新確認後再試。',{id:toastId});
     cancel(true);
     void refreshRef.current();
    }
    return false;
   }
   if(current.current!==entry){void release(request);return false;}
   entry.granted=true;
   const remaining=Date.parse(result.data.expires_at)-Date.parse(result.data.server_now);
   entry.timer=setTimeout(()=>{if(current.current===entry){cancel(true);notify.error('拖曳已逾時，請再試一次。',{id:toastId});}},remaining);
   return true;
  });
 }

 function collisions(args){
  if(!args.pointerCoordinates)return hit.current?[{id:hit.current.id}]:[];
  const candidates=dropTargets(args.active,args.droppableContainers);
  const result=pointerWithin({...args,droppableContainers:candidates});
  const id=result[0]?.id,rect=args.droppableRects.get(id),target=candidates.find(c=>c.id===id)?.data.current;
  hit.current=null;
  if(rect&&target&&id!==args.active.id){
   const side=target.kind==='category'&&args.active.data.current.kind==='item'?'end':
    args.pointerCoordinates.y<rect.top+rect.height/2?'before':'after';
   hit.current={id,target,side};
  }
  return result;
 }
 const highlight=()=>setIndicator(current=>current?.id===hit.current?.id&&current?.side===hit.current?.side?current:hit.current);
 async function end({over}){
  const entry=current.current,destination=hit.current;
  if(!entry||!destination||!entry.keyboard&&destination.id!==over?.id){cancel();return;}
  if(!await entry.admission||current.current!==entry)return;
  const {resource,request}=entry,{target,side}=destination;
  current.current=null;
  clearTimeout(entry.timer);
  setDrag(null);
  setIndicator(null);
  setOptimistic({...expenseOrderProjection(entry.rows,entry.categories,resource,target,side),viewKey:entry.viewKey});
  const intent=resource.kind==='category'?{target:target.id,side,revision:resource.revision}:{
   target:target.kind==='item'?target.id:null,side,revision:resource.revision,sourceCategory:resource.category,
   category:target.category,categoryRevision:resource.categoryRevision,targetCategoryRevision:target.categoryRevision,
  };
  const operation={...request,p_request_id:crypto.randomUUID(),p_intent:intent};
  remember(operation);
  await submit(operation,false);
  if(entry.keyboard&&mounted.current)requestAnimationFrame(()=>{
   if(document.activeElement!==document.body)return;
   const focusId=CSS.escape(dragId(resource));
   const fallback=CSS.escape(dragId({kind:'category',id:target.category}));
   (document.querySelector(`[data-expense-drag-id="${focusId}"] button.bw-drag-handle:not(:disabled)`)||
    document.querySelector(`[data-expense-drag-id="${fallback}"] button.bw-drag-handle:not(:disabled)`))?.focus({preventScroll:true});
  });
 }
 const layout=enabled&&(drag?.viewKey===viewKey?drag:optimistic?.viewKey===viewKey?optimistic:null);
 const shownRows=layout?.rows||rows,shownCategories=layout?.categories||categories;
 const sortableIds=shownCategories.flatMap(id=>[dragId({kind:'category',id}),
  ...shownRows.filter(row=>row.category===id).map(row=>dragId({kind:'item',id:row.id}))]);
 return <DndContext key={generation} sensors={sensors} collisionDetection={collisions}
  accessibility={{screenReaderInstructions:{draggable:'按空白鍵開始拖曳，用上下方向鍵移動，按空白鍵放下，或按 Escape 取消。'}}}
  onDragStart={start} onDragMove={highlight} onDragOver={highlight} onDragEnd={end} onDragCancel={()=>cancel()}>
  <SortableContext items={sortableIds}>{children({rows:shownRows,categories:shownCategories,enabled:enabled&&!pending,
   peer:resource=>peers.get(dragId(resource)),indicator:resource=>indicator?.id===dragId(resource)?indicator.side:null})}</SortableContext>
  {createPortal(<DragOverlay dropAnimation={null} zIndex={70} style={{pointerEvents:'none'}}>
   {drag&&<DragPreview preview={drag.preview}/>}
  </DragOverlay>,document.body)}
 </DndContext>;
}
