import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { boot, enableMetadata, expenseBackend } from "./helpers/expenseBackend.js";
import { dragLuggage, returnLuggage } from "./helpers/luggageDrag.js";
import { buildTimelineVisitDisplayOrder } from "../src/lib/timelineUntimedOrdering.js";

const workspace = page => page.getByRole("region", { name: "支出工作區", includeHidden: true });
const timeline = page => page.locator(".timeline .timeline-item:visible");
const navigation = (page, name) => page.locator(".section-nav-button").getByText(name, { exact: true });
const prompt = page => page.getByRole("dialog", { name: "您有未儲存的變更" });
const scheduleCalls = fixture => fixture.db.expenseCalls.filter(call => call.name === "apply_timeline_schedule_operation");

async function open(page, fixture, { linked = false } = {}) {
  const first = randomUUID();
  await fixture.sql.query(`insert into public.itinerary_items(id,trip_id,day_index,sort_order,type,title,start_time,end_time)
    values($1,$2,0,0,'attraction','Morning QA','09:00','10:00'),
    (gen_random_uuid(),$2,0,1,'attraction','Lunch QA','10:00','11:00'),
    (gen_random_uuid(),$2,0,2,'attraction','Untimed QA',null,null)`, [first, fixture.trip]);
  if (linked) {
    const expense = randomUUID();
    await fixture.sql.query("insert into expense_stage_b.expense_items(id,trip_id,title,payment_state) values($1,$2,'Linked QA','unpaid')", [expense, fixture.trip]);
    await fixture.sql.query("insert into expense_stage_b.expense_itinerary_links values($1,$2,$3)", [expense, fixture.trip, first]);
  }
  await fixture.syncItinerary();
  await enableMetadata(page);
  await boot(page, fixture.db, fixture.A);
  await expect(workspace(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "更新匯率" })).toBeVisible();
}

async function drag(page, source) {
  const handle = timeline(page).filter({ hasText: source }).locator('[data-drag-handle="true"]');
  const targetCard = timeline(page).filter({ hasText: "Lunch QA" });
  const target = await targetCard.getAttribute("data-timeline-item-id");
  const over = page.locator('[id^="DndLiveRegion"]').filter({ hasText: `droppable area ${target}` });
  await expect(handle).toBeVisible();
  const from = await handle.boundingBox();
  const to = await targetCard.boundingBox();
  const x = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  const endY = to.y + to.height / 2;
  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, startY + Math.sign(endY - startY) * 8);
  await expect(page.locator(".timeline-drag-overlay-card")).toBeVisible();
  await page.mouse.move(x, endY, { steps: 8 });
  await expect(over).toHaveCount(1);
  await page.mouse.up();
}

for (const { title, order } of [
  { title: "Morning QA", order: ["Lunch QA", "Morning QA", "Untimed QA"] },
  { title: "Untimed QA", order: ["Morning QA", "Untimed QA", "Lunch QA"] },
]) {
  test(`clean hidden expense guards allow ${title} drag to persist through the real schedule RPC`, async ({ page }) => {
    const fixture = await expenseBackend({ timeline: true });
    try {
      await open(page, fixture);
      await navigation(page, "行程路線").click();
      await expect(workspace(page)).toBeHidden();
      await expect(workspace(page)).toBeAttached();
      await expect(page.locator(".bw-restored-rates")).toBeAttached();
      await drag(page, title);
      for (const [index, name] of order.entries()) await expect(timeline(page).nth(index)).toContainText(name);
      expect(scheduleCalls(fixture)).toHaveLength(1);
      const { rows } = await fixture.sql.query("select * from public.itinerary_items where trip_id=$1 and day_index=0", [fixture.trip]);
      expect(buildTimelineVisitDisplayOrder(rows).map(row => row.title)).toEqual(order);
      await page.reload();
      await expect(workspace(page)).toBeVisible();
      await navigation(page, "行程路線").click();
      for (const [index, name] of order.entries()) await expect(timeline(page).nth(index)).toContainText(name);
      expect(scheduleCalls(fixture)).toHaveLength(1);
      expect(page.qaErrors).toEqual([]);
    } finally {
      await page.close();
      await fixture.close();
    }
  });
}

test("timed swap with a native expense link stops before writing", async ({ page }) => {
  const fixture = await expenseBackend({ timeline: true });
  try {
    await open(page, fixture, { linked: true });
    await navigation(page, "行程路線").click();
    await drag(page, "Morning QA");
    await expect(page.getByText("要移動的行程已關聯支出，目前無法安全交換時段。", { exact: true })).toBeVisible();
    await expect(timeline(page).first()).toContainText("Morning QA");
    expect(scheduleCalls(fixture)).toHaveLength(0);
    expect((await fixture.snapshot()).links).toHaveLength(1);
    expect(page.qaErrors).toEqual([]);
  } finally {
    await page.close();
    await fixture.close();
  }
});

