// Local mocked frontend regression only; not Supabase service acceptance.
import {test,expect} from '@playwright/test';
import {receiptFixture,boot,enableReceipts} from './helpers/budgetReceiptMock.js';
for(const groups of [false,true])test(`Receipt release pause closes ${groups?'group':'legacy'} upload path`,async({page})=>{
 const db=receiptFixture(),before=structuredClone(db.rows);
 await enableReceipts(page,{disabled:true,groups});await boot(page,db);
 await page.getByRole('button',{name:/Receipt Actual · NT/}).click();
 await page.getByRole('tab',{name:'項目明細',exact:true}).click();
 await expect(page.getByText('收據功能暫未開放。')).toHaveCount(0);
 await expect(page.locator('.attachment-heading input[type=file],.attachment-upload input')).toHaveCount(0);
 expect(db.receiptStorageCalls).toHaveLength(0);expect(db.storageCalls).toHaveLength(0);
 expect(db.receiptCalls.filter(c=>/lease|begin|commit|cleanup/.test(c.name))).toHaveLength(0);
 expect(db.rows.actual_expenses).toEqual(before.actual_expenses);expect(db.rows.attachments).toEqual(before.attachments);
 expect(page.qaErrors||[]).toEqual([]);
});
