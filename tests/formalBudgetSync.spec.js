import {expect,test} from "@playwright/test";
import {backend,boot} from "./helpers/formalBudgetMock.js";
import fs from "node:fs/promises";
const row=(page,title="JPY fare")=>page.locator(".bw-row").filter({hasText:title});
async function ready(page,db,actor="A") {await boot(page,db,actor);await page.waitForTimeout(200);}
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});

test("twenty Budget events read one snapshot per client and no unrelated tables",async({page,context})=>{
  const db=backend({leases:true});await ready(page,db);const other=await context.newPage();
  try {
    await ready(other,db,"B"); const reads=db.reads.length, snapshots=db.snapshotReads.length;
    db.rows.budget_items[0].amount=1500;db.rows.budget_items[0].twd_amount=300;
    await page.evaluate(()=>{for(let i=0;i<20;i++)budgetMock.emit("budget_item_participants");});
    await other.evaluate(()=>{for(let i=0;i<20;i++)budgetMock.emit("actual_expense_participants");});
    await expect(row(page)).toContainText("300");await expect(row(other)).toContainText("300");
    expect(db.snapshotReads.length-snapshots).toBe(2);expect(db.reads.length-reads).toBe(0);expect(other.qaErrors).toEqual([]);
  }finally{await other.close();}
});
test("in-flight invalidation reruns once and never resurrects a deleted Budget or payment",async({page})=>{
  const db=backend({leases:true});await ready(page,db);const before=db.snapshotReads.length;
  db.hold={snapshotActor:"A"};await db.emit("budget_items");await expect.poll(()=>db.pending.length).toBe(1);
  db.rows.budget_items=db.rows.budget_items.filter(r=>r.id!=="budget");db.rows.actual_expenses=[];
  await db.emit("budget_items",{eventType:"DELETE",old:{id:"budget"}});await db.emit("actual_expense_participants");
  db.release();await expect(row(page)).toHaveCount(0);expect(db.snapshotReads.length-before).toBe(2);
  await expect(row(page,"Second fare")).toBeVisible();
});
test("authoritative remote changes update totals and receipts without replacing the editor draft",async({page})=>{
  const db=backend({leases:true});await ready(page,db);
  await page.getByRole("button",{name:"JPY fare",exact:true}).click();await page.getByRole("tab",{name:"編輯項目",exact:true}).click();
  const form=page.getByRole("form",{name:"預算編輯"});await form.getByRole("textbox",{name:"備註"}).fill("Keep typed notes");
  const before=db.reads.length;
  db.rows.budget_items[1].twd_amount=600;db.rows.attachments=[{id:"receipt",trip_id:"trip",target_type:"actual_expense",target_id:"paid",file_name:"receipt.pdf"}];
  await db.emit("budget_items");await db.emit("attachments",{eventType:"INSERT",new:db.rows.attachments[0]});
  await expect(row(page,"Second fare")).toContainText("600");await expect(form.getByRole("textbox",{name:"備註"})).toHaveValue("Keep typed notes");
  expect(db.reads.length-before).toBe(0);
});
test("late ID-only receipt DELETE stays scoped after the authoritative snapshot removed it",async({page})=>{
  const db=backend({leases:true});db.rows.attachments=[{id:"receipt",trip_id:"trip",target_type:"actual_expense",target_id:"paid",file_name:"old.pdf"}];
  await ready(page,db);const reads=db.reads.length,before=db.snapshotReads.length;
  db.rows.attachments=[];await db.emit("attachments",{eventType:"DELETE",old:{id:"receipt"}});
  await expect.poll(()=>db.snapshotReads.length).toBe(before+1);await page.waitForTimeout(100);
  await db.emit("attachments",{eventType:"DELETE",old:{id:"receipt"}});
  await expect.poll(()=>db.snapshotReads.length).toBe(before+2);expect(db.reads.length-reads).toBe(0);
});
for(const kind of ["account","trip"])test(`old ${kind} snapshot and callback stay obsolete after A -> B -> A`,async({page})=>{
  const db=backend({leases:true});await ready(page,db);
  await page.evaluate(()=>{budgetMock.oldBudget=budgetMock.captureBudget();});
  db.hold={snapshotActor:"A",tripId:"trip"};await db.emit("budget_items");await expect.poll(()=>db.pending.length).toBe(1);
  db.hold=null;
  if(kind==="account"){await page.evaluate(()=>budgetMock.switchAccount("B"));await expect(page.getByRole("button",{name:"帳號選單"})).toContainText("B");}
  else {await page.getByRole("button",{name:"Other QA",exact:true}).click();await expect(row(page)).toHaveCount(0);}
  db.rows.budget_items[0].twd_amount=700;
  if(kind==="account")await page.evaluate(()=>budgetMock.switchAccount("A"));else await page.getByRole("button",{name:"Rates QA",exact:true}).click();
  await expect(row(page)).toContainText("700");await page.waitForTimeout(200);
  const before=db.snapshotReads.length;await page.evaluate(()=>budgetMock.oldBudget());db.release();await page.waitForTimeout(150);
  await expect(row(page)).toContainText("700");expect(db.snapshotReads.length).toBe(before);
});
test("focus, online and resubscription converge once after missed events",async({page})=>{
  const db=backend({leases:true});await ready(page,db);const before=db.snapshotReads.length,reads=db.reads.length;
  db.rows.budget_items[0].twd_amount=900;
  await page.evaluate(()=>{budgetMock.status("CLOSED");budgetMock.status("SUBSCRIBED");window.dispatchEvent(new Event("online"));window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange"));});
  await expect(row(page)).toContainText("900");expect(db.snapshotReads.length-before).toBe(1);
  // Existing shared-channel luggage rejoin behavior intentionally stays intact.
  expect(db.reads.slice(reads).map(r=>r.table).sort()).toEqual(["luggage_items","shared_luggage_items"]);
});
test("a writer and its same-turn Realtime notification share one post-commit snapshot",async({page})=>{
  const db=backend({leases:true});await ready(page,db);
  await page.getByRole("button",{name:"JPY fare",exact:true}).click();const before=db.snapshotReads.length,reads=db.reads.length;
  await page.getByRole("button",{name:"付款狀態",exact:true}).click();
  await expect(page.locator(".bw-detail").getByRole("button",{name:"付款狀態"})).toHaveAttribute("aria-pressed","true");
  expect(db.snapshotReads.length-before).toBe(1);
  expect(db.reads.slice(reads).every(r=>["budget_items","actual_expenses"].includes(r.table))).toBe(true);
});

test("a delayed full-trip read cannot roll back newer scoped data or its offline cache",async({page})=>{
  const db=backend({leases:true});await ready(page,db);
  db.hold={actor:"A",readTable:"itinerary_items"};await db.emit("accommodations");await expect.poll(()=>db.pending.length).toBe(1);
  db.hold=null;db.rows.budget_items[0].twd_amount=777;await db.emit("budget_items");await expect(row(page)).toContainText("777");
  db.release();await page.waitForTimeout(150);await expect(row(page)).toContainText("777");
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("travel-planner-offline-v2:A:trip:trip")).payload.budgetSnapshot.budgetItems.find(r=>r.id==="budget").twd_amount)).toBe(777);
});

