// Native private-stdin bridge. No signing secret, Worker or credential file.
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {project,endpoint,assertApproval,assertPublicKey,sha} from './staging-budget-acceptance-scope.mjs';
import {createHttp,ok,claims} from './staging-budget-acceptance-http.mjs';
import {main} from './run-staging-budget-acceptance.mjs';
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
 const deadline=Date.now()+30*60000;
 let request;
 while(Date.now()<deadline){try{const r=JSON.parse(await fs.readFile(path.join(dir,'memory-command.json'),'utf8'));if(r.operatorId===operatorId){if(r.action==='stop')break;if(r.action==='run'){request=r;break;}}}catch{}await new Promise(r=>setTimeout(r,500));}
 if(request){
  const before=JSON.parse(await fs.readFile(path.join(dir,'before.json'),'utf8'));assertApproval(request.approval,before);
  let protectedReceiptPath;
  try{protectedReceiptPath=JSON.parse(await fs.readFile(path.join(dir,'protected-receipt.json'),'utf8')).path;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(protectedReceiptPath)assert(before.installation.receiptPathHashes.includes(sha(protectedReceiptPath)),'Receipt path must match independent catalog evidence');
  await status('running');await main(['--authorized-staging-qa','--private-stdin'],{privateInput:{admin:input.admin,approval:request.approval,protectedReceiptPath}});
 }
}catch{await status('blocked',{reason:'Input, identity or acceptance check failed; no automatic retry'});console.log('BLOCKED');process.exitCode=1;}
finally{if(input){input.admin=null;input.anon=null;}if(!process.exitCode)await status('stopped');console.log('STOPPED');}
