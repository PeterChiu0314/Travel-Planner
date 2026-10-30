import {createBudgetPaymentController} from './budgetPaymentGroups.js';
import {budgetAuthorityTimeoutMs,withBudgetAuthorityTimeout} from './budgetMetadataService.js';
export const budgetUndoEnabled=import.meta.env?.VITE_BUDGET_UNDO==='true';
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export const validUndoValue=v=>object(v)&&object(v.versions)&&Array.isArray(v.effects)&&v.effects.every(t=>['budget','actual'].includes(t.kind)&&typeof t.id==='string'&&typeof t.group==='string'&&Number.isSafeInteger(t.revision)&&t.revision>=0&&typeof t.deleted==='boolean');
export function validUndoSnapshot(d){
 const rows=d.undoRecords,r=rows?.[0],v=r?.value;
 if(!Array.isArray(rows)||rows.length!==1||r.kind!=='trip'||r.id!==d.tripId||r.trip_id!==d.tripId||r.revision!==0||!validUndoValue(v)||typeof v.enabled!=='boolean'||!Number.isInteger(v.count)||v.count<0||v.count>5)return false;
 if(!(v.count===0?v.top===null:object(v.top)&&typeof v.top.operation_id==='string'&&['budget','actual'].includes(v.top.kind)&&typeof v.top.id==='string'&&['title','note','category','payer','links','pricing','lifecycle'].includes(v.top.group)))return false;
 const keys=v.effects.map(t=>`${t.kind}:${t.id}:${t.group}`);
 return new Set(keys).size===keys.length&&d.metadataRecords.every(t=>t.groups.every(g=>v.effects.some(e=>e.kind===t.kind&&e.id===t.id&&e.group===g.group&&e.revision===g.revision&&!e.deleted)))&&v.effects.every(e=>d.lifecycleRecords.some(l=>l.kind===e.kind&&l.id===e.id&&l.value.exists===!e.deleted));
}
export const isBudgetUndoKey=e=>(e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&e.key?.toLowerCase()==='z'&&!e.isComposing&&e.keyCode!==229;
export const keepsNativeUndo=target=>Boolean(target?.isContentEditable||target?.closest?.('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="range"]):not([type="color"]):not([type="file"]),textarea,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"]'));
export function createBudgetUndoService(supabase,{timeoutMs=budgetAuthorityTimeoutMs}={}){const rpc=async(name,args)=>{try{return await withBudgetAuthorityTimeout(supabase.rpc(name,args),{timeoutMs});}catch(error){return {error};}};return {
 authorized:async actor=>{try{return (await withBudgetAuthorityTimeout(supabase.auth.getSession(),{timeoutMs})).data?.session?.user?.id===actor;}catch{return false;}},
 lease:a=>rpc('budget_workspace_undo_lease',{p_trip_id:a.p_trip_id,p_session_id:a.p_session_id,p_operation_id:a.p_intent.operation_id,p_token:a.p_token,p_action:a.p_action,p_epoch:a.p_epoch}),
 mutate:a=>rpc('undo_budget_workspace',{p_trip_id:a.p_trip_id,p_session_id:a.p_session_id,p_operation_id:a.p_value.operation_id,p_token:a.p_token,p_epoch:a.p_epoch,p_request_id:a.p_request_id}),
 clear:(trip,sid)=>rpc('clear_budget_metadata_undo',{p_trip_id:trip,p_session_id:sid}),
};}
// Reuse the explicit-operation transport, deadline, request recovery and guard.
// Only a count of user key intents is queued; the DB remains the sole stack.
export function createBudgetUndoController(options){let queued=0,work=null,generation=0,context='',scope=null;const clear=old=>{if(old)void withBudgetAuthorityTimeout(Promise.resolve().then(async()=>{if(await options.service.authorized(old.actor))await options.service.clear?.(old.trip,options.sessionId);})).catch(()=>{});};const c=createBudgetPaymentController({...options,storage:null,operation:{group:'undo',label:'復原',records:'undoRecords',actions:['undo'],validValue:validUndoValue,sameValue:(a,b)=>b.effects.every(t=>a.effects.some(v=>v.kind===t.kind&&v.id===t.id&&v.group===t.group&&v.revision>=t.revision&&v.deleted===t.deleted)),validAdmission:r=>Array.isArray(r.targets),validReceipt:(d,r)=>d.undo_of===r.p_value.operation_id&&d.value.effects.length>0,
 async prepare({snapshot}){const v=snapshot?.undoRecords?.[0]?.value;if(!v?.enabled)return {error:{message:'復原協定尚未確認。'}};if(!v.top)return {error:{message:'目前沒有可復原的操作。'}};return {data:{revision:0,versions:{},targets:[],intent:{action:'undo',operation_id:v.top.operation_id}}};},
 }});return {...c,
 undo(trip,before=async()=>true){queued++;if(work)return work;const gen=generation;work=(async()=>{let ok=false;while(queued&&gen===generation){queued--;const pending=c.view('trip',trip).active;if(!pending&&!await before())break;if(gen!==generation)break;ok=await(pending?c.retry('trip',trip):c.execute('trip',trip,{action:'undo'}));if(!ok)break;}return ok;})().finally(()=>{queued=0;work=null;});return work;},
 configure(actor,trip,editable){const next=JSON.stringify([actor,trip,editable]);if(next!==context){generation++;queued=0;context=next;}if(scope?.actor!==actor||scope?.trip!==trip){clear(scope);scope=actor&&trip?{actor,trip}:null;}c.configure(actor,trip,editable);},
 async dispose(){generation++;queued=0;clear(scope);scope=null;await c.dispose();},
};}