test("measures controlled event-to-DOM latency and scoped SDK request counts",async({page})=>{
  const db=backend({leases:true});await ready(page,db);const before=db.snapshotReads.length,reads=db.reads.length,times=[];
  for(let i=0;i<10;i++) {
    db.rows.budget_items[0].twd_amount=1001+i;
    const start=Date.now();await db.emit("budget_items");await expect(row(page).locator(".bw-total")).toHaveText(String(1001+i).replace(/\B(?=(\d{3})+(?!\d))/g,","));
    times.push(Date.now()-start);
  }
  const ordered=[...times].sort((a,b)=>a-b),metrics={kind:"local-real-App-mocked-SDK",samples:times,p50:ordered[4],p95:ordered[9],snapshotRPCs:db.snapshotReads.length-before,unrelatedTableReads:db.reads.length-reads,batchDelayMs:80};
  expect(metrics.snapshotRPCs).toBe(10);expect(metrics.unrelatedTableReads).toBe(0);
  const burstBefore=db.snapshotReads.length;
  db.rows.budget_items[0].twd_amount=2001;
  await page.evaluate(()=>{for(let i=0;i<10;i++)budgetMock.emit("budget_items");});
  await expect(row(page).locator(".bw-total")).toHaveText("2,001");
  metrics.burstTenSnapshotRPCs=db.snapshotReads.length-burstBefore;expect(metrics.burstTenSnapshotRPCs).toBe(1);
  if(process.env.BUDGET_SYNC_METRICS)await fs.writeFile(process.env.BUDGET_SYNC_METRICS,JSON.stringify(metrics,null,2));
});
