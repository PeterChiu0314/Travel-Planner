import {test,expect} from '@playwright/test';
import {createBudgetMetadataEditor,validBudgetMetadataSnapshot,withoutBudgetMetadata} from '../src/lib/budgetMetadataService.js';
import {createBudgetSourceController} from '../src/lib/budgetSourceGroups.js';
import {createDemoBudgetMetadataService} from '../src/demo/budgetMetadata.js';
import {applyDemoPaymentChanges} from '../src/demo/budgetPaymentGroups.js';
const clients=[];test.afterEach(async()=>{await Promise.all(clients.splice(0).map(c=>c.dispose()));});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function setup(){
 let props={currentUserId:'A',activeTrip:{id:'trip',start_date:'2090-01-01',end_date:'2090-01-06',status:'planning'},members:['A','B'].map(user_id=>({user_id,status:'approved',role:'editor'})),items:[],itineraryBudgetLinks:[],attachments:[{id:'receipt',target_id:'actual'}],tripBudgetRates:{rates:{JPY:0.2}},
  budgetItems:[{id:'budget',trip_id:'trip',title:'Budget title',note:'Budget note',category:'住宿',payer_id:'A',amount:900,twd_amount:900,currency:'TWD',exchange_rate:1,pricing_mode:'split_total',split_type:'equal',unit_amount:null}],budgetParticipants:['A','B'].map(user_id=>({budget_item_id:'budget',user_id})),
  actualExpenses:[{id:'actual',trip_id:'trip',title:'Actual title',category:'交通',note:'Actual note',payer_id:'B',amount:900,twd_amount:900,currency:'TWD',exchange_rate:1,pricing_mode:'split_total',split_type:'equal',unit_amount:null,payment_origin:'manual',payment_active:true,paid_at:'2026-01-01T00:00:00Z',payment_history:[{keep:true}],twd_amount_source:'actual',actual_twd_amount:900}],actualParticipants:[{id:'person',actual_expense_id:'actual',user_id:'A'}]};
 props.onSaveSource=change=>{props={...props,...applyDemoPaymentChanges(props,change)};};props.onSavePayment=props.onSaveSource;
 props.onSaveMetadata=(kind,id,group,value)=>{props[kind==='actual'?'actualExpenses':'budgetItems'].find(r=>r.id===id)[group]=value;};
 const transport=createDemoBudgetMetadataService(()=>props),leases=[],calls=[],service={authorized:transport.authorized,preview:transport.previewSource,lease:async args=>{leases.push(structuredClone(args));return transport.sourceLease(args);},mutate:async args=>{calls.push(structuredClone(args));return transport.mutateSource(args);}};
 const metadata=createBudgetMetadataEditor({service:transport,sessionId:'tab',timeoutMs:25,read:()=>transport.read('trip')});clients.push(metadata);metadata.configure('A','trip',true,true);expect((await metadata.refresh()).ok).toBe(true);
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const source=createBudgetSourceController({metadata,service,storage,sessionId:'tab',timeoutMs:25});clients.push(source);source.configure('A','trip',true);
 const intent=async(action='relink_only',budget_id='budget')=>{const p=await source.preview('actual','actual',{action,budget_id});expect(p.error).toBeUndefined();return {action,budget_id,versions:p.data.versions};};
 return {source,metadata,transport,service,calls,leases,values,storage,intent,get props(){return props;}};
}
test('Source inspection and authoritative preview acquire nothing; relink changes only source identity',async()=>{
 const f=await setup(),before=structuredClone(f.props.actualExpenses[0]),people=structuredClone(f.props.actualParticipants);f.source.view('actual','actual');const intent=await f.intent();expect(f.leases).toHaveLength(0);expect(f.calls).toHaveLength(0);
 expect(await f.source.execute('actual','actual',intent),f.source.view('actual','actual').error).toBe(true);expect(f.props.actualExpenses[0]).toEqual({...before,budget_item_id:'budget',budget_origin_id:'budget'});expect(f.props.actualParticipants).toEqual(people);expect(f.props.attachments).toEqual([{id:'receipt',target_id:'actual'}]);expect(f.leases[0].p_intent).toEqual({action:'relink_only',budget_id:'budget'});expect(f.calls[0].p_value).toEqual(intent);
 expect(withoutBudgetMetadata(f.metadata.status().snapshot).sourceRecords).toBeUndefined();expect(withoutBudgetMetadata(f.metadata.status().snapshot).sourceProtocol).toBeUndefined();
});
test('Apply is a separate explicit action with all changed groups and preserved known cost history and joins',async()=>{
 const f=await setup(),intent=await f.intent('apply_source_data'),people=structuredClone(f.props.actualParticipants);expect(await f.source.execute('actual','actual',intent),f.source.view('actual','actual').error).toBe(true);
 expect(f.props.actualExpenses[0]).toMatchObject({title:'Budget title',category:'住宿',note:'Budget note',payer_id:'A',amount:900,actual_twd_amount:900,payment_origin:'manual',payment_history:[{keep:true}]});expect(f.props.actualParticipants.find(p=>p.user_id==='A').id).toBe(people[0].id);expect(f.props.actualParticipants).toHaveLength(2);
});
test('historical origin is retained on detach and cannot be overwritten by a new association',async()=>{
 const f=await setup();expect(await f.source.execute('actual','actual',await f.intent())).toBe(true);expect(await f.source.execute('actual','actual',await f.intent('relink_only',null))).toBe(true);expect(f.props.actualExpenses[0]).toMatchObject({budget_item_id:null,budget_origin_id:'budget',actual_twd_amount:900});
 const p=await f.source.preview('actual','actual',{action:'relink_only',budget_id:'budget'});expect(p.error.code).toBe('0A000');expect(f.calls).toHaveLength(2);
});
test('known debit refusal never partially copies source text or participants',async()=>{
 const f=await setup();Object.assign(f.props.actualExpenses[0],{actual_twd_amount:777,twd_amount:777});const before=structuredClone(f.props.actualExpenses[0]),p=await f.source.preview('actual','actual',{action:'apply_source_data',budget_id:'budget'});expect(p.error.code).toBe('22023');expect(f.props.actualExpenses[0]).toEqual(before);expect(f.leases).toHaveLength(0);
});
test('changed authoritative source after confirmation requires a new preview with no automatic rebase',async()=>{
 const f=await setup(),intent=await f.intent('apply_source_data');f.props.budgetItems[0].title='Changed after preview';expect(await f.source.execute('actual','actual',intent)).toBe(false);expect(f.source.view('actual','actual').error).toContain('重新預覽');expect(f.calls).toHaveLength(0);expect(f.leases).toHaveLength(0);
});
test('unknown ACK retries the same request once and reload restores no capability',async()=>{
 const f=await setup(),mutate=f.service.mutate;let once=true;f.service.mutate=async args=>{const r=await mutate(args);if(once){once=false;return {error:{message:'lost ACK'}};}return r;};expect(await f.source.execute('actual','actual',await f.intent())).toBe(false);expect(f.source.view('actual','actual').unknown).toBe(true);expect(await f.source.prepare()).toBe(false);
 const stored=JSON.parse([...f.values.values()][0]);expect(stored.request.p_token).toBe(null);expect(stored.request.p_epoch).toBe(null);
 const next=createBudgetSourceController({metadata:f.metadata,service:{...f.service,mutate},storage:f.storage,sessionId:'next-document'});clients.push(next);next.configure('A','trip',true);expect(await next.retry('actual','actual'),next.view('actual','actual').error).toBe(true);expect(f.calls.at(-1).p_request_id).toBe(f.calls[0].p_request_id);expect(f.calls.at(-1).p_session_id).toBe('tab');expect(f.leases.filter(l=>l.p_action==='acquire')).toHaveLength(1);
});
test('pending mutation timeout and repeated click share a single transport and preserve exit guard',async()=>{
 const f=await setup(),gate=deferred(),mutate=f.service.mutate;let issued=0;f.service.mutate=async args=>{issued++;await gate.promise;return mutate(args);};const intent=await f.intent(),one=f.source.execute('actual','actual',intent),two=f.source.execute('actual','actual',intent);expect(one).toBe(two);expect(await one).toBe(false);expect(await f.source.retry('actual','actual')).toBe(false);expect(issued).toBe(1);expect(await f.source.prepare()).toBe(false);gate.resolve();await expect.poll(()=>f.props.actualExpenses[0].budget_item_id).toBe('budget');expect(await f.source.retry('actual','actual')).toBe(true);expect(issued).toBe(1);
});
test('confirmed Source with pending Snapshot retries reads only; old read cannot roll back canonical',async()=>{
 const f=await setup(),gate=deferred(),read=f.transport.read,mutate=f.service.mutate;f.service.mutate=async args=>{const r=await mutate(args);f.transport.read=()=>gate.promise;return r;};expect(await f.source.execute('actual','actual',await f.intent())).toBe(false);expect(f.source.view('actual','actual')).toMatchObject({unknown:false,syncPending:true});expect(f.calls).toHaveLength(1);f.transport.read=read;expect(await f.source.retry('actual','actual')).toBe(true);gate.resolve(await read('trip'));expect(f.calls).toHaveLength(1);expect(f.metadata.status().snapshot.sourceRecords[0].value.budget_id).toBe('budget');
});
test('late Source ACK after account trip switch never refreshes or marks the new context successful',async()=>{
 const f=await setup(),gate=deferred(),mutate=f.service.mutate;f.service.mutate=async args=>{const r=await mutate(args);await gate.promise;return r;};const work=f.source.execute('actual','actual',await f.intent());await expect.poll(()=>f.props.actualExpenses[0].budget_item_id).toBe('budget');f.source.configure('B','other',true);gate.resolve();expect(await work).toBe(false);expect(f.source.view('actual','actual')).toMatchObject({actor:'B',trip:'other',busy:false});
});
test('strict v6 rejects missing Source projection wrong identity forged epochs and altered protected cost',async()=>{
 const f=await setup(),good=(await f.transport.read('trip')).data;expect(validBudgetMetadataSnapshot(good,'trip')).toBe(true);
 for(const tamper of [d=>d.sourceRecords.pop(),d=>d.sourceRecords[0].value.origin_id='wrong',d=>d.sourceRecords[0].epoch=-1,d=>d.sourceProtocol.schemaVersion=99]){const bad=structuredClone(good);tamper(bad);expect(validBudgetMetadataSnapshot(bad,'trip')).toBe(false);}
 const preview=f.service.preview;f.service.preview=async args=>{const r=await preview(args);r.data.after.actual_twd_amount=1;return r;};expect((await f.source.preview('actual','actual',{action:'apply_source_data',budget_id:'budget'})).error).toBeTruthy();expect(f.calls).toHaveLength(0);
});
test('same current source no-op creates no operation revision and exact release leaves other groups alone',async()=>{
 const f=await setup(),field=f.metadata.get('actual','actual','title');expect(await f.metadata.focus(field)).toBe(true);const epoch=field.epoch;expect(await f.source.execute('actual','actual',await f.intent('relink_only',null))).toBe(true);expect(f.metadata.status().snapshot.sourceRecords[0].revision).toBe(0);expect(field.epoch).toBe(epoch);expect(f.metadata.view(field).writable).toBe(true);
});
test('missing Source RPC fails closed and never invokes an older whole-record save',async()=>{
 const f=await setup();f.service.lease=async()=>({error:{code:'PGRST202',message:'Source API missing'}});expect(await f.source.execute('actual','actual',await f.intent())).toBe(false);expect(f.calls).toHaveLength(0);expect(f.props.actualExpenses[0].budget_item_id).toBeUndefined();
});

