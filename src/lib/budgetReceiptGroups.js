import {createBudgetPaymentController} from './budgetPaymentGroups.js';
import {validReceiptValue,sameReceiptValue,receiptFile} from './budgetReceiptValues.js';
import {sourceSignature} from './budgetSourceValues.js';
import {withBudgetAuthorityTimeout,budgetAuthorityTimeoutMs} from './budgetMetadataService.js';
export function createBudgetReceiptService(supabase,storageFor,{timeoutMs=budgetAuthorityTimeoutMs}={}){
 const uploads=new Map(),bounded=work=>withBudgetAuthorityTimeout(work,{timeoutMs});
 const rpc=async(name,args)=>{try{return await bounded(supabase.rpc(name,args));}catch(error){return {error};}};
 const headers=r=>({'x-receipt-session':r.p_session_id,'x-receipt-token':r.p_token,'x-receipt-epoch':String(r.p_epoch),'x-receipt-request':r.p_request_id});
 const phase=(r,p)=>rpc('mutate_budget_receipts',{...r,p_phase:p});
 const inspect=r=>rpc('read_budget_receipt_operation',{p_trip_id:r.p_trip_id,p_id:r.p_id,p_session_id:r.p_session_id,p_request_id:r.p_request_id});
 return {authorized:async actor=>{try{const session=await bounded(supabase.auth.getSession());return session.data?.session?.user?.id===actor;}catch{return false;}},lease:args=>rpc('budget_receipts_lease',args),inspect,abandon:async args=>{const result=await rpc('abandon_budget_receipt',args);if(result.data===true)uploads.delete(args.p_request_id);return result;},
  async mutate(request,file){
   let result=await phase(request,'begin');if(result.error)return result;
   let operation=result.data;if(operation.group==='receipts')return result;
   if(operation.status!=='pending')return {error:{message:'收據操作狀態尚未確認。'}};
   if(request.p_value.action!=='delete'&&!operation.object_ready){
    if(!file)return {error:{code:'RECEIPT_FILE_REQUIRED',message:'請重新選擇原收據檔案以繼續；原有效收據仍保留。'}};
    let work=uploads.get(request.p_request_id);
    if(!work||work.settled){work={settled:false};work.promise=Promise.resolve().then(async()=>{const storage=await storageFor(headers(request));return storage.upload(operation.path,file,{contentType:file.type,upsert:false});}).catch(error=>({error}));work.promise.then(()=>{work.settled=true;});uploads.set(request.p_request_id,work);}
    const uploaded=await bounded(work.promise);
    // An upload error/timeout is not proof of absence. Inspect the same intent
    // before another upload, and never generate another path/request here.
    const confirmed=await inspect(request);if(confirmed.error)return confirmed;
    if(!confirmed.data?.object_ready)return uploaded.error?uploaded:{error:{message:'檔案上傳仍待確認，請重試原操作。'}};
    operation=confirmed.data;
   }
   const committed=await phase(request,'commit');if(committed.data)uploads.delete(request.p_request_id);return committed;
  },
  async cleanup(request,receipt){
   // Logical deletion/replacement has committed. Failed byte cleanup remains a
   // durable job; it must not turn a successful metadata transaction into an
   // unknown mutation or trigger another upload.
   const c=await rpc('claim_budget_receipt_cleanup',{p_trip_id:request.p_trip_id,p_id:request.p_id,p_session_id:request.p_session_id,p_token:request.p_token,p_epoch:request.p_epoch,p_base_revision:receipt.revision,p_versions:receipt.value.versions,p_request_id:request.p_request_id});
   if(c.data){try{const storage=await storageFor({...headers(request),'x-receipt-request':c.data.id,'x-receipt-cleanup':c.data.token}),deleted=await storage.remove([c.data.path]);await rpc('finish_budget_receipt_cleanup',{p_job_id:c.data.id,p_token:c.data.token,p_error:deleted.error?.message||null});}catch{/* Persistent worker retries this claimed job after expiry. */}}
   return c;
  },
 };
}
export function createBudgetReceiptController(options){
 const {metadata,service}=options,files=new Map();let scope='';
 const transport={...service,mutate:r=>service.mutate(r,files.get(`${scope}:${r.p_id}`)?.file),cleanup:(r,receipt)=>service.cleanup(r,receipt)};
 const controller=createBudgetPaymentController({...options,service:transport,operation:{group:'receipts',label:'收據',records:'receiptRecords',actions:['upload','replace','delete'],allowPark:true,validValue:validReceiptValue,sameValue:sameReceiptValue,
  retainRequestOnError:code=>!['22023','22P02'].includes(code),
  afterConfirmed:({request,receipt,service})=>service.cleanup(request,receipt),
  async abandon({entry:e,metadata,service,makeId}){
   const inspected=await service.inspect(e.request);if(inspected.error)return inspected;if(inspected.data?.status==='committed')return {error:{message:'此收據已提交，請先確認同步結果。'}};
   if(!(await metadata.refresh()).ok)return {error:{message:'請連線確認後再取消；原操作仍可恢復。'}};
   const row=metadata.status().snapshot?.receiptRecords?.find(r=>r.id===e.id);if(!row)return {error:{message:'實付項目已不存在，清理將由持久佇列處理。'}};
   const r=e.request,token=e.token||makeId(),args={p_trip_id:r.p_trip_id,p_id:r.p_id,p_session_id:r.p_session_id,p_token:token,p_base_revision:row.revision,p_versions:row.value.versions},admission=await service.lease({...args,p_kind:'actual',p_action:'acquire',p_epoch:null,p_intent:r.p_value});
   if(!admission.data?.granted)return {error:admission.error||{message:'收據編輯權尚未確認。'}};
   const result=await service.abandon({...args,p_epoch:admission.data.epoch,p_request_id:r.p_request_id});return result.data===true?{aborted:true,capability:{token,epoch:admission.data.epoch}}:{error:result.error};
  },
  async recover({entry:e,metadata,service,makeId}){
   const state=await service.inspect(e.request);if(state.error)return state;if(state.data?.status==='committed')return {};
   if(!(await metadata.refresh()).ok)return {error:{message:'最新收據狀態尚未確認。'}};
   const row=metadata.status().snapshot?.receiptRecords?.find(r=>r.id===e.id);
   if(!row||row.revision!==e.request.p_base_revision||sourceSignature(row.value.versions)!==sourceSignature(e.request.p_value.versions))return {error:{message:'付款、來源或收據版本已變更；保留原檔案，請取消此操作後重新確認。'}};
   const token=e.token||makeId(),r=e.request,result=await service.lease({p_trip_id:r.p_trip_id,p_kind:'actual',p_id:r.p_id,p_session_id:r.p_session_id,p_token:token,p_action:'acquire',p_base_revision:r.p_base_revision,p_epoch:null,p_versions:r.p_value.versions,p_intent:r.p_value});
   return result.data?.granted?{data:{token,epoch:result.data.epoch}}:{error:result.error||{message:'其他分頁持有收據編輯權，請稍後重試。'}};
  },
  validAdmission:(data,e)=>Array.isArray(data.targets)&&data.targets.length===1&&data.targets[0].kind==='actual'&&data.targets[0].id===e.id&&data.targets[0].group==='receipts'&&data.targets[0].epoch===data.epoch,
  validReceipt:(data,r)=>r.p_value.action==='delete'?!data.value.ids.includes(r.p_value.old_id):Boolean(data.value.ids.length)&&(!r.p_value.old_id||!data.value.ids.includes(r.p_value.old_id)),
  async prepare({snapshot,kind,id,intent}){
   const row=snapshot?.receiptRecords?.find(r=>r.id===id);if(kind!=='actual'||!snapshot?.receiptProtocol?.enabled||!row?.supported||!validReceiptValue(row.value))return {error:{message:'收據協作尚未啟用或權限尚未確認。'}};
   const file=intent.action==='delete'?null:await receiptFile(intent.file);if(file)files.set(`${scope}:${id}`,{file:intent.file,descriptor:file});
   return {data:{revision:row.revision,versions:row.value.versions,targets:[{kind:'actual',id,group:'receipts'}],intent:{action:intent.action,old_id:intent.old_id||null,file}}};
  },
 }});
 const finish=async(key,work)=>{const ok=await work;if(ok)files.delete(key);return ok;};
 return {...controller,configure(actor,trip,editable){const next=`${actor}:${trip}`;if(next!==scope)files.clear();scope=next;controller.configure(actor,trip,editable);},
  upload:(id,file,old_id=null)=>finish(`${scope}:${id}`,controller.execute('actual',id,{action:old_id?'replace':'upload',file,old_id})),remove:(id,old_id)=>controller.execute('actual',id,{action:'delete',old_id}),
  retry:(kind,id)=>finish(`${scope}:${id}`,controller.retry(kind,id)),abandon:(kind,id)=>finish(`${scope}:${id}`,controller.abandon(kind,id)),
  async reselect(id,file){const descriptor=await receiptFile(file),entry=controller.get('actual',id);if(!entry?.request||sourceSignature(descriptor)!==sourceSignature(entry.request.p_value.file))throw new Error('請選擇與原操作相同的檔案。');files.set(`${scope}:${id}`,{file,descriptor});return finish(`${scope}:${id}`,controller.retry('actual',id));},
 };
}
