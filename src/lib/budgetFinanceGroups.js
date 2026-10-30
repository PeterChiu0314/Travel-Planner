import {createBudgetPaymentController} from './budgetPaymentGroups.js';
import {withBudgetAuthorityTimeout,budgetAuthorityTimeoutMs} from './budgetMetadataService.js';
import {validRatesValue,sameRateQuote} from './budgetFinanceValues.js';
export * from './budgetFinanceValues.js';
const version=v=>Number.isSafeInteger(v)&&v>=0;
export function createBudgetRatesService(supabase,{timeoutMs=budgetAuthorityTimeoutMs}={}){
 const rpc=async(name,args)=>{try{return await withBudgetAuthorityTimeout(supabase.rpc(name,args),{timeoutMs});}catch(error){return {error};}};
 return {authorized:async actor=>{try{const r=await withBudgetAuthorityTimeout(supabase.auth.getSession(),{timeoutMs});return r.data?.session?.user?.id===actor;}catch{return false;}},lease:args=>rpc('budget_rates_lease',args),mutate:args=>rpc('update_trip_budget_rates_v2',args)};
}
export function createBudgetRatesController(options){const c=createBudgetPaymentController({...options,operation:{group:'rates',label:'旅程匯率',records:'ratesRecords',actions:['rates'],validValue:validRatesValue,sameValue:(a,b)=>sameRateQuote(a.quote,b.quote),
 validAdmission:data=>Array.isArray(data.targets)&&data.targets.every(t=>t.kind==='budget'&&typeof t.id==='string'&&version(t.epoch)),validReceipt:(data,r)=>r.p_value.initialize||sameRateQuote(data.value.quote,r.p_value.quote),
 async prepare({snapshot,kind,id,intent}){const r=snapshot?.ratesRecords?.[0];if(kind!=='trip'||id!==snapshot?.tripId||!snapshot?.financeProtocol?.enabled||!r?.supported)return {error:{message:'旅程匯率協作尚未確認或已超過行前規劃期間。'}};return {data:{revision:r.revision,versions:r.value.versions,targets:[],intent:{action:'rates',quote:intent.quote,initialize:Boolean(intent.initialize)}}};},
 }});return {...c,update:(tripId,quote,initialize=false)=>c.execute('trip',tripId,{action:'rates',quote,initialize})};}
