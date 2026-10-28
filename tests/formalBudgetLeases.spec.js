import { expect, test } from "@playwright/test";
import { backend, boot } from "./helpers/formalBudgetMock.js";

const form = page => page.getByRole("form", { name: "預算編輯" });
const focus = page => page.evaluate(() => window.dispatchEvent(new Event("focus")));
async function edit(page, title = "JPY fare") {
  await page.getByRole("button", { name: title, exact: true }).click();
  await page.getByRole("tab", { name: "編輯項目", exact: true }).click();
}
async function cancel(page) {
  await form(page).getByRole("button", { name: "取消", exact: true }).click();
}
test.afterEach(async ({ page }) => { if (page.qaErrors) expect(page.qaErrors).toEqual([]); });

for (const target of ["項目明細", "旅程統計"]) test(`clean sidebar exit to ${target} releases DB authority and clears the remote warning without auto-acquire`, async ({page,context}) => {
  const db=backend({leases:true});await boot(page,db);const b=await context.newPage();
  try {
    await boot(b,db,"B");await edit(page);await edit(b);
    await expect(b.getByRole("alert")).toContainText("其他成員或分頁");
    const admissions=db.leaseCalls.filter(c=>c.actor==="B"&&c.args.p_action==="acquire").length;
    await page.getByRole("tab",{name:target,exact:true}).click();
    await expect(form(page)).toHaveCount(0);await expect.poll(()=>db.held.size).toBe(0);
    await expect(b.getByRole("alert")).toHaveCount(0);await expect(form(b)).toHaveCount(0);
    expect(db.leaseCalls.filter(c=>c.actor==="B"&&c.args.p_action==="acquire")).toHaveLength(admissions);
    await b.getByRole("tab",{name:"編輯項目",exact:true}).click();await expect(form(b)).toBeVisible();
  }finally{await b.close();}
});

test("sidebar dirty exit stays locked on continue, then discards the exact draft on confirmation",async({page})=>{
  const db=backend({leases:true});await boot(page,db);await edit(page);
  await form(page).getByRole("textbox",{name:"備註"}).fill("Explicitly discard this note");
  await expect.poll(()=>page.evaluate(()=>Object.values(localStorage).some(v=>v.includes("Explicitly discard this note")))).toBe(true);
  await page.getByRole("tab",{name:"項目明細",exact:true}).click();
  const prompt=page.getByRole("dialog",{name:"放棄尚未儲存的變更？",exact:true});
  await expect(prompt).toBeVisible();await prompt.getByRole("button",{name:"繼續編輯",exact:true}).click();
  await expect(form(page).getByRole("textbox",{name:"備註"})).toHaveValue("Explicitly discard this note");expect(db.held.size).toBe(1);
  await expect(page.getByRole("tab",{name:"編輯項目",exact:true})).toHaveAttribute("aria-selected","true");
  await page.getByRole("tab",{name:"項目明細",exact:true}).click();await prompt.getByRole("button",{name:"放棄修改",exact:true}).click();
  await expect(form(page)).toHaveCount(0);expect(db.held.size).toBe(0);
  expect(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes("Explicitly discard this note")))).toBe(false);
  await db.emit("budget_items");await page.getByRole("tab",{name:"編輯項目",exact:true}).click();
  await expect(form(page).getByRole("textbox",{name:"備註"})).not.toHaveValue("Explicitly discard this note");
});

for(const failure of ["reject","offline"])test(`sidebar ${failure} release preserves editor and supports retry without false exit`,async({page})=>{
  const db=backend({leases:true});await boot(page,db);await edit(page);
  if(failure==="reject")db.releaseFailure=true;else db.offline=true;
  await page.getByRole("tab",{name:"旅程統計",exact:true}).click();
  await expect(form(page)).toBeVisible();await expect(form(page).getByRole("alert").first()).toContainText("釋放");
  await expect(form(page).getByRole("button",{name:"儲存",exact:true})).toBeDisabled();expect(db.held.size).toBe(1);
  db.releaseFailure=false;db.offline=false;
  await page.getByRole("tab",{name:"旅程統計",exact:true}).click();
  await expect(form(page)).toHaveCount(0);expect(db.held.size).toBe(0);
});

test("rapid sidebar clicks wait for confirmed release and cannot orphan an editor",async({page})=>{
  const db=backend({leases:true});await boot(page,db);await edit(page);db.hold={actor:"A",action:"release"};
  await page.getByRole("tab",{name:"旅程統計",exact:true}).click();await expect.poll(()=>db.pending.length).toBe(1);
  await page.getByRole("tab",{name:"項目明細",exact:true}).click();
  await expect(form(page)).toBeVisible();expect(db.held.size).toBe(1);
  db.release();await expect(form(page)).toHaveCount(0);expect(db.held.size).toBe(0);
  await expect(page.getByRole("tab",{name:"旅程統計",exact:true})).toHaveAttribute("aria-selected","true");
});

