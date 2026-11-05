import {test,expect} from '@playwright/test';
import {metadataBackend,boot,enableMetadata} from './helpers/budgetMetadataMock.js';

const title=p=>p.getByRole('textbox',{name:'項目名稱',exact:true});
const group=(p,name)=>p.locator('.bw-metadata-group').filter({has:p.locator(`[name="${name}"]`)});
const style=control=>control.evaluate(el=>{const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor,opacity:s.opacity};});
async function ready(page){
 const db=metadataBackend();db.extendedMetadata=true;db.pricingMetadata=true;
 await enableMetadata(page);await boot(page,db);
 await page.getByRole('button',{name:'JPY fare',exact:true}).click();
 await page.getByRole('tab',{name:'編輯項目',exact:true}).click();
 await expect(title(page)).toBeVisible();return db;
}
const controls=p=>[title(p),p.getByRole('textbox',{name:'備註',exact:true}),p.getByRole('combobox',{name:'分類',exact:true}),p.getByRole('combobox',{name:'付款人',exact:true}),p.getByRole('spinbutton',{name:'總額',exact:true})];
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});

test('unclaimed and own fields keep the same normal appearance without admission hints',async({page})=>{
 const db=await ready(page),fields=controls(page),before=await Promise.all(fields.map(style));
 expect(db.groupCalls).toHaveLength(0);
 await expect(page.getByRole('button',{name:'編輯完整項目',exact:true})).toHaveCount(0);
 await expect(page.locator('.bw-metadata-group.is-readonly')).toHaveCount(0);
 await expect(page.getByText('聚焦後取得編輯權',{exact:true})).toHaveCount(0);
 await expect(page.getByText('可編輯',{exact:true})).toHaveCount(0);
 const pricing=page.getByRole('group',{name:'計價與分攤',exact:true});
 await expect(pricing.locator('.bw-modes button').first()).toBeDisabled();
 await expect(pricing.locator('.bw-modes button').first()).toHaveCSS('opacity','1');
 await expect(pricing.locator('.bw-participants input[type=checkbox]').first()).toHaveCSS('opacity','1');
 for(const [i,control] of fields.entries()){
  await control.focus();
  if(i===3)await expect(control).not.toHaveAttribute('aria-readonly','true');else await expect(control).toBeEditable();
  await expect.poll(()=>style(control)).toEqual(before[i]);
  await expect(control.locator('xpath=ancestor::div[contains(@class,"bw-metadata-group")]').first()).not.toHaveClass(/is-readonly/);
 }
 await page.screenshot({path:test.info().outputPath('normal-fields.png'),fullPage:false});
});

test('peer-held groups keep normal controls, share collaborator outlines and name the editor on focus',async({page})=>{
 const db=await ready(page),fields=controls(page),normal=await Promise.all(fields.map(style));
 for(const s of db.groupStates.values())Object.assign(s,{actor:'B',session:'peer-tab',expires:db.now+60000});
 await db.emit('budget_items');
 for(const label of ['項目名稱','備註','分類','付款人','計價與分攤']){
  const frame=page.getByRole('group',{name:label,exact:true});
  await frame.locator('input:not(:disabled),textarea,button:not(:disabled)').first().focus();
  await expect(page.getByRole('tooltip').filter({hasText:`B 正在編輯${label}`})).toBeVisible();
  await expect(frame.locator('.bw-collaboration-outline')).toHaveAttribute('data-user','B');
 }
 for(const [i,control] of fields.entries()){
  if(i===4)await expect(control).toHaveAttribute('readonly','');else await expect(control).toHaveAttribute('aria-readonly','true');
  expect((await style(control)).background).toEqual(normal[i].background);
 }
 await title(page).focus();await title(page).press('x');
 await expect(title(page)).toHaveValue('JPY fare');
 expect(db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group')).toHaveLength(0);
 await page.screenshot({path:test.info().outputPath('peer-fields.png'),fullPage:false});
});

test('admission and saving stay silent at field level and preserve the page unsynced state',async({page})=>{
 const db=await ready(page),normal=await style(title(page));
 db.metadataHold={actor:'A',action:'acquire'};await title(page).focus();
 await expect(title(page)).toHaveAttribute('aria-busy','true');
 await expect(page.locator('.bw-metadata-status,.bw-metadata-actions')).toHaveCount(0);
 expect(await style(title(page))).toEqual(normal);
 await title(page).fill('Appearance draft');db.releaseMetadata();
 db.metadataHold={actor:'A',action:'patch'};
 await expect(page.getByRole('status',{name:'預算同步狀態'})).toContainText('未同步');
 await expect(group(page,'title').getByRole('alert')).toHaveCount(0);
 expect(await style(title(page))).toEqual(normal);
 db.releaseMetadata();await expect.poll(()=>db.rows.budget_items[0].title).toBe('Appearance draft');
});
