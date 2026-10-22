import { expect, test } from "@playwright/test";
test.use({viewport:{width:1440,height:900}});
test.beforeEach(async({page})=>{await page.clock.install({time:new Date('2026-10-22T12:00:00+08:00')});});

async function checkMenu(page,label) {
  const field=page.getByRole('combobox',{name:label,exact:true});
  await field.click();const popup=page.getByRole('listbox',{name:`${label}選項`,exact:true});await expect(popup).toBeVisible();
  const anchor=await field.evaluate(e=>{const r=e.closest('.menu-select').getBoundingClientRect();return {x:r.x,width:r.width};});
  const box=await popup.boundingBox();expect(Math.abs(box.width-anchor.width)).toBeLessThan(1);expect(Math.abs(box.x-anchor.x)).toBeLessThan(1);
  expect(box.x).toBeGreaterThanOrEqual(8);expect(box.x+box.width).toBeLessThanOrEqual(1432);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(900);
  const style=await popup.evaluate(e=>({scrollbar:getComputedStyle(e,'::-webkit-scrollbar').width,radius:getComputedStyle(e).borderRadius,overflow:e.scrollWidth>e.clientWidth}));
  expect(style).toEqual({scrollbar:'4px',radius:'10px',overflow:false});
  await field.press('Escape');await expect(popup).toHaveCount(0);
}

test('all Budget menus match field width and share the established popup and scrollbar',async({page})=>{
  await page.goto('/demo/budget?budgetTools=1');
  for(const label of ['付款篩選','統計視角','Demo 情境']) await checkMenu(page,label);
  await page.getByRole('tab',{name:'編輯項目',exact:true}).click();await page.getByRole('button',{name:'停車費',exact:true}).click();
  for(const label of ['分類','付款人','幣別']) await checkMenu(page,label);
  await page.getByRole('button',{name:/關聯行程/}).click();await checkMenu(page,'關聯行程日期');
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('combobox',{name:'Demo 情境',exact:true}).click();await page.getByRole('option',{name:'行程中',exact:true}).click();
  await page.getByRole('button',{name:'新增實付',exact:true}).click();await page.locator('.bw-secondary-fields > summary').click();
  for(const label of ['分類','付款人','幣別','來源預算']) await checkMenu(page,label);
  const source=page.getByRole('combobox',{name:'來源預算',exact:true});await source.click();
  const popup=page.getByRole('listbox',{name:'來源預算選項',exact:true});
  expect(await popup.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  const last=await popup.getByRole('option').last().innerText();await source.press('End');await source.press('Enter');await expect(source).toHaveText(last);
});

test('status column, compact tabs and category colors match the overview at different rankings',async({page})=>{
  await page.goto('/demo/budget');
  expect((await page.locator('.bw-table thead th').last().boundingBox()).width).toBe(100);
  expect((await page.getByRole('tablist',{name:'右側面板'}).boundingBox()).height).toBe(51);
  const verifyColors=async()=>{
    const legend=await page.locator('.bw-category-label').evaluateAll(nodes=>Object.fromEntries(nodes.map(e=>[e.textContent,getComputedStyle(e.querySelector('i')).backgroundColor])));
    const groups=await page.locator('.bw-group-label').evaluateAll(nodes=>nodes.map(e=>({category:e.querySelector('span').textContent,color:getComputedStyle(e.querySelector('svg')).color})));
    for(const entry of groups) expect(entry.color).toBe(legend[entry.category]);return legend;
  };
  const initial=await verifyColors();
  await page.getByRole('combobox',{name:'統計視角',exact:true}).click();await page.getByRole('option',{name:'Peter',exact:true}).click();
  expect(await verifyColors()).toEqual(initial);
});
