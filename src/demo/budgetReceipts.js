import {createBudgetReceiptService} from '../lib/budgetReceiptGroups.js';
import {sourceSignature} from '../lib/budgetSourceValues.js';
export function attachDemoReceipts(service,getProps,{state,changed},now=Date.now){
 const read=service.read.bind(service),journal=new Map(),objects=new Map(),jobs=new Map();let overlay=null;
 const attachments=()=>{const p=getProps();if(overlay&&(overlay.trip!==p.activeTrip.id||sourceSignature(overlay.rows)===sourceSignature(p.attachments||[])))overlay=null;return overlay?.rows||p.attachments||[];};
 const row=id=>getProps().actualExpenses.find(a=>a.id===id),group=id=>state('actual',row(id),'receipts');
 const versions=id=>{const p=getProps(),a=row(id);return {source:state('actual',a,'source').revision,payment:state('actual',a,'payment').revision,graph:state('actual',a,'pricing').value.versions.graph,current:a.budget_item_id??null,origin:a.budget_origin_id??null,budget_graph:a.budget_item_id?state('budget',p.budgetItems.find(b=>b.id===a.budget_item_id),'pricing').value.versions.graph:0};};
 const value=id=>({ids:attachments().filter(a=>a.target_type==='actual_expense'&&a.target_id===id).map(a=>a.id).sort(),versions:versions(id)});
 const valid=args=>{const g=group(args.p_id);return g.owner===getProps().currentUserId&&g.session===args.p_session_id&&g.token===args.p_token&&g.epoch===args.p_epoch&&g.expires>now();};
 const authority=args=>{if(!row(args.p_id)||row(args.p_id).trip_id!==args.p_trip_id)return {code:'42501',message:'找不到實付項目。'};if(!valid(args))return {code:'55P03',message:'收據編輯權已到期。'};if(group(args.p_id).revision!==args.p_base_revision||sourceSignature(versions(args.p_id))!==sourceSignature(args.p_value?.versions||args.p_versions))return {code:'40001',message:'付款、來源或收據版本已變更，原收據保留。'};};
 const operation=i=>({request_id:i.request,pending:i.status==='pending',status:i.status,path:i.path,attachment_id:i.id,object_ready:objects.has(i.path),result:i.result});
 service.read=async trip=>{const result=await read(trip);if(!result.ok)return result;const d=result.data;d.attachments=structuredClone(attachments());d.metadataProtocol.schemaVersion=7;d.receiptProtocol={name:'budget-receipts',schemaVersion:1,enabled:true};d.receiptRecords=d.actualExpenses.map(a=>{const g=group(a.id),held=Boolean(g.owner&&g.expires>now());return {kind:'actual',id:a.id,trip_id:trip,supported:true,revision:g.revision,epoch:g.epoch,value:value(a.id),cleanup_pending:[...jobs.values()].some(j=>j.actual===a.id&&!j.done),cleanup_receipts:[...jobs.values()].filter(j=>j.actual===a.id&&!j.done&&j.old&&objects.get(j.path)?.id===j.object_id).map(j=>j.old),held,owner_id:held?g.owner:null,own_session:held};});return result;};
 const rpc=async(name,args)=>{
  if(name==='budget_receipts_lease'){
   if(!row(args.p_id))return {error:{code:'42501'}};const g=group(args.p_id),owns=g.owner===getProps().currentUserId&&g.session===args.p_session_id&&g.token===args.p_token;
   if(args.p_action==='release'){if(owns&&g.epoch===args.p_epoch)g.owner=null;changed();return {data:{granted:true}};}
   if(g.revision!==args.p_base_revision||sourceSignature(versions(args.p_id))!==sourceSignature(args.p_versions))return {error:{code:'40001'}};
   if(g.owner&&g.expires>now()&&!owns||args.p_action==='renew'&&(!owns||g.epoch!==args.p_epoch||g.expires<=now()))return {data:{granted:false}};
   if(!g.owner||g.expires<=now())g.epoch++;Object.assign(g,{owner:getProps().currentUserId,session:args.p_session_id,token:args.p_token,expires:now()+420000});changed();return {data:{granted:true,epoch:g.epoch,revision:g.revision,targets:[{kind:'actual',id:args.p_id,group:'receipts',epoch:g.epoch}],value:value(args.p_id)}};
  }
  if(name==='read_budget_receipt_operation'){const i=journal.get(args.p_request_id);return {data:i&&i.actor===getProps().currentUserId&&i.session===args.p_session_id?operation(i):null};}
  if(name==='claim_budget_receipt_cleanup'){
   const error=authority(args);if(error)return {error};const job=jobs.get(args.p_request_id);if(!job||job.done)return {data:null};job.token=crypto.randomUUID();job.args=args;return {data:{id:args.p_request_id,path:job.path,object_id:job.object_id,token:job.token}};
  }
  if(name==='finish_budget_receipt_cleanup'){const j=jobs.get(args.p_job_id);if(!j||j.token!==args.p_token)return {error:{code:'42501'}};j.done=!args.p_error&&!objects.has(j.path);return {data:j.done};}
  if(name==='abandon_budget_receipt'){const error=authority(args);if(error)return {error};const i=journal.get(args.p_request_id);if(!i||i.status==='committed')return {data:false};i.status='aborted';if(objects.has(i.path))jobs.set(i.request,{path:i.path,object_id:objects.get(i.path).id});return {data:true};}
  if(name!=='mutate_budget_receipts')throw new Error('Unsupported memory receipt operation');
  const signature=sourceSignature([getProps().currentUserId,args.p_trip_id,args.p_id,args.p_session_id,args.p_base_revision,args.p_value]);let i=journal.get(args.p_request_id);
  if(i&&i.signature!==signature)return {error:{code:'22023'}};if(i?.status==='committed')return {data:structuredClone(i.result)};if(i?.status==='aborted')return {error:{code:'55000'}};
  const error=authority(args);if(error)return {error};
  if(!i){if(args.p_phase!=='begin')return {error:{code:'22023'}};const old=attachments().find(a=>a.id===args.p_value.old_id&&a.target_id===args.p_id);if(args.p_value.action!=='upload'&&!old)return {error:{code:'40001'}};
   const id=crypto.randomUUID();i={request:args.p_request_id,actor:getProps().currentUserId,session:args.p_session_id,signature,status:'pending',id,path:`memory-receipts/${id}`,args,old};journal.set(i.request,i);
  }
  if(args.p_phase==='begin')return {data:operation(i)};
  const object=objects.get(i.path);if(args.p_value.action!=='delete'&&!object)return {error:{code:'40001',message:'上傳尚未確認。'}};
  const next=attachments().filter(a=>a.id!==i.old?.id);if(args.p_value.action!=='delete')next.push({id:i.id,trip_id:args.p_trip_id,target_type:'actual_expense',target_id:args.p_id,file_name:args.p_value.file.name,file_type:args.p_value.file.type,file_size:args.p_value.file.size,file_url:object.url,uploaded_by:getProps().currentUserId});
  if(i.old){const oldObject=[...objects.entries()].find(([,o])=>o.url===i.old.file_url);if(oldObject)jobs.set(i.request,{actual:args.p_id,old:i.old,path:oldObject[0],object_id:oldObject[1].id});}
  overlay={trip:args.p_trip_id,rows:next};getProps().onSaveReceipts?.(next);group(args.p_id).revision++;changed();i.status='committed';i.result={kind:'actual',id:args.p_id,group:'receipts',revision:group(args.p_id).revision,request_id:i.request,value:value(args.p_id),undo_supported:false};return {data:structuredClone(i.result)};
 };
 const storageFor=async headers=>({
  async upload(path,file){const i=journal.get(headers['x-receipt-request']);if(!i||i.path!==path||i.status!=='pending'||!valid({...i.args,p_token:headers['x-receipt-token'],p_epoch:Number(headers['x-receipt-epoch'])}))return {error:{code:'403'}};if(objects.has(path))return {error:{code:'409'}};objects.set(path,{id:crypto.randomUUID(),url:URL.createObjectURL(file)});return {data:{path}};},
  async remove(paths){const j=jobs.get(headers['x-receipt-request']);if(!j||j.token!==headers['x-receipt-cleanup']||!valid(j.args))return {error:{code:'403'}};for(const path of paths){if(path!==j.path||objects.get(path)?.id!==j.object_id)return {error:{code:'403'}};URL.revokeObjectURL(objects.get(path).url);objects.delete(path);}return {data:paths};},
 });
 service.receiptService=createBudgetReceiptService({rpc,auth:{getSession:async()=>({data:{session:{user:{id:getProps().currentUserId}}}})}},storageFor);
 service.disposeReceipts=()=>{for(const o of objects.values())URL.revokeObjectURL(o.url);objects.clear();};
 return service;
}