test('unverified empty metadata cannot falsely clear a blocked-editor warning',async({page,context})=>{
  const db=backend({leases:true});await boot(page,db);const b=await context.newPage();
  try{
    await boot(b,db,'B');await edit(page);await edit(b);await expect(b.getByRole('alert')).toContainText('其他成員或分頁');
    db.collaborationOffline=true;await cancel(page);await expect.poll(()=>db.held.size).toBe(0);
    await b.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(b.getByRole('alert')).toContainText('其他成員或分頁');
    db.collaborationOffline=false;await db.emit('budget_collaboration_signals');await expect(b.getByRole('alert')).toHaveCount(0);await expect(form(b)).toHaveCount(0);
  }finally{await b.close();}
});

test('editing then undoing a field is a clean exit without a discard dialog',async({page})=>{
  const db=backend({leases:true});await boot(page,db);await edit(page);
  const title=form(page).getByRole('textbox',{name:'項目',exact:true});await title.fill('Temporary change');await title.fill('JPY fare');
  await page.getByRole('tab',{name:'旅程統計',exact:true}).click();
  await expect(form(page)).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);expect(db.held.size).toBe(0);
});

for (const actor of ["A", "B"]) test(`two ${actor === "A" ? "same-account tabs" : "accounts"} cannot edit the same row; different rows remain independent`, async ({ page, context }) => {
  const db = backend({ leases: true }); await boot(page, db);
  const other = await context.newPage();
  try {
    await boot(other, db, actor); await edit(page); await expect(form(page)).toBeVisible();
    await edit(other); await expect(other.getByRole("alert")).toContainText("其他成員或分頁");
    await expect(form(other)).toHaveCount(0); expect(db.held.size).toBe(1);
    await other.getByRole("button", { name: "Second fare", exact: true }).click();
    await expect(form(other)).toBeVisible(); expect(db.held.size).toBe(2);
    await cancel(other); expect(db.held.has("budget:budget")).toBe(true);
    await cancel(page); await edit(other);
    await expect(form(other)).toBeVisible(); expect(db.held.get("budget:budget").actor).toBe(actor);
    await cancel(other); expect(db.held.size).toBe(0); expect(db.rpcs).toEqual([]);
    expect(other.qaErrors).toEqual([]);
  } finally { await other.close(); }
});

test("real editor heartbeats for twelve minutes without changing financial versions or table writes", async ({ page }) => {
  const db = backend({ leases: true }); await page.clock.install(); await boot(page, db);
  const original = structuredClone(db.rows); await edit(page); await expect(form(page)).toBeVisible();
  const initial = db.leaseCalls.filter(c => c.args.p_action === "renew").length;
  for (let i = 0; i < 12; i++) {
    db.now += 60000; await page.clock.runFor(60000);
    await expect.poll(() => db.leaseCalls.filter(c => c.args.p_action === "renew").length).toBe(initial + i + 1);
  }
  await expect(form(page).getByRole("button", { name: "儲存", exact: true })).toBeEnabled();
  expect(db.rows).toEqual(original); expect(db.rpcs).toEqual([]);
  expect(db.reads.some(r => r.patch)).toBe(false);
  await cancel(page); expect(db.held.size).toBe(0);
});

test("expiry and failed reacquisition preserve draft and keep Save disabled until authority returns", async ({ page, context }) => {
  const db = backend({ leases: true }); await boot(page, db); await edit(page);
  await form(page).getByRole("textbox", { name: "項目", exact: true }).fill("My unsaved draft");
  db.now += 480000; await focus(page);
  await expect(form(page).getByRole("button", { name: "儲存", exact: true })).toBeDisabled();
  const other = await context.newPage();
  try {
    await boot(other, db, "B"); await edit(other); await expect(form(other)).toBeVisible();
    await page.getByRole("button", { name: "重新確認編輯權限" }).click();
    await expect(form(page).getByRole("button", { name: "儲存", exact: true })).toBeDisabled();
    await expect(form(page).getByRole("textbox", { name: "項目", exact: true })).toHaveValue("My unsaved draft");
    await cancel(other); await page.getByRole("button", { name: "重新確認編輯權限" }).click();
    await expect(form(page).getByRole("button", { name: "儲存", exact: true })).toBeEnabled();
    const storedDrafts = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes("draft")).map(([,value]) => value).join(""));
    for (const c of db.leaseCalls) expect(storedDrafts).not.toContain(c.args.p_token);
    await form(page).getByRole("button", { name: "儲存", exact: true }).click();
    await expect(page.getByRole("button", { name: "My unsaved draft", exact: true })).toBeVisible();
    expect(db.rpcs).toHaveLength(1); expect(db.rpcs[0].name).toBe("save_budget_workspace_record_v4");
    expect(db.held.size).toBe(0); expect(other.qaErrors).toEqual([]);
  } finally { await other.close(); }
});

