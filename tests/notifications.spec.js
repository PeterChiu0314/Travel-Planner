import {test,expect} from "@playwright/test";
import {createSyncNotifications} from "../src/lib/syncNotifications.js";
import {friendlyError,notificationDuration,syncToastId} from "../src/lib/notifications.js";

function setup(){let online=true;const calls=[];const notify=Object.fromEntries(['warning','error','success','clear','dismiss'].map(type=>[type,(message,options)=>calls.push({type,message,options})]));const sync=createSyncNotifications(notify,()=>online);sync.configure('A','trip');calls.length=0;return{calls,sync,offline:()=>online=false,online:()=>online=true};}
test('connection copy distinguishes offline and service failure without raw TypeError',()=>{
  expect(friendlyError(new TypeError('Failed to fetch'),true)).toContain('同步暫時失敗');
  expect(friendlyError(new TypeError('Failed to fetch'),false)).toContain('網路連線中斷');
  expect(friendlyError({message:'付款金額不得為負數'})).toBe('付款金額不得為負數');
  expect(notificationDuration.error).toBe(Infinity);expect(notificationDuration.success).toBeLessThan(notificationDuration.warning);
});
test('repeated REST/Realtime failures share one ID; all required reads and channel must recover',()=>{
  const {sync,calls}=setup();sync.failure('budget','Failed to fetch');sync.failure('budget','Failed to fetch');sync.failure('realtime','即時連線中斷');
  expect(calls).toHaveLength(1);expect(calls[0].options.id).toBe(syncToastId);
  sync.verified('budget');expect(calls.every(c=>c.type!=='success')).toBe(true);
  sync.verified('realtime');expect(calls.at(-1)).toMatchObject({type:'success',options:{id:syncToastId}});
});
test('online event alone and unrelated success cannot certify recovery; failed retry stays visible',async()=>{
  const {sync,calls,offline,online}=setup();offline();sync.failure('connection','offline');sync.verified('connection');expect(sync.pending()).toEqual(['connection']);
  online();sync.online();sync.verified('budget');expect(calls.every(c=>c.type!=='success')).toBe(true);
  sync.failure('trip-data',{message:'API unavailable'});sync.verified('connection');expect(calls.at(-1).type).toBe('error');
  let retried=0;sync.setRetry(()=>retried++);await calls.at(-1).options.action.onClick();expect(retried).toBe(1);
  sync.failure('trip-data',{message:'API unavailable'});expect(calls.at(-1).options.duration).toBe(Infinity);
  sync.verified('trip-data');expect(calls.at(-1).type).toBe('success');
});
test('trip change drops departed work without claiming success; account change clears private feedback',()=>{
  const {sync,calls}=setup();sync.failure('budget','Failed to fetch');sync.failure('trips','Failed to fetch');sync.configure('A','other');
  expect(sync.pending()).toEqual(['trips']);expect(calls.every(c=>c.type!=='success')).toBe(true);
  sync.configure('B','trip');expect(sync.pending()).toEqual([]);expect(calls.at(-1).type).toBe('clear');
});
test('reads started before a new failure cannot certify that newer failure',()=>{
  const {sync,calls}=setup();const oldRead=sync.checkpoint();sync.failure('budget','Failed to fetch');sync.verified('budget',oldRead);
  expect(sync.pending()).toEqual(['budget']);expect(calls.at(-1).type).toBe('warning');
  const freshRead=sync.checkpoint();sync.verified('budget',freshRead);expect(calls.at(-1).type).toBe('success');
});
