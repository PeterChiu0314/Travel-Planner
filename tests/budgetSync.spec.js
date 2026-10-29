import {expect,test} from "@playwright/test";
import {mock} from "node:test";
import {createRequestGuard} from "../src/lib/luggageSync.js";
import {createBudgetRefresh,readBudgetSnapshot,emptyBudgetSnapshot} from "../src/lib/budgetSync.js";
import {budgetAuthorityTimeoutMs} from "../src/lib/budgetMetadataService.js";

function setup(options = {}) {
  const guard=createRequestGuard(); guard.setContext("A:trip");
  const pending=[],applied=[],errors=[];
  const sync=createBudgetRefresh({guard,read:key=>new Promise(resolve=>pending.push({key,resolve})),apply:(data,key)=>applied.push({data,key}),onError:error=>errors.push(error),delay:5,...options});
  return {guard,pending,applied,errors,sync};
}
test("burst invalidations discard an in-flight mixed graph and share one authoritative rerun",async()=>{
  const f=setup(),work=f.sync.refresh();
  for(let i=0;i<20;i++)f.sync.schedule();
  const writer=f.sync.committed(); expect(f.pending).toHaveLength(1);
  f.pending[0].resolve({data:"obsolete"}); await Promise.resolve(); await Promise.resolve();
  expect(f.applied).toEqual([]); expect(f.pending).toHaveLength(2);
  f.pending[1].resolve({data:"complete graph"}); await Promise.all([work,writer]);
  expect(f.applied).toEqual([{data:"complete graph",key:"A:trip"}]);
});
test("account/trip ABA and scheduled old-generation work never apply or advance the new context",async()=>{
  const f=setup(),old=f.sync.refresh(); f.sync.schedule();
  f.guard.setContext("B:trip"); f.guard.setContext("A:trip"); const fresh=f.sync.refresh();
  f.pending[1].resolve({data:"fresh"}); await fresh;
  f.pending[0].resolve({data:"old"}); await old;
  expect(f.applied).toEqual([{data:"fresh",key:"A:trip"}]);
});
test("read failures retain authority and later retries can recover",async()=>{
  const f=setup(),failed=f.sync.refresh(); f.pending[0].resolve({error:{message:"offline"}});
  expect((await failed).ok).toBe(false); expect(f.applied).toEqual([]); expect(f.errors).toHaveLength(1);
  const retry=f.sync.refresh(); f.pending[1].resolve({data:"recovered"}); expect((await retry).ok).toBe(true);
});
test("adapter fails closed on missing RPC, forbidden, malformed and cross-trip snapshots",async()=>{
  for(const data of [null,{}, {...emptyBudgetSnapshot(),tripId:"other"}]) {
    expect((await readBudgetSnapshot({rpc:async()=>({data})},"trip")).error).toBeTruthy();
  }
  const calls=[];
  expect((await readBudgetSnapshot({rpc:async name=>{calls.push(name);return {error:{code:"PGRST202"}};}},"trip")).error.code).toBe("PGRST202");
  expect(calls).toEqual(["read_budget_snapshot"]);
});

test("pending coalesced snapshot releases its read slot after the authority deadline",async()=>{
  const f=setup({timeoutMs:budgetAuthorityTimeoutMs});mock.timers.enable({apis:["setTimeout"]});
  try {
    let settled=false;const work=f.sync.refresh().then(result=>{settled=true;return result;});
    mock.timers.tick(budgetAuthorityTimeoutMs+1);for(let i=0;i<20;i++)await Promise.resolve();
    expect(settled).toBe(true);expect((await work).ok).toBe(false);
    const retry=f.sync.refresh();expect(f.pending).toHaveLength(2);
    f.pending[1].resolve({data:"fresh"});expect((await retry).ok).toBe(true);
    f.pending[0].resolve({data:"obsolete"});for(let i=0;i<20;i++)await Promise.resolve();
    expect(f.applied).toEqual([{data:"fresh",key:"A:trip"}]);
  }finally{mock.timers.reset();}
});

test("the shared deadline bounds dirty reruns and repeated retries instead of restarting",async()=>{
  const f=setup({timeoutMs:budgetAuthorityTimeoutMs});mock.timers.enable({apis:["setTimeout"]});
  try {
    const work=f.sync.refresh();for(let i=0;i<20;i++)f.sync.committed();
    expect(f.pending).toHaveLength(1);mock.timers.tick(8000);
    f.pending[0].resolve({data:"pre-commit"});for(let i=0;i<20;i++)await Promise.resolve();expect(f.pending).toHaveLength(2);
    mock.timers.tick(2001);for(let i=0;i<20;i++)await Promise.resolve();
    expect((await work).error.code).toBe("BUDGET_SNAPSHOT_TIMEOUT");expect(f.applied).toEqual([]);expect(f.errors).toHaveLength(1);
    const fresh=f.sync.refresh();expect(f.pending).toHaveLength(3);f.pending[2].resolve({data:"accepted"});await fresh;
    f.pending[1].resolve({data:"late rerun"});for(let i=0;i<20;i++)await Promise.resolve();
    expect(f.applied).toEqual([{data:"accepted",key:"A:trip"}]);expect(f.errors).toHaveLength(1);
  }finally{mock.timers.reset();}
});
