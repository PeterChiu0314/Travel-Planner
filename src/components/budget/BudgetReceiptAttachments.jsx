import {useState,useSyncExternalStore} from 'react';
export default function BudgetReceiptAttachments({client,metadata,record,members,AttachmentList,onOpen,fallbackAttachments=[]}){
 useSyncExternalStore(client.subscribe,client.getVersion);const [localError,setLocalError]=useState(''),state=client.view('actual',record.id),snapshot=metadata.status().snapshot,receipt=snapshot?.receiptRecords?.find(r=>r.id===record.id);
 const enabled=metadata.status().editable&&metadata.status().verified&&snapshot?.receiptProtocol?.enabled&&receipt?.supported;
 const held=receipt?.held&&!receipt.own_session,owner=members.find(m=>m.user_id===receipt?.owner_id),pending=state.active;
 return <section aria-label="實付收據" aria-busy={Boolean(state.busy)}>
  <AttachmentList attachments={(snapshot?.attachments||fallbackAttachments).filter(a=>a.target_type==='actual_expense'&&a.target_id===record.id&&(!state.receipt||state.receipt.value.ids.includes(a.id)))} canEdit={enabled&&!held&&!pending} targetId={record.id} targetType="actual_expense" onOpen={onOpen}
   onUpload={(_,id,file)=>client.upload(id,file)} onDelete={a=>client.remove(record.id,a.id)} onReplace={(a,file)=>client.upload(record.id,file,a.id)}/>
  {held?<p role="status">{owner?.display_name||owner?.user_id||'其他成員'} 正在操作收據</p>:null}
  {state.busy?<p role="status">{({upload:'正在上傳收據',replace:'正在替換收據',delete:'正在刪除收據'})[state.intent?.action]||'正在確認收據'}，完成確認前請保留此畫面…</p>:state.syncPending?<p role="status">收據已提交，最新同步待確認</p>:null}
  {receipt?.cleanup_pending?<p className="bw-muted" role="status">收據已更新，舊檔清理待重試。</p>:null}
  {receipt?.cleanup_receipts?.map(a=><p className="bw-muted" key={a.id}>待清理原檔：<button type="button" className="ghost-button compact" onClick={()=>onOpen(a)}>{a.file_name}</button></p>)}
  {state.error?<p className="bw-warning" role="alert">{state.error}</p>:null}
  {pending&&!state.busy?<div className="form-actions"><button type="button" className="ghost-button compact" onClick={()=>void client.retry('actual',record.id)}>確認／重試收據操作</button>
   {state.request?.p_value?.file?<label className="attachment-upload">重新選擇原檔案<input aria-label="重新選擇原收據" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event=>{const file=event.target.files?.[0];setLocalError('');if(file)void client.reselect(record.id,file).catch(e=>setLocalError(e.message));event.target.value='';}}/></label>:null}
   {state.request?<button type="button" className="ghost-button compact" onClick={()=>void client.abandon('actual',record.id)}>取消未完成操作</button>:null}</div>:null}
  {pending&&!state.busy?<button type="button" className="ghost-button compact" onClick={()=>client.park('actual',record.id)}>保留操作，稍後確認</button>:null}
  {state.parked?<p role="status">已保留待確認操作，可先離開。重新開啟後仍需確認原請求。</p>:null}
  {localError?<p role="alert" className="bw-warning">{localError}</p>:null}
 </section>;
}
