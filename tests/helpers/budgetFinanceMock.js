import {receiptBackend,boot} from './budgetReceiptMock.js';
import {enableMetadata} from './budgetMetadataMock.js';
import {attachDemoFinance} from '../../src/demo/budgetFinanceGroups.js';
import {metadataField} from '../../src/lib/budgetMetadataValues.js';
export {boot};
export async function enableFinance(page){await enableMetadata(page);await page.route('**/src/lib/budgetFinanceValues.js*',async r=>{const response=await r.fetch();await r.fulfill({response,body:(await response.text()).replace("import.meta.env?.VITE_BUDGET_FINANCE_GROUPS==='true'","true")});});}
export function financeBackend(){const db=receiptBackend(),original=db.request.bind(db);db.rows.attachments=[];db.financeCalls=[];db.financeReadGates=[];let actor='A',session='tab';
 const props=()=>({activeTrip:db.trips[0],currentUserId:actor,budgetItems:db.rows.budget_items,actualExpenses:db.rows.actual_expenses||[],budgetParticipants:db.rows.budget_item_participants,actualParticipants:db.rows.actual_expense_participants||[],members:db.members.filter(m=>m.trip_id==='trip'),tripBudgetRates:db.trips[0].budget_exchange_rates,
 onSaveMetadata(k,id,g,v){const row=db.rows[k==='budget'?'budget_items':'actual_expenses'].find(r=>r.id===id);row[metadataField(g)]=v;},onSaveRates(c){db.trips[0].budget_exchange_rates=c.quote;for(const r of c.rows)Object.assign(db.rows.budget_items.find(b=>b.id===r.id),r);}});
 const state=(k,row,g)=>{const key=`${k}:${row.id}:${g}`;if(!db.groupStates.has(key))db.groupStates.set(key,{revision:0,epoch:0});const s=db.groupStates.get(key);s.value=g==='pricing'?{...row,participantIds:[],shares:{},versions:{}}:row[metadataField(g)];return s;};
 const service={authorized:async()=>true,read:async trip=>{const r=await original({op:'rpc',name:'read_budget_metadata_snapshot_v7',args:{p_trip_id:trip,p_session_id:session},actor});return {ok:!r.error,data:r.data,error:r.error};},lease:a=>original({op:'rpc',name:'budget_metadata_group_lease',args:a,actor}),patch:a=>original({op:'rpc',name:'patch_budget_metadata_group',args:a,actor})};
 attachDemoFinance(service,props,{state,changed(){db.groupRevision++;for(const g of db.groupStates.values())if(Object.hasOwn(g,'owner'))g.actor=g.owner;},graphVersion:()=>db.paymentGraph});
 db.request=async req=>{if(req.op!=='rpc')return original(req);actor=req.actor;session=req.args?.p_session_id||session;const {name,args}=req;if(!['read_budget_metadata_snapshot_v8','budget_metadata_group_lease_v2','patch_budget_metadata_group_v2','budget_rates_lease','update_trip_budget_rates_v2'].includes(name))return original(req);db.financeCalls.push(req);
 if(name==='read_budget_metadata_snapshot_v8'){const r=await service.read(args.p_trip_id);if(db.financeReadGate){const g=db.financeReadGate;db.financeReadGate=null;g.started=true;await g.promise;}return {data:r.data,error:r.error};}
 if(name==='budget_metadata_group_lease_v2')return service.lease(args);if(name==='patch_budget_metadata_group_v2')return service.patch(args);if(name==='budget_rates_lease')return service.ratesService.lease(args);if(db.financeFailure)return {error:{message:'rates unavailable'}};const result=await service.ratesService.mutate(args);if(db.financeAckLost){db.financeAckLost=false;return {error:{message:'ACK lost'}};}return result;
 };return db;
}
