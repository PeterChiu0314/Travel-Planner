// Native private-stdin bridge. No signing secret, Worker or credential file.
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {project,endpoint,assertApproval,assertPublicKey,sha} from './staging-budget-acceptance-scope.mjs';
import {createHttp,ok,claims} from './staging-budget-acceptance-http.mjs';
assert(process.argv.includes('--private-stdin'));
const root=fileURLToPath(new URL('../..',import.meta.url)),dir=path.join(root,'.tmp-staging-budget-acceptance');
await fs.mkdir(dir,{recursive:true});
const operatorId=randomUUID(),status=(phase,extra={})=>fs.writeFile(path.join(dir,'memory-status.json'),JSON.stringify({operatorId,phase,credentialsSaved:false,...extra}));
let input;
try{
 input=await new Promise((resolve,reject)=>{const r=readline.createInterface({input:process.stdin});r.once('line',s=>{try{resolve(JSON.parse(s));}catch{reject(Error('Invalid private input'));}r.close();});});
 assert.equal(claims(input.admin).ref,project);assert.equal(claims(input.admin).role,'service_role');
 assertPublicKey(input.anon,input.admin);
 const qa=JSON.parse(await fs.readFile(path.join(root,'.tmp-b7-p1/qa-scope.json'),'utf8'));
 const http=createHttp({url:endpoint,anon:input.anon});
 assert.equal((await http(null,'/auth/v1/health')).status,200);
 for(const id of qa.users){const user=ok(await http(input.admin,`/auth/v1/admin/users/${id}`,{admin:true}));assert.equal(user.id,id);assert.equal(user.user_metadata?.qa_run,qa.run);assert(user.email.endsWith('@example.invalid'));}
 // Only the publishable/anon key is persisted, exactly as normal Vite config.
 await fs.writeFile(path.join(root,'.env.staging.local'),`VITE_SUPABASE_URL=${endpoint}\nVITE_SUPABASE_ANON_KEY=${input.anon}\n`);
 input.anon=null;await status('ready');console.log('READY');
 const deadline=Date.now()+45*60000;
 let handled;
 while(Date.now()<deadline){
  let request;try{const r=JSON.parse(await fs.readFile(path.join(dir,'memory-command.json'),'utf8'));if(r.operatorId===operatorId){if(r.action==='stop')break;if(r.action==='run'&&sha(r)!==handled)request=r;}}catch{}
  if(!request){await new Promise(r=>setTimeout(r,500));continue;}
  handled=sha(request);
  const before=JSON.parse(await fs.readFile(path.join(dir,'before.json'),'utf8'));assertApproval(request.approval,before);
  assert(Date.parse(request.approval.expiresAt)<=deadline,'Run must finish inside the RAM helper lifetime');
  let protectedReceiptPath;
  try{protectedReceiptPath=JSON.parse(await fs.readFile(path.join(dir,'protected-receipt.json'),'utf8')).path;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(protectedReceiptPath)assert(before.installation.receiptPathHashes.includes(sha(protectedReceiptPath)),'Receipt path must match independent catalog evidence');
  // Fresh child per explicitly dispatched contract: repaired QA modules are
  // loaded anew. Key never appears in argv/env/files; failed commands never
  // replay. The operator must independently Pause/read back before continuing.
  await status('running');
  const child=spawn(process.execPath,['scripts/qa/run-staging-budget-acceptance.mjs','--authorized-staging-qa','--private-stdin'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
  child.stdout.resume();child.stderr.resume();
  const completed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
  child.stdin.end(JSON.stringify({admin:input.admin,approval:request.approval,protectedReceiptPath})+'\n');
  const code=await completed;
  if(code===0){await status('completed');break;}
  await status('needs-readback',{reason:'Stopped run; no retry until a distinct fresh contract is explicitly dispatched'});
 }
}catch{await status('blocked',{reason:'Input, identity or acceptance check failed; no automatic retry'});console.log('BLOCKED');process.exitCode=1;}
finally{if(input){input.admin=null;input.anon=null;}if(!process.exitCode)await status('stopped');console.log('STOPPED');}
