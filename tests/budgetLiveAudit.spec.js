import {expect,test} from "@playwright/test";
import {backend,boot} from "./helpers/formalBudgetMock.js";
test("opt-in live QA page logs only sanitized observations and uses existing authenticated RPCs",async({page})=>{
 const db=backend({leases:true});await boot(page,db);await page.goto("/tests/live-budget/index.html");
 await expect(page.locator("#identity")).toHaveText("登入使用者：A");
 await page.locator("#trip").fill("00000000-0000-4000-8000-000000000001");
 // Invalid trip is handled by the isolated backend; no credentials or payload
 // are exposed in this page's error evidence.
 await page.getByRole("button",{name:"讀取協作狀態",exact:true}).click();
 await expect(page.getByRole("log")).toContainText('"action":"collaboration"');
 const output=await page.getByRole("log").textContent();expect(output).not.toContain("access_token");expect(output).not.toContain("qa-not-a-real-token");
 await page.getByRole("button",{name:"清空畫面紀錄",exact:true}).click();await expect(page.getByRole("log")).toHaveText("");expect(page.qaErrors).toEqual([]);
});
