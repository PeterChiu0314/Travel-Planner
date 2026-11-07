import {test,expect} from '@playwright/test';import {expenseBackend,boot,enableMetadata} from './helpers/expenseBackend.js';
const editor=p=>p.getByRole('region',{name:'支出項目編輯'});
async function open(p,f){await enableMetadata(p);await boot(p,f.db,f.A);await expect(p.getByRole('region',{name:'支出工作區'})).toBeVisible();}
test('lost create ACK plus immediate refresh keeps the original request and later local input',async({page})=>{const f=await expenseBackend();try{await open(page,f);await page.getByRole('button',{name:'新增項目',exact:true}).click();f.db.dropAck=true;const title=editor(page).getByRole('textbox',{name:'項目名稱',exact:true});await title.fill('Refresh race');await title.blur();await expect.poll(async()=>(await f.snapshot()).items.length).toBe(1);await editor(page).getByRole('textbox',{name:'備註',exact:true}).fill('Typed after submit');page.on('dialog',d=>d.accept());await page.reload();await expect(editor(page).getByRole('textbox',{name:'備註',exact:true})).toHaveValue('Typed after submit');await page.getByRole('tab',{name:'項目明細',exact:true}).click();await expect.poll(async()=>(await f.snapshot()).items[0].note).toBe('Typed after submit');expect((await f.snapshot()).items).toHaveLength(1);const calls=f.db.expenseCalls.filter(c=>c.name==='create_named_expense_item');expect(calls.length).toBeGreaterThanOrEqual(2);expect(new Set(calls.map(c=>c.args.p_request_id)).size).toBe(1);expect(page.qaErrors).toEqual([]);}finally{await page.close();await f.close();}});
test('one add entry opens only a local form; whitespace close and refresh leave no rows',async({page})=>{const f=await expenseBackend();try{await open(page,f);const add=page.getByRole('button',{name:'新增項目',exact:true});await expect(add).toHaveCount(1);await add.dblclick();await expect(editor(page)).toBeVisible();await expect(page.locator('.bw-row')).toHaveCount(0);expect((await f.snapshot()).items).toHaveLength(0);await editor(page).getByRole('textbox',{name:'項目名稱',exact:true}).fill('　 ');await page.getByRole('tab',{name:'項目明細',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await add.click();await page.reload();await expect(page.locator('.bw-row')).toHaveCount(0);expect((await f.snapshot()).items).toHaveLength(0);expect(f.db.expenseCalls.filter(c=>c.name.includes('create'))).toHaveLength(0);expect(page.qaErrors).toEqual([]);}finally{await page.close();await f.close();}});
test('unnamed expense explains why it cannot save; continue focuses the title, discard creates nothing',async({page})=>{
 const f=await expenseBackend();
 try{
  await open(page,f);
  const add=page.getByRole('button',{name:'新增項目',exact:true});
  const details=page.getByRole('tab',{name:'項目明細',exact:true});
  const title=editor(page).getByRole('textbox',{name:'項目名稱',exact:true});
  const note=editor(page).getByRole('textbox',{name:'備註',exact:true});
  const amount=editor(page).getByRole('spinbutton',{name:'總額',exact:true});
  const dialog=page.getByRole('dialog',{name:'您有未儲存的變更'});
  await add.click();
  await amount.fill('800');
  await note.fill('Only a note so far');
  await details.click();
  await expect(dialog).toContainText('請先填寫項目名稱，才能儲存此支出。');
  await expect(dialog.getByRole('button',{name:'儲存',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'繼續編輯',exact:true}).click();
  await expect(title).toBeFocused();
  await expect(amount).toHaveValue('800');
  await expect(note).toHaveValue('Only a note so far');
  expect((await f.snapshot()).items).toHaveLength(0);
  await details.click();
  await dialog.getByRole('button',{name:'不儲存',exact:true}).click();
  await expect(editor(page)).toHaveCount(0);
  expect((await f.snapshot()).items).toHaveLength(0);
  expect(f.db.expenseCalls.filter(c=>c.name==='create_named_expense_item')).toHaveLength(0);
  await add.click();
  await note.fill('Keep this note');
  await details.click();
  await dialog.getByRole('button',{name:'繼續編輯',exact:true}).click();
  await expect(title).toBeFocused();
  await title.fill('Named after continuing');
  await details.click();
  await expect(dialog).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  await expect.poll(async()=>(await f.snapshot()).items.map(i=>[i.title,i.note])).toEqual([['Named after continuing','Keep this note']]);
  expect(f.db.expenseCalls.filter(c=>c.name==='create_named_expense_item')).toHaveLength(1);
  expect(page.qaErrors).toEqual([]);
 }finally{await page.close();await f.close();}
});
test('name only commits one stable incomplete row and enables ordinary collaboration',async({page})=>{const f=await expenseBackend();try{await open(page,f);await page.getByRole('button',{name:'新增項目',exact:true}).click();const title=editor(page).getByRole('textbox',{name:'項目名稱',exact:true});await title.fill('東京住宿');await title.blur();await expect.poll(async()=>(await f.snapshot()).items.length).toBe(1);await page.getByRole('tab',{name:'項目明細',exact:true}).click();const s=await f.snapshot();expect(s.items[0].budget).toBe(null);expect(s.items[0].paid).toBe(null);await expect(page.locator('.bw-row')).toHaveCount(1);await expect(page.locator('.bw-row')).toContainText('尚未填寫');expect(page.qaErrors).toEqual([]);await page.screenshot({path:test.info().outputPath('named-incomplete.png')});}finally{await page.close();await f.close();}});
test('planning edits one amount and marks it paid without a separate paid form',async({page})=>{const f=await expenseBackend();try{await open(page,f);await page.getByRole('button',{name:'新增項目',exact:true}).click();await expect(editor(page).getByText(/實付/)).toHaveCount(0);const amount=editor(page).getByRole('group',{name:'預算計價與分攤',exact:true}).getByRole('spinbutton',{name:'總額',exact:true});await amount.fill('800');await editor(page).getByRole('textbox',{name:'項目名稱',exact:true}).fill('午餐');await amount.focus();await expect(amount).toBeEditable();await editor(page).getByRole('button',{name:'付款狀態',exact:true}).click();await expect.poll(async()=>(await f.snapshot()).items[0]?.payment_state).toBe('paid');const s=await f.snapshot();expect(s.items).toHaveLength(1);expect(s.items[0].budget.amount).toBe(800);expect(s.items[0].paid.amount).toBe(800);await page.getByRole('tab',{name:'項目明細',exact:true}).click();await expect(page.locator('.bw-detail')).not.toContainText('實付');await expect(page.locator('.bw-row .bw-status')).toHaveText('已付款');await page.screenshot({path:test.info().outputPath('planning-single-amount-paid.png')});}finally{await page.close();await f.close();}});
