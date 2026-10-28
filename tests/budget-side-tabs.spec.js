import { expect, test } from "@playwright/test";
const sideTab=(page,name)=>page.getByRole('tablist',{name:'右側面板',exact:true}).getByRole('tab',{name,exact:true});
const item=(page,name)=>page.locator('.bw-row').getByRole('button',{name,exact:true});
test.beforeEach(async({page})=>{await page.clock.install({time:new Date('2026-10-22T12:00:00+08:00')});await page.goto('/demo/budget');});

test('Demo sidebar exit confirms dirty discard and reopens canonical data',async({page})=>{
  await sideTab(page,'編輯項目').click();await expect(page.getByText('選取項目開始編輯',{exact:true})).toBeVisible();
  await item(page,'關西機場 → 京都巴士').click();const form=page.getByRole('form',{name:'預算編輯'});
  await expect(form.getByLabel('項目',{exact:true})).toHaveValue('關西機場 → 京都巴士');
  await form.getByLabel('備註',{exact:true}).fill('編輯頁籤草稿');
  await sideTab(page,'項目明細').click();const prompt=page.getByRole('dialog',{name:'放棄尚未儲存的變更？',exact:true});
  await expect(prompt).toBeVisible();await prompt.getByRole('button',{name:'繼續編輯',exact:true}).click();
  await expect(form.getByLabel('備註',{exact:true})).toHaveValue('編輯頁籤草稿');
  await sideTab(page,'項目明細').click();await prompt.getByRole('button',{name:'放棄修改',exact:true}).click();
  await expect(form).toHaveCount(0);await expect(page.locator('.bw-detail h3')).toHaveText('關西機場 → 京都巴士');
  await sideTab(page,'旅程統計').click();await expect(page.getByLabel('旅程費用摘要')).toBeVisible();
  await sideTab(page,'編輯項目').click();await expect(form.getByLabel('備註',{exact:true})).not.toHaveValue('編輯頁籤草稿');
  await form.getByRole('button',{name:'儲存',exact:true}).click();await expect(sideTab(page,'項目明細')).toHaveAttribute('aria-selected','true');
  await item(page,'租車加油').click();await sideTab(page,'編輯項目').click();await expect(form.getByLabel('項目',{exact:true})).toHaveValue('租車加油');
  await form.getByRole('button',{name:'取消',exact:true}).click();await expect(sideTab(page,'項目明細')).toHaveAttribute('aria-selected','true');
});

test('deselecting retains the chosen detail, edit or stats tab instead of redirecting',async({page})=>{
  await sideTab(page,'項目明細').click();await item(page,'租車加油').click();await item(page,'租車加油').click();
  await expect(sideTab(page,'項目明細')).toHaveAttribute('aria-selected','true');await expect(page.getByText('選取項目查看明細',{exact:true})).toBeVisible();
  await sideTab(page,'編輯項目').click();await item(page,'租車加油').click();await item(page,'租車加油').click();
  await expect(sideTab(page,'編輯項目')).toHaveAttribute('aria-selected','true');await expect(page.getByText('選取項目開始編輯',{exact:true})).toBeVisible();
  await sideTab(page,'旅程統計').click();await item(page,'租車加油').click();await expect(sideTab(page,'旅程統計')).toHaveAttribute('aria-selected','true');await expect(page.getByLabel('旅程費用摘要')).toBeVisible();
  await item(page,'租車加油').click();await expect(sideTab(page,'旅程統計')).toHaveAttribute('aria-selected','true');
});

test('switching rows in the edit tab resolves dirty changes before replacing the form',async({page})=>{
  await sideTab(page,'編輯項目').click();await item(page,'租車加油').click();const form=page.getByRole('form',{name:'預算編輯'});
  await form.getByLabel('備註',{exact:true}).fill('切換前保護');await item(page,'停車費').click();
  const guard=page.getByRole('dialog',{name:'您有未儲存的變更'});await expect(guard).toBeVisible();await guard.getByRole('button',{name:'不儲存',exact:true}).click();
  await expect(form.getByLabel('項目',{exact:true})).toHaveValue('停車費');await expect(sideTab(page,'編輯項目')).toHaveAttribute('aria-selected','true');
});

test('edit tab respects viewer permissions and surfaces existing edit locks',async({page})=>{
  for (const [flag,message] of [['viewer','目前沒有編輯權限'],['locked','其他成員正在編輯此項目。']]) {
    await page.goto(`/tests/harness/budget-safety.html?${flag}=1`);
    await page.getByRole('tab',{name:'預算',exact:true}).click();
    await item(page,'舊外幣預算').click();await sideTab(page,'編輯項目').click();
    await expect(page.getByText(message,{exact:true})).toBeVisible();await expect(page.getByRole('form',{name:'預算編輯'})).toHaveCount(0);
    await expect(page.getByTestId('rpc-contract')).toHaveText('[]');
  }
});
