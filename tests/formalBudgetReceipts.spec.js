import {expect,test} from "@playwright/test";
import {backend,boot} from "./helpers/formalBudgetMock.js";
const file={name:"lease-qa.pdf",mimeType:"application/pdf",buffer:Buffer.from("receipt fixture")};
async function setup(page) {
  const db=backend({leases:true});
  db.rows.actual_expenses=[{...db.rows.budget_items[0],id:"paid",budget_item_id:"budget",payment_active:true,actual_twd_amount:200,twd_amount_source:"actual"}];
  db.rows.actual_expense_participants=[{actual_expense_id:"paid",user_id:"A",share_amount:100},{actual_expense_id:"paid",user_id:"B",share_amount:100}];
  await boot(page,db);await page.waitForTimeout(150);await page.getByRole("button",{name:"JPY fare",exact:true}).click();return db;
}
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});
test("another Actual holder blocks receipt upload before any Storage operation",async({page})=>{
  const db=await setup(page);db.held.set("actual:paid",{actor:"B",session:"other",token:"other",expires:db.now+420000});
  await page.locator(".attachment-upload input").setInputFiles(file);
  await expect(page.getByRole("alert")).toContainText("其他成員或分頁");expect(db.storageCalls).toEqual([]);expect(db.rpcs).toEqual([]);
});
test("upload uses an Actual lease and canonical snapshot; delete removes metadata before bytes",async({page})=>{
  const db=await setup(page);await page.locator(".attachment-upload input").setInputFiles(file);
  await expect(page.getByRole("button",{name:"lease-qa.pdf",exact:true})).toBeVisible();
  expect(db.rpcs[0].name).toBe("mutate_budget_receipt");expect(db.rpcs[0].args.p_edit_token).toBeTruthy();
  await expect.poll(()=>db.held.size).toBe(0);
  await page.locator(".attachment-row").getByRole("button",{name:"X",exact:true}).click();
  await expect(page.getByRole("button",{name:"lease-qa.pdf",exact:true})).toHaveCount(0);
  expect(db.rpcs.map(c=>c.args.p_action)).toEqual(["insert","delete"]);
  expect(db.storageCalls.map(c=>c.action)).toEqual(["upload","remove"]);await expect.poll(()=>db.held.size).toBe(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("travel-planner-offline-v2:A:trip:trip")).payload.attachments)).toEqual([]);
});
test("failed upload metadata registration removes only the newly uploaded bytes",async({page})=>{
  const db=await setup(page);db.receiptFailure=true;await page.locator(".attachment-upload input").setInputFiles(file);
  await expect(page.getByRole("alert")).toContainText("Receipt lease lost");
  expect(db.rows.attachments||[]).toEqual([]);expect(db.storageCalls.map(c=>c.action)).toEqual(["upload","remove"]);
  expect(db.storageCalls[1].paths).toEqual([db.storageCalls[0].path]);await expect.poll(()=>db.held.size).toBe(0);
});