test('confirmed Source release failure guards exit; retry releases without resending or reacquiring',async()=>{
 const f=await setup(),lease=f.service.lease;let deny=true;f.service.lease=args=>args.p_action==='release'&&deny?{error:{message:'release pending'}}:lease(args);
 expect(await f.source.execute('actual','actual',await f.intent())).toBe(false);expect(f.source.view('actual','actual')).toMatchObject({unknown:false,releasePending:true});expect(await f.source.prepare()).toBe(false);expect(f.calls).toHaveLength(1);
 deny=false;expect(await f.source.retry('actual','actual')).toBe(true);expect(await f.source.prepare()).toBe(true);expect(f.calls).toHaveLength(1);expect(f.leases.filter(c=>c.p_action==='acquire')).toHaveLength(1);
});

test('offline after confirmed Source keeps pending receipt and recovers by authoritative read only',async()=>{
 const f=await setup(),mutate=f.service.mutate,read=f.transport.read;f.service.mutate=async args=>{const result=await mutate(args);f.transport.read=async()=>({ok:false,error:{message:'offline'}});return result;};
 expect(await f.source.execute('actual','actual',await f.intent())).toBe(false);expect(f.source.view('actual','actual')).toMatchObject({unknown:false,syncPending:true});expect(await f.source.prepare()).toBe(false);
 f.transport.read=read;expect(await f.source.retry('actual','actual')).toBe(true);expect(f.calls).toHaveLength(1);expect(f.props.actualExpenses[0].budget_item_id).toBe('budget');
});
