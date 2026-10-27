import {expect,test} from "@playwright/test";
import {deleteBudgetReceipt} from "../src/lib/budgetReceipts.js";
test("rejected receipt metadata deletion never touches Storage",async()=>{
  const calls=[],supabase={rpc:async(name)=>{calls.push(name);return {error:{code:"55P03"}};},storage:{from:()=>{throw Error("must not touch bytes");}}};
  const result=await deleteBudgetReceipt({supabase,tripId:"trip",attachment:{id:"receipt",target_id:"actual"},meta:{editLease:{}},refresh:()=>{throw Error("must not refresh");}});
  expect(result.ok).toBe(false);expect(calls).toEqual(["mutate_budget_receipt"]);
});
test("bytes use the canonical metadata path only after successful deletion and cleanup failures still reconcile",async()=>{
  const calls=[],supabase={rpc:async()=>{calls.push("metadata");return {data:{file_url:"canonical-path"}};},storage:{from:bucket=>({remove:async paths=>{calls.push({bucket,paths});return {error:{message:"offline"}};}})}};
  const result=await deleteBudgetReceipt({supabase,tripId:"trip",attachment:{id:"receipt",target_id:"actual",file_url:"untrusted-old-path"},meta:{editLease:{sessionId:"tab",token:"capability"}},refresh:async()=>{calls.push("refresh");}});
  expect(result.ok).toBe(true);expect(result.cleanupError).toBeTruthy();expect(calls).toEqual(["metadata",{bucket:"trip-attachments",paths:["canonical-path"]},"refresh"]);
});
