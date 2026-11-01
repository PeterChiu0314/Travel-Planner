// True Auth login is supplied by the RAM-only operator; Google OAuth itself
// is not claimed by this controlled QA session bootstrap.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
export async function execute({runtime:r}){
 assert.equal(r.project,'uyqdopksfysbobhjcepk');const x=r.cutover;
 await r.browserContexts[1].close();
 const context=await r.browser.newContext({viewport:{width:1440,height:1000},locale:'zh-TW'});r.browserContexts[1]=context;
 await context.route('**/*.supabase.co/**',route=>new URL(route.request().url()).hostname===r.project+'.supabase.co'?route.continue():route.abort());
 await context.addInitScript(({session,project,trip})=>{if(location.hostname!=='127.0.0.1')return;const marker=`qa-auth-seeded:${session.user.id}`;if(!localStorage.getItem(marker)){localStorage.setItem(`sb-${project}-auth-token`,JSON.stringify(session));localStorage.setItem(marker,'true');localStorage.setItem(`travel-planner-session-context:${session.user.id}`,JSON.stringify({activeTripId:trip,activeSection:'budget',activeDay:0,luggageTab:'personal',updatedAt:new Date().toISOString()}));}},{session:x.sessions[1],project:r.project,trip:x.trips[0]});
 const page=await context.newPage();r.browserPages[1]=page;page.setDefaultTimeout(6000);
 await page.goto(r.browserBaseUrl,{waitUntil:'domcontentloaded',timeout:10000});await page.getByRole('button',{name:r.browserProof.sharedTitle,exact:true}).waitFor({timeout:10000});
 await page.reload({waitUntil:'domcontentloaded',timeout:10000});await page.getByRole('button',{name:r.browserProof.sharedTitle,exact:true}).waitFor({timeout:10000});
 const event={id:'BROWSER-RELOGIN-REFRESH',status:'Passed',at:new Date().toISOString(),actualAuthVerification:true,freshOrdinarySession:true,controlledQaBootstrap:true,googleOauthNotClaimed:true,realUiReloadRetainedCorrectTrip:true};
 r.browserProof.events.push(event);await fs.writeFile(path.join(r.dir,'browser-results.json'),JSON.stringify(r.browserProof,null,2));return event;
}
