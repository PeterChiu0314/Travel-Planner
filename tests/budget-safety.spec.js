import { expect, test } from "@playwright/test";

import { calculateActualPricing, calculatePricing, recordForm, recordAllocations, settlementBalances } from "../src/lib/budgetFinance.js";
import { saveDemoBudgetRecord } from "../src/demo/saveBudgetRecord.js";
import { persistBudgetWorkspace } from "../src/lib/budgetWorkspaceService.js";

// Save/cancel now return to the selected canonical detail (#11).
async function inspectAfter(page, form, action) {
  await form.getByRole('button',{name:action,exact:true}).click();
  if (await form.count() === 0) await page.getByRole('tab',{name:'項目明細',exact:true}).click();
}


const form = { title: "Card debit", category: "餐飲", currency: "JPY", amount: 2800, exchange_rate: .22, pricing_mode: "split_total", payer_id: "a", participantIds: ["a","b"], shares: {}, linkedItemIds: [] };
const members = ["a","b"].map((user_id) => ({ user_id, status: "approved" }));
const trip = { id: "trip", start_date: "2090-01-01", end_date: "2090-01-05" };
const emptyState = () => ({ budgetItems: [], budgetParticipants: [], actualExpenses: [], actualParticipants: [], attachments: [], itineraryBudgetLinks: [], tripBudgetRates: { rates: { JPY: .22 } } });
const nav = (page, name) => page.getByRole("navigation", { name: "Demo 導覽", exact: true }).getByRole("button", { name, exact: true });
const row = (page, title) => page.locator(".bw-row").filter({ has: page.getByRole("button", { name: title, exact: true }) });

test("actual TWD keeps foreign totals and allocates the known debit, with explicit estimates and legacy safety", () => {
  const actual = calculateActualPricing({ ...form, twd_amount_source: "actual", actual_twd_amount: "625" });
  expect(actual.amount).toBe(2800); expect(actual.twd_amount).toBe(625);
  expect(Object.values(actual.allocations).reduce((a,b)=>a+b,0)).toBe(625);
  expect(calculateActualPricing({ ...form, twd_amount_source: "estimated" }).twd_amount).toBe(616);
  expect(calculateActualPricing({ ...form, exchange_rate: "", twd_amount_source: "actual", actual_twd_amount: "625" }).twd_amount).toBe(625);
  expect(calculateActualPricing({ ...form, exchange_rate: "", twd_amount_source: "actual", actual_twd_amount: "625" }).exchange_rate).toBeNull();
  expect(calculateActualPricing({ ...form, amount: 9999999999, exchange_rate: 100, twd_amount_source: "actual", actual_twd_amount: "625" }).twd_amount).toBe(625);
  for (const invalid of ["", "-1", "625.5", "NaN", "10000000000"]) expect(() => calculateActualPricing({ ...form, twd_amount_source: "actual", actual_twd_amount: invalid })).toThrow();
  const old = { id:"old", ...form, ...calculatePricing(form), twd_amount:625 };
  const seed = recordForm(old, [{actual_expense_id:"old",user_id:"a"},{actual_expense_id:"old",user_id:"b"}], "actual_expense_id", members);
  expect(seed.twd_amount_source).toBe("legacy");
  expect(calculateActualPricing({ ...seed, note:"Only note changed" }).twd_amount).toBe(625);
  expect(recordAllocations({...old,twd_amount:625.5},[{user_id:"a"},{user_id:"b"}])).toBeNull();
  expect(()=>calculateActualPricing({...form,pricing_mode:"custom",shares:{a:0,b:0},twd_amount_source:"actual",actual_twd_amount:625})).toThrow("合計為零");
});

test("Demo transaction rejects bad payment changes without mutating any parent, child or receipt; retries are idempotent", () => {
  const original = emptyState(), input = {...form,payment_action:"paid",payment_expected:[]};
  const created = saveDemoBudgetRecord(original,"budget",input,null,{operationId:"request"},trip,members);
  expect(created.ok).toBe(true); expect(original).toEqual(emptyState());
  const replay = saveDemoBudgetRecord(created.nextState,"budget",input,null,{operationId:"request"},trip,members);
  expect(replay.nextState).toBe(created.nextState); expect(replay.nextState.actualExpenses).toHaveLength(1);
  const state = created.nextState, budget = state.budgetItems[0], payment = state.actualExpenses[0];
  const withReceipt = {...state,attachments:[{target_type:"actual_expense",target_id:payment.id}]};
  const before = structuredClone(withReceipt);
  const rejected = saveDemoBudgetRecord(withReceipt,"budget",{...form,title:"Never commit",payment_action:"unpaid",payment_expected:[{id:payment.id,updated_at:payment.updated_at}],payment_confirmed:true},budget.id,{baseUpdatedAt:budget.updated_at},trip,members);
  expect(rejected.ok).toBe(false); expect(rejected.error.message).toContain("收據"); expect(withReceipt).toEqual(before);
  const bad = saveDemoBudgetRecord(state,"budget",{...form,payment_action:"unpaid",payment_expected:[]},budget.id,{},trip,members);
  expect(bad.ok).toBe(false); expect(bad.conflict).toBe(true);
});

