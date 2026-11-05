import {test,expect} from '@playwright/test';
import {metadataBackend,boot,enableMetadata} from './helpers/budgetMetadataMock.js';
const title=p=>p.getByRole('textbox',{name:'項目名稱',exact:true});
const note=p=>p.getByRole('textbox',{name:'備註',exact:true});
const titleGroup=p=>p.locator('.bw-metadata-group').filter({has:title(p)});
async function ready(page,db,actor='A'){
 await enableMetadata(page);await boot(page,db,actor);
 await page.getByRole('button',{name:'JPY fare',exact:true}).click();
 await page.getByRole('tab',{name:'編輯項目',exact:true}).click();await expect(title(page)).toBeVisible();
}
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});
test('peer denied admission after focus switches does not strand release and peer can later edit',async({page,context})=>{
 const db=metadataBackend();await ready(page,db);await title(page).focus();await expect(title(page)).toBeEditable();const peer=await context.newPage();
 try{await ready(peer,db,'B');db.metadataHold={actor:'B',action:'acquire'};await title(peer).focus();await expect.poll(()=>db.metadataPending.length).toBe(1);await note(peer).focus();db.releaseMetadata();
 await expect(titleGroup(peer).getByText('尚未確認權限釋放，請重試結束編輯。',{exact:true})).toHaveCount(0);
 await note(page).focus();await expect.poll(()=>db.groupStates.get('budget:budget:title').actor).toBe(null);
 await title(peer).focus();await expect(title(peer)).toBeEditable();await title(peer).fill('Peer recovered');await expect.poll(()=>db.rows.budget_items[0].title).toBe('Peer recovered');expect(peer.qaErrors).toEqual([]);
 }finally{db.releaseMetadata();await peer.close();}
});
test('failed release exposes an enabled retry and recovers through the visible control',async({page})=>{
 const db=metadataBackend();await ready(page,db);await title(page).focus();await expect(title(page)).toBeEditable();db.releaseFailure=true;await note(page).focus();
 await expect(titleGroup(page).getByRole('alert')).toContainText('尚未確認權限釋放');const retry=titleGroup(page).getByRole('button',{name:'重試',exact:true});await expect(retry).toBeEnabled();
 db.releaseFailure=false;await retry.click();await expect(titleGroup(page).getByRole('alert')).toHaveCount(0);await title(page).focus();await expect(title(page)).toBeEditable();await title(page).fill('Visible retry recovered');await expect.poll(()=>db.rows.budget_items[0].title).toBe('Visible retry recovered');
 await page.screenshot({path:test.info().outputPath('issue16-release-recovered.png'),fullPage:false});
});
test('immediate refocus during a delayed release waits then reacquires only that group',async({page})=>{
 const db=metadataBackend();await ready(page,db);await title(page).focus();await expect(title(page)).toBeEditable();db.metadataHold={actor:'A',action:'release'};await note(page).focus();await expect.poll(()=>db.metadataPending.length).toBe(1);await title(page).focus();
 db.releaseMetadata();await expect(title(page)).toBeEditable();await title(page).fill('Immediate refocus recovered');await expect.poll(()=>db.rows.budget_items[0].title).toBe('Immediate refocus recovered');
 expect(db.groupCalls.filter(c=>c.args.p_action==='release'&&c.args.p_group==='title')).toHaveLength(1);
});
