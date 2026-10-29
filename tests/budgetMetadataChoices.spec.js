import {test,expect} from '@playwright/test';
import {createBudgetMetadataEditor,validBudgetMetadataSnapshot} from '../src/lib/budgetMetadataService.js';
import {createDemoBudgetMetadataService} from '../src/demo/budgetMetadata.js';
import {mock} from 'node:test';
import {budgetAuthorityTimeoutMs} from '../src/lib/budgetMetadataService.js';
const clients=[];
test.afterEach(async()=>{await Promise.all(clients.splice(0).map(c=>c.dispose()));});
async function setup() {
  const props={currentUserId:'A',members:[{user_id:'A',status:'approved'},{user_id:'B',status:'approved'}],items:[{id:'i',trip_id:'trip'},{id:'j',trip_id:'trip'}],itineraryBudgetLinks:[],
    budgetItems:[{id:'id',trip_id:'trip',title:'Initial',note:'Note',category:'交通',payer_id:'A',amount:900,currency:'TWD'}],actualExpenses:[],
    onSaveMetadata(kind,id,group,value){if(group==='links')props.itineraryBudgetLinks=value.map(i=>({budget_item_id:id,itinerary_item_id:i}));else props.budgetItems[0][group==='payer'?'payer_id':group]=value;}};
  const store=new Map(),storage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},transport=createDemoBudgetMetadataService(()=>props),patches=[];
  const service={...transport,patch:async args=>{patches.push(structuredClone(args));return transport.patch(args);}};
  const read=()=>transport.read('trip'),client=createBudgetMetadataEditor({service,read,sessionId:'tab',storage});clients.push(client);client.configure('A','trip',true,true);await client.refresh();return {props,client,service,transport,patches,store,storage,read};
}
for(const [group,value] of [['category','餐飲'],['payer','B'],['payer',null],['links',['j','i','j']]])test(`${group} immediate autosave canonicalizes and preserves other fields ${JSON.stringify(value)}`,async()=>{
  const f=await setup(),g=f.client.get('budget','id',group);await f.client.focus(g);f.client.input(g,value);
  await expect.poll(()=>g.saved).toBe(true);expect(f.patches).toHaveLength(1);expect(f.patches[0].p_patch).toEqual({[group]:group==='links'?['i','j']:value});
  expect(f.props.budgetItems[0]).toMatchObject({title:'Initial',note:'Note',amount:900,currency:'TWD'});expect(f.client.view(g).writable).toBe(true);
  f.client.input(g,value);await f.client.save(g);expect(f.patches).toHaveLength(1);
});
test('schema v2 rejects malformed missing group and foreign collection projections',async()=>{
  const f=await setup(),good=(await f.read()).data;expect(validBudgetMetadataSnapshot(good,'trip')).toBe(true);
  const bad=structuredClone(good);bad.metadataRecords[0].groups.find(g=>g.group==='links').value=['foreign'];expect(validBudgetMetadataSnapshot(bad,'trip')).toBe(false);
  const missing=structuredClone(good);missing.metadataRecords[0].groups.pop();expect(validBudgetMetadataSnapshot(missing,'trip')).toBe(false);
});
test('links queue retains latest collection while previous request awaits acknowledgement',async()=>{
  const f=await setup(),g=f.client.get('budget','id','links');await f.client.focus(g);const original=f.service.patch;let resolve;
  f.service.patch=async args=>{const result=await original(args);await new Promise(r=>resolve=r);return result;};
  f.client.input(g,['i']);const first=f.client.save(g);await expect.poll(()=>Boolean(resolve)).toBe(true);f.client.input(g,['j']);expect(f.patches).toHaveLength(1);
  f.service.patch=original;resolve();await first;await expect.poll(()=>g.canonical).toEqual(['j']);expect(f.patches).toHaveLength(2);expect(f.props.itineraryBudgetLinks).toEqual([{budget_item_id:'id',itinerary_item_id:'j'}]);
});
test('unknown payer ACK retries exact intent without a second write',async()=>{
  const f=await setup(),g=f.client.get('budget','id','payer');await f.client.focus(g);const original=f.service.patch;let once=true;
  f.service.patch=async args=>{const result=await original(args);if(once){once=false;return {error:{message:'ack lost'}};}return result;};
  f.client.input(g,'B');expect(await f.client.save(g)).toBe(false);const id=g.request.p_request_id;expect(await f.client.retry(g)).toBe(true);expect(f.patches.map(p=>p.p_request_id)).toEqual([id,id]);expect(g.base).toBe(1);
});
test('payer membership failure preserves draft and changing trip fences late ACK',async()=>{
  const f=await setup(),g=f.client.get('budget','id','payer');await f.client.focus(g);f.client.input(g,'outside');expect(await f.client.save(g)).toBe(false);expect(f.client.view(g).display).toBe('outside');expect(f.props.budgetItems[0].payer_id).toBe('A');
  f.client.configure('A','other',true,true);expect(f.client.status().verified).toBe(false);expect(f.store.size).toBe(1);
});
test('links draft storage restores arrays without capability or automatic write',async()=>{
  const f=await setup(),g=f.client.get('budget','id','links');await f.client.focus(g);f.service.patch=async()=>({error:{code:'55P03'}});f.client.input(g,['i']);await f.client.save(g);await f.client.release(g);
  const restored=createBudgetMetadataEditor({service:f.transport,read:f.read,sessionId:'new-document',storage:f.storage});clients.push(restored);restored.configure('A','trip',true,true);await restored.refresh();const draft=restored.get('budget','id','links');
  expect(restored.view(draft).display).toEqual(['i']);expect(draft.token).toBeUndefined();expect(restored.view(draft).writable).toBe(false);expect(f.props.itineraryBudgetLinks).toEqual([]);
});
test('null payer first intent survives pending acquire and becomes an actual null patch',async()=>{
  const f=await setup(),g=f.client.get('budget','id','payer'),original=f.service.lease;let resolve;
  f.service.lease=async args=>{if(args.p_action==='acquire')await new Promise(r=>resolve=r);return original(args);};
  const pending=f.client.focus(g);await expect.poll(()=>Boolean(resolve)).toBe(true);f.client.input(g,null);
  expect(f.client.view(g).display).toBe(null);expect(g.value).toBe('A');resolve();await pending;await f.client.save(g);
  expect(f.props.budgetItems[0].payer_id).toBe(null);expect(f.patches[0].p_patch).toEqual({payer:null});
});
test('confirmed link collection survives snapshot deadline with queued collection and exact retry',async()=>{
  const f=await setup(),g=f.client.get('budget','id','links');await f.client.focus(g);
  let resolve,hold=true;
  const client=createBudgetMetadataEditor({service:f.service,sessionId:'timeout-tab',read:()=>hold?new Promise(r=>resolve=r):f.read()});
  clients.push(client);client.configure('A','trip',true,true);hold=false;await client.refresh();const links=client.get('budget','id','links');
  await f.client.release(g);await client.focus(links);mock.timers.enable({apis:['setTimeout']});
  const drain=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
  try{
    hold=true;client.input(links,['i']);const work=client.save(links);await drain();expect(links.canonical).toEqual(['i']);const stale=await f.read();client.input(links,['j']);
    mock.timers.tick(budgetAuthorityTimeoutMs+1);await drain();expect(await work).toBe(false);expect(links.canonical).toEqual(['i']);expect(client.view(links).display).toEqual(['j']);expect(f.patches).toHaveLength(1);
    hold=false;expect(await client.retry(links)).toBe(true);expect(f.patches.map(p=>p.p_patch)).toEqual([{links:['i']},{links:['j']}]);resolve(stale);await drain();expect(links.canonical).toEqual(['j']);expect(client.status().snapshot.itineraryBudgetLinks).toEqual([{budget_item_id:'id',itinerary_item_id:'j'}]);
  }finally{mock.timers.reset();}
});
