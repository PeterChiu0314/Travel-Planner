import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { metadataBackend, boot, enableMetadata } from "./helpers/budgetMetadataMock.js";
const editor = page => page.getByRole("region", { name: "預算群組編輯" });
const title = page => page.getByRole("textbox", { name: "項目名稱", exact: true });
const note = page => page.getByRole("textbox", { name: "備註", exact: true });
async function write(field, value) { await field.focus(); await field.fill(value); }
async function ready(page, db, actor = "A") { await enableMetadata(page); await boot(page, db, actor); await page.getByRole("button", { name: "JPY fare", exact: true }).click(); await page.getByRole("tab", { name: "編輯項目", exact: true }).click(); await expect(title(page)).toBeVisible(); }
test.afterEach(async ({ page }) => { if (page.qaErrors) expect(page.qaErrors).toEqual([]); });

test("open has no lease; first focus buffers input until admission and same-group lock is exclusive", async ({ page, context }) => {
  const db = metadataBackend(); await ready(page, db); expect(db.groupCalls).toHaveLength(0); expect(db.leaseCalls).toHaveLength(0);
  db.metadataHold = { actor: "A", action: "acquire" }; await title(page).focus(); await expect.poll(() => db.metadataPending.length).toBe(1);
  await title(page).fill("Buffered first input"); await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeDisabled();
  expect(db.rows.budget_items[0].title).toBe("JPY fare"); db.releaseMetadata(); await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeEnabled();
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
    await other.getByRole("button", { name: "儲存備註", exact: true }).click(); await expect(note(page)).toHaveValue("B new note");
    await expect(title(page)).toHaveValue("A new title");
    if (process.env.BUDGET_B2_EVIDENCE) { await fs.mkdir(process.env.BUDGET_B2_EVIDENCE, { recursive: true });
      await other.screenshot({ path: path.join(process.env.BUDGET_B2_EVIDENCE, "b2-other-editor.png") }); }
    await page.getByRole("button", { name: "儲存名稱", exact: true }).click();
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
test("clean blur releases; dirty sidebar exit is guarded and release failures keep the editor recoverable", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await title(page).focus(); await expect.poll(() => [...db.groupStates.values()].filter(g => g.actor).length).toBe(1);
  await note(page).focus(); await expect.poll(() => db.groupStates.get("budget:budget:title").actor).toBe(null);
  await note(page).fill("Keep this note"); await page.getByRole("tab", { name: "旅程統計", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "繼續編輯", exact: true }).click(); await expect(note(page)).toHaveValue("Keep this note");
  db.releaseFailure = true; await page.getByRole("button", { name: "捨棄此欄草稿", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("尚未確認權限釋放");
  db.releaseFailure = false; await page.getByRole("button", { name: "捨棄此欄草稿", exact: true }).click(); await page.getByRole("tab", { name: "旅程統計", exact: true }).click(); await expect(title(page)).toHaveCount(0);
});
for (const unavailable of ["metadataMissing", "metadataEnabled"]) test(`${unavailable}: no automatic legacy write fallback`, async ({ page }) => {
  const db = metadataBackend(); db[unavailable] = unavailable === "metadataMissing"; await ready(page, db);
  await expect(title(page)).toHaveAttribute("readonly", ""); await title(page).focus(); await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeDisabled();
  expect(db.groupCalls).toHaveLength(0); expect(db.leaseCalls).toHaveLength(0);
});
test("lost acknowledgement retries the exact request without duplicate commits", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "Committed with lost ack"); db.losePatchAck = true;
  await page.getByRole("button", { name: "儲存名稱", exact: true }).click(); await expect(page.getByRole("button", { name: "確認儲存結果", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "確認儲存結果", exact: true }).click(); await expect(title(page)).toHaveValue("Committed with lost ack");
  expect(db.groupStates.get("budget:budget:title").revision).toBe(1);
  const calls = db.groupCalls.filter(c => c.name === "patch_budget_metadata_group"); expect(calls).toHaveLength(2); expect(calls[0].args).toEqual(calls[1].args);
});
test("offline keeps the per-tab draft and disables writes until validated renewal", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "Offline draft"); db.offline = true; await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(title(page)).toHaveValue("Offline draft"); await expect(title(page)).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeDisabled();
  db.offline = false; await page.evaluate(() => window.dispatchEvent(new Event("online"))); await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeEnabled();
  const stored = await page.evaluate(() => JSON.stringify(sessionStorage)); expect(stored).not.toMatch(/p_token|token_hash/);
});
test("failed background snapshot invalidates authority even when the browser remains online", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "Retain through read failure");
  db.snapshotDenied = true; await db.emit("budget_items");
  await expect(title(page)).toHaveValue("Retain through read failure"); await expect(title(page)).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeDisabled();
  db.snapshotDenied = false; await db.emit("budget_items");
  const group = title(page).locator(".."); await group.getByRole("button", { name: "重新確認編輯權", exact: true }).click();
  await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeEnabled();
});
test("keyboard Unicode entry is buffered during admission and Tab reaches readonly fields", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); db.metadataHold = { actor: "A", action: "acquire" };
  await title(page).click(); await page.keyboard.press("End"); await page.keyboard.insertText("・京都");
  await expect(title(page)).toHaveValue("JPY fare・京都"); expect(db.rows.budget_items[0].title).toBe("JPY fare");
  db.releaseMetadata(); await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeEnabled();
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeFocused();
});
test("same-group conflict preserves input, and explicit discard adopts the latest revision", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "Keep my draft");
  db.rows.budget_items[0].title = "Remote canonical"; db.groupStates.get("budget:budget:title").revision++;
  await db.emit("budget_collaboration_signals"); await expect(page.getByRole("alert")).toContainText("草稿已保留");
  await expect(title(page)).toHaveValue("Keep my draft"); await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "捨棄此欄草稿", exact: true }).click(); await expect(title(page)).toHaveValue("Remote canonical");
});
test("draft survives reload without restoring capability or overwriting another tab", async ({ page, context }) => {
  const db = metadataBackend(); await ready(page, db); await write(title(page), "Only this tab");
  const other = await context.newPage(); try { await ready(other, db, "B"); await expect(title(other)).toHaveValue("JPY fare");
    await page.reload(); await page.getByRole("button", { name: "JPY fare", exact: true }).click(); await page.getByRole("tab", { name: "編輯項目", exact: true }).click();
    await expect(title(page)).toHaveValue("Only this tab"); await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeDisabled();
    expect(other.qaErrors).toEqual([]);
  } finally { await other.close(); }
});
test("late admission cannot authorize the returned trip generation", async ({ page }) => {
  const db = metadataBackend(); await ready(page, db); db.metadataHold = { actor: "A", action: "acquire" };
  await title(page).focus(); await expect.poll(() => db.metadataPending.length).toBe(1);
  await page.getByRole("button", { name: "Other QA", exact: true }).click(); await expect(title(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Rates QA", exact: true }).click();
  await page.getByRole("button", { name: "JPY fare", exact: true }).click(); await page.getByRole("tab", { name: "編輯項目", exact: true }).click();
  await expect(page.getByRole("button", { name: "儲存名稱", exact: true })).toBeDisabled();
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
  await write(note(page), "Actual note"); await page.getByRole("button", { name: "儲存備註", exact: true }).click();
  expect(db.rows.actual_expenses[0]).toMatchObject({ note: "Actual note", actual_twd_amount: 71, currency: "JPY", exchange_rate: .2 }); expect(db.leaseCalls).toHaveLength(0);
});
test("Demo shares the metadata editor and stays memory-only", async ({ page }) => {
  await enableMetadata(page); const errors = [], requests = [];
  page.on("pageerror", e => errors.push(e.message)); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", r => { if (/\.supabase\.co|\/auth\/v1|\/rest\/v1|\/realtime\/v1|open.er-api.com/.test(r.url())) requests.push(r.url()); });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/demo/budget");
  await page.getByRole("button", { name: "租車加油", exact: true }).click(); await page.getByRole("tab", { name: "編輯項目", exact: true }).click();
  await write(note(page), "Demo note"); await page.getByRole("button", { name: "儲存備註", exact: true }).click(); await expect(note(page)).toHaveValue("Demo note");
  if (process.env.BUDGET_B2_EVIDENCE) { await fs.mkdir(process.env.BUDGET_B2_EVIDENCE, { recursive: true }); await page.screenshot({ path: path.join(process.env.BUDGET_B2_EVIDENCE, "b2-demo-desktop.png") }); }
  await page.getByRole("tab", { name: "項目明細", exact: true }).click(); await expect(page.locator(".bw-detail")).toContainText("Demo note");
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});
