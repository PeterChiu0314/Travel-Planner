import { test, expect } from '@playwright/test';
import { boot } from './helpers/expenseBackend.js';
import { departureFixture } from './helpers/expenseDepartureFixture.js';

const budgetRow=(page,title)=>page.getByRole('row').filter({has:page.getByRole('button',{name:title,exact:true})});
const membersDialog=page=>page.locator('.members-dialog');
const openMembers=page=>page.getByRole('button',{name:/^\d+ 位成員$/}).click();

test('owner approval from the member dialog updates unpaid splits in both accounts before opening any editor',async({page,context})=>{
  const f=await departureFixture({pending:true});
  const peer=await context.newPage();
  try{
    const participants=[f.A,f.B];
    const split=await f.seed('核准均分',{participantIds:participants});
    await f.seed('核准每人計價',{participantIds:participants,pricing_mode:'per_person',unit_amount:300});
    await f.seed('核准自訂',{participantIds:participants,pricing_mode:'custom',shares:{[f.A]:500,[f.B]:400}});
    await boot(page,f.db,f.A);
    await boot(peer,f.db,f.B);
    for(const p of [page,peer]) await expect(budgetRow(p,'核准均分').locator('.bw-person')).toHaveText('450');

    await openMembers(page);
    await membersDialog(page).getByRole('button',{name:'核准',exact:true}).click();
    await expect(membersDialog(page).getByRole('button',{name:'Charlie 角色操作',exact:true})).toBeVisible();
    await membersDialog(page).getByRole('button',{name:'關閉',exact:true}).click();

    const assertRows=async(p,share)=>{
      await expect(budgetRow(p,'核准均分').locator('.bw-person')).toHaveText('300');
      await expect(budgetRow(p,'核准每人計價').getByRole('button',{name:'900',exact:true})).toBeVisible();
      await expect(budgetRow(p,'核准自訂').locator('.bw-person')).toHaveText(share);
    };
    for(const [p,share] of [[page,'500'],[peer,'400']]){
      await assertRows(p,share);
      await p.reload();
      await assertRows(p,share);
      expect(p.qaErrors).toEqual([]);
    }
    const after=await f.snapshot();
    expect(after.participants.find(p=>p.expense_id===split&&p.user_id===f.C)?.budget_share_amount).toBe(300);
    expect(after.participants.find(p=>p.expense_id===split&&p.user_id===f.D)?.budget_selected).toBe(false);
    expect(f.db.expenseCalls.filter(call=>call.name==='mutate_expense_group')).toHaveLength(0);
  }finally{await page.close();await peer.close();await f.close();}
});