test("Formal adapter uses one RPC, preserves exact debit and request key, and never retries through legacy writes", async () => {
  const calls = [], payload = {...form,actual_twd_amount:625,twd_amount_source:"actual"}; let reloads=0;
  const deps = { tripId:"trip",reload:async()=>{reloads++;},supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:{id:"saved"},error:null};},from:()=>{throw new Error("Legacy write must not run");}} };
  const result = await persistBudgetWorkspace(deps,"actual",payload,null,{operationId:"request"});
  expect(result.ok).toBe(true); expect(calls).toHaveLength(1); expect(calls[0].name).toBe("save_budget_workspace_record_v2");
  expect(calls[0].args.p_payload.actual_twd_amount).toBe(625); expect(calls[0].args.p_payload.amount).toBe(2800); expect(calls[0].args.p_request_id).toBe("request");expect(reloads).toBe(1);
  deps.supabase.rpc=async()=>({error:{code:"PGRST202",message:"Missing"}});
  const failure=await persistBudgetWorkspace(deps,"budget",{...form,payment_action:"paid"},null,{operationId:"retry"});
  expect(failure.ok).toBe(false); expect(failure.error.message).toContain("草稿已保留"); expect(reloads).toBe(1);
  deps.supabase.rpc=async()=>({error:{code:"40001",message:"Changed"}});
  expect((await persistBudgetWorkspace(deps,"budget",form,"saved")).conflict).toBe(true);
  deps.supabase.rpc=async()=>({data:{id:"committed"},error:null}); deps.reload=async()=>{throw new Error("Refresh failed");};
  const committed=await persistBudgetWorkspace(deps,"budget",form,null);
  expect(committed.ok).toBe(true); expect(committed.refreshError.message).toBe("Refresh failed");
});

