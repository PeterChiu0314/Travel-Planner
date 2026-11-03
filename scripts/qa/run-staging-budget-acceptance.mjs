// Default command is READ ONLY. Hosted Auth/session/fixture/browser/Storage work
// is unreachable without both the explicit switch and a fresh approved contract.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {project,endpoint,assertTarget,assertPreflight,assertApproval,preflightSql,freshMatrix,sha} from './staging-budget-acceptance-scope.mjs';
import {createHttp,ok,claims,realSessions,fixtureApi,httpCases,paymentAndSourceCases} from './staging-budget-acceptance-http.mjs';
import {baseScope,scopedPreflightSql,verifyAfter} from './staging-budget-acceptance-protection.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url)),dir=path.join(root,'.tmp-staging-budget-acceptance');
export function validateMode(args){assert(args.every(a=>['--readonly','--print-preflight','--prepare-scope','--finalize','--authorized-staging-qa','--private-stdin'].includes(a)),'Unknown command');assert(args.filter(a=>['--readonly','--print-preflight','--prepare-scope','--finalize','--authorized-staging-qa'].includes(a)).length<=1,'Read-only and write modes are mutually exclusive');assert(!args.includes('--authorized-staging-qa')||args.includes('--private-stdin'),'Hosted credentials must arrive only through private stdin');}
export async function main(args=process.argv.slice(2)){
 validateMode(args);if(args.includes('--print-preflight')){process.stdout.write(preflightSql);return;}
 if(args.includes('--prepare-scope')){
  await fs.mkdir(dir,{recursive:true});const qa=JSON.parse(await fs.readFile(path.join(root,'.tmp-b7-p1/qa-scope.json'),'utf8'));const scope={run:randomUUID(),trips:[randomUUID(),randomUUID()],users:qa.users,resources:[],objects:[]};baseScope(scope);
  await fs.writeFile(path.join(dir,'qa-plan.json'),JSON.stringify(scope,null,2),{flag:'wx'});await fs.writeFile(path.join(dir,'scoped-preflight.sql'),scopedPreflightSql(scope));console.log('Offline scope prepared; no Hosted request. Do not overwrite a pending run.');return;
 }
 if(args.includes('--finalize')){
  const json=async name=>JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));const report=await json('results.json');assert.equal(report.mode,'authorized-hosted-qa','Readonly phase cannot certify unexecuted QA cleanup');
  const detail=verifyAfter({before:await json('dormant-before.json'),after:await json('after.json'),scope:await json('fixture-scope.json')});for(const id of ['D05','Z01'])Object.assign(report.rows.find(v=>v.id===id),{status:'Passed',reason:undefined,detail});await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2));return report;
 }
 const authorized=args.includes('--authorized-staging-qa');await fs.mkdir(dir,{recursive:true});
 const report={date:new Date().toISOString(),baseCommit:'c416b7d',project,mode:authorized?'authorized-hosted-qa':'read-only',mockedRoutes:false,rows:freshMatrix(),requests:[],failures:[],productionReady:false};
 if(authorized)for(const row of report.rows)Object.assign(row,{status:'Not Run',reason:'Waiting for authorized execution'});
 const save=()=>fs.writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2));
 const block=(id,reason)=>Object.assign(report.rows.find(x=>x.id===id),{status:'Blocked',reason});
 const check=async(id,fn)=>{const row=report.rows.find(x=>x.id===id);assert(row);try{const detail=await fn();Object.assign(row,{status:'Passed',reason:undefined,detail,executedAt:new Date().toISOString()});return true;}catch(e){Object.assign(row,{status:'Failed',reason:`${e.name}: ${String(e.message).replace(/eyJ[A-Za-z0-9_.-]+|sb_secret_[A-Za-z0-9_-]+/g,'[redacted]').slice(0,450)}`});report.failures.push(id);if(authorized)throw Error(`Acceptance ${id} failed; stop before dependent writes`);return false;}finally{await save();}};
 let before;
 try{before=JSON.parse(await fs.readFile(path.join(dir,'before.json'),'utf8'));}catch{}
 if(before){
  // A capture is a dated observation, never silently promoted to a fresh execution permit.
  report.before={capturedAt:before.capturedAt,ledger:before.ledgerCount,head:before.ledgerHead,protocols:before.protocolRows,coverage:before.dataProjectionCoverage,installation:before.installation};
  await check('R01',async()=>{assertPreflight(before,{active:authorized,now:Date.parse(before.capturedAt)+1});return {observedAt:before.capturedAt,sourceAnd12Acls:true};});
  await check('R02',async()=>{assertPreflight(before,{active:authorized,now:Date.parse(before.capturedAt)+1});return {expectedState:authorized?'five authorized protocols ON; Undo/Receipt OFF':'all seven OFF',latches:before.protocolRows};});
  await check('R03',async()=>{assert.equal(before.installation.qaTaggedUserCount,2);assert.equal(before.installation.qaSessionCount,0);const qa=JSON.parse(await fs.readFile(path.join(root,'.tmp-b7-p1/qa-scope.json'),'utf8'));assert(qa.users.length===2&&qa.users.every(id=>before.installation.qaIdentities.some(v=>v.idSha256===sha(id)&&v.runSha256===sha(qa.run))));return {receiptMetadata:1,objects:2,qaUsers:2,qaSessions:0,localQaManifestMatchesLiveHashes:true,coverage:before.dataProjectionCoverage};});
  await check('R04',async()=>{assert(before.installation.realtimeTables.includes('budget_collaboration_signals'));assert(before.installation.realtimeSignalSelect);assert.equal(before.installation.applicationRlsOff,0);return {catalogOnly:true,actualWebsocketNotYetVerified:true};});
 }
 const env=await fs.readFile(path.join(root,'.env.staging.local'),'utf8'),value=key=>env.match(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^\\s"']+)`,'m'))?.[1],url=value('VITE_SUPABASE_URL'),anon=value('VITE_SUPABASE_ANON_KEY');assertTarget(url);
 let writeDeadline=0;const http=createHttp({url,anon,requests:report.requests,beforeRequest:({route,method})=>{if(method!=='GET'&&!route.startsWith('/auth/v1/logout'))assert(authorized&&writeDeadline>Date.now(),'No Hosted write outside approved QA window');}});
 await check('R05',async()=>{for(const route of ['/auth/v1/health','/auth/v1/settings'])assert.equal((await http(null,route)).status,200);return {realStagingHttp:true,loginNotAttempted:true};});
 if(!authorized){report.after={hostedWritesPerformed:0,protocolWritesPerformed:0,note:'Independent final catalog capture required for current after-state; no Auth login, object access or acceptance mutations'};await save();return report;}
 // No automated key lookup or credential file. Existing admin credential is
 // restricted to verifying/reusing two owned QA identities and minting real Auth sessions.
 const input=await new Promise((resolve,reject)=>{const lines=readline.createInterface({input:process.stdin});lines.once('line',text=>{try{resolve(JSON.parse(text));}catch{reject(Error('Private input invalid'));}lines.close();});lines.once('close',()=>reject(Error('Private input closed')));});
 assertApproval(input.approval,before);const plan=JSON.parse(await fs.readFile(path.join(dir,'qa-plan.json'),'utf8'));assert.equal(before.fixtureScopeSha256,sha(baseScope(plan)));assert.equal(before.scopeExistingTrips,0);assert(/^[a-f0-9]{64}$/.test(before.originalProtection));assert(input.admin,'Existing Staging fixture admin credential required');assert.equal(claims(input.admin).ref,project);assert.equal(claims(input.admin).role,'service_role');
 writeDeadline=Date.parse(input.approval.expiresAt);
 const qa=JSON.parse(await fs.readFile(path.join(root,'.tmp-b7-p1/qa-scope.json'),'utf8'));
 assert.deepEqual(plan.users,qa.users);const run=plan.run,r={run,dir,input,before,anon,http,check,block,sessions:[],objects:[],resources:[],trip:plan.trips[0],privateTrip:plan.trips[1],tripName:`QA acceptance ${run}`,browserUrl:'http://127.0.0.1:5189',createdTrips:[]};
 r.savePrivate=async()=>{const scope={project,run,trips:plan.trips,users:qa.users,resources:r.resources,createdTrips:r.createdTrips,objects:r.objects};await fs.writeFile(path.join(dir,'fixture-scope.json'),JSON.stringify(scope,null,2));await fs.writeFile(path.join(dir,'after-preflight.sql'),scopedPreflightSql(scope));};
 let server;
 const stopTimer=setTimeout(()=>{void r.browser?.close().catch(()=>{});server?.kill();},Math.max(1,writeDeadline-Date.now()));stopTimer.unref();
 try{
  await realSessions({http,admin:input.admin,qa,onSession:s=>r.sessions.push(s)});input.admin=null;
  for(const [trip,name] of [[r.trip,r.tripName],[r.privateTrip,`QA private ${run}`]]){
   r.createdTrips.push(trip);await r.savePrivate();
   ok(await http(r.sessions[0].access_token,'/rest/v1/trips',{method:'POST',body:{id:trip,title:name,name,owner_id:qa.users[0],destination:'Isolated acceptance',start_date:'2099-01-01',end_date:'2099-01-03'}}));
   // Use the owner's normal membership management permission, not admin DML.
   const members=ok(await http(r.sessions[0].access_token,`/rest/v1/trip_members?trip_id=eq.${trip}&select=user_id`));
   if(!members.some(m=>m.user_id===qa.users[0]))ok(await http(r.sessions[0].access_token,'/rest/v1/trip_members',{method:'POST',body:{trip_id:trip,user_id:qa.users[0],role:'owner',status:'approved',display_name:'QA Owner'}}));
  }
  ok(await http(r.sessions[0].access_token,'/rest/v1/trip_members',{method:'POST',body:{trip_id:r.trip,user_id:qa.users[1],role:'editor',status:'approved',display_name:'QA Editor'}}));
  r.api=fixtureApi({http,sessions:r.sessions,trip:r.trip,onCreate:async id=>{r.resources.push(id);await r.savePrivate();}});await httpCases(r);await paymentAndSourceCases(r);
  server=spawn(process.execPath,['scripts/qa/b7-staging-vite.mjs'],{cwd:root,windowsHide:true,env:{...process.env,VITE_SUPABASE_URL:endpoint,VITE_SUPABASE_ANON_KEY:anon,VITE_BUDGET_METADATA_GROUPS:'true',VITE_BUDGET_FINANCE_GROUPS:'true',VITE_BUDGET_LIFECYCLE:'true',VITE_BUDGET_RECEIPTS:'false',VITE_BUDGET_RECEIPTS_DISABLED:'true'},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned Vite readiness timed out')),12000);server.once('error',()=>{clearTimeout(timer);reject(Error('Owned Vite launch failed'));});server.once('exit',()=>{clearTimeout(timer);reject(Error('Owned Vite exited; never reuse an unrelated listener'));});server.stdout.on('data',chunk=>{if(chunk.toString().includes('127.0.0.1:5189')){clearTimeout(timer);resolve();}});server.stderr.resume();});
  const {browserCases}=await import('./staging-budget-acceptance-browser.mjs');await browserCases(r);
  const {storageCases}=await import('./staging-budget-acceptance-storage.mjs');await storageCases(r);
  await check('B01',async()=>{const id=await r.api.create('budget');await r.mutate('budget',id,'lifecycle',{action:'delete'});assert(!(await r.api.snap()).budgetItems.some(b=>b.id===id));return {ordinaryHttpCreateDelete:true};});
  const {travelCase}=await import('./staging-budget-acceptance-travel.mjs');await travelCase(r);
 }finally{
  clearTimeout(stopTimer);
  await r.browser?.close();server?.kill();
  try{await r.api?.releaseAll();}catch{report.failures.push('cleanup-leases');}
  // No sweep, cascaded deletion or admin financial cleanup. Retain owned QA
  // financial histories for independent audit, then clean in an approved stage.
  report.ownedFixtureState={retainedForAudit:true,trips:r.createdTrips.length,objectsPending:r.objects.length,scopeFileIgnored:true};
  for(const s of r.sessions){try{assert.equal((await http(s.access_token,'/auth/v1/logout?scope=local',{method:'POST'})).status,204);}catch{report.failures.push('qa-session-signout');}}
  block('D05','Independent before/after catalog/row readback required after returning all protocols OFF');
  block('Z01','Owned QA histories retained for audit; exact cleanup and independently verified protocol Pause still required');
  input.admin=null;r.sessions=[];await r.savePrivate();await save();
 }
 return report;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().then(report=>{if(report){console.log(JSON.stringify({mode:report.mode,counts:Object.fromEntries(['Passed','Failed','Blocked','Not Run'].map(s=>[s,report.rows.filter(x=>x.status===s).length])),output:'.tmp-staging-budget-acceptance/results.json'}));if(report.failures.length)process.exitCode=1;}}).catch(()=>{console.error('Acceptance stopped; inspect sanitized evidence and owned scope before retry. No automatic retry.');process.exitCode=1;});
