import {createBudgetPaymentController} from './budgetPaymentGroups.js';
import {withBudgetAuthorityTimeout,budgetAuthorityTimeoutMs} from './budgetMetadataService.js';
import {validSourceValue,validSourcePreview,validSourceAdmission,sameSourceValue,sourceSignature} from './budgetSourceValues.js';
export function createBudgetSourceService(supabase) {
 const rpc=async(name,args)=>{try{return await supabase.rpc(name,args);}catch(error){return {error};}};
 return {authorized:async actor=>{try{return (await supabase.auth.getSession()).data?.session?.user?.id===actor;}catch{return false;}},
  preview:args=>rpc('read_budget_source_preview',args),lease:args=>rpc('budget_source_lease',args),mutate:args=>rpc('mutate_budget_source',args)};
}
// A protocol strategy on the existing explicit-operation lifecycle, not another
// request queue/authority manager. Preview is read-only and never grants a lease.
export function createBudgetSourceController(options) {
 const {metadata,service,timeoutMs=budgetAuthorityTimeoutMs}=options;
 async function preview(kind,id,intent,snapshot=metadata.status().snapshot) {
  if(kind!=='actual'||snapshot?.sourceProtocol?.name!=='budget-source'||snapshot.sourceProtocol.schemaVersion!==1||!snapshot.sourceProtocol.enabled)return {error:{code:'55000',message:'來源協作尚未啟用，資料未變更。'}};
  const result=await withBudgetAuthorityTimeout(service.preview({p_trip_id:snapshot.tripId,p_id:id,p_action:intent.action,p_budget_id:intent.budget_id??null}),{timeoutMs});
  return result.error?result:validSourcePreview(result.data,snapshot,id,intent)?result:{error:{code:'40001',message:'來源摘要與目前資料不一致，請重新整理後預覽。'}};
 }
 const controller=createBudgetPaymentController({...options,operation:{group:'source',label:'來源',records:'sourceRecords',actions:['relink_only','apply_source_data'],validValue:validSourceValue,validAdmission:validSourceAdmission,sameValue:sameSourceValue,
  validReceipt:(data,request)=>data.value.budget_id===request.p_value.budget_id,
  async prepare({snapshot,kind,id,intent}) {const result=await preview(kind,id,intent,snapshot);if(result.error)return result;
   if(!intent.versions||sourceSignature(intent.versions)!==sourceSignature(result.data.versions))return {error:{code:'40001',message:'來源或相依資料已變更，請重新預覽並確認；原資料未覆蓋。'}};return result;},
 }});
 return {...controller,async preview(kind,id,intent){if(!(await metadata.refresh()).ok)return {error:{message:'最新資料尚未確認，請重新整理。'}};return preview(kind,id,intent);}};
}