test("a dirty unnamed expense survives cancelled cross-page handoff and can be discarded", async ({ page }) => {
  const fixture = await expenseBackend({ timeline: true });
  try {
    await open(page, fixture);
    await page.getByRole("button", { name: "新增項目", exact: true }).click();
    const amount = page.getByRole("spinbutton", { name: "總額", exact: true });
    await amount.fill("123");
    await navigation(page, "行程路線").click();
    await prompt(page).getByRole("button", { name: "繼續編輯" }).click();
    await expect(amount).toHaveValue("123");
    await navigation(page, "行程路線").click();
    await prompt(page).getByRole("button", { name: "不儲存" }).click();
    await expect(timeline(page)).toHaveCount(3);
    await expect(timeline(page).locator('[data-drag-handle="true"]')).toHaveCount(3);
    expect((await fixture.snapshot()).items).toEqual([]);
    expect(fixture.db.expenseCalls.filter(call => call.name.startsWith("create_"))).toHaveLength(0);
    expect(page.qaErrors).toEqual([]);
  } finally {
    await page.close();
    await fixture.close();
  }
});

test("in-flight and unknown expense creation block navigation and retry one request identity", async ({ page }) => {
  const fixture = await expenseBackend({ timeline: true });
  let allowReceipt;
  const held = new Promise(resolve => { allowReceipt = resolve; });
  let started = 0;
  let loseReceipt = true;
  const request = fixture.db.request.bind(fixture.db);
  fixture.db.request = async call => {
    if (call.name !== "create_named_expense_item") return request(call);
    started++;
    await held;
    fixture.db.dropAck = loseReceipt;
    return request(call);
  };
  try {
    await open(page, fixture);
    await page.getByRole("button", { name: "新增項目", exact: true }).click();
    await page.getByRole("textbox", { name: "項目名稱", exact: true }).fill("Pending navigation QA");
    await navigation(page, "行程路線").click();
    await expect.poll(() => started).toBe(1);
    await expect(workspace(page)).toBeVisible();
    expect(scheduleCalls(fixture)).toHaveLength(0);
    allowReceipt();
    await expect(prompt(page)).toBeVisible();
    await prompt(page).getByRole("button", { name: "不儲存" }).click();
    await expect(workspace(page)).toBeVisible();
    await expect(page.getByRole("status", { name: "儲存狀態" })).toHaveText("儲存結果待確認");
    loseReceipt = false;
    await navigation(page, "行程路線").click();
    await expect(timeline(page)).toHaveCount(3);
    const calls = fixture.db.expenseCalls.filter(call => call.name === "create_named_expense_item");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(calls.map(call => call.args.p_request_id)).size).toBe(1);
    expect((await fixture.snapshot()).items.map(item => item.title)).toEqual(["Pending navigation QA"]);
    expect(page.qaErrors).toEqual([]);
  } finally {
    allowReceipt();
    await page.close();
    await fixture.close();
  }
});

test("failed clean expense lease release does not prevent unrelated editors from opening", async ({ page }) => {
  const fixture = await expenseBackend({ timeline: true });
  let releaseAttempts = 0;
  const request = fixture.db.request.bind(fixture.db);
  fixture.db.request = async call => {
    if (call.name === "expense_group_lease" && call.args.p_action === "release") {
      releaseAttempts++;
      return { error: { code: "P0001", message: "Injected clean release refusal" } };
    }
    return request(call);
  };
  try {
    await open(page, fixture, { linked: true });
    await page.getByRole("button", { name: "Linked QA", exact: true }).click();
    await page.getByRole("tab", { name: "編輯項目", exact: true }).click();
    const title = page.getByRole("textbox", { name: "項目名稱", exact: true });
    await title.focus();
    await expect(title).toBeEditable();
    await navigation(page, "行程路線").click();
    await expect.poll(() => releaseAttempts).toBeGreaterThan(0);
    const morning = timeline(page).filter({ hasText: "Morning QA" });
    await morning.click();
    await morning.getByRole("button", { name: "編輯", exact: true }).click();
    await expect(page.locator(".form-mode-label")).toHaveText("編輯行程");
    await navigation(page, "住宿資訊").click();
    await page.getByRole("button", { name: "新增住宿", exact: true }).click();
    await expect(page.locator(".accommodation-form").getByLabel("住宿名稱")).toBeVisible();
    await navigation(page, "待辦指南").click();
    await page.getByRole("button", { name: "新增待辦", exact: true }).click();
    await expect(page.locator(".todo-panel form").getByLabel("標題")).toBeVisible();
    await page.getByRole("button", { name: "新增指南", exact: true }).click();
    await expect(page.locator(".guide-panel form").getByLabel("標題")).toBeVisible();
    await navigation(page, "行李清單").click();
    await expect(page.getByLabel("個人行李名稱", { exact: true })).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
    expect(fixture.db.expenseCalls.filter(call => call.name === "mutate_expense_group")).toHaveLength(0);
    expect(page.qaErrors).toEqual([]);
  } finally {
    await page.close();
    await fixture.close();
  }
});

