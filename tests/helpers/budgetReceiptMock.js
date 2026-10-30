import {sourceBackend,enableMetadata,boot as sourceBoot} from './budgetSourceMock.js';
import {sourceSignature} from '../../src/lib/budgetSourceValues.js';
export async function enableReceipts(page){await enableMetadata(page);await page.route('**/src/lib/budgetReceiptConfig.js*',r=>r.fulfill({contentType:'text/javascript',body:'export const budgetReceiptsEnabled=true;'}));}
export async function boot(page,db,actor='A'){
 await page.route('**/src/lib/budgetReceiptStorage.js*',r=>r.fulfill({contentType:'text/javascript',body:`export async function receiptStorage(client,headers){const actor=(await client.auth.getSession()).data.session.user.id;return {upload:async(path,file)=>window.budgetBackend({op:'receipt-storage',action:'upload',path,file:{name:file.name,type:file.type,size:file.size},headers,actor}),remove:async paths=>window.budgetBackend({op:'receipt-storage',action:'remove',paths,headers,actor})};}`}));
 await sourceBoot(page,db,actor);
}
export function receiptBackend(){
 const db=sourceBackend(),original=db.request.bind(db);db.receiptEnabled=true;db.receiptCalls=[];db.receiptIntents=new Map();db.receiptObjects=new Map();db.receiptJobs=new Map();db.receiptStorageCalls=[];db.receiptPending=[];db.releaseReceipt=()=>{db.receiptHold=null;db.receiptPending.splice(0).forEach(r=>r());};
 const state=id=>{const key=`actual:${id}:receipts`;if(!db.groupStates.has(key))db.groupStates.set(key,{revision:0,epoch:0});return db.groupStates.get(key);};
 const versions=id=>{const row=db.rows.actual_expenses.find(a=>a.id===id);return {source:db.groupStates.get(`actual:${id}:source`)?.revision||0,payment:db.groupStates.get(`actual:${id}:payment`)?.revision||0,graph:db.paymentGraph,current:row.budget_item_id??null,origin:row.budget_origin_id??null,budget_graph:db.paymentGraph};};
 const value=id=>({ids:db.rows.attachments.filter(a=>a.target_type==='actual_expense'&&a.target_id===id).map(a=>a.id).sort(),versions:versions(id)});
 const owns=(args,actor)=>{const g=state(args.p_id);return g.actor===actor&&g.session===args.p_session_id&&g.token===args.p_token&&g.epoch===args.p_epoch&&g.expires>db.now;};
 const inspect=i=>i?{request_id:i.request,status:i.status,path:i.path,attachment_id:i.id,object_ready:db.receiptObjects.has(i.path),result:i.result}:null;
 db.request=async req=>{
  const {name,args,actor}=req;
  if(req.op==='receipt-storage'){
   db.receiptStorageCalls.push(structuredClone(req));const headers=req.headers,i=db.receiptIntents.get(headers['x-receipt-request']),g=i&&state(i.args.p_id),authorized=i&&g.actor===actor&&g.session===headers['x-receipt-session']&&g.token===headers['x-receipt-token']&&g.epoch===Number(headers['x-receipt-epoch'])&&g.expires>db.now;
   if(db.offline)return {error:{message:'offline'}};
   if(req.action==='upload'){if(!authorized||i.path!==req.path||i.status!=='pending')return {error:{code:'403',message:'Storage denied'}};if(db.receiptUploadFailure)return {error:{message:'upload unavailable'}};if(db.receiptStorageBefore)await db.receiptStorageBefore.promise;if(db.receiptObjects.has(i.path))return {error:{code:'409'}};db.receiptObjects.set(i.path,{id:crypto.randomUUID(),...req.file});if(db.receiptStorageHold)await db.receiptStorageHold.promise;if(db.receiptUploadAckLost){db.receiptUploadAckLost=false;return {error:{message:'upload ACK lost'}};}return {data:{path:i.path}};}
   const job=db.receiptJobs.get(headers['x-receipt-request']);if(!job||job.token!==headers['x-receipt-cleanup'])return {error:{code:'403'}};if(db.receiptDeleteFailure)return {error:{message:'Storage remove failed'}};for(const path of req.paths){if(path!==job.path||db.receiptObjects.get(path)?.id!==job.object_id)return {error:{code:'403'}};db.receiptObjects.delete(path);}return {data:req.paths};
  }
  if(name==='read_budget_metadata_snapshot_v7'){
   if(db.receiptMissingSnapshot)return {error:{code:'PGRST202',message:'Receipt snapshot missing'}};
   const result=await original({...req,name:'read_budget_metadata_snapshot_v6'});if(result.error)return result;const d=result.data;d.metadataProtocol.schemaVersion=7;d.receiptProtocol={name:'budget-receipts',schemaVersion:1,enabled:db.receiptEnabled};d.receiptRecords=d.actualExpenses.map(a=>{const g=state(a.id),held=Boolean(g.actor&&g.expires>db.now);return {kind:'actual',id:a.id,trip_id:a.trip_id,supported:true,revision:g.revision,epoch:g.epoch,value:value(a.id),held,owner_id:held?g.actor:null,own_session:held&&g.actor===actor&&g.session===args.p_session_id,cleanup_receipts:[...db.receiptJobs.values()].filter(j=>j.actual===a.id&&!j.done&&j.old&&db.receiptObjects.get(j.path)?.id===j.object_id).map(j=>j.old),cleanup_pending:[...db.receiptJobs.values()].some(j=>j.actual===a.id&&!j.done)};});
   if(db.receiptSnapshotHold)await db.receiptSnapshotHold.promise;return result;
  }
  if(!['budget_receipts_lease','mutate_budget_receipts','read_budget_receipt_operation','claim_budget_receipt_cleanup','finish_budget_receipt_cleanup','abandon_budget_receipt'].includes(name))return original(req);
  db.receiptCalls.push(structuredClone(req));if(db.receiptHold?.actor===actor&&db.receiptHold.phase===(args.p_phase||args.p_action))await new Promise(r=>db.receiptPending.push(r));if(db.offline)return {error:{message:'offline'}};
  if(!db.members.some(m=>m.trip_id===args.p_trip_id&&m.user_id===actor&&m.status==='approved'&&m.role!=='viewer')&&!['finish_budget_receipt_cleanup'].includes(name))return {error:{code:'42501',message:'Forbidden'}};
  if(name==='finish_budget_receipt_cleanup'){const j=db.receiptJobs.get(args.p_job_id);if(j?.token!==args.p_token)return {error:{code:'42501'}};j.done=!args.p_error&&!db.receiptObjects.has(j.path);return {data:j.done};}
  if(name==='read_budget_receipt_operation'){const i=db.receiptIntents.get(args.p_request_id);return {data:i?.actor===actor&&i.args.p_session_id===args.p_session_id?inspect(i):null};}
  const g=state(args.p_id);
  if(name==='budget_receipts_lease'){
   if(args.p_action==='release'){if(owns(args,actor))g.actor=null;return {data:{granted:true}};}
   if(!db.receiptEnabled)return {error:{code:'55000'}};if(g.revision!==args.p_base_revision||sourceSignature(versions(args.p_id))!==sourceSignature(args.p_versions))return {error:{code:'40001'}};
   if(g.actor&&g.expires>db.now&&(g.actor!==actor||g.session!==args.p_session_id||g.token!==args.p_token))return {data:{granted:false}};if(!g.actor||g.expires<=db.now)g.epoch++;Object.assign(g,{actor,session:args.p_session_id,token:args.p_token,expires:db.now+420000});return {data:{granted:true,epoch:g.epoch,revision:g.revision,targets:[{kind:'actual',id:args.p_id,group:'receipts',epoch:g.epoch}],value:value(args.p_id)}};
  }
  const signature=sourceSignature([actor,args.p_trip_id,args.p_id,args.p_session_id,args.p_base_revision,args.p_value]);let i=db.receiptIntents.get(args.p_request_id);
  if(name==='mutate_budget_receipts'&&i){if(i.signature!==signature)return {error:{code:'22023'}};if(i.status==='committed')return {data:structuredClone(i.result)};if(i.status==='aborted')return {error:{code:'55000'}};}
  if(!owns(args,actor))return {error:{code:'55P03',message:'Receipt lease lost'}};if(g.revision!==args.p_base_revision||sourceSignature(versions(args.p_id))!==sourceSignature(args.p_versions||args.p_value?.versions))return {error:{code:'40001',message:'Receipt dependency changed'}};
  if(name==='claim_budget_receipt_cleanup'){const j=db.receiptJobs.get(args.p_request_id);if(!j||j.done)return {data:null};j.token=crypto.randomUUID();return {data:{id:args.p_request_id,path:j.path,object_id:j.object_id,token:j.token}};}
  if(name==='abandon_budget_receipt'){if(!i||i.status==='committed')return {data:false};i.status='aborted';if(db.receiptObjects.has(i.path))db.receiptJobs.set(i.request,{actual:args.p_id,path:i.path,object_id:db.receiptObjects.get(i.path).id});return {data:true};}
  if(!i){if(args.p_phase!=='begin')return {error:{code:'22023'}};const old=db.rows.attachments.find(a=>a.id===args.p_value.old_id&&a.target_id===args.p_id);if(args.p_value.action!=='upload'&&!old)return {error:{code:'40001'}};const id=crypto.randomUUID();i={id,request:args.p_request_id,actor,args:structuredClone(args),signature,status:'pending',path:`trips/${args.p_trip_id}/attachments/actual_expense/${args.p_id}/receipts/${id}/file`,old};db.receiptIntents.set(i.request,i);}
  if(args.p_phase==='begin')return {data:inspect(i)};if(db.receiptCommitFailure)return {error:{code:'22012',message:'metadata write failed'}};if(args.p_value.action!=='delete'&&!db.receiptObjects.has(i.path))return {error:{code:'40001'}};
  db.rows.attachments=db.rows.attachments.filter(a=>a.id!==i.old?.id);if(args.p_value.action!=='delete')db.rows.attachments.push({id:i.id,trip_id:args.p_trip_id,target_type:'actual_expense',target_id:args.p_id,file_url:i.path,file_name:args.p_value.file.name,file_type:args.p_value.file.type,file_size:args.p_value.file.size});
  if(i.old)db.receiptJobs.set(i.request,{actual:args.p_id,old:i.old,path:i.old.file_url,object_id:db.receiptObjects.get(i.old.file_url)?.id});g.revision++;i.status='committed';i.result={kind:'actual',id:args.p_id,group:'receipts',request_id:i.request,revision:g.revision,value:value(args.p_id)};if(db.receiptAfterCommit)db.receiptAfterCommit();await db.emit('attachments');if(db.receiptAckLost){db.receiptAckLost=false;return {error:{message:'Receipt ACK lost'}};}return {data:structuredClone(i.result)};
 };
 return db;
}
export function receiptFixture(){const db=receiptBackend();db.rows.actual_expenses=[{id:'receipt-actual',trip_id:'trip',title:'Receipt Actual',category:'交通',note:'Keep note',amount:900,twd_amount:900,currency:'TWD',exchange_rate:1,payer_id:'A',payment_origin:'manual',payment_active:true,paid_at:'2026-10-30T00:00:00Z',twd_amount_source:'actual',actual_twd_amount:900,payment_history:[{keep:true}]}];db.rows.actual_expense_participants=[{id:'keep-person',actual_expense_id:'receipt-actual',user_id:'A'}];db.rows.attachments=[];return db;}
