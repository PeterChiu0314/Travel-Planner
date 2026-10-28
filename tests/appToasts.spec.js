import {test,expect} from "@playwright/test";
import {backend,boot} from "./helpers/formalBudgetMock.js";

const toast=page=>page.locator('[data-sonner-toast]');
async function settled(page,db){await expect.poll(()=>db.reads.some(r=>r.table==='luggage_items')&&db.reads.some(r=>r.table==='shared_luggage_items')).toBe(true);await expect.poll(()=>page.evaluate(()=>window.budgetMock.inFlight)).toBe(0);await expect.poll(()=>db.snapshotReads.length).toBeGreaterThan(1);}
test.afterEach(async({page})=>{if(page.qaErrors)expect(page.qaErrors).toEqual([]);});
test('Formal REST failures do not move workspace; repeated failures update one toast and recover only after a valid snapshot',async({page})=>{
  const db=backend({leases:true});await boot(page,db);await settled(page,db);const before=await page.getByRole('table',{name:'預算明細',exact:true}).boundingBox();
  db.offline=true;await db.emit('budget_items');await expect(toast(page)).toContainText('資料同步暫時失敗');
  for(let i=0;i<3;i++)await db.emit('budget_items');
  await expect(toast(page)).toHaveCount(1);await expect(page.locator('.workspace > .notice')).toHaveCount(0);
  expect(await page.getByRole('table',{name:'預算明細',exact:true}).boundingBox()).toEqual(before);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(toast(page)).not.toContainText('已恢復');
  db.offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(toast(page)).toContainText('資料已重新核對');await expect(toast(page).getByRole('button',{name:'重新嘗試'})).toHaveCount(0);
});
test('Realtime SUBSCRIBED alone cannot hide a failed reconciliation',async({page})=>{
  const db=backend({leases:true});await boot(page,db);await settled(page,db);await page.evaluate(()=>window.budgetMock.status('CHANNEL_ERROR'));
  await expect(toast(page)).toContainText('即時連線暫時中斷');db.offline=true;
  await page.evaluate(()=>window.budgetMock.status('SUBSCRIBED'));await expect(toast(page)).toContainText('資料同步暫時失敗');
  await expect(toast(page)).not.toContainText('已恢復');db.offline=false;
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(toast(page)).toContainText('資料已重新核對');
});
test('an older full load cannot certify recovery after a newer scoped Budget read failed',async({page})=>{
  const db=backend({leases:true});await boot(page,db);await settled(page,db);
  db.hold={actor:'A',readTable:'accommodations'};await db.emit('accommodations');await expect.poll(()=>db.pending.length).toBeGreaterThan(0);
  db.offline=true;await db.emit('budget_items');await expect(toast(page)).toContainText('資料同步暫時失敗');
  db.offline=false;db.release();await expect.poll(()=>page.evaluate(()=>window.budgetMock.inFlight)).toBe(0);
  await expect(toast(page)).not.toContainText('已恢復');
  // A full-load subscription rejoin may have also failed its scoped luggage reads.
  // Retry reconciles every failed source, not just the one new Budget snapshot.
  await toast(page).getByRole('button',{name:'重新嘗試'}).click();await expect(toast(page)).toContainText('資料已重新核對');
});
test('offline has specific copy; online with a failing API is not a recovery',async({page})=>{
  const db=backend({leases:true});await boot(page,db);await settled(page,db);db.offline=true;
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});window.dispatchEvent(new Event('offline'));});
  await expect(toast(page)).toContainText('網路連線中斷');
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));});
  await expect(toast(page)).toContainText('資料同步暫時失敗');await expect(toast(page)).not.toContainText('已恢復');
  db.offline=false;await toast(page).getByRole('button',{name:'重新嘗試',exact:true}).click();await expect(toast(page)).toContainText('資料已重新核對');
});
test('payment/editor validation stays inline and logout clears previous account notifications',async({page})=>{
  const db=backend({leases:true});await boot(page,db);await page.getByRole('button',{name:'JPY fare',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();
  const form=page.getByRole('form',{name:'預算編輯',exact:true});await form.getByRole('textbox',{name:'項目',exact:true}).fill(' ');await form.getByRole('button',{name:'儲存',exact:true}).click();
  await expect(form.getByRole('alert').first()).toContainText('請填寫項目名稱');await expect(toast(page)).toHaveCount(0);
  db.offline=true;await db.emit('budget_items');await expect(toast(page)).toHaveCount(1);
  db.offline=false;await page.evaluate(()=>window.budgetMock.switchAccount('B'));await expect(toast(page)).toHaveCount(0);
});
test('failed financial save keeps its friendly inline error and input without a duplicate toast',async({page})=>{
  const db=backend({leases:true});await boot(page,db);await settled(page,db);await page.getByRole('button',{name:'JPY fare',exact:true}).click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();
  const form=page.getByRole('form',{name:'預算編輯',exact:true});db.saveFailure={message:'TypeError: Failed to fetch'};
  await form.getByRole('textbox',{name:'備註'}).fill('Keep input');await form.getByRole('button',{name:'儲存',exact:true}).click();
  await expect(form.getByRole('alert').first()).toContainText('資料同步暫時失敗');await expect(form.getByRole('textbox',{name:'備註'})).toHaveValue('Keep input');await expect(toast(page)).toHaveCount(0);
});
test('success feedback expires; persistent errors remain independently dismissible',async({page})=>{
  await page.clock.install();await page.goto('/demo/budget');
  await page.evaluate(async()=>{const {notify}=await import('/src/lib/notifications.js');notify.success('已完成');notify.error('持續錯誤');});
  await expect(toast(page)).toHaveCount(2);await page.clock.runFor(4300);await expect(toast(page)).toHaveCount(1);await expect(toast(page)).toContainText('持續錯誤');
  await toast(page).getByRole('button',{name:'關閉通知'}).click();await page.clock.runFor(400);await expect(toast(page)).toHaveCount(0);
});
test('Login uses the same friendly floating error without a displaced login panel',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/lib/supabase.js*',route=>route.fulfill({contentType:'text/javascript',body:`export const hasSupabaseConfig=true;export const supabase={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signInWithOAuth:async()=>({error:{message:'TypeError: Failed to fetch'}})}};`}));
  await page.goto('/');const panel=page.locator('.login-panel');await expect(panel).toBeVisible();const before=await panel.boundingBox();
  await page.getByRole('button',{name:'使用 Google 登入',exact:true}).click();await expect(toast(page)).toContainText('資料同步暫時失敗');await expect(toast(page)).not.toContainText('TypeError');expect(await panel.boundingBox()).toEqual(before);
  await expect(page.locator('.login-panel .notice')).toHaveCount(0);expect(errors).toEqual([]);
});
test('keyboard viewport keeps the toast above actions and long feedback scrolls within its bounds',async({page})=>{
  await page.setViewportSize({width:390,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/demo/budget');
  await page.evaluate(async()=>{Object.defineProperty(window.visualViewport,'height',{configurable:true,get:()=>400});window.visualViewport.dispatchEvent(new Event('resize'));const {notify}=await import('/src/lib/notifications.js');notify.error('很長的錯誤說明。'.repeat(80));});
  const box=await toast(page).boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(301);expect(box.height).toBeLessThanOrEqual(201);
  const button=await toast(page).getByRole('button',{name:'關閉通知'}).boundingBox();expect(button.x+button.width).toBeLessThan(box.x+box.width+1);
  await toast(page).getByRole('button',{name:'關閉通知'}).click();await expect(toast(page)).toHaveCount(0);
});
for(const width of [1440,390])test(`Demo ${width}px stacks semantic toasts without API calls or covering navigation; keyboard and reduced motion work`,async({page})=>{
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>{if(/https?:\/\/[^/]*\.supabase\.co|\/auth\/v1|\/rest\/v1|\/realtime\/v1/.test(r.url()))requests.push(r.url());});
  await page.setViewportSize({width,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/demo/budget');
  const search=page.getByRole('textbox',{name:'搜尋項目',exact:true});await search.focus();const box=await page.locator('.workspace').boundingBox();
  await page.evaluate(async()=>{const {notify}=await import('/src/lib/notifications.js');notify.info('資訊提示');notify.warning('警告提示');notify.error('操作失敗，內容已保留。');});
  await expect(toast(page)).toHaveCount(3);await expect(search).toBeFocused();expect(await page.locator('.workspace').boundingBox()).toEqual(box);
  await expect(page.getByRole('region',{name:'通知（Alt+T）',exact:true})).toHaveAttribute('aria-live','polite');
  expect(await toast(page).first().evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0s');
  if(width===390){const nav=await page.locator('.bottom-nav').boundingBox();const last=await toast(page).last().boundingBox();expect(last.y+last.height).toBeLessThan(nav.y-10);}
  if(process.env.TOAST_QA_DIR)await page.screenshot({path:`${process.env.TOAST_QA_DIR}/toast-${width}.png`});
  await page.keyboard.press('Alt+t');await expect(page.locator('[data-sonner-toaster]')).toBeFocused();await page.keyboard.press('Escape');await expect(search).toBeFocused();
  await toast(page).last().getByRole('button',{name:'關閉通知'}).click();await expect(toast(page)).toHaveCount(2);
  expect(requests).toEqual([]);expect(errors).toEqual([]);
});