test('custom shares saved by the editor are matched to the removed member before both accounts reload',async({page,context})=>{
  const f=await departureFixture();
  const peer=await context.newPage();
  try{
    const id=await f.seed('表單自訂分攤',{});
    const paid=await f.seed('歷史付款',{}, {paid:true,payer:f.C});
    const initial=await f.snapshot();
    await boot(page,f.db,f.A);
    await boot(peer,f.db,f.B);
    await budgetRow(page,'表單自訂分攤').getByRole('button',{name:'表單自訂分攤',exact:true}).click();
    await page.getByRole('tab',{name:'編輯項目',exact:true}).click();
    const editor=page.getByRole('region',{name:'支出項目編輯'});
    await editor.getByRole('button',{name:'自訂分攤',exact:true}).click();
    for(const [name,amount] of [['A','400'],['B','300'],['Charlie','200']]){
      const share=editor.getByRole('spinbutton',{name:`${name} 分攤金額`,exact:true});
      await share.focus();
      await expect(share).toBeEditable();
      await share.fill(amount);
    }
    await expect(editor.getByRole('spinbutton',{name:'總額',exact:true})).toHaveValue('900');
    await page.getByRole('tab',{name:'項目明細',exact:true}).click();
    const shares=rows=>Object.fromEntries(rows.filter(p=>p.expense_id===id&&p.budget_selected).map(p=>[p.user_id,p.budget_share_amount]));
    const expected={[f.A]:400,[f.B]:300,[f.C]:200};
    await expect.poll(async()=>shares((await f.snapshot()).participants)).toEqual(expected);
    await f.sql.exec('reset role');
    const receipt=(await f.sql.query("select result from expense_stage_b.receipts where result->>'expense_id'=$1 and result->>'group'='budget' order by (result->>'revision')::bigint desc limit 1",[id])).rows[0].result;
    expect(shares(receipt.participants)).toEqual(expected);
    await expect(budgetRow(peer,'表單自訂分攤').locator('.bw-person')).toHaveText('300');

    await openMembers(page);
    await membersDialog(page).getByRole('button',{name:'Charlie 角色操作',exact:true}).click();
    page.once('dialog',dialog=>dialog.accept());
    await membersDialog(page).getByRole('menuitem',{name:'移除成員',exact:true}).click();
    await expect(membersDialog(page).getByRole('button',{name:'Charlie 角色操作',exact:true})).toHaveCount(0);
    await membersDialog(page).getByRole('button',{name:'關閉',exact:true}).click();

    for(const [p,amount] of [[page,'500'],[peer,'400']]){
      await expect(budgetRow(p,'表單自訂分攤').locator('.bw-person')).toHaveText(amount);
      await p.reload();
      await expect(budgetRow(p,'表單自訂分攤').locator('.bw-person')).toHaveText(amount);
      await expect(budgetRow(p,'表單自訂分攤').getByRole('button',{name:'900',exact:true})).toBeVisible();
      expect(p.qaErrors).toEqual([]);
    }
    const after=await f.snapshot();
    expect(shares(after.participants)).toEqual({[f.A]:500,[f.B]:400});
    expect(after.participants.find(p=>p.expense_id===id&&p.user_id===f.D)?.budget_selected).toBe(false);
    expect(after.items.find(item=>item.id===paid)).toEqual(initial.items.find(item=>item.id===paid));
    expect(after.participants.filter(p=>p.expense_id===paid)).toEqual(initial.participants.filter(p=>p.expense_id===paid));
  }finally{await page.close();await peer.close();await f.close();}
});

test('two accounts converge after member removal and show the same historical settlement after reload',async({page,context})=>{
  const f=await departureFixture();
  const peer=await context.newPage();
  try {
    await f.seed('未付款交通',{});
    await f.seed('需重選的車票',{participantIds:[f.C]});
    await f.seed('需重選的代付',{}, {payer:f.C});
    await f.seed('歷史代付',{}, {paid:true,payer:f.C});
    await boot(page,f.db,f.A);
    await boot(peer,f.db,f.B);
    const row=p=>p.getByRole('row').filter({hasText:'未付款交通'});
    for(const p of [page,peer]) await expect(row(p).locator('.bw-person')).toHaveText('300');

    expect(await f.remove([f.C])).toBe(1);
    for(const p of [page,peer]) {
      await expect(row(p).locator('.bw-person')).toHaveText('450');
      await p.reload();
      await expect(row(p).locator('.bw-person')).toHaveText('450');
      const pending=p.getByRole('row').filter({hasText:'需重選的車票'});
      await expect(pending).toContainText('需指定參與者');
      await pending.getByRole('button',{name:'需重選的車票',exact:true}).click();
      await expect(p.getByRole('button',{name:'付款狀態',exact:true})).toBeDisabled();
      await p.getByRole('button',{name:'需重選的代付',exact:true}).click();
      await expect(p.getByText('請重新指定付款人，再標記已付款。')).toBeVisible();
      await expect(p.getByRole('button',{name:'付款狀態',exact:true})).toBeDisabled();
      await p.getByRole('button',{name:'分帳結算',exact:true}).click();
      await expect(p.locator('.settlement-row').filter({hasText:'Charlie（已退出）'})).toContainText('600');
      await expect(p.locator('.transfer-row')).toHaveCount(2);
      await expect(p.locator('.transfer-row').first()).toContainText('Charlie（已退出）');
      expect(p.qaErrors).toEqual([]);
    }
  } finally { await page.close();await peer.close();await f.close(); }
});
