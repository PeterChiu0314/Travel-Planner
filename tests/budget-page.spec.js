import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-22T12:00:00+08:00") });
  await page.goto("/demo/budget");
  await expect(page.getByRole("table", { name: "預算明細", exact: true })).toBeVisible();
});
const rowByTitle = (page, title) => page.locator(".bw-row").filter({ has: page.getByRole("button", { name: title, exact: true }) });
const editor = (page) => page.getByRole("form", { name: "預算編輯" });
test("dense groups, filter independence, single-click details and no early comparison", async ({ page }) => {
  await expect(page.getByRole("tab", { name: "對照", exact: true })).toHaveCount(0);
  await expect(page.locator(".bw-row")).toHaveCount(32);
  const before = await page.getByLabel("旅程費用摘要").textContent();
  await page.getByRole("combobox", {name:"費用分類",exact:true}).click(); await page.getByRole("option",{name:"餐飲",exact:true}).click();
  await expect(page.locator(".bw-row")).toHaveCount(13);
  await expect(page.getByLabel("旅程費用摘要")).toHaveText(before);
  await page.getByRole("button", { name: "Day 1・關西機場午餐", exact: true }).click();
  await expect(page.locator(".bw-detail h3")).toHaveText("Day 1・關西機場午餐");
  await expect(editor(page)).toHaveCount(0);
  await page.getByLabel("搜尋項目").fill("不存在");
  await expect(page.getByText("找不到符合條件的項目")).toBeVisible();
});
test("per-person pricing, custom split and actual conversion preserve the original budget", async ({ page }) => {
  await page.getByRole("button", { name: "新增預算", exact: true }).click();
  const form = editor(page);
  await form.getByLabel("項目", { exact: true }).fill("兩人門票");
  await form.getByRole("button", { name: "每人計價", exact: true }).click();
  await form.getByLabel("每人單價", { exact: true }).fill("700");
  await form.getByRole("combobox",{name:"幣別",exact:true}).click(); await page.getByRole("option",{name:"JPY",exact:true}).click();
  await form.getByLabel(/匯率/).fill("0.22");
  await form.locator('.bw-member-options > summary').click();
  const people = form.locator('.bw-participants input[type=checkbox]');
  for (let i=2; i<await people.count(); i++) await people.nth(i).uncheck();
  await form.getByRole("button", { name: "儲存", exact: true }).click();
  const row = rowByTitle(page,"兩人門票");
  await expect(row).toContainText("154");
  await expect(row).toContainText("308");
  await row.getByRole("button", { name: "兩人門票", exact: true }).click();
  await page.getByRole("button", { name: "編輯項目", exact: true }).click();
  await form.getByRole("button", { name: "自訂分攤", exact: true }).click();
  const amounts = form.getByRole("spinbutton", { name: /分攤金額/ });
  await amounts.nth(0).fill("1000"); await amounts.nth(1).fill("400");
  await form.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(row).toContainText("依成員");
  await row.getByRole("button", { name: "兩人門票", exact: true }).click();
  await page.getByRole("button", { name: "付款狀態", exact: true }).click();
  await expect(page.getByRole("form", { name: "實付編輯" })).toHaveCount(0);
  await page.getByRole("tab", { name: "實付", exact: true }).click();
  await expect(page.getByRole("table", { name: "實付明細", exact: true })).toContainText("兩人門票");
  await page.getByRole("tab", { name: "預算", exact: true }).click();
  await expect(row).toContainText("308"); await expect(row).toContainText("實付");
});
test("double-click shares the right draft; blur does not save, Escape cancels, Enter saves", async ({ page }) => {
  const row=page.locator(".bw-row").first();
  const title=await row.locator("td").nth(1).textContent();
  await row.locator("td").nth(1).getByRole("button").dblclick();
  const input=page.getByRole("textbox",{name:/快速修改項目/});
  await input.fill("尚未儲存");
  await expect(editor(page).getByLabel("項目",{exact:true})).toHaveValue("尚未儲存");
  await page.getByRole("tab",{name:"旅程統計",exact:true}).click();
  await expect(input).toHaveValue("尚未儲存");
  await page.getByRole("tab",{name:/項目明細/}).click();
  await input.press("Escape");
  await expect(row.locator("td").nth(1)).toHaveText(title);
  await row.locator("td").nth(3).getByRole("button").dblclick();
  const total=page.getByRole("spinbutton",{name:/快速修改總額/});
  await total.fill("1000"); await total.press("Enter");
  await expect(editor(page)).toHaveCount(0);
  await expect(row.locator("td").nth(3)).toContainText("1,000"); // First flight line uses TWD.
  await page.getByRole('tab',{name:'實付',exact:true}).click();
  await expect(page.locator('.bw-row')).toHaveCount(8);
  await expect(rowByTitle(page,'去程機票・桃園 → 關西')).toContainText('35,745');
});
test("empty participants cannot save; view navigation uses the editor guard",async({page})=>{
  await page.getByRole("button",{name:"新增預算",exact:true}).click();
  const form=editor(page); await form.getByLabel("項目",{exact:true}).fill("草稿");
  await form.locator('.bw-member-options > summary').click();
  for(const checkbox of await form.locator('.bw-participants input[type=checkbox]').all()) await checkbox.uncheck();
  await form.getByRole("button",{name:"儲存",exact:true}).click();
  await expect(form.getByRole("alert")).toContainText("至少選擇一位");
  await page.getByRole("tab",{name:"實付",exact:true}).click();
  const guard=page.getByRole("dialog",{name:"您有未儲存的變更"});
  await expect(guard).toBeVisible(); await guard.getByRole("button",{name:"不儲存",exact:true}).click();
  await expect(page.getByRole("table",{name:"實付明細",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"新增實付",exact:true}).click();
  await expect(page.getByRole("form",{name:"實付編輯"}).getByLabel("項目",{exact:true})).toHaveValue("");
});
test("traveling prioritizes actuals; only settlement exposes frozen comparison",async({page})=>{
  await page.clock.setSystemTime(new Date("2027-04-06T12:00:00+08:00")); await page.clock.runFor(30010);
  await expect(page.getByRole("table",{name:"實付明細",exact:true})).toBeVisible();
  await expect(page.getByRole("tab",{name:"對照",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"新增實付",exact:true}).click();
  const form=page.getByRole("form",{name:"實付編輯"});
  await form.getByLabel("項目",{exact:true}).fill("旅途中咖啡"); await form.getByLabel("總額",{exact:true}).fill("300");
  await form.getByRole("button",{name:"儲存",exact:true}).click();
  await page.clock.setSystemTime(new Date("2027-04-11T12:00:00+08:00")); await page.clock.runFor(30010);
  await page.getByRole("tab",{name:"對照",exact:true}).click();
  const before=await page.locator(".bw-comparison-summary").textContent();
  await expect(page.getByRole("table",{name:"出發前預算對照",exact:true})).toContainText("旅途中咖啡");
  await page.getByRole("tab",{name:"預算",exact:true}).click();
  await page.locator(".bw-row").first().locator("td").nth(3).getByRole("button").dblclick();
  await page.getByRole("spinbutton",{name:/快速修改總額/}).fill("9999"); await page.getByRole("spinbutton",{name:/快速修改總額/}).press("Enter");
  await page.getByRole("tab",{name:"對照",exact:true}).click();
  await expect(page.locator(".bw-comparison-summary")).toHaveText(before);
});
test("cancelled payment button drafts never create or remove actual expenses",async({page})=>{
  await page.getByRole("button",{name:"新增預算",exact:true}).click(); const form=editor(page);
  await form.getByLabel("項目",{exact:true}).fill("已購機票"); await form.getByLabel("總額",{exact:true}).fill("12000");
  await form.getByRole('button',{name:'付款狀態',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await form.getByRole('button',{name:'取消',exact:true}).click();
  await expect(rowByTitle(page,'已購機票')).toHaveCount(0);
  await rowByTitle(page,'去程機票・桃園 → 關西').getByRole('button',{name:'去程機票・桃園 → 關西',exact:true}).click();
  await page.getByRole('button',{name:'編輯項目',exact:true}).click();
  await expect(form.getByRole('button',{name:'付款狀態',exact:true})).toHaveAttribute('aria-pressed','true');
  await form.getByRole('button',{name:'付款狀態',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await form.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.getByRole('button',{name:'付款狀態',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('tab',{name:'實付',exact:true}).click();
  await expect(page.locator('.bw-row')).toHaveCount(8);
});

test("paid toggle saves with the budget and detail changes preserve saved payment amounts",async({page})=>{
  await page.getByRole("button",{name:"新增預算",exact:true}).click(); const form=editor(page);
  await form.getByLabel("項目",{exact:true}).fill("已購機票"); await form.getByLabel("總額",{exact:true}).fill("12000");
  await form.getByRole('button',{name:'付款狀態',exact:true}).click();
  await form.getByRole("button",{name:"儲存",exact:true}).click();
  const row=rowByTitle(page,"已購機票"); await expect(row).toContainText("實付");
  await row.getByRole('button',{name:'已購機票',exact:true}).click();
  await page.getByRole('button',{name:'付款狀態',exact:true}).click();
  await expect(row).toContainText('預算');
  await page.getByRole('button',{name:'付款狀態',exact:true}).click();
  await expect(page.getByRole('form',{name:'實付編輯'})).toHaveCount(0);
  await expect(row).toContainText('實付');
  await row.getByRole("button",{name:"已購機票"}).click(); await page.getByRole("button",{name:"編輯項目"}).click();
  await form.getByLabel("總額",{exact:true}).fill("13000"); await form.getByRole("button",{name:"儲存",exact:true}).click();
  await page.getByRole("tab",{name:"實付",exact:true}).click(); await expect(row).toHaveCount(1); await expect(row).toContainText("12,000");
  await page.getByRole('tab',{name:'預算',exact:true}).click();
  await row.getByRole('button',{name:'已購機票',exact:true}).click();
  await page.getByRole('button',{name:'編輯項目',exact:true}).click();
  await expect(form.getByRole('button',{name:'付款狀態',exact:true})).toHaveAttribute('aria-pressed','true');
  await form.getByRole('button',{name:'付款狀態',exact:true}).click();
  await form.getByRole('button',{name:'儲存',exact:true}).click();
  await expect(row).toContainText('預算');
  await page.getByRole('tab',{name:'實付',exact:true}).click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('.bw-row')).toHaveCount(8);
});
test("compact payment pills share footer placement and keep room for save actions",async({page})=>{
  for (const width of [1264,1140,390]) {
    await page.setViewportSize({width,height:892});
    await page.getByRole('button',{name:'關西機場 → 京都巴士',exact:true}).click();
    const detail=page.locator('.bw-detail-actions');
    const unpaid=detail.getByRole('button',{name:'付款狀態',exact:true});
    await expect(unpaid).toHaveText('未付款');
    await expect(unpaid).toHaveAttribute('aria-pressed','false');
    const detailBox=await detail.boundingBox(), pillBox=await unpaid.boundingBox();
    expect(pillBox.width).toBe(90); expect(pillBox.height).toBe(32);
    expect(Math.abs(pillBox.x-detailBox.x)).toBeLessThan(1);
    await page.getByRole('button',{name:'編輯項目',exact:true}).click();
    const footer=editor(page).locator('.bw-editor-actions');
    const pill=footer.getByRole('button',{name:'付款狀態',exact:true});
    await pill.focus(); await pill.press('Space');
    await expect(pill).toHaveText('已付款');
    await expect(pill).toHaveAttribute('aria-pressed','true');
    const bounds=await footer.boundingBox(), paidBox=await pill.boundingBox();
    const cancel=await footer.getByRole('button',{name:'取消',exact:true}).boundingBox();
    const save=await footer.getByRole('button',{name:'儲存',exact:true}).boundingBox();
    expect(paidBox.width).toBe(90); expect(paidBox.height).toBe(save.height);
    expect(Math.abs(paidBox.x-bounds.x)).toBeLessThan(1);
    expect(paidBox.x+paidBox.width).toBeLessThan(cancel.x);
    expect(save.x+save.width).toBeLessThanOrEqual(bounds.x+bounds.width+1);
    await pill.press('Space');
    await editor(page).getByRole('button',{name:'取消',exact:true}).click();
  }
});

test("historical trip without a baseline never displays a fabricated zero budget",async({page})=>{
  await page.getByRole("button",{name:"系統測試專用",exact:true}).click();
  await page.getByRole("tab",{name:"對照",exact:true}).click();
  await expect(page.getByText("無出發前快照，無法還原當時預算。")).toBeVisible();
  await expect(page.locator(".bw-row")).toHaveCount(0);
});
test("compact editor defaults, personal calculation and searchable itinerary links survive save",async({page})=>{
  await page.getByRole('button',{name:'新增預算',exact:true}).click();
  const form=editor(page);
  await expect(form.locator('.bw-member-options')).not.toHaveAttribute('open');
  await form.getByLabel('項目',{exact:true}).fill('關聯行程測試');
  await form.getByLabel('總額',{exact:true}).fill('1000');
  await expect(form.locator('.bw-calculation')).toContainText('每人NT$ 200');
  await expect(form.locator('.bw-calculation')).toContainText('總額NT$ 1,000');
  await expect(form.getByLabel('付款人',{exact:true})).toBeVisible();
  await form.locator('.bw-member-options > summary').click();
  expect((await form.locator('.bw-participants label').first().boundingBox()).height).toBeLessThanOrEqual(34);
  await form.locator('.bw-participants input[type=checkbox]').last().uncheck();
  await expect(form.locator('.bw-calculation')).toContainText('每人NT$ 250');
  await form.locator('.bw-member-options > summary').click();
  await form.locator('.bw-link-options > summary').click();
  await form.getByRole('combobox',{name:'關聯行程日期',exact:true}).click(); await page.getByRole('option',{name:'Day 2',exact:true}).click();
  await form.getByLabel('搜尋關聯行程',{exact:true}).fill('宇治');
  await form.locator('.bw-link-results').getByLabel('宇治吃午餐',{exact:true}).check();
  await form.locator('.bw-link-results').getByLabel('宇治市漫遊',{exact:true}).check();
  await expect(form.locator('.bw-linked-items li')).toHaveCount(2);
  await form.getByRole('button',{name:'取消關聯 宇治吃午餐',exact:true}).click();
  await form.getByRole('button',{name:'儲存',exact:true}).click();
  const row=rowByTitle(page,'關聯行程測試');
  await expect(row).toContainText('Day 2');
  await row.getByRole('button',{name:'關聯行程測試',exact:true}).click();
  await expect(page.locator('.bw-detail .bw-calculation')).toContainText('每人NT$ 250');
  await expect(page.locator('.bw-detail .bw-calculation')).toContainText('總額NT$ 1,000');
  await page.getByRole('button',{name:'編輯項目',exact:true}).click();
  await expect(form.locator('.bw-linked-items')).toContainText('宇治市漫遊');
  await expect(form.locator('.bw-linked-items li')).toHaveCount(1);
  await expect(form.locator('.bw-member-options')).not.toHaveAttribute('open');
});

test("desktop panels stay below the header and reach save without scrolling the whole workspace",async({page})=>{
  await page.setViewportSize({width:1264,height:892});
  await page.locator('.bw-row').first().locator('td').nth(1).getByRole('button').dblclick();
  const form=editor(page);
  await expect(form.getByText('已付款',{exact:true})).toBeVisible();
  await expect(form.getByLabel('這筆已付款')).toHaveCount(0);
  await form.locator('.bw-member-options > summary').click();
  await form.locator('.bw-link-options > summary').click();
  await form.getByLabel('備註',{exact:true}).scrollIntoViewIfNeeded();
  await expect(form.getByRole('button',{name:'儲存',exact:true})).toBeInViewport();
  await expect(page.getByRole('tab',{name:'項目明細',exact:true})).toBeInViewport();
  const header=await page.locator('.trip-header').boundingBox();
  const side=await page.locator('.bw-side').boundingBox();
  expect(Math.abs(side.y-header.y-header.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(side.y+side.height-892)).toBeLessThanOrEqual(1);
  expect(Math.abs(side.x+side.width-1264)).toBeLessThanOrEqual(1);
  const workspace=await page.locator('.workspace').boundingBox();
  const table=await page.locator('.bw-table').boundingBox();
  expect(Math.abs(table.x-workspace.x)).toBeLessThanOrEqual(1);
  expect(await page.locator('.bw-side').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  const position=await page.locator('.workspace').evaluate(el=>({top:el.scrollTop,overflow:el.scrollHeight-el.clientHeight}));
  expect(position.top).toBe(0); expect(position.overflow).toBeLessThanOrEqual(1);
  await page.locator('.bw-row').last().scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:'新增預算',exact:true})).toBeInViewport();
  await expect(page.getByRole('tab',{name:'項目明細',exact:true})).toBeInViewport();
});
test('inline editing keeps row height and uses compact inputs and edge-aligned board scrollbars',async({page})=>{
  await page.setViewportSize({width:1264,height:892});
  const row=page.locator('.bw-row').first();
  const before=await row.boundingBox();
  await row.locator('td').nth(2).getByRole('button').dblclick();
  const input=page.getByRole('spinbutton',{name:/快速修改每人預算/});
  expect((await row.boundingBox()).height).toBe(before.height);
  expect((await input.boundingBox()).height).toBe(28);
  expect(await input.evaluate(el=>getComputedStyle(el).appearance)).toBe('textfield');
  const form=editor(page);
  for(const field of await form.locator('input:not([type=checkbox]),select').all()) {
    if(await field.isVisible()) expect((await field.boundingBox()).height).toBeLessThanOrEqual(32);
  }
  const main=await page.locator('.bw-main').boundingBox();
  const table=await page.locator('.bw-table').boundingBox();
  const side=await page.locator('.bw-side').boundingBox();
  expect(Math.abs(table.x-main.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(side.x-main.x-main.width)).toBeLessThanOrEqual(1);
  for(const selector of ['.bw-table-scroll','.bw-side']) {
    expect(await page.locator(selector).evaluate(el=>getComputedStyle(el,'::-webkit-scrollbar').width)).toBe('4px');
  }
});

test('itinerary suggestions follow category and always allow the full trip without losing selected links',async({page})=>{
  await rowByTitle(page,'京都山科山樂酒店・2 晚').getByRole('button',{name:'京都山科山樂酒店・2 晚',exact:true}).click();
  await page.getByRole('button',{name:'編輯項目',exact:true}).click();
  const form=editor(page);
  await form.locator('.bw-link-options > summary').click();
  const suggestions=form.getByRole('group',{name:'建議行程',exact:true});
  const day1=form.getByRole('group',{name:'Day 1 行程',exact:true});
  await expect(form.locator('.bw-link-results > fieldset').first()).toHaveAttribute('aria-label','建議行程');
  await expect(suggestions.getByLabel('京都山科山樂酒店',{exact:true})).toBeVisible();
  await expect(suggestions.getByLabel('宇治吃午餐',{exact:true})).toHaveCount(0);
  await expect(form.locator('.bw-linked-items')).toContainText('京都山科山樂酒店');
  await expect(form.locator('.bw-link-results').getByLabel('宇治吃午餐',{exact:true})).toHaveCount(1);
  await form.locator('.bw-link-results').getByLabel('宇治吃午餐',{exact:true}).check();
  await suggestions.getByLabel('京都山科山樂酒店',{exact:true}).uncheck();
  await expect(day1.getByLabel('京都山科山樂酒店',{exact:true})).not.toBeChecked();
  await day1.getByLabel('京都山科山樂酒店',{exact:true}).check();
  await expect(suggestions.getByLabel('京都山科山樂酒店',{exact:true})).toBeChecked();
  await expect(form.locator('.bw-link-scopes')).toHaveCount(0);
  for(const input of await form.locator('input:not([type=checkbox]),textarea').all()) expect(await input.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect(form.locator('.bw-linked-items')).toContainText('宇治吃午餐');
  await form.getByLabel('搜尋關聯行程',{exact:true}).fill('沒有結果');
  await expect(form.locator('.bw-link-results')).toContainText('沒有符合的行程');
});

test('shared menus support keyboard, dismissal, custom categories and source selection without submitting drafts',async({page})=>{
  const filter=page.getByRole('combobox',{name:'費用分類',exact:true});
  await filter.focus(); await filter.press('ArrowDown'); await filter.press('End'); await filter.press('Enter');
  await expect(filter).toHaveText('其他');
  await filter.click(); await filter.press('Escape'); await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('button',{name:'新增預算',exact:true}).click();
  const form=editor(page);
  await form.getByRole('combobox',{name:'分類',exact:true}).fill('保險網路');
  await form.getByLabel('項目',{exact:true}).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(form.getByRole('combobox',{name:'分類',exact:true})).toHaveValue('保險網路');
  await form.getByRole('combobox',{name:'付款人',exact:true}).click();
  await page.getByRole('option',{name:'Dennis',exact:true}).click();
  await expect(form.getByRole('combobox',{name:'付款人',exact:true})).toHaveText('Dennis');
  await page.getByRole('tab',{name:'實付',exact:true}).click();
  await page.getByRole('dialog',{name:'您有未儲存的變更'}).getByRole('button',{name:'不儲存',exact:true}).click();
  await page.getByRole('button',{name:'新增實付',exact:true}).click();
  const actual=page.getByRole('form',{name:'實付編輯'});
  await actual.locator('.bw-secondary-fields > summary').click();
  await actual.getByRole('combobox',{name:'來源預算',exact:true}).click();
  const popup=page.getByRole('listbox',{name:'來源預算選項',exact:true});
  await expect(popup).toBeVisible();
  const rect=await popup.boundingBox(); expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y+rect.height).toBeLessThanOrEqual(900);
  await popup.getByRole('option',{name:'平等院門票',exact:true}).click();
  await expect(actual.getByLabel('項目',{exact:true})).toHaveValue('平等院門票');
  await expect(actual.getByRole('combobox',{name:'幣別',exact:true})).toHaveText('JPY');
  expect(await page.locator('.budget-workspace select, .budget-workspace datalist').count()).toBe(0);
});

test('category person totals follow average and named allocations including partial and custom shares',async({page})=>{
  const group=(name)=>page.locator('.bw-group').filter({has:page.locator('.bw-group-label > span').getByText(name,{exact:true})});
  await expect(group('機票').locator('.bw-group-person')).toHaveText('11,566');
  await expect(group('門票').locator('.bw-group-person')).toHaveText('≈ 480');
  const view=page.getByRole('combobox',{name:'統計視角',exact:true});
  await view.click(); await page.getByRole('option',{name:'Peter',exact:true}).click();
  await expect(group('門票').locator('.bw-group-person')).toHaveText('792');
  await expect(group('餐飲').locator('.bw-group-person')).toHaveText('6,402');
  await view.click(); await page.getByRole('option',{name:'Dora',exact:true}).click();
  await expect(group('門票').locator('.bw-group-person')).toHaveText('220');
  await expect(group('機票').locator('.bw-number').last()).toHaveText('57,830');
  await expect(page.locator('.bw-group-label svg')).toHaveCount(7);
  await expect(rowByTitle(page,'名鐵・名古屋 → 中部機場').locator('.bw-person')).toHaveText('≈ 216');
  await rowByTitle(page,'關西機場 → 京都巴士').getByRole('button',{name:'關西機場 → 京都巴士',exact:true}).click();
  const colors=await page.locator('.bw-row.is-selected').evaluate(el=>({selected:getComputedStyle(el).backgroundColor,group:getComputedStyle(el.previousElementSibling).backgroundColor}));
  expect(colors.selected).not.toBe(colors.group);
  expect(await page.locator('.bw-table thead th').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe('12px');
  expect(await page.locator('.bw-table thead small').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe('11px');
  const gaps=await page.locator('.bw-group').evaluateAll(els=>els.map(el=>({border:getComputedStyle(el.querySelector('th')).borderTopWidth,
    gap:el.previousElementSibling?el.getBoundingClientRect().top-el.previousElementSibling.getBoundingClientRect().bottom:0})));
  expect(gaps.every(row=>row.border==='0px'&&Math.abs(row.gap)<1)).toBe(true);
});

test('sticky header keeps an opaque uninterrupted divider above scrolled category and item rows',async({page})=>{
  await page.setViewportSize({width:1264,height:892});
  const scroller=page.locator('.bw-table-scroll');
  for(const offset of [0,18,30,40,90,250]) {
    await scroller.evaluate((el,top)=>{el.scrollTop=top;},offset);
    await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBe(offset);
    const cells=await page.locator('.bw-table thead th').evaluateAll(elements=>elements.map(el=>{
      const box=el.getBoundingClientRect(), style=getComputedStyle(el);
      const x=box.x+box.width/2, y=box.bottom-1;
      return {top:box.top,bottom:box.bottom,border:style.borderBottomWidth,background:style.backgroundColor,
        covers:el.contains(document.elementFromPoint(x,y))};
    }));
    expect(cells.every(cell=>cell.covers && cell.border==='1px' && cell.background==='rgb(252, 251, 247)')).toBe(true);
    expect(new Set(cells.map(cell=>cell.top)).size).toBe(1);
    expect(new Set(cells.map(cell=>cell.bottom)).size).toBe(1);
  }
});

test('list bottom leaves the same 12px inset as the side panel and the header is compact',async({page})=>{
  await page.setViewportSize({width:1264,height:892});
  await page.locator('.bw-row').last().scrollIntoViewIfNeeded();
  await page.locator('.bw-table-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
  const last=await page.locator('.bw-row').last().boundingBox(), scroller=await page.locator('.bw-table-scroll').boundingBox();
  expect(Math.abs(scroller.y+scroller.height-last.y-last.height-12)).toBeLessThanOrEqual(2); // Collapsed table borders and fractional device pixels.
  expect((await page.locator('.bw-table thead').boundingBox()).height).toBeLessThanOrEqual(38);
});

for(const width of [390,1280,1440])test(`${width}px table and editor remain operable`,async({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message)); await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  if(width>=1280){const main=await page.locator(".bw-main").boundingBox(),side=await page.locator(".bw-side").boundingBox();expect(side.x).toBeGreaterThan(main.x+main.width-1);expect((await page.locator(".bw-row").first().boundingBox()).height).toBeLessThanOrEqual(46);}
  await page.getByRole("button",{name:"新增預算",exact:true}).click(); await editor(page).getByLabel("項目",{exact:true}).fill("可操作");
  await expect(editor(page).getByRole("button",{name:"儲存",exact:true})).toBeEnabled(); expect(errors).toEqual([]);
});
