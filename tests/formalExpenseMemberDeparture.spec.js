import { test, expect } from '@playwright/test';
import { boot } from './helpers/expenseBackend.js';
import { departureFixture } from './helpers/expenseDepartureFixture.js';

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
