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
test('failed release recovers in the background without field actions',async({page})=>{
 const db=metadataBackend();await ready(page,db);await title(page).focus();await expect(title(page)).toBeEditable();db.releaseFailure=true;await note(page).focus();
 await expect(page.getByRole('status',{name:'預算同步狀態'})).toBeVisible();await expect(titleGroup(page).getByRole('button',{name:'重試',exact:true})).toHaveCount(0);
 db.releaseFailure=false;await expect.poll(()=>db.groupStates.get('budget:budget:title').actor,{timeout:10000}).toBe(null);await title(page).focus();await expect(title(page)).toBeEditable();await title(page).fill('Background recovered');await expect.poll(()=>db.rows.budget_items[0].title).toBe('Background recovered');
 await page.screenshot({path:test.info().outputPath('issue16-release-recovered.png'),fullPage:false});
});
test('immediate refocus during a delayed release waits then reacquires only that group',async({page})=>{
 const db=metadataBackend();await ready(page,db);await title(page).focus();await expect(title(page)).toBeEditable();db.metadataHold={actor:'A',action:'release'};await note(page).focus();await expect.poll(()=>db.metadataPending.length).toBe(1);await title(page).focus();
 db.releaseMetadata();await expect(title(page)).toBeEditable();await title(page).fill('Immediate refocus recovered');await expect.poll(()=>db.rows.budget_items[0].title).toBe('Immediate refocus recovered');
 expect(db.groupCalls.filter(c=>c.args.p_action==='release'&&c.args.p_group==='title')).toHaveLength(1);
});