test.describe("payment and actual-cost browser regressions", () => {
  test.use({viewport:{width:1440,height:1000}});
  test.beforeEach(async({page})=>{await page.clock.install({time:new Date("2026-10-22T12:00:00+08:00")});});
  test("single-payment status changes preserve the recorded amount without a destructive confirmation", async({page})=>{
    await page.goto("/demo/budget"); const title="去程機票・桃園 → 關西";
    await row(page,title).getByRole("button",{name:title,exact:true}).click();
    let dialogs=0;page.on("dialog",async d=>{dialogs++;await d.dismiss();});
    await page.getByRole("button",{name:"付款狀態",exact:true}).click();
    await expect(page.getByRole("button",{name:"付款狀態",exact:true})).toHaveAttribute("aria-pressed","false");
    await expect(row(page,title)).toContainText("35,745");await expect(page.locator('.bw-detail .bw-calculation')).toContainText('35,745');
    await page.getByRole("button",{name:"付款狀態",exact:true}).click();await expect(row(page,title)).toContainText("已付款");expect(dialogs).toBe(0);
  });
  test("receipts survive changing the payment status in planning", async({page})=>{
    await page.goto("/demo/budget"); const title="去程機票・桃園 → 關西";
    await row(page,title).getByRole("button",{name:title,exact:true}).click();
    await page.locator('.attachment-upload input[type=file]').setInputFiles({name:"proof.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4 local test")});
    await expect(page.getByRole("button",{name:"proof.pdf",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"付款狀態",exact:true}).click();
    await expect(row(page,title)).toContainText("未付款");await expect(page.getByRole("button",{name:"proof.pdf",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"付款狀態",exact:true}).click();await expect(row(page,title)).toContainText("已付款");
  });
  test("multiple payments become inactive together without changing the frozen budget or deleting records",async({page})=>{
    await page.goto("/demo/budget?budgetTools=1");await page.getByRole("combobox",{name:"Demo 情境",exact:true}).click();await page.getByRole("option",{name:"旅程結算",exact:true}).click();
    await page.getByRole("tab",{name:"對照",exact:true}).click();const baseline=await page.locator(".bw-comparison-summary > span").first().textContent();
    await page.getByRole("tab",{name:"預算",exact:true}).click();await row(page,"租車加油").getByRole("button",{name:"租車加油",exact:true}).click();
    await page.getByRole("button",{name:"付款狀態",exact:true}).click();
    await expect(row(page,"租車加油")).toContainText("未付款");await expect(page.locator(".bw-retained button")).toHaveCount(2);
    await page.getByRole("tab",{name:"實付",exact:true}).click();await expect(page.locator(".bw-row")).toHaveCount(32);
    await page.getByRole("tab",{name:"對照",exact:true}).click();await expect(page.locator(".bw-comparison-summary > span").first()).toHaveText(baseline);
  });
  test("simple TWD entry survives save, edit and settlement", async({page})=>{
    await page.goto("/demo/budget");await page.clock.setSystemTime(new Date("2027-04-06T12:00:00+08:00"));await page.clock.runFor(30010);await page.getByRole("button",{name:"新增實付",exact:true}).click();
    const editor=page.getByRole("form",{name:"實付編輯"});await editor.getByLabel("項目",{exact:true}).fill("信用卡實扣");await editor.getByLabel("總額",{exact:true}).fill("625");
    await editor.getByRole("combobox",{name:"付款人",exact:true}).click();await page.getByRole("option",{name:"Peter",exact:true}).click();
    if(process.env.BUDGET_ISSUES_QA_DIR) await page.screenshot({path:`${process.env.BUDGET_ISSUES_QA_DIR}/actual-debit-editor.png`});
    await inspectAfter(page, editor, "儲存");await expect(row(page,"信用卡實扣")).toContainText("625");
    await expect(row(page,"信用卡實扣")).toHaveClass(/is-selected/);await expect(page.locator(".bw-detail")).toContainText("實際扣款");
    if(process.env.BUDGET_ISSUES_QA_DIR) await page.screenshot({path:`${process.env.BUDGET_ISSUES_QA_DIR}/actual-debit-detail.png`});
    await page.getByRole('tab',{name:'編輯項目',exact:true}).click();await expect(editor.getByLabel("總額",{exact:true})).toHaveValue("625");await expect(editor.getByLabel("實際台幣扣款",{exact:true})).toHaveCount(0);
    await editor.locator(".bw-secondary-fields > summary").click();await expect(editor.getByLabel("細項",{exact:true})).toHaveCount(0);
    await editor.getByLabel("備註",{exact:true}).fill("保留實際扣款");await inspectAfter(page, editor, "儲存");
    await expect(row(page,"信用卡實扣")).toContainText("625");await nav(page,"分帳結算").click();await expect(page.locator(".settlement-expense").filter({hasText:"信用卡實扣"})).toContainText("625");
    if(process.env.BUDGET_ISSUES_QA_DIR) await page.screenshot({path:`${process.env.BUDGET_ISSUES_QA_DIR}/actual-debit-settlement.png`});
  });
  test("legacy trip without shared rates can save metadata while monetary controls stay frozen",async({page})=>{
    await page.goto("/tests/harness/budget-safety.html");await page.getByRole("tab",{name:"預算",exact:true}).click();
    await row(page,"舊外幣預算").getByRole("button",{name:"舊外幣預算",exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();
    const editor=page.getByRole("form",{name:"預算編輯"});await expect(editor.getByLabel("總額",{exact:true})).toBeDisabled();await expect(editor.getByRole("combobox",{name:"幣別",exact:true})).toBeDisabled();await expect(editor.locator(".bw-trip-rate")).toContainText("歷史匯率");
    await editor.getByLabel("項目",{exact:true}).fill("修正舊旅程名稱");await inspectAfter(page, editor, "儲存");
    await expect(row(page,"修正舊旅程名稱")).toContainText("620");await expect(editor).toHaveCount(0);
    expect(JSON.parse(await page.getByTestId("rpc-contract").textContent())[0].name).toBe("save_budget_workspace_record_v3");
  });
  test("Formal controller keeps a failed combined draft and retries the same operation without duplicate actuals",async({page})=>{
    await page.goto("/tests/harness/budget-safety.html?future=1&fail=once");await page.getByRole("button",{name:"新增預算",exact:true}).click();
    const editor=page.getByRole("form",{name:"預算編輯"});await editor.getByLabel("項目",{exact:true}).fill("交易失敗後重試");await editor.getByLabel("總額",{exact:true}).fill("1000");await editor.getByRole("button",{name:"付款狀態",exact:true}).click();
    await inspectAfter(page, editor, "儲存");await expect(editor.getByRole("alert")).toContainText("草稿仍保留");await expect(editor.getByLabel("項目",{exact:true})).toHaveValue("交易失敗後重試");
    await inspectAfter(page, editor, "儲存");await expect(editor).toHaveCount(0);await expect(row(page,"交易失敗後重試")).toContainText("已付款");
    const calls=JSON.parse(await page.getByTestId("rpc-contract").textContent());expect(calls).toHaveLength(2);expect(calls[0].request).toBe(calls[1].request);
    await expect(row(page,"交易失敗後重試")).toHaveClass(/is-selected/);await expect(page.locator(".bw-detail .bw-calculation")).toContainText("1,000");
  });
});
