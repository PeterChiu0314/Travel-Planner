import {test,expect} from '@playwright/test';
import {metadataBackend,boot,enableMetadata} from './helpers/budgetMetadataMock.js';
const editor=p=>p.getByRole('region',{name:'預算群組編輯'});
const title=p=>editor(p).getByRole('textbox',{name:'項目名稱',exact:true});
const note=p=>editor(p).getByRole('textbox',{name:'備註',exact:true});
async function ready(page,db,actor='A'){await enableMetadata(page);await boot(page,db,actor);await page.getByRole('button',{name:'JPY fare',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();await expect(title(page)).toBeVisible();}
async function noSyncUi(page){
 await expect(editor(page).locator('.bw-sync-status,.bw-metadata-status,.bw-metadata-actions')).toHaveCount(0);
 await expect(page.getByText(/尚有變更未同步|連線尚未確認，變更已保留/)).toHaveCount(0);
 await expect(editor(page).getByRole('button',{name:/^重試$|捨棄此欄草稿|確認儲存結果/})).toHaveCount(0);
}
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});

test('normal admission, held autosave, two-user independent saves, blur and confirmed convergence stay silent',async({page,context})=>{
 const db=metadataBackend();db.extendedMetadata=true;db.pricingMetadata=true;await ready(page,db);const peer=await context.newPage();
 try{await ready(peer,db,'B');await title(page).focus();await expect(title(page)).toBeEditable();await note(peer).focus();await expect(note(peer)).toBeEditable();
  await noSyncUi(page);await noSyncUi(peer);db.metadataHold={actor:'A',action:'patch'};await title(page).fill('Quiet title');await note(peer).fill('Quiet note');
  await expect.poll(()=>db.metadataPending.length).toBe(1);await expect.poll(()=>db.rows.budget_items[0].note).toBe('Quiet note');await noSyncUi(page);await noSyncUi(peer);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);await expect(peer.locator('[data-sonner-toast]')).toHaveCount(0);
  db.releaseMetadata();await expect.poll(()=>db.rows.budget_items[0].title).toBe('Quiet title');await title(page).blur();await note(peer).blur();
  await expect.poll(()=>[...db.groupStates.values()].filter(g=>g.actor).length).toBe(0);await noSyncUi(page);await noSyncUi(peer);await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);expect(peer.qaErrors).toEqual([]);
  await page.screenshot({path:test.info().outputPath('quiet-autosave.png')});
 }finally{db.releaseMetadata();await peer.close();}
});

test('one outage affecting two fields produces one Toast and keeps both drafts plus the page leave guard',async({page})=>{
 const db=metadataBackend();await ready(page,db);db.patchError={code:'XX000',message:'server unavailable'};
 await title(page).focus();await expect(title(page)).toBeEditable();await title(page).fill('Retained title');await expect.poll(()=>db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group').length).toBe(1);
 await note(page).focus();await expect(note(page)).toBeEditable();await note(page).fill('Retained note');await expect.poll(()=>new Set(db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group').map(c=>c.args.p_group)).size).toBe(2);
 await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);await noSyncUi(page);await expect(title(page)).toHaveValue('Retained title');await expect(note(page)).toHaveValue('Retained note');
 await page.getByRole('button',{name:'關閉編輯',exact:true}).click();await expect(page.getByRole('dialog',{name:'您有未儲存的變更'})).toBeVisible();await page.getByRole('button',{name:'繼續編輯',exact:true}).click();
 db.patchError=null;await expect.poll(()=>db.rows.budget_items[0].title,{timeout:12000}).toBe('Retained title');await expect.poll(()=>db.rows.budget_items[0].note,{timeout:12000}).toBe('Retained note');await noSyncUi(page);
 for(const group of ['title','note']){const calls=db.groupCalls.filter(c=>c.name==='patch_budget_metadata_group'&&c.args.p_group===group);expect(calls.length).toBeGreaterThanOrEqual(2);expect(new Set(calls.map(c=>c.args.p_request_id)).size).toBe(1);}
});

test('offline uses existing global Toast and keeps the draft without an editor banner; reconnect safely converges',async({page})=>{
 const db=metadataBackend();await ready(page,db);await title(page).focus();await expect(title(page)).toBeEditable();await title(page).fill('Offline retained');db.offline=true;
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'));});
 await expect(title(page)).not.toBeEditable();await expect(title(page)).toHaveValue('Offline retained');await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);await noSyncUi(page);
 expect(db.rows.budget_items[0].title).toBe('JPY fare');db.offline=false;
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));});
 await expect.poll(()=>db.rows.budget_items[0].title,{timeout:12000}).toBe('Offline retained');await noSyncUi(page);
});
