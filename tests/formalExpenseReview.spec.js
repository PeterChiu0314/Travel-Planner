import {test,expect} from '@playwright/test';
import {randomUUID as uuid} from 'node:crypto';
import {reviewFixture} from './helpers/expenseReviewFixture.js';
import {boot,enableMetadata} from './helpers/expenseBackend.js';
const editor=p=>p.getByRole('region',{name:'支出項目編輯'});
async function open(p,f){await enableMetadata(p);await boot(p,f.db,f.A);await p.getByRole('button',{name:'Review',exact:true}).click();await p.getByRole('tab',{name:'編輯項目',exact:true}).click();}
test('an approved member absent from an older expense snapshot is not proposed on focus or saved implicitly',async({page})=>{
 const f=await reviewFixture(),C=uuid();try{await f.sql.exec('reset role');await f.sql.query('insert into public.trip_members values($1,$2,$3,$4,$5,$6)',[f.trip,C,'C','c@qa.invalid','approved','editor']);await open(page,f);
  const group=editor(page).getByRole('group',{name:'預算計價與分攤',exact:true}),before=await f.snapshot();await expect(group).toContainText('參與成員 · 1 人');await group.focus();await group.getByText('參與成員 · 1 人',{exact:true}).click();await expect(group.getByRole('checkbox',{name:/^C\b/})).not.toBeChecked();await expect(group.getByRole('checkbox',{name:/^B\b/})).not.toBeChecked();
  await page.getByRole('tab',{name:'項目明細',exact:true}).click();await page.getByRole('tab',{name:'旅程統計',exact:true}).click();const after=await f.snapshot();expect(after.items).toEqual(before.items);expect(after.participants).toEqual(before.participants);expect(after.groups.map(g=>g.revision)).toEqual(before.groups.map(g=>g.revision));expect(f.db.expenseCalls.filter(c=>c.name==='mutate_expense_group')).toHaveLength(0);
  await page.getByRole('tab',{name:'編輯項目',exact:true}).click();const amount=group.getByRole('spinbutton',{name:'總額',exact:true});await amount.focus();await expect(amount).toBeEditable();await amount.fill('12000');await amount.blur();await expect.poll(async()=>(await f.snapshot()).items[0].budget.amount).toBe(12000);expect((await f.snapshot()).participants.find(p=>p.user_id===C)?.budget_selected).toBe(false);expect((await f.snapshot()).participants.find(p=>p.user_id===f.B).budget_selected).toBe(false);expect(page.qaErrors).toEqual([]);await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
 }finally{await page.close();f.c.dispose();await f.close();}
});
test('legacy paid with no allocation stays unchanged and demands an explicit participant decision before repricing',async({page})=>{
 const f=await reviewFixture(true);try{f.db.trips[0].start_date='2020-04-05';f.db.trips[0].end_date='2020-04-10';const before=await f.snapshot();await open(page,f);
  const group=editor(page).getByRole('group',{name:'實付計價與分攤',exact:true});await expect(group).toContainText('參與成員 · 0 人');await group.focus();await group.getByText('參與成員 · 0 人',{exact:true}).click();await expect(group.getByRole('checkbox',{checked:true})).toHaveCount(0);
  const note=editor(page).getByRole('textbox',{name:'備註',exact:true});await note.focus();await expect(note).toBeEditable();await note.fill('只改備註');await note.blur();await expect.poll(async()=>(await f.snapshot()).items[0].note).toBe('只改備註');expect((await f.snapshot()).items[0].paid).toEqual(before.items[0].paid);
  const amount=group.getByRole('spinbutton',{name:'總額',exact:true});await amount.focus();await expect(amount).toBeEditable();await amount.fill('150');await amount.blur();await expect(page.locator('[data-sonner-toast]')).toContainText('請至少選擇一位參與成員');expect((await f.snapshot()).participants).toEqual([]);expect((await f.snapshot()).items[0].paid).toEqual(before.items[0].paid);
  await editor(page).getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('dialog',{name:'您有未儲存的變更'}).getByRole('button',{name:'不儲存',exact:true}).click();await expect(page.locator('.bw-detail')).toContainText('100');expect(page.qaErrors).toEqual([]);
 }finally{await page.close();f.c.dispose();await f.close();}
});
