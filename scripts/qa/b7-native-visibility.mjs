// Official Playwright CDP noDefaults avoids forced focus. A fresh Chrome
// incognito target is verified before any QA authentication enters the browser.
import fs from 'node:fs/promises';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {spawn,execFile} from 'node:child_process';import {randomUUID} from 'node:crypto';import {chromium} from 'playwright';import {qaDeadline} from './b7-real-response-gate.mjs';
export async function execute({runtime:r,args,credentials:c}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');
 if(args.mode==='probe'){
  assert(!r.nativeVisibility,'One native visibility instance');const binary=path.join(process.env.PROGRAMFILES||'C:\\Program Files','Google/Chrome/Application/chrome.exe');await fs.access(binary);
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const profile=await fs.mkdtemp(path.join(r.root,'.tmp-b7-final-recovery/native-profile-'));
  const startedAt=new Date().toISOString(),child=spawn(binary,['--no-first-run','--no-default-browser-check','--disable-sync','--incognito','--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'about:blank'],{windowsHide:false,stdio:'ignore'});child.once('error',()=>{});
  const owned={child,profile,port};r.nativeVisibility=owned;
  try{const end=Date.now()+8000;let endpoint;while(Date.now()<end){try{const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1000)});if(response.ok){endpoint=(await response.json()).webSocketDebuggerUrl;break;}}catch{}await new Promise(z=>setTimeout(z,100));}assert(endpoint,'Fresh native Chrome CDP was not ready');assert.equal(new URL(endpoint).hostname,'127.0.0.1');
   const browser=await chromium.connectOverCDP(endpoint,{noDefaults:true,timeout:8000});owned.browser=browser;r.additionalQaBrowsers??=[];r.additionalQaBrowsers.push(browser);const browserCdp=await browser.newBrowserCDPSession();owned.cdp=browserCdp;
   const processes=await browserCdp.send('SystemInfo.getProcessInfo'),browserPid=processes.processInfo.find(z=>z.type==='browser').id;owned.browserPid=browserPid;
   if(browserPid!==child.pid){const text=await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(r.root,'scripts/qa/verify-b7-native-chrome.ps1'),'-CandidatePid',String(browserPid),'-ExpectedLauncherPid',String(child.pid),'-Port',String(port),'-Profile',profile,'-StartedAt',startedAt],{windowsHide:true,timeout:8000},(error,stdout)=>error?reject(Error('Native Chrome ownership read failed')):resolve(stdout)));const proof=JSON.parse(text.replace(/^\uFEFF/,''));assert(proof.exactQaChrome&&proof.profileAndPortAndLaunchTimeVerified);owned.ownerProof=proof;}
   const context=browser.contexts()[0];assert(context);owned.context=context;
   const incognito=await browserCdp.send('Target.createBrowserContext',{disposeOnDetach:true});owned.incognitoId=incognito.browserContextId;
   const pageEvent=context.waitForEvent('page',{timeout:5000});await browserCdp.send('Target.createTarget',{url:'about:blank#b7-main-'+randomUUID(),browserContextId:owned.incognitoId});const page=await pageEvent;owned.page=page;page.setDefaultTimeout(6000);page.setDefaultNavigationTimeout(8000);
   const pageCdp=await context.newCDPSession(page),target=(await pageCdp.send('Target.getTargetInfo')).targetInfo,contexts=await browserCdp.send('Target.getBrowserContexts');assert.equal(target.browserContextId,owned.incognitoId);assert(contexts.browserContextIds.includes(target.browserContextId),'Target must be a real off-the-record context, never the persisted profile');await pageCdp.detach();
   const freshPage=context.waitForEvent('page',{timeout:5000});await browserCdp.send('Target.createTarget',{url:'about:blank#b7-'+randomUUID(),browserContextId:owned.incognitoId});const sibling=await freshPage;owned.sibling=sibling;
   await page.bringToFront();assert.equal(await page.evaluate(()=>document.visibilityState),'visible');await sibling.bringToFront();const deadline=Date.now()+3000;while(Date.now()<deadline&&await page.evaluate(()=>document.visibilityState)!=='hidden')await new Promise(z=>setTimeout(z,50));assert.equal(await page.evaluate(()=>document.visibilityState),'hidden','No synthetic visibility or focus override is allowed');await page.bringToFront();assert.equal(await page.evaluate(()=>document.visibilityState),'visible');
   const result={at:new Date().toISOString(),status:'Passed',scope:'native visibility capability only, no Staging acceptance yet',sameSpawnedBrowserPidVerified:true,incognitoVerifiedBeforeCredentials:true,officialNoDefaults:true,realVisibilitySequence:['visible','hidden','visible'],domVisibilityOverride:false,credentialsSupplied:false};await fs.writeFile(path.join(r.root,'.tmp-b7-final-recovery/native-visibility-probe.json'),JSON.stringify(result,null,2));return result;
  }catch(error){try{await owned.cdp?.send('Browser.close');}catch{}child.kill();r.nativeVisibility=null;throw error;}
 }
 if(args.mode==='open-app'){
  const owned=r.nativeVisibility,x=r.cutover;assert(owned?.incognitoId&&x.sessions.length===2);const session=x.sessions[0],context=owned.context,page=owned.page;
  await context.route('**/*.supabase.co/**',route=>new URL(route.request().url()).hostname===r.project+'.supabase.co'?route.continue():route.abort());
  await page.addInitScript(({session,project,trip})=>{if(location.hostname!=='127.0.0.1')return;const marker=`qa-auth-seeded:${session.user.id}`;if(!localStorage.getItem(marker)){localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify(session));localStorage.setItem(marker,'true');}const key=`travel-planner-session-context:${session.user.id}`;if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({activeTripId:trip,activeSection:'budget',activeDay:0,luggageTab:'personal',updatedAt:new Date().toISOString()}));},{session,project:r.project,trip:x.trips[0]});
  await page.goto(r.browserBaseUrl,{waitUntil:'domcontentloaded',timeout:10000});await page.getByRole('button',{name:'新增預算',exact:true}).waitFor({timeout:10000});return {realStagingAppReady:true,ordinaryQaJwtOnly:true,incognito:true};
 }
 if(args.mode==='background-e2e'){
  const owned=r.nativeVisibility;assert(owned?.page);const primary=r.browserPages[0],primaryContext=r.browserContexts[0];
  r.browserPages[0]=owned.page;r.browserContexts[0]=owned.context;
  // The verified sibling was created in the same native incognito context.
  try{const module=await import('./b7-browser-resilience.mjs?v='+Date.now());return await qaDeadline(module.execute({runtime:r,args:{mode:'background-visibility',useNativeSibling:true},credentials:c}),{ms:45000,label:'native background E2E',onTimeout:()=>{void owned.page.close().catch(()=>{});void owned.sibling.close().catch(()=>{});}});}finally{r.browserPages[0]=primary;r.browserContexts[0]=primaryContext;}
 }
 if(args.mode==='close'){
  const owned=r.nativeVisibility;if(!owned)return {closed:true};try{await qaDeadline(owned.cdp.send('Browser.close'),{ms:3000});}catch{}try{owned.child.kill();}catch{}r.nativeVisibility=null;return {closedExactNativeChrome:true};
 }
 throw Error('Unsupported native visibility action');
}
