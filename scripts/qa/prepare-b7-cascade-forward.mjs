// Local artifact preparation only. Never connects Hosted or runs SQL.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {cascadeDir,cascadeHead,cascadeName,cascadeSource,cascadeDeploymentSql,validateCascadeVersion,sha} from './b7-cascade-forward-artifacts.mjs';
const utcVersion=new Date().toISOString().slice(0,19).replace(/[-:T]/g,'');
if(utcVersion<=cascadeHead)throw Error(`BLOCKED: official UTC clock ${utcVersion} is not later than installed ${cascadeHead}. Retry after 2026-10-31T13:00:00Z. Do not alter system clock or hand-edit a version.`);
try{await fs.access(path.join(cascadeDir,'packet-manifest.json'));throw Error('An issued candidate already exists; Review it rather than generating another version');}catch(e){if(e.code!=='ENOENT')throw e;}
const work=path.resolve('.tmp-b7-p1/official-migration');await fs.mkdir(work,{recursive:true});
// Official migration new copies piped stdin until EOF. Close our unused pipe;
// otherwise execFile leaves the CLI waiting after creating the empty file.
const run=(file,args,options)=>new Promise((resolve,reject)=>{
 const child=execFile(file,args,{timeout:60000,maxBuffer:1024*1024,...options},(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr}));
 child.stdin.end();
});
const source=await cascadeSource();
const dir=path.join(work,'supabase/migrations');await fs.mkdir(dir,{recursive:true});const prior=new Set(await fs.readdir(dir));
const cliVersion=(await run(process.execPath,['node_modules/supabase/dist/supabase.js','--version'],{windowsHide:true})).stdout.trim();
await run(process.execPath,['node_modules/supabase/dist/supabase.js','migration','new',cascadeName,'--workdir',work],{windowsHide:true});
const files=(await fs.readdir(dir)).filter(f=>!prior.has(f)&&f.endsWith('_'+cascadeName+'.sql'));if(files.length!==1)throw Error('Official CLI must generate exactly one fresh migration');const file=files[0];
const version=file.split('_')[0];validateCascadeVersion(version);const wrapper=await cascadeDeploymentSql(version);
const destination=path.join(cascadeDir,file);try{await fs.access(destination);throw Error('Refuse to overwrite an issued artifact');}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.writeFile(destination,source);await fs.writeFile(path.join(cascadeDir,'candidate-deployment.psql'),wrapper);
const manifest={projectRef:'uyqdopksfysbobhjcepk',version,file,name:cascadeName,sourceSha256:sha(source),sourceBytes:Buffer.byteLength(source),wrapperSha256:sha(wrapper),previousHead:cascadeHead,ledgerBefore:62,ledgerAfter:63,beforeFunctionSha256:'c3667a091954ed67ea677ff73aed85a5aa57cf292bb02519fcea155521a4a3d5',afterFunctionSha256:'ecd7888508e91b6df351a9ab4e95cf1a3facc426316ee68a868e622b1cdfda51',issuedByOfficialCli:true,cliVersion,issuedAt:new Date().toISOString(),cliOutputConfirmedFile:file,hostedApplied:false,deploymentAuthorized:false};
await fs.writeFile(path.join(cascadeDir,'packet-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
