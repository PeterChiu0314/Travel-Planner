import {withBudgetAuthorityTimeout} from './budgetMetadataService.js';
import {fetchBudgetQuote} from './tripBudgetRates.js';
// One fixed request survives uncertain responses; capabilities stay in memory.
export function createExpenseRates({service,actor,trip,sessionId,getGraph,refresh,storage,onError,quote=()=>fetchBudgetQuote({force:true})}){
 const key=`travel-planner-expense-rates:${actor}:${trip}`,listeners=new Set();let pending=null,cleanup=null,work=null,busy=false,version=0,closed=false,generation=0;
 try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved?.p_trip_id===trip&&saved.p_request_id)pending=saved;}catch{/* No authority from storage. */}
 const emit=()=>{if(!closed){version++;listeners.forEach(fn=>fn());}};
 const persist=()=>{try{if(pending)storage?.setItem(key,JSON.stringify({...pending,p_token:null,p_epoch:null}));else storage?.removeItem(key);}catch{/* Keep memory request. */}};
 async function release(){if(!cleanup)return true;const r=await withBudgetAuthorityTimeout(service.rateLease({...cleanup,p_action:'release'}));if(r.data?.granted){cleanup=null;emit();return true;}onError(r.error||new Error('匯率更新結果待確認。'));emit();return false;}
 async function confirm(){if(!pending)return release();if(!await service.authorized(actor))return false;const request=pending,r=await withBudgetAuthorityTimeout(service.rates(request));
  if(r.error){if(['PT409','22023','42501','55P03'].includes(r.error.code)){pending=null;persist();await release();await refresh();}onError(r.error);emit();return false;}
  if(!r.data?.committed||r.data.request_id!==request.p_request_id||r.data.trip_id!==trip||r.data.revision!==request.p_base+1){onError(new Error('匯率更新結果待確認。'));return false;}
  pending=null;persist();await release();await refresh();emit();return true;
 }
 function retry(){if(work)return work;work=confirm().finally(()=>{work=null;emit();});return work;}
 async function update(){if(work||busy||pending||cleanup)return retry();busy=true;emit();try{
  const external=await quote();if(closed||!await refresh()||!await service.authorized(actor))return false;const graph=getGraph();
  const lease={p_trip_id:trip,p_session_id:sessionId,p_token:crypto.randomUUID(),p_base:graph.rateState.revision,p_epoch:null};
  const r=await withBudgetAuthorityTimeout(service.rateLease({...lease,p_action:'acquire'}),{late:async result=>{if(result.data?.granted)await service.rateLease({...lease,p_action:'release',p_epoch:result.data.epoch});}});
  if(r.error||!r.data?.granted){if(r.error)onError(r.error);return false;}
  cleanup={...lease,p_epoch:r.data.epoch};if(closed){await release();return false;}
  pending={...cleanup,p_value:{quote:external,previous:graph.rates,targets:graph.rateState.targets},p_request_id:crypto.randomUUID()};persist();return await retry();
 }catch(error){onError(error);return false;}finally{busy=false;emit();}}
 return{subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},getVersion:()=>version,status:()=>({busy:busy||Boolean(work),pending:Boolean(pending||cleanup)}),update,retry,
  async finish(){if(busy)return false;return retry();},attach(){const n=++generation;return()=>queueMicrotask(()=>{if(n===generation){closed=true;listeners.clear();persist();if(cleanup&&!pending)void release();}});}};
}
