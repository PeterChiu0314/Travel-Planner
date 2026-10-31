import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {metadataBackend,boot,enableMetadata} from './helpers/budgetMetadataMock.js';
import {paymentBackend} from './helpers/budgetPaymentMock.js';
const screenshots=process.env.B7_FORWARD_SCREENSHOT_DIR||'test-results/b7-forward-ui';
// Controlled browser regression only. Existing module interception provides a
// fake DTO/config; no tracked flags, DB protocols or real Auth are enabled.
test.afterEach(async({page})=>{expect(page.qaErrors||[]).toEqual([]);});
async function open(page,db){await enableMetadata(page);await boot(page,db);await page.getByRole('button',{name:'JPY fare',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();}
for(const code of ['PT409','PT500'])test(`Forward browser ${code} autosave preserves the rendered draft and does not retry`,async({page})=>{
 const db=metadataBackend(),original=db.request.bind(db),calls=[];
 db.request=async r=>{if(r.op==='rpc'&&r.name.startsWith('patch_budget_metadata_group')){calls.push(structuredClone(r));return {error:{code,message:code==='PT409'?'group_conflict':'unfinished_group_patch'}};}return original(r);};
 await open(page,db);const title=page.getByRole('textbox',{name:'項目名稱',exact:true});await title.click();await title.fill(`Protected ${code} draft`);await title.blur();
 await expect(page.getByRole('region',{name:'預算群組編輯'})).toContainText(code==='PT409'?'此欄位已更新':'unfinished_group_patch');await expect(title).toHaveValue(`Protected ${code} draft`);expect(db.rows.budget_items[0].title).toBe('JPY fare');expect(calls).toHaveLength(1);
 await page.waitForTimeout(250);expect(calls).toHaveLength(1);await expect(page.locator('vite-error-overlay')).toHaveCount(0);await fs.mkdir(screenshots,{recursive:true});await page.screenshot({path:`${screenshots}/b7-forward-${code}-draft.png`,fullPage:false});
});
test('Forward browser PT409 Payment refusal permits an explicit new operation and commits exactly once',async({page})=>{
 const db=paymentBackend();db.paymentError={code:'PT409',message:'payment_dependency_changed'};await enableMetadata(page);await boot(page,db);await page.getByRole('button',{name:'JPY fare',exact:true}).click();await page.getByRole('tab',{name:'項目明細',exact:true}).click();const toggle=page.getByRole('button',{name:'付款狀態',exact:true});await toggle.click();
 await expect(page.getByText('payment_dependency_changed',{exact:false}).first()).toBeVisible();expect(db.rows.actual_expenses||[]).toHaveLength(0);const rejected=db.paymentCalls.filter(r=>r.name.startsWith('mutate_budget_payment'));expect(rejected).toHaveLength(1);await expect(toggle).toBeEnabled();
 db.paymentError=null;await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');await expect(toggle).toBeEnabled();expect(db.rows.actual_expenses).toHaveLength(1);const calls=db.paymentCalls.filter(r=>r.name.startsWith('mutate_budget_payment'));expect(calls).toHaveLength(2);expect(calls[1].args.p_request_id).not.toBe(calls[0].args.p_request_id);await page.screenshot({path:`${screenshots}/b7-forward-payment-recovered.png`,fullPage:false});
});
