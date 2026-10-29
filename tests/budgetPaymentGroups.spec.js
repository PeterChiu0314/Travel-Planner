import { test, expect } from '@playwright/test';
import { createBudgetPaymentController } from '../src/lib/budgetPaymentGroups.js';
import { createBudgetMetadataEditor, withoutBudgetMetadata, validBudgetMetadataSnapshot } from '../src/lib/budgetMetadataService.js';
import { createDemoBudgetMetadataService } from '../src/demo/budgetMetadata.js';
import { applyDemoPaymentChanges } from '../src/demo/budgetPaymentGroups.js';
const clients=[];
test.afterEach(async()=>{await Promise.all(clients.splice(0).map(c=>c.dispose()));});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
async function setup(options={}) {
 let props={currentUserId:'A',activeTrip:{id:'trip',start_date:'2090-01-01'},members:['A','B'].map(user_id=>({user_id,status:'approved',role:'editor'})),items:[],itineraryBudgetLinks:[],attachments:[],
 budgetItems:[{id:'id',trip_id:'trip',title:'Committed',note:'Keep',amount:900,twd_amount:900,currency:'TWD',exchange_rate:1,pricing_mode:'split_total',split_type:'equal',payer_id:'A',updated_at:'2026-01-01T00:00:00Z'}],
 budgetParticipants:['A','B'].map(user_id=>({budget_item_id:'id',user_id})),actualExpenses:[],actualParticipants:[]};
 props.onSavePayment=change=>{props={...props,...applyDemoPaymentChanges(props,change)};};props.onSaveMetadata=(kind,id,group,value)=>{props.budgetItems[0][group]=value;};
 const transport=createDemoBudgetMetadataService(()=>props),calls=[],leases=[],service={authorized:transport.authorized,lease:async args=>{leases.push(structuredClone(args));return transport.paymentLease(args);},mutate:async args=>{calls.push(structuredClone(args));return transport.mutatePayment(args);}};
 const metadata=createBudgetMetadataEditor({service:transport,read:()=>transport.read('trip'),sessionId:'tab',timeoutMs:30,debounceMs:5});clients.push(metadata);metadata.configure('A','trip',true,true);await metadata.refresh();
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const payment=createBudgetPaymentController({metadata,service,sessionId:'tab',storage,timeoutMs:30,...options});clients.push(payment);payment.configure('A','trip',true);
 return {payment,metadata,transport,service,calls,leases,storage,values,get props(){return props;}};
}
test('inspection has no lease and explicit payment uses committed DB shape without full form',async()=>{
 const f=await setup();expect(f.payment.view('budget','id').active).toBe(false);expect(f.leases).toHaveLength(0);const ok=await f.payment.execute('budget','id',{action:'paid'});expect(ok,f.payment.view('budget','id').error).toBe(true);
 expect(f.props.actualExpenses).toHaveLength(1);expect(f.props.actualExpenses[0]).toMatchObject({title:'Committed',amount:900,payer_id:'A',payment_active:true});expect(Object.keys(f.calls[0].p_value)).toEqual(['action','versions']);expect(f.payment.hasPending()).toBe(false);
 expect(withoutBudgetMetadata(f.metadata.status().snapshot).paymentRecords).toBeUndefined();expect(withoutBudgetMetadata(f.metadata.status().snapshot).paymentProtocol).toBeUndefined();
});
test('explicit unpaid and paid preserve record joins history receipt and known debit',async()=>{
 const f=await setup();expect(await f.payment.execute('budget','id',{action:'paid'})).toBe(true);const row=structuredClone(f.props.actualExpenses[0]),people=structuredClone(f.props.actualParticipants);f.props.attachments.push({id:'receipt',target_id:row.id});
 for(const action of ['unpaid','paid']){expect(await f.payment.execute('budget','id',{action})).toBe(true);expect(f.props.actualExpenses).toHaveLength(1);expect(f.props.actualExpenses[0]).toMatchObject({...row,payment_active:action==='paid'});expect(f.props.actualParticipants).toEqual(people);expect(f.props.attachments).toEqual([{id:'receipt',target_id:row.id}]);}
});
test('duplicate click shares one in-flight operation and unknown ACK retries original request',async()=>{
 const f=await setup(),gate=deferred(),original=f.service.mutate;f.service.mutate=async args=>{await gate.promise;return original(args);};
 const one=f.payment.execute('budget','id',{action:'paid'}),two=f.payment.execute('budget','id',{action:'paid'});expect(one).toBe(two);gate.resolve();expect(await one).toBe(true);expect(f.calls).toHaveLength(1);
 let once=true;f.service.mutate=async args=>{const r=await original(args);if(once){once=false;return {error:{message:'lost ack'}};}return r;};expect(await f.payment.execute('budget','id',{action:'unpaid'})).toBe(false);expect(f.payment.view('budget','id').unknown).toBe(true);expect(await f.payment.retry('budget','id')).toBe(true);expect(f.calls[1]).toEqual(f.calls[2]);expect(f.props.actualExpenses).toHaveLength(1);
});
test('mutation timeout keeps exact transport and cannot admit a second payment while unsettled',async()=>{
 const f=await setup(),gate=deferred(),original=f.service.mutate;let issued=0;f.service.mutate=async args=>{issued++;await gate.promise;return original(args);};
 expect(await f.payment.execute('budget','id',{action:'paid'})).toBe(false);expect(f.payment.hasPending()).toBe(true);expect(await f.payment.retry('budget','id')).toBe(false);expect(issued).toBe(1);gate.resolve();await new Promise(r=>setTimeout(r,5));expect(await f.payment.retry('budget','id')).toBe(true);expect(f.props.actualExpenses).toHaveLength(1);
});
test('confirmed payment with pending Snapshot retries read only and preserves request identity',async()=>{
 const f=await setup(),original=f.service.mutate,read=f.transport.read;let resolve;f.service.mutate=async args=>{const result=await original(args);f.transport.read=()=>new Promise(r=>resolve=r);return result;};
 expect(await f.payment.execute('budget','id',{action:'paid'})).toBe(false);expect(f.payment.view('budget','id')).toMatchObject({unknown:false,syncPending:true});expect(f.calls).toHaveLength(1);f.transport.read=read;expect(await f.payment.retry('budget','id')).toBe(true);resolve(await read('trip'));expect(f.calls).toHaveLength(1);
});
test('restored pending request has no capability and replays original origin session',async()=>{
 const f=await setup(),original=f.service.mutate;f.service.mutate=async args=>{await original(args);return {error:{message:'lost'}};};await f.payment.execute('budget','id',{action:'paid'});const stored=JSON.parse([...f.values.values()][0]);expect(stored.request.p_token).toBe(null);expect(stored.request.p_epoch).toBe(null);
 const next=createBudgetPaymentController({metadata:f.metadata,service:{...f.service,mutate:original},storage:f.storage,sessionId:'new-tab'});clients.push(next);next.configure('A','trip',true);expect(next.view('budget','id').unknown).toBe(true);expect(await next.retry('budget','id')).toBe(true);expect(f.calls.at(-1).p_session_id).toBe('tab');expect(f.props.actualExpenses).toHaveLength(1);
});
test('old account/trip late ACK cannot mark a new context successful or call its refresh',async()=>{
 const f=await setup(),gate=deferred(),original=f.service.mutate;f.service.mutate=async args=>{const result=await original(args);await gate.promise;return result;};const work=f.payment.execute('budget','id',{action:'paid'});await expect.poll(()=>f.props.actualExpenses.length).toBe(1);f.payment.configure('B','other',true);gate.resolve();expect(await work).toBe(false);expect(f.payment.view('budget','id')).toMatchObject({trip:'other',busy:false});
});
test('missing Payment RPC fails closed and never falls back to financial save',async()=>{
 const f=await setup();f.service.mutate=async()=>({error:{code:'PGRST202',message:'missing'}});expect(await f.payment.execute('budget','id',{action:'paid'})).toBe(false);expect(f.props.actualExpenses).toHaveLength(0);expect(f.payment.view('budget','id').unknown).toBe(true);
});
test('P2 missing currency quote rejects pricing draft and explicit latest quote preserves other input',async()=>{
 const f=await setup();f.props.tripBudgetRates={rates:{JPY:0.2}};f.props.budgetItems[0]={...f.props.budgetItems[0],currency:'JPY',exchange_rate:0.2,twd_amount:180};await f.metadata.refresh();const g=f.metadata.get('budget','id','pricing');await f.metadata.focus(g);
 f.metadata.input(g,{...g.value,currency:'USD',exchange_rate:'',amount:'1200'});expect(await f.metadata.save(g)).toBe(false);expect(f.props.budgetItems[0].amount).toBe(900);f.props.tripBudgetRates={rates:{JPY:0.2,USD:32}};
 const applied=await f.metadata.useLatestPricingRate(g);expect(applied,JSON.stringify({error:g.error,state:g.state,base:g.base,canonical:g.canonical,remote:g.remote})).toBe(true);expect(f.metadata.view(g).display).toMatchObject({currency:'USD',amount:'1200',exchange_rate:32});
});
test('v4 payment snapshot rejects missing records mismatched active state and forged dependency readiness',async()=>{
 const f=await setup(),good=(await f.transport.read('trip')).data;expect(validBudgetMetadataSnapshot(good,'trip')).toBe(true);
 for(const change of [d=>d.paymentRecords.pop(),d=>d.paymentRecords[0].value.active=true,d=>d.paymentRecords[0].value.versions.targets=[],d=>d.paymentProtocol.enabled='yes']){const bad=structuredClone(good);change(bad);expect(validBudgetMetadataSnapshot(bad,'trip')).toBe(false);}
});
test('account switch during authorization cannot acquire or mutate with old actor',async()=>{
 const f=await setup(),gate=deferred();f.service.authorized=()=>gate.promise;const work=f.payment.execute('budget','id',{action:'paid'});expect(f.payment.view('budget','id').busy).toBe(true);expect(f.payment.hasPending()).toBe(true);f.payment.configure('B','other',true);gate.resolve(true);expect(await work).toBe(false);expect(f.leases).toHaveLength(0);expect(f.calls).toHaveLength(0);
});
test('late payment admission timeout releases exact capability and failed release remains retryable',async()=>{
 const f=await setup(),gate=deferred(),original=f.service.lease;f.service.lease=async args=>args.p_action==='acquire'?gate.promise:original(args);
 expect(await f.payment.execute('budget','id',{action:'paid'})).toBe(false);expect(f.payment.hasPending()).toBe(true);const acquisition=f.leases.find(c=>c.p_action==='acquire');
 // The test adapter sees the authoritative late grant, then transport delivers
 // it after the UI has already timed out.
 const e=f.payment.get('budget','id');const admission=await f.transport.paymentLease({p_trip_id:'trip',p_kind:'budget',p_id:'id',p_session_id:'tab',p_token:e.token,p_action:'acquire',p_base_revision:e.base,p_epoch:null,p_versions:e.versions});gate.resolve(admission);
 await expect.poll(()=>f.payment.hasPending()).toBe(false);expect(f.calls).toHaveLength(0);expect(f.leases.at(-1).p_action).toBe('release');expect(f.leases.at(-1).p_epoch).toBe(admission.data.epoch);
 f.service.lease=original;let denied=true;f.service.lease=async args=>args.p_action==='release'&&denied?{error:{message:'release lost'}}:original(args);
 expect(await f.payment.execute('budget','id',{action:'paid'})).toBe(false);expect(f.payment.view('budget','id').syncPending).toBe(true);denied=false;expect(await f.payment.retry('budget','id')).toBe(true);expect(f.props.actualExpenses).toHaveLength(1);
});
test('committed Payment converges when latest authoritative snapshot has a newer independent rates generation',async()=>{
 const f=await setup(),read=f.transport.read,mutate=f.service.mutate;let committed=false;
 f.transport.read=async trip=>{const r=await read(trip);if(committed)for(const record of r.data.paymentRecords)record.value.versions.rates++;return r;};
 f.service.mutate=async args=>{const r=await mutate(args);committed=true;return r;};
 expect(await f.payment.execute('budget','id',{action:'paid'}),f.payment.view('budget','id').error).toBe(true);expect(f.payment.hasPending()).toBe(false);expect(f.calls).toHaveLength(1);
});
