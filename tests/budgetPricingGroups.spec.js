import { test, expect } from '@playwright/test';
import { createBudgetMetadataEditor, validBudgetMetadataSnapshot } from '../src/lib/budgetMetadataService.js';
import { createDemoBudgetMetadataService } from '../src/demo/budgetMetadata.js';
import { applyDemoPricing, pricingInputError, pricingContent } from '../src/lib/budgetPricingGroups.js';
import { mock } from 'node:test';
import { budgetAuthorityTimeoutMs } from '../src/lib/budgetMetadataService.js';
const clients=[];
test.afterEach(async()=>{await Promise.all(clients.splice(0).map(c=>c.dispose()));});
async function setup() {
 let props={currentUserId:'A',members:['A','B','C'].map(user_id=>({user_id,status:'approved'})),items:[],itineraryBudgetLinks:[],
 budgetItems:[{id:'id',trip_id:'trip',title:'Keep',note:'Keep note',category:'交通',payer_id:'B',amount:900,twd_amount:900,currency:'TWD',exchange_rate:1,pricing_mode:'split_total'}],actualExpenses:[],
 budgetParticipants:['A','B','C'].map(user_id=>({budget_item_id:'id',user_id})),actualParticipants:[]};
 props.onSaveMetadata=(kind,id,group,value)=>{if(group==='pricing')props={...props,...applyDemoPricing(props,kind,id,value)};else props.budgetItems[0][group]=value;};
 const transport=createDemoBudgetMetadataService(()=>props),patches=[],service={...transport,patch:async args=>{patches.push(structuredClone(args));return transport.patch(args);}};
 const client=createBudgetMetadataEditor({service,read:()=>transport.read('trip'),sessionId:'tab',debounceMs:10});clients.push(client);client.configure('A','trip',true,true);await client.refresh();
 return {client,service,transport,patches,get props(){return props;},g:client.get('budget','id','pricing')};
}
test('pricing canonical structured snapshot binds financial graph and dependency vectors',async()=>{
 const f=await setup(),data=(await f.transport.read('trip')).data;expect(validBudgetMetadataSnapshot(data,'trip')).toBe(true);
 const bad=structuredClone(data);bad.metadataRecords[0].groups.find(g=>g.group==='pricing').value.amount=1;expect(validBudgetMetadataSnapshot(bad,'trip')).toBe(false);
 const missing=structuredClone(data);delete missing.metadataRecords[0].groups.find(g=>g.group==='pricing').value.versions;expect(validBudgetMetadataSnapshot(missing,'trip')).toBe(false);
 const unsupported=structuredClone(data),group=unsupported.metadataRecords[0].groups.find(g=>g.group==='pricing');group.supported=false;group.value.versions.targets=[];expect(validBudgetMetadataSnapshot(unsupported,'trip')).toBe(true);
 group.supported=true;expect(validBudgetMetadataSnapshot(unsupported,'trip')).toBe(false);
});
test('pricing custom total is sum of every share and patch preserves nonfinancial fields',async()=>{
 const f=await setup();await f.client.focus(f.g);f.client.input(f.g,{...f.g.value,pricing_mode:'custom',shares:{A:'600',B:'300',C:'300'}});await expect.poll(()=>f.g.saved).toBe(true);
 expect(f.props.budgetItems[0]).toMatchObject({amount:1200,twd_amount:1200,title:'Keep',note:'Keep note',payer_id:'B'});expect(f.patches).toHaveLength(1);expect(Object.keys(f.patches[0].p_patch)).toEqual(['pricing']);
 f.client.input(f.g,{...f.g.value});await f.client.save(f.g);expect(f.patches).toHaveLength(1);
});
test('invalid blank and precision drafts never issue requests and valid correction autosaves',async()=>{
 const f=await setup();await f.client.focus(f.g);
 for(const amount of ['', '-1', 'NaN', '1.001']){f.client.input(f.g,{...f.g.value,amount});expect(await f.client.save(f.g)).toBe(false);expect(f.client.view(f.g).dirty).toBe(true);}
 expect(f.patches).toHaveLength(0);f.client.input(f.g,{...f.g.value,amount:'0'});await expect.poll(()=>f.props.budgetItems[0].amount).toBe(0);
});
test('structured queue rebases only its confirmed ACK vector and saves newest amount once',async()=>{
 const f=await setup();await f.client.focus(f.g);let finish;const original=f.service.patch;
 f.service.patch=async args=>{const result=await original(args);await new Promise(resolve=>finish=resolve);return result;};
 f.client.input(f.g,{...f.g.value,amount:'1000'});const work=f.client.save(f.g);await expect.poll(()=>typeof finish).toBe('function');f.client.input(f.g,{...f.g.value,amount:'1200'});
 f.service.patch=original;finish();await work;await expect.poll(()=>f.props.budgetItems[0].amount).toBe(1200);expect(f.patches.map(p=>p.p_patch.pricing.amount)).toEqual([1000,1200]);expect(f.patches[1].p_base_revision).toBe(1);expect(f.patches[1].p_patch.pricing.versions.targets[0].revision).toBe(1);
});
test('unknown pricing ACK retries exact request without issuing legacy save or second effect',async()=>{
 const f=await setup();await f.client.focus(f.g);const original=f.service.patch;let once=true;f.service.patch=async args=>{const r=await original(args);if(once){once=false;return {error:{message:'ack lost'}};}return r;};
 f.client.input(f.g,{...f.g.value,amount:'1000'});expect(await f.client.save(f.g)).toBe(false);expect(f.g.request).toBeTruthy();expect(await f.client.retry(f.g)).toBe(true);expect(f.patches).toHaveLength(2);expect(f.patches[0]).toEqual(f.patches[1]);expect(f.g.base).toBe(1);
});
test('rates vector change retains local pricing intent and blocks automatic rebase',async()=>{
 const f=await setup();await f.client.focus(f.g);f.client.input(f.g,{...f.g.value,amount:'1100'});
 const data=(await f.transport.read('trip')).data;data.metadataRecords[0].groups.find(g=>g.group==='pricing').value.versions.rates++;
 f.client.ingest(data);expect(f.g.conflict).toBe(true);expect(f.client.view(f.g).display.amount).toBe('1100');expect(await f.client.save(f.g)).toBe(false);expect(f.patches).toHaveLength(0);
});
test('all invalid numerics fail preview validation while original cents and rate precision reconcile',()=>{
 const p={pricing_mode:'split_total',amount:'10.01',currency:'JPY',exchange_rate:'0.123456',participantIds:['A','B','C'],shares:{}};
 expect(pricingInputError(p)).toBe('');expect(pricingContent({...p,versions:{rates:1}})).toEqual(pricingContent({...p,versions:{rates:2}}));
 for(const patch of [{amount:'Infinity'},{exchange_rate:'0'},{exchange_rate:'0.1234567'},{participantIds:[]}])expect(pricingInputError({...p,...patch})).not.toBe('');
});
test('pricing ACK survives ten second snapshot deadline with queued value and ignores late stale snapshot',async()=>{
 const f=await setup();await f.client.focus(f.g);let resolve,hold=false;
 const client=createBudgetMetadataEditor({service:f.service,sessionId:'deadline',read:()=>hold?new Promise(r=>resolve=r):f.transport.read('trip')});clients.push(client);client.configure('A','trip',true,true);await client.refresh();const g=client.get('budget','id','pricing');await f.client.release(f.g);await client.focus(g);
 const drain=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};mock.timers.enable({apis:['setTimeout']});
 try{hold=true;client.input(g,{...g.value,amount:'1000'});const work=client.save(g);await drain();expect(g.canonical.amount).toBe(1000);const stale=await f.transport.read('trip');client.input(g,{...g.value,amount:'1200'});
 mock.timers.tick(budgetAuthorityTimeoutMs+1);await drain();expect(await work).toBe(false);expect(g.canonical.amount).toBe(1000);expect(client.view(g).display.amount).toBe('1200');expect(f.patches).toHaveLength(1);
 hold=false;expect(await client.retry(g)).toBe(true);expect(f.patches.map(p=>p.p_patch.pricing.amount)).toEqual([1000,1200]);resolve(stale);await drain();expect(g.canonical.amount).toBe(1200);expect(client.status().snapshot.budgetItems[0].amount).toBe(1200);
 }finally{mock.timers.reset();}
});
test('Demo safe inactive retained transition preserves identities and known debit rejects entire amount change',async()=>{
 const f=await setup();f.props.actualExpenses=[{...f.props.budgetItems[0],id:'payment',budget_item_id:'id',budget_origin_id:'id',payment_origin:'budget_toggle',payment_active:false,payment_history:[{event:'keep'}],twd_amount_source:'estimated'}];
 f.props.actualParticipants=['A','B','C'].map(user_id=>({id:`p-${user_id}`,actual_expense_id:'payment',user_id}));f.props.attachments=[{id:'receipt',target_id:'payment'}];await f.client.refresh();await f.client.focus(f.g);f.client.input(f.g,{...f.g.value,amount:'1200'});expect(await f.client.save(f.g)).toBe(true);
 expect(f.props.actualExpenses[0]).toMatchObject({id:'payment',amount:1200,payment_active:false,payment_history:[{event:'keep'}],twd_amount_source:'estimated'});expect(f.props.actualParticipants.map(p=>p.id)).toEqual(['p-A','p-B','p-C']);expect(f.props.attachments).toEqual([{id:'receipt',target_id:'payment'}]);
 f.props.actualExpenses[0]={...f.props.actualExpenses[0],twd_amount_source:'actual',actual_twd_amount:1200};const before=structuredClone(f.props.actualExpenses);expect(()=>applyDemoPricing(f.props,'budget','id',{...f.g.value,amount:'1500'})).toThrow('已知台幣扣款');expect(f.props.actualExpenses).toEqual(before);
});