test("changed canonical version prevents reacquisition without replacing the typed draft", async ({ page }) => {
  const db = backend({ leases: true }); await boot(page, db); await edit(page);
  await form(page).getByRole("textbox", { name: "項目", exact: true }).fill("Keep this draft");
  db.now += 480000; await focus(page);
  await expect(form(page).getByRole("button", { name: "儲存", exact: true })).toBeDisabled();
  db.rows.budget_items[0].updated_at = "2026-10-28T00:00:00Z";
  db.rows.budget_items[0].title = "Other committed value";
  await page.getByRole("button", { name: "重新確認編輯權限" }).click();
  await expect(form(page).getByRole("alert").first()).toContainText("資料已由其他人更新");
  await expect(form(page).getByRole("textbox", { name: "項目", exact: true })).toHaveValue("Keep this draft");
  await expect(form(page).getByRole("button", { name: "儲存", exact: true })).toBeDisabled(); expect(db.rpcs).toEqual([]);
});

test("short offline renewal recovers server authority while retaining the draft", async ({ page }) => {
  const db = backend({ leases: true }); await boot(page, db); await edit(page);
  await form(page).getByRole("textbox", { name: "備註" }).fill("Retain offline note");
  db.offline = true; await focus(page);
  await expect(form(page).getByRole("button", { name: "儲存", exact: true })).toBeDisabled();
  db.offline = false; await focus(page);
  await expect(form(page).getByRole("button", { name: "儲存", exact: true })).toBeEnabled();
  await expect(form(page).getByRole("textbox", { name: "備註" })).toHaveValue("Retain offline note");
  expect(db.rpcs).toEqual([]);
});

test("revoked membership disables the existing editor and preserves its draft", async ({ page }) => {
  const db=backend({leases:true}); await boot(page,db); await edit(page);
  await form(page).getByRole("textbox",{name:"備註"}).fill("Retain revoked draft");
  db.members.find(m=>m.trip_id==="trip"&&m.user_id==="A").role="viewer";
  await db.emit("trip_members");
  await expect(form(page).getByRole("button",{name:"儲存",exact:true})).toBeDisabled();
  await expect(form(page).getByRole("textbox",{name:"備註"})).toHaveValue("Retain revoked draft");
  expect(db.rpcs).toEqual([]); await expect.poll(()=>db.held.size).toBe(0);
});

