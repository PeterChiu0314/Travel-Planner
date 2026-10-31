// Local artifact preparation only. Never connects Hosted or runs SQL.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {tripDir,tripHead,tripName,tripSource,tripDeploymentSql,validateTripVersion,sha} from './b7-trip-cascade-artifacts.mjs';
const utcVersion=new Date().toISOString().slice(0,19).replace(/[-:T]/g,'');
if(utcVersion<=tripHead)throw Error(`BLOCKED: official UTC clock ${utcVersion} is not later than installed ${tripHead}. Retry after 2026-10-31T13:04:15Z. Do not alter system clock or hand-edit a version.`);
try{await fs.access(path.join(tripDir,'packet-manifest.json'));throw Error('An issued candidate already exists; Review it rather than generating another version');}catch(e){if(e.code!=='ENOENT')throw e;}
const work=path.resolve('.tmp-b7-p1/official-trip-migration');await fs.mkdir(work,{recursive:true});
// Official migration new copies piped stdin until EOF. Close our unused pipe;
// otherwise execFile leaves the CLI waiting after creating the empty file.
const run=(file,args,options)=>new Promise((resolve,reject)=>{
 const child=execFile(file,args,{timeout:60000,maxBuffer:1024*1024,...options},(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr}));
 child.stdin.end();
});
const source=await tripSource();
const dir=path.join(work,'supabase/migrations');await fs.mkdir(dir,{recursive:true});const prior=new Set(await fs.readdir(dir));
const cliVersion=(await run(process.execPath,['node_modules/supabase/dist/supabase.js','--version'],{windowsHide:true})).stdout.trim();
await run(process.execPath,['node_modules/supabase/dist/supabase.js','migration','new',tripName,'--workdir',work],{windowsHide:true});
const files=(await fs.readdir(dir)).filter(f=>!prior.has(f)&&f.endsWith('_'+tripName+'.sql'));if(files.length!==1)throw Error('Official CLI must generate exactly one fresh migration');const file=files[0];
const version=file.split('_')[0];validateTripVersion(version);const wrapper=await tripDeploymentSql(version);
const destination=path.join(tripDir,file);try{await fs.access(destination);throw Error('Refuse to overwrite an issued artifact');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.writeFile(destination,source);await fs.writeFile(path.join(tripDir,'candidate-deployment.psql'),wrapper);
const seal=JSON.parse(await fs.readFile(path.join(tripDir,'source-manifest.json'),'utf8'));const manifest={projectRef:'uyqdopksfysbobhjcepk',version,file,name:tripName,sourceSha256:sha(source),sourceBytes:Buffer.byteLength(source),wrapperSha256:sha(wrapper),wrapperBytes:Buffer.byteLength(wrapper),previousHead:tripHead,ledgerBefore:63,ledgerAfter:64,functions:seal.functions,newObjects:seal.newObjects,issuedByOfficialCli:true,cliVersion,issuedAt:new Date().toISOString(),cliOutputConfirmedFile:file,hostedApplied:false,deploymentAuthorized:false};
await fs.writeFile(path.join(tripDir,'packet-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
