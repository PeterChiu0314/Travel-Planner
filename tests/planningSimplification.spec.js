import {test,expect} from '@playwright/test';
import {undoBackend,enableUndo,boot} from './helpers/budgetUndoMock.js';
async function save(page,db,value){const current=db.rows.budget_items[0].title;await page.getByRole('button',{name:'Second fare',exact:true}).click();await page.getByRole('button',{name:current,exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();const title=page.getByRole('textbox',{name:'項目名稱',exact:true});await title.click();await title.fill(value);await title.blur();await expect.poll(()=>db.rows.budget_items[0].title).toBe(value);await page.getByRole('button',{name:'關閉編輯',exact:true}).click();await page.locator('body').click({position:{x:1000,y:600}});}
test('Silent single Undo has no success/error toast or history and preserves search native undo',async({page})=>{
 const db=undoBackend();await enableUndo(page);await boot(page,db);await save(page,db,'One');await save(page,db,'Two');
 await page.keyboard.press('Control+z');await expect.poll(()=>db.rows.budget_items[0].title).toBe('One');await page.keyboard.press('Control+z');
 await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);expect(db.undoCalls.filter(c=>c.name==='undo_budget_workspace')).toHaveLength(1);
 const search=page.getByRole('textbox',{name:'搜尋項目',exact:true});await search.fill('abc');await page.keyboard.press('Control+z');expect(db.undoCalls.filter(c=>c.name==='undo_budget_workspace')).toHaveLength(1);
 await expect(page.getByRole('button',{name:/Undo|復原/})).toHaveCount(0);expect(page.qaErrors||[]).toEqual([]);
});
test('Expired undo is silent and does not modify saved data',async({page})=>{
 test.setTimeout(45000);
 const db=undoBackend();await enableUndo(page);await boot(page,db);await save(page,db,'Expired');
 // The memory backend clock is the real clock; verify the specified duration.
 await new Promise(r=>setTimeout(r,30100));await page.keyboard.press('Meta+z');
 await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);expect(db.rows.budget_items[0].title).toBe('Expired');
});