test("quick payment and delete obtain temporary capabilities and release them", async ({ page }) => {
  const db = backend({ leases: true }); await boot(page, db);
  await page.getByRole("button", { name: "JPY fare", exact: true }).click();
  await page.getByRole("button", { name: "付款狀態", exact: true }).click();
  await expect(page.locator(".bw-detail").getByRole("button", { name: "付款狀態" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => db.held.size).toBe(0); expect(db.rows.actual_expenses).toHaveLength(1);
  expect(db.rpcs[0].name).toBe("save_budget_workspace_record_v4"); expect(db.rpcs[0].args.p_edit_token).toBeTruthy();
  await page.getByRole("button", { name: "刪除項目", exact: true }).click();
  await page.getByRole("dialog", { name: "刪除項目？", exact: true }).getByRole("button", { name: "刪除", exact: true }).click();
  await expect(page.getByRole("button", { name: "JPY fare", exact: true })).toHaveCount(0);
  expect(db.rpcs.at(-1).name).toBe("delete_budget_workspace_record_v2"); expect(db.held.size).toBe(0);
});

test("missing lease API fails closed and never writes raw financial lock columns", async ({ page }) => {
  const db = backend({ leases: true }); db.missingLeaseRpc = true; await boot(page, db); await edit(page);
  await expect(page.getByRole("alert")).toContainText("lease API unavailable");
  await expect(form(page)).toHaveCount(0); expect(db.rpcs).toEqual([]);
  expect(db.reads.some(r => r.patch)).toBe(false);
});

test("leaving and reentering Budget releases the old capability and can acquire again", async ({ page }) => {
  const db = backend({ leases: true }); await boot(page, db); await edit(page); await expect(form(page)).toBeVisible();
  const oldToken=db.held.get("budget:budget").token;
  await page.getByRole("button",{name:"行李清單",exact:true}).click();
  await expect.poll(()=>db.held.size).toBe(0);
  await page.getByRole("button",{name:"預算管理",exact:true}).click(); await edit(page);
  await expect(form(page)).toBeVisible(); expect(db.held.get("budget:budget").token).not.toBe(oldToken);
  await cancel(page);
});

test("hidden workspace keeps its draft but rechecks authority before saving after return", async ({ page }) => {
  const db=backend({leases:true}); await boot(page,db); await edit(page);
  await form(page).getByRole("textbox",{name:"備註"}).fill("Preserved during navigation");
  await page.getByRole("button",{name:"行李清單",exact:true}).click(); await expect.poll(()=>db.held.size).toBe(0);
  await page.getByRole("button",{name:"預算管理",exact:true}).click();
  await expect(form(page).getByRole("textbox",{name:"備註"})).toHaveValue("Preserved during navigation");
  expect(db.held.size).toBe(0);
  await expect(form(page).getByRole("button",{name:"儲存",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"重新確認編輯權限",exact:true}).click();
  await form(page).getByRole("button",{name:"儲存",exact:true}).click();
  await expect.poll(()=>db.rpcs.length).toBe(1); await expect(form(page)).toHaveCount(0);
  expect(db.rows.budget_items[0].note).toBe("Preserved during navigation"); expect(db.held.size).toBe(0);
});

test("same-account tab restoring a shared dirty draft cannot offer Save before obtaining its own lease",async({page,context})=>{
  const db=backend({leases:true});await boot(page,db);await edit(page);
  await form(page).getByRole("textbox",{name:"備註",exact:true}).fill("Shared draft stays safe");
  await expect.poll(()=>page.evaluate(()=>Object.entries(localStorage).some(([key,value])=>key.includes("draft")&&value.includes("Shared draft stays safe")))).toBe(true);
  const other=await context.newPage();try{
    await boot(other,db,"A");await expect(form(other).getByRole("textbox",{name:"備註",exact:true})).toHaveValue("Shared draft stays safe");
    await expect(form(other).getByRole("button",{name:"儲存",exact:true})).toBeDisabled();
    await other.getByRole("button",{name:"重新確認編輯權限",exact:true}).click();
    await expect(form(other).getByRole("alert").first()).toContainText("其他成員或分頁正在編輯");
    await expect(form(other).getByRole("button",{name:"儲存",exact:true})).toBeDisabled();
    expect(db.held.size).toBe(1);expect(db.rpcs).toEqual([]);
    await cancel(page);
    await page.getByRole("dialog",{name:"放棄尚未儲存的變更？",exact:true}).getByRole("button",{name:"放棄變更",exact:true}).click();
    await expect.poll(()=>db.held.size).toBe(0);
    await other.getByRole("button",{name:"重新確認編輯權限",exact:true}).click();
    await expect(form(other).getByRole("button",{name:"儲存",exact:true})).toBeEnabled();
    await expect(form(other).getByRole("textbox",{name:"備註",exact:true})).toHaveValue("Shared draft stays safe");
  }finally{await other.close();}
});

test("late old-account admission cannot open the new account's editor or release using its credentials", async ({ page }) => {
  const db = backend({ leases: true }); await boot(page, db);
  db.hold = { actor: "A", action: "acquire" }; await edit(page);
  await expect.poll(() => db.pending.length).toBe(1);
  await page.evaluate(() => budgetMock.switchAccount("B"));
  await expect(page.getByRole("button", { name: "帳號選單" })).toContainText("B");
  db.release(); await expect(form(page)).toHaveCount(0);
  expect(db.leaseCalls.filter(c => c.actor === "B" && c.args.p_action === "release")).toEqual([]); expect(db.rpcs).toEqual([]);
});

test('restored draft remains dirty after admission when its financial save fails',async({page,context})=>{
  const db=backend({leases:true});await boot(page,db);await edit(page);
  await form(page).getByRole('textbox',{name:'備註'}).fill('Restored unsaved value');
  await expect.poll(()=>page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('Restored unsaved value')))).toBe(true);
  const other=await context.newPage();try{
    await boot(other,db);await expect(form(other).getByRole('textbox',{name:'備註'})).toHaveValue('Restored unsaved value');
    await cancel(page);await page.getByRole('dialog',{name:'放棄尚未儲存的變更？',exact:true}).getByRole('button',{name:'放棄變更',exact:true}).click();
    db.saveFailure={code:'40001',message:'Injected conflict'};
    await other.getByRole('button',{name:'重新確認編輯權限',exact:true}).click();await form(other).getByRole('button',{name:'儲存',exact:true}).click();
    await expect(form(other).getByRole('alert').first()).toContainText('草稿仍保留');await cancel(other);
    await expect(other.getByRole('dialog',{name:'放棄尚未儲存的變更？',exact:true})).toBeVisible();
    expect(db.rows.budget_items[0].note).not.toBe('Restored unsaved value');
  }finally{await other.close();}
});
