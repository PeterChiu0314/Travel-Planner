import {test,expect} from '@playwright/test';
import {workspaceBackend,enableWorkspace,boot} from './helpers/budgetWorkspaceMock.js';
const field=p=>p.getByRole('textbox',{name:'項目名稱',exact:true});
async function open(page){await page.getByRole('button',{name:'JPY fare',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();}
test.afterEach(async({page})=>{expect(page.qaErrors||[]).toEqual([]);});
for(const key of ['Control+z','Meta+z'])test(`Formal ${key} outside inputs never writes saved data`,async({page})=>{
 const db=workspaceBackend();await enableWorkspace(page);await boot(page,db);await open(page);
 await field(page).click();await field(page).fill('Permanent save');await field(page).blur();await expect.poll(()=>db.rows.budget_items[0].title).toBe('Permanent save');
 await page.getByRole('button',{name:'關閉編輯',exact:true}).click();await page.locator('body').click({position:{x:1000,y:600}});
 const before=structuredClone(db.rows),calls=db.rpcs.length;await page.keyboard.press(key);await page.waitForTimeout(1200);
 expect(db.rows).toEqual(before);expect(db.rpcs.slice(calls).filter(r=>!/read|snapshot/.test(r.name))).toEqual([]);expect(db.undoCalls).toEqual([]);
 await expect(page.getByRole('button',{name:/Undo|復原/})).toHaveCount(0);await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
for(const label of ['項目名稱','備註'])test(`Formal ${label} uses actual Chromium native text undo`,async({page})=>{
 const db=workspaceBackend();await enableWorkspace(page);await boot(page,db);await open(page);
 const input=page.getByRole('textbox',{name:label,exact:true}),before=await input.inputValue();
 await input.click();await expect(input).toBeEditable();await input.press('End');await page.keyboard.insertText('native edit');await expect(input).toHaveValue(before+'native edit');
 await page.keyboard.press('Control+z');await expect(input).toHaveValue(before);expect(db.undoCalls).toEqual([]);
});
test('Number input leaves native key event unprevented and never invokes Undo RPC',async({page})=>{
 const db=workspaceBackend();await enableWorkspace(page);await boot(page,db);await open(page);
 const input=page.getByRole('spinbutton',{name:'總額',exact:true});await input.focus();
 await page.evaluate(()=>{window.nativeKey=[];window.addEventListener('keydown',e=>{if(e.key==='z')queueMicrotask(()=>window.nativeKey.push(e.defaultPrevented));});});
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>window.nativeKey)).toEqual([false]);expect(db.undoCalls).toEqual([]);
});
test('Demo saved metadata persists after Ctrl Z with no external requests',async({page})=>{
 await enableWorkspace(page);const external=[];page.on('request',r=>{if(/supabase|exchangerate-api/.test(new URL(r.url()).hostname))external.push(r.url());});
 await page.goto('/demo/budget');await page.getByRole('button',{name:'新增預算',exact:true}).click();await field(page).click();await field(page).fill('Demo saved');await field(page).blur();
 await expect(page.getByRole('button',{name:'Demo saved',exact:true})).toBeVisible();await page.getByRole('button',{name:'關閉編輯',exact:true}).click();
 await page.locator('body').click({position:{x:1000,y:600}});await page.keyboard.press('Control+z');await expect(page.getByRole('button',{name:'Demo saved',exact:true})).toBeVisible();expect(external).toEqual([]);
});
