import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {expect,chromium} from '@playwright/test';
import {project} from './staging-budget-acceptance-scope.mjs';
import {qaDeadline} from './b7-real-response-gate.mjs';
import {isPostgresChangesReady} from '../../src/lib/realtimePostgresReadiness.js';

export function observedRealtimeReady(payload,trip){
 try{const d=JSON.parse(typeof payload==='string'?payload:payload.toString()),m=Array.isArray(d)?{topic:d[2],event:d[3],payload:d[4]}:d;return m.topic===`realtime:trip-${trip}`&&m.event==='system'&&isPostgresChangesReady(m.payload);}catch{return false;}
}

export function observedRealtimeSignal(payload,trip,actor){
 try{const decoded=JSON.parse(typeof payload==='string'?payload:payload.toString()),message=Array.isArray(decoded)?{event:decoded[3],payload:decoded[4]}:decoded,data=message.payload?.data,record=data?.record;
  if(message.event==='postgres_changes'&&data.schema==='public'&&data.table==='budget_collaboration_signals'&&record?.trip_id===trip&&Number.isSafeInteger(Number(record.revision)))return {actor,revision:Number(record.revision),receivedAt:Date.now()};
 }catch{}return null;
}

export async function browserCases(r){
 const {check,api,trip,sessions}=r;
 assert.equal(r.browserUrl,'http://127.0.0.1:5189');
 r.browser=await chromium.launch({channel:'chrome',headless:false});r.contexts=[];r.pages=[];r.browserRequests=[];r.browserErrors=[];r.realtimeSignals=[];r.realtimeReady=new Set();
 for(const [i,session] of sessions.entries()){
  const context=await r.browser.newContext({viewport:{width:1440,height:1000},locale:'zh-TW',serviceWorkers:'block'});r.contexts.push(context);
  // Abort target mistakes before credentials leave the machine. No mock response.
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','open.er-api.com',`${project}.supabase.co`].includes(u.hostname)||u.protocol==='data:')return route.continue();r.browserErrors.push({kind:'unexpected-host',host:u.hostname});return route.abort();});
  await context.addInitScript(({session,project,trip})=>{if(location.hostname!=='127.0.0.1')return;const key=`qa-acceptance-seeded:${session.user.id}`;if(!localStorage.getItem(key)){localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify(session));localStorage.setItem(key,'true');}if(!localStorage.getItem(`travel-planner-session-context:${session.user.id}`))localStorage.setItem(`travel-planner-session-context:${session.user.id}`,JSON.stringify({activeTripId:trip,activeSection:'budget',activeDay:0,luggageTab:'personal',updatedAt:new Date().toISOString()}));},{session,project,trip});
  const page=await context.newPage();r.pages.push(page);
  // Observe the product's own authenticated socket, never outbound auth frames
  // or a second stand-alone client with different initialization behavior.
  page.on('websocket',socket=>{socket.on('framereceived',frame=>{if(observedRealtimeReady(frame.payload,trip))r.realtimeReady.add(i);const signal=observedRealtimeSignal(frame.payload,trip,i);if(signal)r.realtimeSignals.push(signal);});socket.on('close',()=>r.realtimeReady.delete(i));});
  page.on('pageerror',()=>r.browserErrors.push({kind:'pageerror',actor:i}));
  page.on('request',req=>{const u=new URL(req.url());if(u.hostname===`${project}.supabase.co`)r.browserRequests.push({actor:i,method:req.method(),path:u.pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi,':id')});});
  await page.goto(r.browserUrl);await expect(page.getByRole('button',{name:'新增預算',exact:true})).toBeVisible();
  await expect(page.getByText(r.tripName,{exact:true}).first()).toBeVisible();
 }
 const [a,b,c]=r.pages;
 const canonical=async()=>(await api.snap()).budgetItems.find(z=>z.id===r.budget);
 const field=(page,name='項目名稱')=>page.getByRole('textbox',{name,exact:true});
 const edit=async(page,name='項目名稱')=>{if(!await field(page).count()){const button=page.getByRole('button',{name:(await canonical()).title,exact:true}),row=page.locator('.bw-row').filter({has:button});if(!(await row.getAttribute('class')).split(/\s+/).includes('is-selected'))await button.click();await page.getByRole('tab',{name:'編輯項目',exact:true}).click();}const t=field(page,name);await t.click();await expect(t).toBeEditable();return t;};
 const close=async page=>{await page.getByRole('button',{name:'關閉編輯',exact:true}).click();await expect(field(page)).toHaveCount(0);};
 await check('B02',async()=>{const t=await edit(a);await t.fill(`QA UI autosaved ${r.run.slice(0,8)}`);await t.blur();await expect.poll(async()=>(await canonical()).title).toBe(await t.inputValue());const n=await edit(a,'備註');await n.fill('QA real UI note');await n.blur();await expect.poll(async()=>(await canonical()).note).toBe('QA real UI note');await close(a);return {realUiToHttp:true};});
 await check('A04',async()=>{for(const name of ['項目名稱','備註']){const t=await edit(a,name),before=await t.inputValue();await t.press('End');await a.keyboard.insertText('native input');await expect(t).toHaveValue(before+'native input');await a.keyboard.press('Control+z');await expect(t).toHaveValue(before);}const pricing=a.getByRole('group',{name:'計價與分攤',exact:true});await pricing.focus();if(await pricing.locator('details').getAttribute('open')===null)await pricing.locator('summary').click();const amount=pricing.getByRole('spinbutton',{name:/分攤金額/}).first();await amount.focus();await expect(amount).toBeEditable();await a.evaluate(()=>{window.qaNativeKeys=[];window.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='z')queueMicrotask(()=>window.qaNativeKeys.push(e.defaultPrevented));});});await a.keyboard.press('Control+z');assert.deepEqual(await a.evaluate(()=>window.qaNativeKeys),[false]);await close(a);return {actualChromiumTextHistory:true,numberNativeEventNotPrevented:true,macHardwareNotClaimed:true};});
 await check('A05',async()=>{const before=await api.graph();await a.locator('body').click({position:{x:1000,y:600}});const start=r.browserRequests.length;await a.keyboard.press('Control+z');await a.keyboard.press('Meta+z');await a.waitForTimeout(1300);assert.deepEqual(await api.graph(),before);assert(!r.browserRequests.slice(start).some(x=>x.method!=='GET'&&x.path.includes('/rpc/')&&!/read_/.test(x.path)));return {savedGraphUnchanged:true};});
 await check('C05',async()=>{
  await expect.poll(()=>r.realtimeReady.has(1),{timeout:15000,message:'Peer product Postgres Changes system readiness required before mutation'}).toBe(true);
  const start=r.realtimeSignals.length,before=(await api.snap()).collaborationRevision,title=`QA websocket ${r.run.slice(0,8)} ${randomUUID().slice(0,8)}`;
  await api.patch(0,'budget',r.budget,'title',()=>title);
  await expect.poll(()=>r.realtimeSignals.slice(start).some(signal=>signal.actor===1&&signal.revision>Number(before)),{timeout:15000,message:'Real product postgres_changes frame for the correct trip required'}).toBe(true);
  await expect(b.getByRole('button',{name:title,exact:true})).toBeVisible({timeout:15000});return {websocketPayloadReceived:true,peerUiConverged:true,actualProductSocket:true,rawFramesAndTokensNotPersisted:true};
 });
 await check('C06',async()=>{for(const page of r.pages){await page.reload();await expect(page.getByRole('button',{name:(await canonical()).title,exact:true})).toBeVisible();}return {threeRealContexts:true};});
 await check('C08',async()=>{await r.contexts[1].setOffline(true);try{const title=`QA reconnect ${r.run.slice(0,8)}`;await api.patch(0,'budget',r.budget,'title',()=>title);await expect(b.getByRole('button',{name:title,exact:true})).toHaveCount(0);}finally{await r.contexts[1].setOffline(false);}await b.reload();await expect(b.getByRole('button',{name:(await canonical()).title,exact:true})).toBeVisible();return {actualOfflineNetwork:true};});
 await check('C07',async()=>{const native=await r.contexts[0].newCDPSession(a);await native.send('Emulation.setFocusEmulationEnabled',{enabled:false});const {windowId}=await native.send('Browser.getWindowForTarget');try{await native.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});await a.bringToFront();await expect.poll(()=>a.evaluate(()=>document.visibilityState)).toBe('visible');const t=await edit(a),before=await canonical(),draft=`QA background ${r.run.slice(0,8)} ${randomUUID().slice(0,8)}`;await t.fill(draft);await native.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});await expect.poll(()=>a.evaluate(()=>document.visibilityState)).toBe('hidden');await a.waitForTimeout(1300);assert.equal(await t.inputValue(),draft);assert.equal((await canonical()).title,before.title);await native.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});await a.bringToFront();await expect.poll(()=>a.evaluate(()=>document.visibilityState)).toBe('visible');await expect.poll(async()=>(await canonical()).title).toBe(draft);await close(a);}finally{await native.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});await native.send('Emulation.setFocusEmulationEnabled',{enabled:true});await native.detach();}return {realDocumentHiddenVisible:true,actualWindowMinimized:true,playwrightFocusEmulationDisabled:true};});
 await check('C09',async()=>{
  // Delay a real admission request, commit a competing revision, then forward
  // the unchanged request. A fabricated response is never accepted here.
  const held={};held.promise=new Promise(resolve=>held.resolve=resolve);let forward;const released=new Promise(resolve=>{forward=resolve;});let taken=false;
  const pattern='**/rest/v1/rpc/budget_metadata_group_lease_v2',handler=async route=>{const j=route.request().postDataJSON();if(!taken&&j.p_id===r.budget&&j.p_group==='title'&&j.p_action==='acquire'){taken=true;held.resolve();await released;await route.continue();}else await route.continue();};
  await c.route(pattern,handler);let timer=setTimeout(()=>forward(),8000);
  try{const name=(await canonical()).title;await c.getByRole('button',{name,exact:true}).click();await c.getByRole('tab',{name:'編輯項目',exact:true}).click();const ct=field(c);await ct.click();await qaDeadline(held.promise,{ms:4000,label:'real lease request held'});await ct.fill('QA unsaved rejected draft');await api.patch(1,'budget',r.budget,'title',()=>`QA conflict winner ${r.run.slice(0,8)}`);const response=c.waitForResponse(z=>z.url().endsWith('/rpc/budget_metadata_group_lease_v2')&&z.request().postDataJSON()?.p_group==='title');forward();const denied=await response;assert.equal(denied.status(),409);assert.equal((await denied.json()).code,'PT409');await expect(ct).toHaveValue('QA unsaved rejected draft');await c.locator('.bw-metadata-group').filter({has:ct}).getByRole('button',{name:'捨棄此欄草稿',exact:true}).click();await expect(ct).toHaveValue((await canonical()).title);await close(c);return {realPt409:true,unsavedDraftCancelled:true};}
  finally{clearTimeout(timer);forward();await c.unroute(pattern,handler);}
 });
 await check('A03',async()=>{assert(!r.browserRequests.some(x=>/undo|inverse/i.test(x.path)));await expect(a.getByRole('button',{name:/Undo|復原|上傳收據/})).toHaveCount(0);assert.deepEqual(r.browserErrors,[]);return {customUndoRequests:0,pageErrors:0,allThreeContexts:true};});
 for(const [i,page] of r.pages.entries())await page.screenshot({path:`${r.dir}/browser-context-${i}.png`});
}
