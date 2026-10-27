import {expect,test} from "@playwright/test";
import {backend,boot} from "./helpers/formalBudgetMock.js";
import {collaboratorColor} from "../src/lib/collaboratorColors.js";
const row=(page,title="JPY fare")=>page.locator(".bw-row").filter({hasText:title});
const outlines=(page,title)=>row(page,title).locator(".bw-collaboration-outline");
async function start(page,db,actor="A"){await boot(page,db,actor);await page.waitForTimeout(180);}
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});

test("remote selection adds a stable frame without moving the table; names appear only on hover/focus",async({page,context})=>{
  const db=backend({leases:true});await start(page,db);const b=await context.newPage();
  try{
    await start(b,db,"B");const before=await row(b).boundingBox();
    await page.getByRole("button",{name:"JPY fare",exact:true}).click();
    await expect(outlines(b)).toHaveCount(1);await expect(outlines(page)).toHaveCount(0);
    expect(await row(b).boundingBox()).toEqual(before);
    const box=await outlines(b).boundingBox();expect(box.width).toBeGreaterThan(before.width-12);expect(box.height).toBe(before.height-2);
    expect(await outlines(b).evaluate(e=>e.style.getPropertyValue("--bw-remote-color"))).toBe(collaboratorColor("A"));
    await expect(b.getByRole("tooltip")).toHaveCount(0);await row(b).hover();await expect(b.getByRole("tooltip")).toHaveText("A · 選取");
    await b.mouse.move(1,1);await row(b).focus();await expect(b.getByRole("tooltip")).toHaveText("A · 選取");
    await b.keyboard.press("Escape");await expect(b.getByRole("tooltip")).toHaveCount(0);
    await b.getByRole("button",{name:"Second fare",exact:true}).click();await expect(row(b,"Second fare")).toHaveClass(/is-selected/);
    await expect(outlines(page,"Second fare")).toHaveCount(1);await expect(outlines(b)).toHaveCount(1);
    if(process.env.BUDGET_COLLAB_SCREENSHOT){await row(b).hover();await b.screenshot({path:process.env.BUDGET_COLLAB_SCREENSHOT});}
    expect(b.qaErrors).toEqual([]);
  }finally{await b.close();}
});
test("DB edit authority wins over a selection hint and a losing tab never gets a save form",async({page,context})=>{
  const db=backend({leases:true});await start(page,db);const b=await context.newPage();
  try{
    await start(b,db,"B");await page.getByRole("button",{name:"JPY fare",exact:true}).click();await page.getByRole("tab",{name:"編輯項目",exact:true}).click();
    await expect(outlines(b)).toHaveAttribute("data-mode","edit");
    await b.getByRole("button",{name:"JPY fare",exact:true}).click();await b.getByRole("tab",{name:"編輯項目",exact:true}).click();
    await expect(b.getByRole("form",{name:"預算編輯"})).toHaveCount(0);await expect(b.getByRole("alert")).toContainText("其他成員或分頁");
    await page.getByRole("form",{name:"預算編輯"}).getByRole("button",{name:"取消",exact:true}).click();
    await expect(outlines(b)).toHaveAttribute("data-mode","selection");expect(b.qaErrors).toEqual([]);
  }finally{await b.close();}
});
test("multiple members and same-account sessions coexist and clear when leaving Budget",async({page,context})=>{
  const db=backend({leases:true});db.members.push({id:"trip-C",trip_id:"trip",user_id:"C",role:"editor",status:"approved",display_name:"C"});
  await start(page,db);const b=await context.newPage(),c=await context.newPage();
  try{
    await start(b,db,"B");await start(c,db,"C");
    for(const p of [page,b])await p.getByRole("button",{name:"JPY fare",exact:true}).click();
    await expect(outlines(c)).toHaveCount(2);await row(c).hover();await expect(c.getByRole("tooltip")).toContainText("A · 選取");await expect(c.getByRole("tooltip")).toContainText("B · 選取");
    await page.getByRole("button",{name:"行李清單",exact:true}).click();await expect(outlines(c)).toHaveCount(1);
    await b.evaluate(()=>budgetMock.switchAccount("A"));db.now+=60000;await db.emit("budget_collaboration_signals");await expect(outlines(c)).toHaveCount(0);
    await page.getByRole("button",{name:"預算管理",exact:true}).click();
    await b.getByRole("button",{name:"預算管理",exact:true}).click();
    await b.getByRole("button",{name:"JPY fare",exact:true}).click();await expect(outlines(page)).toHaveCount(1);
    expect(b.qaErrors).toEqual([]);expect(c.qaErrors).toEqual([]);
  }finally{await b.close();await c.close();}
});
test("disconnect hides unconfirmed visuals; reconnect and server expiry reconcile without financial reads",async({page,context})=>{
  const db=backend({leases:true});await start(page,db);const b=await context.newPage();
  try{
    await start(b,db,"B");await page.getByRole("button",{name:"JPY fare",exact:true}).click();await expect(outlines(b)).toHaveCount(1);
    await b.evaluate(()=>window.dispatchEvent(new Event("offline")));await expect(outlines(b)).toHaveCount(0);
    await b.evaluate(()=>window.dispatchEvent(new Event("focus")));await expect(outlines(b)).toHaveCount(1);
    await b.waitForTimeout(150);const snapshots=db.snapshotReads.length;
    db.now+=60000;await db.emit("budget_collaboration_signals");await expect(outlines(b)).toHaveCount(0);
    expect(db.snapshotReads.length).toBe(snapshots);expect(b.qaErrors).toEqual([]);
  }finally{await b.close();}
});
test("five remote colors fit one row and their names are reachable by tap/focus on a narrow screen",async({page})=>{
  const db=backend({leases:true});for(const user_id of ["B","C","D","E","F"]){if(user_id!=="B")db.members.push({id:`trip-${user_id}`,trip_id:"trip",user_id,role:"editor",status:"approved",display_name:user_id});
    db.selections.set(user_id,{tripId:"trip",user_id,session:user_id,kind:"budget",resource_id:"budget",expires_at:new Date(db.now+45000).toISOString(),mode:"selection"});}
  await start(page,db);const before=await row(page).boundingBox();await expect(row(page).locator(".is-segmented")).toHaveCount(1);expect(await row(page).boundingBox()).toEqual(before);
  const gradient=await row(page).locator(".is-segmented").evaluate(e=>e.style.getPropertyValue("--bw-remote-gradient"));for(const id of ["B","C","D","E","F"])expect(gradient).toContain(collaboratorColor(id));
  await page.setViewportSize({width:390,height:844});await row(page).focus();await expect(page.getByRole("tooltip")).toContainText("F · 選取");
  const tooltip=await page.getByRole("tooltip").boundingBox();expect(tooltip.x).toBeGreaterThanOrEqual(0);expect(tooltip.x+tooltip.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");await row(page).getByRole("button",{name:"JPY fare",exact:true}).click();await expect(page.getByRole("tooltip")).toContainText("B · 選取");
});
