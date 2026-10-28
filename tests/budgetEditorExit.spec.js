import {expect,test} from "@playwright/test";
import {backend,boot} from "./helpers/formalBudgetMock.js";
const pane=(p,name)=>p.getByRole('tablist',{name:'右側面板'}).getByRole('tab',{name,exact:true});
const form=p=>p.getByRole('form',{name:/^(預算|實付)編輯$/});
async function open(p,title){await p.getByRole('button',{name:title,exact:true}).click();await pane(p,'編輯項目').click();await expect(form(p)).toBeVisible();}
function setup(actual=false){
  const db=backend({leases:true,departed:actual});
  if(actual){db.rows.actual_expenses=[{...db.rows.budget_items[0],id:'actual',title:'Actual fare',budget_item_id:null,paid_at:'2026-10-28T00:00:00Z',twd_amount_source:'estimated'}];
    db.rows.actual_expense_participants=['A','B'].map(user_id=>({actual_expense_id:'actual',user_id}));}
  return db;
}
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});

for(const actual of [false,true])test(`${actual?'Actual':'Budget'} save and cancel return to the selected canonical detail`,async({page})=>{
  const db=setup(actual);await boot(page,db);const title=actual?'Actual fare':'JPY fare';await open(page,title);
  await form(page).getByRole('textbox',{name:'備註'}).fill('Fresh saved note');await form(page).getByRole('button',{name:'儲存',exact:true}).click();
  await expect(pane(page,'項目明細')).toHaveAttribute('aria-selected','true');await expect(page.locator('.bw-detail')).toContainText('Fresh saved note');
  expect(db.held.size).toBe(0);await expect(page.getByRole('button',{name:'繼續編輯此項目',exact:true})).toHaveCount(0);
  await page.locator('.bw-detail').getByRole('button',{name:'編輯項目',exact:true}).click();
  await form(page).getByRole('button',{name:'取消',exact:true}).click();await expect(pane(page,'項目明細')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.bw-detail h3')).toHaveText(title);await expect(page.locator('.bw-detail')).toContainText('Fresh saved note');
});

for(const actual of [false,true])test(`new ${actual?'Actual':'Budget'} selects only the returned ID after save`,async({page})=>{
  const db=setup(actual);await boot(page,db);await page.getByRole('button',{name:actual?'新增實付':'新增預算',exact:true}).click();
  await form(page).getByRole('textbox',{name:'項目',exact:true}).fill('New canonical record');
  await form(page).getByRole('spinbutton',{name:'總額',exact:true}).fill('10');
  await form(page).getByRole('button',{name:'儲存',exact:true}).click();
  await expect(pane(page,'項目明細')).toHaveAttribute('aria-selected','true');await expect(page.locator('.bw-detail h3')).toHaveText('New canonical record');
  await expect(page.locator('.bw-row.is-selected')).toContainText('New canonical record');
});

test('new save without a returned ID clears selection instead of selecting an old row',async({page})=>{
  const db=setup();db.omitSaveId=true;await boot(page,db);await page.getByRole('button',{name:'JPY fare',exact:true}).click();
  await page.getByRole('button',{name:'新增預算',exact:true}).click();await form(page).getByRole('textbox',{name:'項目',exact:true}).fill('Created without response ID');
  await form(page).getByRole('spinbutton',{name:'總額',exact:true}).fill('10');await form(page).getByRole('button',{name:'儲存',exact:true}).click();
  await expect(pane(page,'項目明細')).toHaveAttribute('aria-selected','true');await expect(page.locator('.bw-detail')).toHaveCount(0);
  await expect(page.locator('.bw-row.is-selected')).toHaveCount(0);await expect(page.getByText('選取項目查看明細',{exact:true})).toBeVisible();
});

for(const code of ['40001','55P03'])test(`save ${code} retains the editor and draft`,async({page})=>{
  const db=setup();await boot(page,db);await open(page,'JPY fare');db.saveFailure={code,message:'Injected save failure'};
  await form(page).getByRole('textbox',{name:'備註'}).fill('Keep failed draft');await form(page).getByRole('button',{name:'儲存',exact:true}).click();
  await expect(form(page).getByRole('alert').first()).toBeVisible();await expect(pane(page,'編輯項目')).toHaveAttribute('aria-selected','true');
  await expect(form(page).getByRole('textbox',{name:'備註'})).toHaveValue('Keep failed draft');await expect(page.locator('.bw-detail')).toHaveCount(0);
});

test('persisted save with rejected release remains recoverable without a second financial write',async({page})=>{
  const db=setup();await boot(page,db);await open(page,'JPY fare');db.releaseFailure=true;
  await form(page).getByRole('textbox',{name:'備註'}).fill('Already committed');await form(page).getByRole('button',{name:'儲存',exact:true}).click();
  await expect(form(page).getByRole('alert').first()).toContainText('資料已儲存');expect(db.rows.budget_items[0].note).toBe('Already committed');
  db.releaseFailure=false;await form(page).getByRole('button',{name:'取消',exact:true}).click();
  await expect(pane(page,'項目明細')).toHaveAttribute('aria-selected','true');await expect(page.locator('.bw-detail')).toContainText('Already committed');expect(db.rpcs).toHaveLength(1);
});

test('remotely deleted selection falls back to detail empty state',async({page})=>{
  const db=setup();await boot(page,db);await page.getByRole('button',{name:'JPY fare',exact:true}).click();
  db.rows.budget_items=db.rows.budget_items.filter(r=>r.id!=='budget');await db.emit('budget_items');
  await expect(page.locator('.bw-row.is-selected')).toHaveCount(0);await expect(page.getByText('選取項目查看明細',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'繼續編輯此項目',exact:true})).toHaveCount(0);
});

test('Demo desktop and narrow viewport show discard confirmation and return saved content to detail',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.clock.install({time:new Date('2026-10-22T12:00:00+08:00')});
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.goto('/demo/budget');await open(page,'關西機場 → 京都巴士');
    await form(page).getByRole('textbox',{name:'備註'}).fill('Discarded note');await pane(page,'旅程統計').click();
    const prompt=page.getByRole('dialog',{name:'放棄尚未儲存的變更？',exact:true});await expect(prompt).toBeVisible();
    if(process.env.BUDGET_LIFECYCLE_QA_DIR)await page.screenshot({path:`${process.env.BUDGET_LIFECYCLE_QA_DIR}/budget-12-discard-${width}.png`});
    await prompt.getByRole('button',{name:'繼續編輯',exact:true}).click();await expect(form(page).getByRole('textbox',{name:'備註'})).toHaveValue('Discarded note');
    await pane(page,'旅程統計').click();await prompt.getByRole('button',{name:'放棄修改',exact:true}).click();await expect(form(page)).toHaveCount(0);
    await pane(page,'編輯項目').click();await expect(form(page).getByRole('textbox',{name:'備註'})).not.toHaveValue('Discarded note');
    await form(page).getByRole('textbox',{name:'備註'}).fill('Canonical saved note');await form(page).getByRole('button',{name:'儲存',exact:true}).click();
    await expect(pane(page,'項目明細')).toHaveAttribute('aria-selected','true');await expect(page.locator('.bw-detail')).toContainText('Canonical saved note');
    if(process.env.BUDGET_LIFECYCLE_QA_DIR)await page.screenshot({path:`${process.env.BUDGET_LIFECYCLE_QA_DIR}/budget-11-detail-${width}.png`});
  }
  expect(errors).toEqual([]);
});