test("dirty guard applies to the departing trip and does not leak to the next trip", async ({ page }) => {
  const fixture = await expenseBackend({ timeline: true });
  try {
    const other = { ...fixture.db.trips[0], id: randomUUID(), title: "Other QA" };
    fixture.db.trips.push(other);
    fixture.db.members.push({ ...fixture.db.members[0], id: randomUUID(), trip_id: other.id });
    await fixture.sql.query(`insert into public.trips(id,title,name,destination,owner_id,start_date,end_date,budget_exchange_rates)
      values($1,'Other QA','Other QA','Japan',$2,$3,$4,$5)`,
      [other.id, fixture.A, other.start_date, other.end_date, other.budget_exchange_rates]);
    await fixture.sql.query(`insert into public.trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved')
      on conflict (trip_id,user_id) do nothing`, [other.id, fixture.A]);
    await open(page, fixture);
    await page.getByRole("button", { name: "新增項目", exact: true }).click();
    const amount = page.getByRole("spinbutton", { name: "總額", exact: true });
    await amount.fill("456");
    await page.getByRole("button", { name: "Other QA", exact: true }).click();
    await prompt(page).getByRole("button", { name: "繼續編輯" }).click();
    await expect(amount).toHaveValue("456");
    await page.getByRole("button", { name: "Other QA", exact: true }).click();
    await prompt(page).getByRole("button", { name: "不儲存" }).click();
    await expect(page.getByRole("button", { name: "Other QA，目前旅程", exact: true })).toBeVisible();
    await expect(amount).toHaveCount(0);
    await page.getByRole("button", { name: "新增項目", exact: true }).click();
    await expect(amount).toHaveValue("");
    expect(fixture.db.expenseCalls.filter(call => call.name.startsWith("create_"))).toHaveLength(0);
    expect(page.qaErrors).toEqual([]);
  } finally {
    await page.close();
    await fixture.close();
  }
});

test("clean hidden expense guards allow personal-to-shared luggage assignment and return", async ({ page }) => {
  const fixture = await expenseBackend({ timeline: true });
  try {
    await fixture.sql.query("select set_config('request.jwt.claim.sub',$1,false)", [fixture.A]);
    await fixture.sql.query(`insert into public.luggage_items(trip_id,owner_id,title,category,notes)
      values($1,$2,'Adapter QA','電子用品','keep notes'),($1,$2,'Raincoat QA','衣物','')`, [fixture.trip, fixture.A]);
    await fixture.syncLuggage();
    await open(page, fixture);
    await navigation(page, "行李清單").click();
    await expect(workspace(page)).toBeAttached();
    await dragLuggage(page, "Adapter QA", fixture.B, "personal");
    const shared = page.locator(`#lb-shared [data-member-id="${fixture.B}"]`);
    await expect(shared.getByRole("button", { name: "編輯：Adapter QA", exact: true })).toBeVisible();
    expect(fixture.db.rows.shared_luggage_items).toEqual([
      expect.objectContaining({ title: "Adapter QA", assigned_to: fixture.B, notes: "keep notes" }),
    ]);
    await returnLuggage(page, "Adapter QA", "衣物");
    await expect(page.locator("#lb-personal").getByRole("button", { name: "編輯：Adapter QA", exact: true })).toBeVisible();
    expect(fixture.db.rows.shared_luggage_items).toEqual([]);
    expect(fixture.db.rows.luggage_items.find(item => item.title === "Adapter QA")).toMatchObject({
      owner_id: fixture.A, category: "衣物", notes: "keep notes",
    });
    expect(fixture.db.expenseCalls.filter(call => call.name === "assign_luggage_item" || call.name === "privatize_luggage_item")).toHaveLength(2);
    expect(page.qaErrors).toEqual([]);
  } finally {
    await page.close();
    await fixture.close();
  }
});
