import {expect,test} from "@playwright/test";
import {createBudgetCollaboration} from "../src/lib/budgetCollaboration.js";
const pause=()=>new Promise(r=>setTimeout(r,110));
function setup({protocol=1}={}){
  let now=Date.now(),actor="A",tick;const calls=[],changes=[],pending=[];
  const f={calls,changes,pending,offline:false,hold:false,advance:ms=>now+=ms,actor:value=>{actor=value;},tick:()=>tick?.()};
  const supabase={auth:{getSession:async()=>({data:{session:{user:{id:actor}}}})},
    rpc:async(name,args)=>{calls.push({name,args,actor});if(f.offline)throw Error("offline");
      if(name.startsWith("update_budget_selection")){if(f.failWrites)throw Error('write interrupted');return {data:null};}
      const result={data:{tripId:args.p_trip_id,selectionProtocol:protocol,serverNow:new Date(now).toISOString(),entries:[{kind:"budget",resource_id:"record",user_id:"B",mode:"edit",expires_at:new Date(now+20000).toISOString(),own_session:false}]}};
      if(f.hold)await new Promise(r=>pending.push(r));return result;},
    channel:()=>({on(){return this;},subscribe(cb){queueMicrotask(()=>cb("SUBSCRIBED"));return this;}}),removeChannel:async()=>{},};
  // Supabase PostgrestBuilder is awaitable through then(), without catch().
  const execute=supabase.rpc;supabase.rpc=(...args)=>({then:(resolve,reject)=>execute(...args).then(resolve,reject)});
  f.client=createBudgetCollaboration({supabase,sessionId:"session",onChange:rows=>changes.push(rows),now:()=>now,setTimer:fn=>{tick=fn;return fn;},clearTimer:()=>{tick=null;}});return f;
}
test("expired authority is swept locally without a financial or metadata read per tick",async()=>{
  const f=setup();await f.client.configure("A","trip");await pause();expect(f.changes.at(-1)).toHaveLength(1);
  const before=f.calls.length;f.advance(21000);f.tick();expect(f.changes.at(-1)).toEqual([]);expect(f.calls.length).toBe(before);await f.client.dispose();
});
test("late A metadata and callbacks cannot replace account B or a later A generation",async()=>{
  const f=setup();f.hold=true;await f.client.configure("A","trip");await pause();
  f.hold=false;f.actor("B");await f.client.configure("B","trip");await pause();
  f.actor("A");await f.client.configure("A","trip");await pause();const before=f.changes.length;
  f.pending.splice(0).forEach(r=>r());await pause();expect(f.changes.length).toBe(before);await f.client.dispose();
});
test("hidden/offline reads cannot reintroduce names and hidden selection stops heartbeats",async()=>{
  const f=setup();await f.client.configure("A","trip");await pause();f.client.select({kind:"budget",id:"record"});await pause();
  f.hold=true;f.client.reconcile();await pause();f.client.hide();f.pending.splice(0).forEach(r=>r());await pause();
  expect(f.changes.at(-1)).toEqual([]);const before=f.calls.length;f.advance(60000);f.tick();expect(f.calls.length).toBe(before);
  f.hold=false;f.offline=true;f.client.reconcile();await pause();expect(f.changes.at(-1)).toEqual([]);await f.client.dispose();
});
test("selection payloads contain no names, amounts, financial drafts or authority tokens",async()=>{
  const f=setup();await f.client.configure("A","trip");f.client.select({kind:"budget",id:"record",title:"private draft",amount:123,token:"not-authority"});await pause();
  const writes=f.calls.filter(c=>c.name==="update_budget_selection");expect(writes.at(-1).args).toEqual({p_trip_id:"trip",p_session_id:"session",p_kind:"budget",p_id:"record"});
  await f.client.dispose();
});

test('v2 heartbeat, visibility recovery and retry never manufacture a new active selection',async()=>{
  const f=setup({protocol:2});await f.client.configure('A','trip');await pause();f.failWrites=true;
  f.client.select({kind:'budget',id:'record'});await pause();
  f.failWrites=false;f.advance(16000);f.tick();await pause();f.client.hide();await pause();f.client.reconcile();await pause();
  const writes=f.calls.filter(c=>c.name==='update_budget_selection_v2');
  expect(writes.filter(c=>c.args.p_action==='select')).toHaveLength(1);
  expect(writes.filter(c=>c.args.p_action==='refresh').length).toBeGreaterThan(0);
  expect(new Set(writes.map(c=>c.args.p_activity_id)).size).toBe(1);
  expect(Object.keys(writes[0].args).sort()).toEqual(['p_action','p_activity_id','p_id','p_kind','p_session_id','p_trip_id']);
  await f.client.dispose();
});
