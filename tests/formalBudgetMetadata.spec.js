import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { metadataBackend, boot, enableMetadata } from "./helpers/budgetMetadataMock.js";
import { budgetAuthorityTimeoutMs } from "../src/lib/budgetMetadataService.js";
const editor = page => page.getByRole("region", { name: "預算群組編輯" });
const title = page => page.getByRole("textbox", { name: "項目名稱", exact: true });
const note = page => page.getByRole("textbox", { name: "備註", exact: true });
async function write(field, value) { await field.focus(); await field.fill(value); }
async function ready(page, db, actor = "A", recordTitle = "JPY fare") { await enableMetadata(page); await boot(page, db, actor); await page.getByRole("button", { name: recordTitle, exact: true }).click(); await page.getByRole("tab", { name: "編輯項目", exact: true }).click(); await expect(title(page)).toBeVisible(); }
test.afterEach(async ({ page }) => { if (page.qaErrors) expect(page.qaErrors).toEqual([]); });

test("open has no lease; first focus buffers input until admission and same-group lock is exclusive", async ({ page, context }) => {
  const db = metadataBackend(); await ready(page, db); expect(db.groupCalls).toHaveLength(0); expect(db.leaseCalls).toHaveLength(0);
  db.metadataHold = { actor: "A", action: "acquire" }; await title(page).focus(); await expect.poll(() => db.metadataPending.length).toBe(1);
  await title(page).fill("Buffered first input"); await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toHaveCount(0);
  expect(db.rows.budget_items[0].title).toBe("JPY fare"); db.releaseMetadata(); await expect(title(page)).toBeEditable();
  await expect(title(page)).toHaveValue("Buffered first input");
  const other = await context.newPage(); try { await ready(other, db, "B"); await title(other).focus();
    await expect(other.getByText("A 正在編輯項目名稱", { exact: true })).toBeVisible(); await expect(title(other)).toHaveAttribute("readonly", "");
    expect(db.rows.budget_items[0].title).toBe("JPY fare"); expect(other.qaErrors).toEqual([]);
  } finally { await other.close(); }
});
test("different groups save narrow patches and remote commits preserve a dirty local group", async ({ page, context }) => {
  const db = metadataBackend(); await ready(page, db); const other = await context.newPage();
  try {
    await ready(other, db, "B"); await write(title(page), "A new title"); await write(note(other), "B new note");
    await expect.poll(() => db.rows.budget_items[0].note).toBe("B new note"); await expect(note(page)).toHaveValue("B new note");
    await expect(title(page)).toHaveValue("A new title");
    if (process.env.BUDGET_B2_EVIDENCE) { await fs.mkdir(process.env.BUDGET_B2_EVIDENCE, { recursive: true });
      await other.screenshot({ path: path.join(process.env.BUDGET_B2_EVIDENCE, "b2-other-editor.png") }); }
    await expect.poll(() => db.rows.budget_items[0].title).toBe("A new title");
    await expect(title(other)).toHaveValue("A new title"); expect(db.rows.budget_items[0]).toMatchObject({ title: "A new title", note: "B new note", amount: 1000, twd_amount: 200 });
    expect(db.rpcs.filter(r => r.name.startsWith("save_budget_workspace"))).toHaveLength(0); expect(db.leaseCalls).toHaveLength(0);
    for (const call of db.groupCalls.filter(c => c.name === "patch_budget_metadata_group")) expect(Object.keys(call.args.p_patch)).toHaveLength(1);
    expect(other.qaErrors).toEqual([]);
  } finally { await other.close(); }
});
test("same-account tabs have distinct sessions and cannot edit the same group", async ({ page, context }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "A draft"); const other = await context.newPage();
  try { await ready(other, db); await title(other).focus(); await expect(other.getByText("A 正在編輯項目名稱", { exact: true })).toBeVisible();
    const calls = db.groupCalls.filter(c => c.args.p_action === "acquire"); expect(new Set(calls.map(c => c.args.p_session_id)).size).toBe(2); expect(other.qaErrors).toEqual([]);
  } finally { await other.close(); }
});
test("clean blur releases; invalid sidebar exit is guarded and release failures keep the editor recoverable", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await title(page).focus(); await expect.poll(() => [...db.groupStates.values()].filter(g => g.actor).length).toBe(1);
  await note(page).focus(); await expect.poll(() => db.groupStates.get("budget:budget:title").actor).toBe(null);
  await write(title(page), ""); await page.getByRole("tab", { name: "旅程統計", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "繼續編輯", exact: true }).click(); await expect(title(page)).toHaveValue("");
  db.releaseFailure = true; await page.getByRole("button", { name: "捨棄此欄草稿", exact: true }).click(); await expect(page.getByRole("alert").filter({hasText:"尚未確認權限釋放"})).toBeVisible();
  db.releaseFailure = false; await page.getByRole("button", { name: "捨棄此欄草稿", exact: true }).click(); await page.getByRole("tab", { name: "旅程統計", exact: true }).click(); await expect(title(page)).toHaveCount(0);
});
for (const unavailable of ["metadataMissing", "metadataEnabled"]) test(`${unavailable}: no automatic legacy write fallback`, async ({ page }) => {
  const db = metadataBackend(); db[unavailable] = unavailable === "metadataMissing"; await ready(page, db);
  await expect(title(page)).toHaveAttribute("readonly", ""); await title(page).focus(); await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toHaveCount(0);
  expect(db.groupCalls).toHaveLength(0); expect(db.leaseCalls).toHaveLength(0);
});
test("lost acknowledgement retries the exact request without duplicate commits", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "Committed with lost ack"); db.losePatchAck = true;
  await expect(page.getByRole("button", { name: "確認儲存結果", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "確認儲存結果", exact: true }).click(); await expect(title(page)).toHaveValue("Committed with lost ack");
  expect(db.groupStates.get("budget:budget:title").revision).toBe(1);
  const calls = db.groupCalls.filter(c => c.name === "patch_budget_metadata_group"); expect(calls).toHaveLength(2); expect(calls[0].args).toEqual(calls[1].args);
});
test("offline keeps the per-tab draft and disables writes until validated renewal", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "Offline draft"); db.offline = true; await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(title(page)).toHaveValue("Offline draft"); await expect(title(page)).toHaveAttribute("readonly", "");
  expect(db.groupCalls.filter(c=>c.name === "patch_budget_metadata_group")).toHaveLength(0);
  db.offline = false; await page.evaluate(() => window.dispatchEvent(new Event("online"))); await expect(title(page)).toBeEditable();
  const stored = await page.evaluate(() => JSON.stringify(sessionStorage)); expect(stored).not.toMatch(/p_token|token_hash/);
});
test("failed background snapshot invalidates authority even when the browser remains online", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "Retain through read failure");
  db.snapshotDenied = true; await db.emit("budget_items");
  await expect(title(page)).toHaveValue("Retain through read failure"); await expect(title(page)).toHaveAttribute("readonly", "");
  expect(db.groupCalls.filter(c=>c.name === "patch_budget_metadata_group")).toHaveLength(0);
  db.snapshotDenied = false; await db.emit("budget_items");
  await expect(title(page)).toBeEditable();
});
test("keyboard Unicode entry is buffered during admission and Tab reaches readonly fields", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); db.metadataHold = { actor: "A", action: "acquire" };
  await title(page).click(); await page.keyboard.press("End"); await page.keyboard.insertText("・京都");
  await expect(title(page)).toHaveValue("JPY fare・京都"); expect(db.rows.budget_items[0].title).toBe("JPY fare");
  db.releaseMetadata(); await expect(title(page)).toBeEditable();
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "捨棄此欄草稿", exact: true })).toBeFocused();
});
test("same-group conflict preserves input, and explicit discard adopts the latest revision", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "Keep my draft");
  db.rows.budget_items[0].title = "Remote canonical"; db.groupStates.get("budget:budget:title").revision++;
  await db.emit("budget_collaboration_signals"); await expect(page.getByRole("alert")).toContainText("草稿已保留");
  await expect(title(page)).toHaveValue("Keep my draft"); await expect(title(page)).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "捨棄此欄草稿", exact: true }).click(); await expect(title(page)).toHaveValue("Remote canonical");
});
test("draft survives reload without restoring capability or overwriting another tab", async ({ page, context }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "Only this tab");
  const other = await context.newPage(); try { await ready(other, db, "B"); await expect(title(other)).toHaveValue("JPY fare");
    await page.reload(); await page.getByRole("button", { name: "JPY fare", exact: true }).click(); await page.getByRole("tab", { name: "編輯項目", exact: true }).click();
    await expect(title(page)).toHaveValue("Only this tab"); await expect(title(page)).toHaveAttribute("readonly", "");
    expect(other.qaErrors).toEqual([]);
  } finally { await other.close(); }
});
test("late admission cannot authorize the returned trip generation", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); db.metadataHold = { actor: "A", action: "acquire" };
  await title(page).focus(); await expect.poll(() => db.metadataPending.length).toBe(1);
  await page.getByRole("button", { name: "Other QA", exact: true }).click(); await expect(title(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Rates QA", exact: true }).click();
  await page.getByRole("button", { name: "JPY fare", exact: true }).click(); await page.getByRole("tab", { name: "編輯項目", exact: true }).click();
  await expect(title(page)).toHaveAttribute("readonly", "");
  db.releaseMetadata();
  await expect.poll(() => [...db.groupStates.values()].filter(g => g.actor).length).toBe(0);
});
test("pending admission blocks a clean sidebar exit until exact cleanup", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); db.metadataHold = { actor: "A", action: "acquire" };
  await title(page).focus(); await expect.poll(() => db.metadataPending.length).toBe(1);
  await page.getByRole("tab", { name: "旅程統計", exact: true }).click(); await expect(title(page)).toBeVisible();
  db.releaseMetadata(); await expect(title(page)).toHaveCount(0); await expect.poll(() => [...db.groupStates.values()].filter(g => g.actor).length).toBe(0);
});
test("legacy whole-record owner prevents group admission without a legacy save fallback", async ({ page }) => {
  const db = metadataBackend(); db.held.set("budget:budget", { actor: "B", session: "old-tab", token: "old-token", expires: db.now + 420000 });
  await ready(page, db); await title(page).focus(); await expect(page.getByRole("alert")).toContainText("其他成員或分頁");
  await expect(title(page)).toHaveAttribute("readonly", ""); expect(db.leaseCalls).toHaveLength(0);
});
test("full-record editing is an explicit transition after releasing this tab's group", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await title(page).focus();
  await expect.poll(() => [...db.groupStates.values()].filter(g => g.actor).length).toBe(1);
  await page.getByRole("button", { name: "編輯完整項目", exact: true }).click();
  await expect(page.getByRole("form", { name: "預算編輯", exact: true })).toBeVisible();
  await expect.poll(() => [...db.groupStates.values()].filter(g => g.actor).length).toBe(0);
  expect(db.leaseCalls.some(c => c.args.p_action === "acquire")).toBe(true);
});
test("standalone Actual uses the same groups without changing known debit", async ({ page }) => {
  const db = metadataBackend(); db.trips.forEach(t => { t.start_date = "2020-04-05"; t.end_date = "2020-04-10"; });
  db.rows.actual_expenses = [{ id: "manual", trip_id: "trip", title: "Manual fare", note: "Original", payment_origin: "manual", amount: 300,
    currency: "JPY", exchange_rate: .2, twd_amount: 71, actual_twd_amount: 71, twd_amount_source: "actual", payer_id: "A" }];
  await enableMetadata(page); await boot(page, db); await page.getByRole("button", { name: "Manual fare", exact: true }).click(); await page.getByRole("tab", { name: "編輯項目", exact: true }).click();
  await write(note(page), "Actual note"); await expect.poll(() => db.rows.actual_expenses[0].note).toBe("Actual note");
  expect(db.rows.actual_expenses[0]).toMatchObject({ note: "Actual note", actual_twd_amount: 71, currency: "JPY", exchange_rate: .2 }); expect(db.leaseCalls).toHaveLength(0);
});
test("Demo shares the metadata editor and stays memory-only", async ({ page }) => {
  await enableMetadata(page); const errors = [], requests = [];
  page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", r => { if (/\.supabase\.co|\/auth\/v1|\/rest\/v1|\/realtime\/v1|open.er-api.com/.test(r.url())) requests.push(r.url()); });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/demo/budget");
  await page.getByRole("button", { name: "租車加油", exact: true }).click(); await page.getByRole("tab", { name: "編輯項目", exact: true }).click();
  await write(note(page), "Demo note"); await expect(note(page).locator("..").getByText("已儲存", {exact:true})).toBeVisible(); await expect(note(page)).toHaveValue("Demo note");
  if (process.env.BUDGET_B2_EVIDENCE) { await fs.mkdir(process.env.BUDGET_B2_EVIDENCE, { recursive: true }); await page.screenshot({ path: path.join(process.env.BUDGET_B2_EVIDENCE, "b2-demo-desktop.png") }); }
  await page.getByRole("tab", { name: "項目明細", exact: true }).click(); await expect(page.locator(".bw-detail")).toContainText("Demo note");
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test("one second quiet input coalesces; no normal save buttons or success toasts", async ({page})=>{
  const db=metadataBackend(); await ready(page,db); await write(title(page),"First");
  await page.waitForTimeout(400); await title(page).fill("Final"); await page.waitForTimeout(400);
  expect(db.groupCalls.filter(c=>c.name==="patch_budget_metadata_group")).toHaveLength(0);
  await expect.poll(()=>db.rows.budget_items[0].title).toBe("Final");
  expect(db.groupCalls.filter(c=>c.name==="patch_budget_metadata_group")).toHaveLength(1);
  await expect(page.getByRole("button",{name:/^儲存(名稱|備註)$/})).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
});

test("blur flushes immediately and releases only after patch acknowledgement", async ({page})=>{
  const db=metadataBackend(); await ready(page,db); await write(title(page),"Blur latest");
  db.metadataHold={actor:"A",action:"patch"}; await note(page).focus();
  await expect.poll(()=>db.metadataPending.length).toBe(1); expect(db.rows.budget_items[0].title).toBe("JPY fare");
  expect(db.groupCalls.filter(c=>c.args.p_group==="title"&&c.args.p_action==="release")).toHaveLength(0);
  db.releaseMetadata(); await expect.poll(()=>db.rows.budget_items[0].title).toBe("Blur latest");
  await expect.poll(()=>db.groupStates.get("budget:budget:title").actor).toBe(null);
});

test("IME composition blocks debounce and blur commits until compositionend", async ({page})=>{
  const db=metadataBackend(); await ready(page,db); await title(page).focus(); await expect(title(page)).toBeEditable();
  await title(page).dispatchEvent("compositionstart"); await title(page).fill("京都住宿");
  await page.waitForTimeout(1250); expect(db.groupCalls.filter(c=>c.name==="patch_budget_metadata_group")).toHaveLength(0);
  await title(page).dispatchEvent("compositionend"); await expect.poll(()=>db.rows.budget_items[0].title).toBe("京都住宿");
});

test("typing continues during patch; old acknowledgement never replaces latest local text", async ({page})=>{
  const db=metadataBackend(); await ready(page,db); db.metadataHold={actor:"A",action:"patch"}; await write(title(page),"A");
  await expect.poll(()=>db.metadataPending.length).toBe(1); await expect(title(page)).toBeEditable();
  await title(page).fill("AB"); await title(page).fill("ABC"); await expect(title(page)).toHaveValue("ABC");
  expect(db.groupCalls.filter(c=>c.name==="patch_budget_metadata_group")).toHaveLength(1);
  db.releaseMetadata(); await expect(title(page)).toHaveValue("ABC"); await expect.poll(()=>db.rows.budget_items[0].title).toBe("ABC");
  expect(db.groupCalls.filter(c=>c.name==="patch_budget_metadata_group").map(c=>c.args.p_patch.title)).toEqual(["A","ABC"]);
});

test("confirmed canonical remains visible through failed snapshot and converges without another patch", async ({page})=>{
  const db=metadataBackend(); await ready(page,db); db.metadataHold={actor:"A",action:"patch"}; await write(title(page),"  Canonical new  ");
  await expect.poll(()=>db.metadataPending.length).toBe(1); db.snapshotDenied=true; db.releaseMetadata();
  await expect(title(page)).toHaveValue("Canonical new"); await expect(page.getByText("已儲存，最新同步待確認",{exact:true})).toBeVisible();
  expect(db.groupCalls.filter(c=>c.name==="patch_budget_metadata_group")).toHaveLength(1);
  db.snapshotDenied=false; await db.emit("budget_collaboration_signals");
  await expect(page.getByText("已儲存",{exact:true})).toBeVisible(); await expect(title(page)).toHaveValue("Canonical new");
  expect(db.groupCalls.filter(c=>c.name==="patch_budget_metadata_group")).toHaveLength(1);
});

test("dirty full editor transition waits for final autosave and exact release before whole-record acquire", async ({page})=>{
  const db=metadataBackend(); await ready(page,db); db.metadataHold={actor:"A",action:"patch"}; await write(title(page),"Handoff final");
  await page.getByRole("button",{name:"編輯完整項目",exact:true}).click(); await expect.poll(()=>db.metadataPending.length).toBe(1);
  await expect(page.getByRole("form",{name:"預算編輯",exact:true})).toHaveCount(0); expect(db.leaseCalls).toHaveLength(0);
  db.releaseMetadata(); await expect(page.getByRole("form",{name:"預算編輯",exact:true})).toBeVisible();
  await expect(page.getByRole("textbox",{name:"項目",exact:true})).toHaveValue("Handoff final"); expect(db.groupStates.get("budget:budget:title").actor).toBe(null);
  const patch=db.groupCalls.find(c=>c.name==="patch_budget_metadata_group"), release=db.groupCalls.find(c=>c.args.p_action==="release"&&c.args.p_group==="title");
  expect(release.args.p_token).toBe(patch.args.p_token); expect(release.args.p_epoch).toBe(patch.args.p_epoch);
  expect(db.leaseCalls.some(c=>c.args.p_action==="acquire")).toBe(true); await expect(page.getByRole("dialog")).toHaveCount(0);
});

for(const failure of ["patch","release"]) test(`${failure} failure prevents dirty full-editor handoff and preserves the recoverable editor`,async({page})=>{
  const db=metadataBackend(); await ready(page,db); if(failure==="patch")db.patchError={code:"55P03"}; else db.releaseFailure=true;
  await write(title(page),"Keep through failure"); await page.getByRole("button",{name:"編輯完整項目",exact:true}).click();
  if(failure==="patch") {await expect(page.getByRole("dialog")).toBeVisible(); await page.getByRole("button",{name:"繼續編輯",exact:true}).click();}
  else await expect(page.getByRole("alert")).toContainText("尚未確認權限釋放");
  await expect(editor(page)).toBeVisible(); await expect(title(page)).toHaveValue("Keep through failure"); expect(db.leaseCalls).toHaveLength(0);
});

test("dirty sidebar and close flush valid input without prompting or dropping it",async({page})=>{
  const db=metadataBackend(); await ready(page,db); await write(note(page),"Sidebar final");
  await page.getByRole("tab",{name:"旅程統計",exact:true}).click(); await expect(note(page)).toHaveCount(0);
  expect(db.rows.budget_items[0].note).toBe("Sidebar final"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab",{name:"編輯項目",exact:true}).click(); await write(title(page),"Close final");
  await page.getByRole("button",{name:"關閉編輯",exact:true}).click(); await expect(editor(page)).toHaveCount(0);
  expect(db.rows.budget_items[0].title).toBe("Close final");
});

test("reload retains unknown request identity but no capability; explicit replay commits only once",async({page})=>{
  const db=metadataBackend(); await ready(page,db); db.losePatchAck=true; await write(title(page),"Lost ack reload");
  await expect(page.getByRole("button",{name:"確認儲存結果",exact:true})).toBeVisible();
  const original=db.groupCalls.find(c=>c.name==="patch_budget_metadata_group").args;
  await page.reload(); await page.getByRole("button",{name:"Lost ack reload",exact:true}).click(); await page.getByRole("tab",{name:"編輯項目",exact:true}).click();
  await expect(title(page)).toHaveValue("Lost ack reload"); await page.getByRole("button",{name:"確認儲存結果",exact:true}).click();
  await expect(title(page).locator("..").locator(".bw-metadata-status")).toContainText("已儲存"); const patches=db.groupCalls.filter(c=>c.name==="patch_budget_metadata_group");
  expect(patches).toHaveLength(2); expect(patches[1].args).toMatchObject({p_request_id:original.p_request_id,p_session_id:original.p_session_id,p_token:null,p_epoch:null});
  expect(db.groupStates.get("budget:budget:title").revision).toBe(1);
});

test("late patch after changing trip cannot open a full editor in the new trip",async({page})=>{
  const db=metadataBackend(); await ready(page,db); db.metadataHold={actor:"A",action:"patch"}; await write(title(page),"Old trip final");
  await expect.poll(()=>db.metadataPending.length).toBe(1);
  await page.getByRole("button",{name:"Other QA",exact:true}).click();
  // Stay is always safe while unresolved work exists.
  await expect(page.getByRole("dialog")).toBeVisible({timeout:15000}); await page.getByRole("button",{name:"繼續編輯",exact:true}).click();
  await expect(title(page)).toHaveValue("Old trip final"); db.releaseMetadata(); await expect.poll(()=>db.rows.budget_items[0].title).toBe("Old trip final");
  await page.getByRole("button",{name:"確認儲存結果",exact:true}).click(); await expect(page.getByRole("button",{name:"確認儲存結果",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Other QA",exact:true}).click(); await expect(editor(page)).toHaveCount(0);
  await expect(page.getByRole("form",{name:"預算編輯",exact:true})).toHaveCount(0);
});

test("handoff cannot release another account's group and cannot acquire its wildcard",async({page,context})=>{
  const db=metadataBackend();await ready(page,db);const other=await context.newPage();
  try{await ready(other,db,"B");await note(other).focus();await expect(note(other)).toBeEditable();
    await write(title(page),"A final");await page.getByRole("button",{name:"編輯完整項目",exact:true}).click();
    await expect.poll(()=>db.rows.budget_items[0].title).toBe("A final");await expect.poll(()=>db.leaseCalls.length).toBeGreaterThan(0);
    await expect(editor(page)).toBeVisible();await expect(page.getByRole("form",{name:"預算編輯",exact:true})).toHaveCount(0);
    expect(db.groupStates.get("budget:budget:note").actor).toBe("B");
    expect(db.groupCalls.filter(c=>c.actor==="A"&&c.args.p_action==="release"&&c.args.p_group==="note")).toHaveLength(0);
    expect(other.qaErrors).toEqual([]);
  }finally{await other.close();}
});

test("dirty item switch saves before opening the next item",async({page})=>{
  const db=metadataBackend();await ready(page,db);await write(note(page),"Before item switch");
  const next=db.rows.budget_items.find(r=>r.id!=="budget");await page.getByRole("button",{name:next.title,exact:true}).click();
  await expect.poll(()=>db.rows.budget_items.find(r=>r.id==="budget").note).toBe("Before item switch");
  await expect(page.getByRole("dialog")).toHaveCount(0);await expect.poll(()=>db.groupStates.get("budget:budget:note").actor).toBe(null);
  await expect(title(page)).toHaveValue(next.title);
});

test("clean idle releases while focused; first Backspace reacquires and preserves its intent",async({page})=>{
  const db=metadataBackend();await page.clock.install();await ready(page,db);await title(page).focus();await expect(title(page)).toBeEditable();
  await title(page).fill("JPY fare🧳");await page.clock.fastForward(1001);await expect.poll(()=>db.rows.budget_items[0].title).toBe("JPY fare🧳");
  await page.clock.fastForward(120001);await expect.poll(()=>db.groupStates.get("budget:budget:title").actor).toBe(null);
  await expect(title(page)).toBeFocused();await expect(title(page)).toHaveAttribute("readonly","");await title(page).press("End");await title(page).press("Backspace");
  await expect(title(page)).toHaveValue("JPY fare");await expect(title(page)).toBeEditable();
  await page.clock.fastForward(1001);await expect.poll(()=>db.rows.budget_items[0].title).toBe("JPY fare");
});

const patches = db => db.groupCalls.filter(c=>c.name==="patch_budget_metadata_group");
async function pendingSnapshot(page,db,{queued=true}={}) {
  await page.clock.install();await ready(page,db);const gate=db.holdNextMetadataSnapshotAfterPatch();
  await write(title(page),"Confirmed A");await page.clock.fastForward(1001);await expect.poll(()=>gate.started).toBe(1);
  expect(db.rows.budget_items[0].title).toBe("Confirmed A");
  if(queued)await title(page).fill("Queued B");return gate;
}
async function snapshotDeadline(page) {await page.clock.fastForward(budgetAuthorityTimeoutMs+1);}

test("snapshot deadline frees Formal queue; retry confirms authority and never resends committed A",async({page})=>{
  const db=metadataBackend(),gate=await pendingSnapshot(page,db);
  await expect(title(page).locator("..").locator(".bw-metadata-status")).toHaveText("已儲存，最新同步待確認；另有尚未儲存的修改");
  await snapshotDeadline(page);await expect(title(page).locator("..").getByRole("button",{name:"重試",exact:true})).toBeVisible();
  if(process.env.BUDGET_SNAPSHOT_EVIDENCE){await fs.mkdir(process.env.BUDGET_SNAPSHOT_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.BUDGET_SNAPSHOT_EVIDENCE,"formal-confirmed-A-queued-B-timeout.png")});}
  await expect(title(page)).toHaveValue("Queued B");expect(patches(db)).toHaveLength(1);expect(db.groupStates.get("budget:budget:title").revision).toBe(1);
  const first=patches(db)[0].args;await title(page).locator("..").getByRole("button",{name:"重試",exact:true}).click();
  await expect.poll(()=>db.rows.budget_items[0].title).toBe("Queued B");await expect(title(page)).toHaveValue("Queued B");
  await expect(page.getByRole("button",{name:"Queued B",exact:true})).toBeVisible();
  expect(patches(db)).toHaveLength(2);expect(patches(db)[1].args.p_base_revision).toBe(1);expect(patches(db)[1].args.p_request_id).not.toBe(first.p_request_id);
  expect(db.groupCalls.filter(c=>c.args.p_action==="acquire"&&c.args.p_group==="title")).toHaveLength(2);
  gate.release();await page.clock.runFor(100);await expect(title(page)).toHaveValue("Queued B");
  await expect(page.getByRole("button",{name:"Queued B",exact:true})).toBeVisible();
  if(process.env.BUDGET_SNAPSHOT_EVIDENCE)await page.screenshot({path:path.join(process.env.BUDGET_SNAPSHOT_EVIDENCE,"formal-recovered-B.png")});
  expect(db.groupStates.get("budget:budget:title").revision).toBe(2);expect(patches(db)).toHaveLength(2);
});

for(const action of ["close","sidebar","full","trip","item"])test(`pending snapshot ${action} exit settles at deadline and preserves dirty B`,async({page})=>{
  const db=metadataBackend(),gate=await pendingSnapshot(page,db);
  const leave=()=>action==="close"?page.getByRole("button",{name:"關閉編輯",exact:true}).click()
    :action==="sidebar"?page.getByRole("tab",{name:"旅程統計",exact:true}).click()
    :page.getByRole("button",{name:action==="trip"?"Other QA":action==="item"?db.rows.budget_items.find(r=>r.id!=="budget").title:"編輯完整項目",exact:true}).click();
  await leave();await expect(editor(page)).toBeVisible();await expect(page.getByRole("dialog")).toHaveCount(0);
  await snapshotDeadline(page);await expect(page.getByRole("dialog")).toBeVisible();await page.getByRole("button",{name:"繼續編輯",exact:true}).click();
  await expect(title(page)).toHaveValue("Queued B");expect(patches(db)).toHaveLength(1);expect(db.leaseCalls).toHaveLength(0);
  await title(page).locator("..").getByRole("button",{name:"重試",exact:true}).click();await expect.poll(()=>db.rows.budget_items[0].title).toBe("Queued B");
  await leave();
  if(action==="full")await expect(page.getByRole("form",{name:"預算編輯",exact:true}).getByRole("textbox",{name:"項目",exact:true})).toHaveValue("Queued B");
  else if(action==="item")await expect(title(page)).toHaveValue(db.rows.budget_items.find(r=>r.id!=="budget").title);
  else await expect(editor(page)).toHaveCount(0);
  await expect.poll(()=>db.groupStates.get("budget:budget:title").actor).toBe(null);expect(patches(db)).toHaveLength(2);
  gate.release();await page.clock.runFor(100);
  if(action==="item")await expect(title(page)).toHaveValue(db.rows.budget_items.find(r=>r.id!=="budget").title);
});

test("confirmed clean A can close after pending snapshot deadline with exact release and no duplicate patch",async({page})=>{
  const db=metadataBackend(),gate=await pendingSnapshot(page,db,{queued:false});const first=patches(db)[0].args;
  await page.getByRole("button",{name:"關閉編輯",exact:true}).click();await snapshotDeadline(page);await expect(editor(page)).toHaveCount(0);
  expect(db.rows.budget_items[0].title).toBe("Confirmed A");expect(patches(db)).toHaveLength(1);
  expect(db.groupCalls.some(c=>c.args.p_action==="release"&&c.args.p_token===first.p_token&&c.args.p_epoch===first.p_epoch)).toBe(true);
  gate.release();await page.clock.runFor(100);await expect(editor(page)).toHaveCount(0);
});

test("timeout followed by offline and reconnect keeps B until a fresh snapshot and confirmed lease",async({page})=>{
  const db=metadataBackend(),gate=await pendingSnapshot(page,db);await snapshotDeadline(page);
  db.offline=true;await page.evaluate(()=>{Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>false});window.dispatchEvent(new Event("offline"));});
  await expect(title(page)).toHaveValue("Queued B");await expect(title(page)).toHaveAttribute("readonly","");expect(patches(db)).toHaveLength(1);
  db.offline=false;await page.evaluate(()=>{Object.defineProperty(navigator,"onLine",{configurable:true,get:()=>true});window.dispatchEvent(new Event("online"));});
  await title(page).locator("..").getByRole("button",{name:"重試",exact:true}).click();await expect.poll(()=>db.rows.budget_items[0].title).toBe("Queued B");
  gate.release();await page.clock.runFor(100);await expect(title(page)).toHaveValue("Queued B");expect(patches(db)).toHaveLength(2);
});

test("another tab takes over after timeout; old snapshot cannot replace its committed version or local B",async({page,context})=>{
  const db=metadataBackend(),gate=await pendingSnapshot(page,db);await snapshotDeadline(page);db.now+=420001;
  const other=await context.newPage();try {
    await ready(other,db,"B","Confirmed A");await write(title(other),"Other tab canonical");await expect.poll(()=>db.rows.budget_items[0].title).toBe("Other tab canonical");
    gate.release();await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await page.clock.runFor(100);
    await expect(title(page)).toHaveValue("Queued B");await expect(page.getByRole("alert").filter({hasText:/草稿已保留/})).toBeVisible();
    expect(db.rows.budget_items[0].title).toBe("Other tab canonical");expect(patches(db).filter(c=>c.actor==="A")).toHaveLength(1);
    expect(db.groupStates.get("budget:budget:title")).toMatchObject({actor:"B",revision:2});expect(other.qaErrors).toEqual([]);
  }finally{await other.close();}
});

for(const change of ["account","logout"])test(`${change} during pending snapshot fences late graph and never sends queued B`,async({page})=>{
  const db=metadataBackend(),gate=await pendingSnapshot(page,db);
  await page.evaluate(change=>change==="logout"?window.budgetMock.client.auth.signOut():window.budgetMock.switchAccount("B"),change);
  if(change==="logout")await expect(page.getByRole("button",{name:/Google/})).toBeVisible();
  else await expect(page.getByRole("button",{name:"帳號選單"})).toContainText("B");
  gate.release();await snapshotDeadline(page);await expect(editor(page)).toHaveCount(0);expect(patches(db)).toHaveLength(1);
});

test("unknown patch acknowledgement with a pending snapshot replays the original request instead of treating it as confirmed",async({page})=>{
  const db=metadataBackend();db.losePatchAck=true;const gate=await pendingSnapshot(page,db,{queued:false});await snapshotDeadline(page);
  const first=patches(db)[0].args;await page.getByRole("button",{name:"確認儲存結果",exact:true}).click();
  await expect(page.getByRole("button",{name:"確認儲存結果",exact:true})).toHaveCount(0);expect(patches(db)).toHaveLength(2);
  expect(patches(db)[1].args).toEqual(first);expect(db.groupStates.get("budget:budget:title").revision).toBe(1);gate.release();
});

test("Demo uses the same snapshot deadline and queued recovery without connecting to any service",async({page})=>{
  await page.clock.install();await enableMetadata(page);const requests=[],errors=[];
  page.on("request",r=>{if(/\.supabase\.co|\/auth\/v1|\/rest\/v1|\/realtime\/v1|open.er-api.com/.test(r.url()))requests.push(r.url());});
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  await page.route("**/src/demo/budgetMetadata.js*",route=>{
    if(new URL(route.request().url()).searchParams.has("snapshot_original"))return route.fallback();
    return route.fulfill({contentType:"text/javascript",body:`
      import {createDemoBudgetMetadataService as original} from "/src/demo/budgetMetadata.js?snapshot_original=1";
      export function createDemoBudgetMetadataService(...args) {
        const service=original(...args),gate=window.demoSnapshotTest={arm:true,hold:false,pending:false,patches:[]};
        return {...service,async patch(args){const result=await service.patch(args);gate.patches.push({id:args.p_request_id,value:args.p_patch.title});
          if(gate.arm){gate.arm=false;gate.hold=true;}return result;},
          async read(trip){const result=await service.read(trip);if(!gate.hold)return result;gate.hold=false;gate.pending=true;
            return new Promise(resolve=>{gate.release=()=>{gate.pending=false;resolve(result);};});}};
      }`});
  });
  await page.setViewportSize({width:1440,height:1000});await page.goto("/demo/budget");await page.getByRole("button",{name:"租車加油",exact:true}).click();
  await page.getByRole("tab",{name:"編輯項目",exact:true}).click();await write(title(page),"Demo A");await page.clock.fastForward(1001);
  await expect.poll(()=>page.evaluate(()=>window.demoSnapshotTest.pending)).toBe(true);await title(page).fill("Demo B");await snapshotDeadline(page);
  await expect(title(page).locator("..").locator(".bw-metadata-status")).toHaveText("已儲存，最新同步待確認；另有尚未儲存的修改");
  await title(page).locator("..").getByRole("button",{name:"重試",exact:true}).click();await expect(title(page)).toHaveValue("Demo B");
  await expect(title(page).locator("..").locator(".bw-metadata-status")).toHaveText("已儲存");await page.evaluate(()=>window.demoSnapshotTest.release());
  await expect(title(page)).toHaveValue("Demo B");expect((await page.evaluate(()=>window.demoSnapshotTest.patches)).map(p=>p.value)).toEqual(["Demo A","Demo B"]);
  expect(requests).toEqual([]);expect(errors).toEqual([]);
});
