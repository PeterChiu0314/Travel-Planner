// Starts a NEW loopback-only native PostgreSQL cluster; never accepts a DB URL.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);
const root=process.cwd(),marker=randomUUID();
let bin=path.resolve(process.env.BUDGET_TEST_PG_BIN||'.tmp-budget-native-pg/runtime/pgsql/bin');
const work=path.resolve(root,'.tmp-budget-native-pg/runs',marker);
// Windows PostgreSQL tools interpret paths via the ANSI codepage. Keep the
// cluster and executable spelling ASCII even when the checkout contains CJK.
const clusterRoot=path.join(os.tmpdir(),'travel_planner_budget_pg',marker);
await fs.mkdir(clusterRoot,{recursive:true});
if(process.platform==='win32'&&/[^\x00-\x7f]/.test(bin)){
  const alias=path.join(clusterRoot,'runtime');await fs.symlink(path.dirname(bin),alias,'junction');bin=path.join(alias,'bin');
}
const pgctl=path.join(bin,process.platform==='win32'?'pg_ctl.exe':'pg_ctl');
const initdb=path.join(bin,process.platform==='win32'?'initdb.exe':'initdb');
const port=await new Promise((resolve,reject)=>{
  const listener=net.createServer();listener.on('error',reject);
  listener.listen(0,'127.0.0.1',()=>{const value=listener.address().port;listener.close(()=>resolve(value));});
});
await fs.mkdir(work,{recursive:true});
const data=path.join(clusterRoot,'data'),log=path.join(clusterRoot,'postgres.log');
let started=false;
try {
  const version=(await run(path.join(bin,process.platform==='win32'?'postgres.exe':'postgres'),['--version'],{windowsHide:true})).stdout.trim();
  await run(initdb,['-D',data,'-U','budget_local_admin','--auth=trust','--encoding=UTF8','--no-locale'],{windowsHide:true,timeout:60000,maxBuffer:2e6});
  const options=`-h 127.0.0.1 -p ${port} -c wal_level=logical -c deadlock_timeout=200ms -c log_lock_waits=on -c log_parameter_max_length=0 -c log_parameter_max_length_on_error=0 -c budget_metadata.test_cluster=${marker}`;
  await run(pgctl,['-D',data,'-l',log,'-o',options,'-w','start'],{windowsHide:true,timeout:30000});started=true;
  console.log(`Native isolated cluster: ${version}; 127.0.0.1:${port}; marker ${marker}`);
  await fs.writeFile(path.join(work,'environment.json'),JSON.stringify({version,host:'127.0.0.1',port,marker,work,data,log,startedAt:new Date().toISOString()},null,2));
  const exit=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['tests/budget-metadata-parallel.mjs'],{cwd:root,windowsHide:true,stdio:'inherit',env:{...process.env,
      BUDGET_NATIVE_PORT:String(port),BUDGET_NATIVE_MARKER:marker,BUDGET_NATIVE_EVIDENCE:work,BUDGET_NATIVE_RECEIPTS_ONLY:process.argv.includes('--receipts')?'1':'',BUDGET_NATIVE_FINANCE_ONLY:process.argv.includes('--finance')?'1':'',
      BUDGET_NATIVE_PG_MODULE:path.resolve('.tmp-budget-db-runtime/node_modules/pg/lib/index.js')}});
    child.on('error',reject);child.on('exit',code=>resolve(code??1));
  });
  process.exitCode=exit;
  if(exit===0&&process.argv.includes('--advisors')){
    const url=`postgresql://budget_local_admin@127.0.0.1:${port}/postgres?sslmode=disable`;
    for(const [name,args] of [['advisors',['db','advisors','--db-url',url,'--type','all','--fail-on','none']],
      ['migration-list',['migration','list','--db-url',url]]]){
      try {
        const result=await run(process.execPath,['node_modules/supabase/dist/supabase.js',...args],{cwd:root,windowsHide:true,timeout:30000,maxBuffer:3e6});
        await fs.writeFile(path.join(work,`${name}.json`),JSON.stringify({ok:true,stdout:result.stdout,stderr:result.stderr},null,2));console.log(`Local CLI ${name}: completed; details saved with isolated evidence.`);
      }catch(error){
        await fs.writeFile(path.join(work,`${name}.json`),JSON.stringify({ok:false,message:error.message,stdout:error.stdout,stderr:error.stderr},null,2));console.log(`Local CLI ${name}: unavailable; diagnostics saved with isolated evidence.`);
      }
    }
  }
} catch(error) {
  console.error({message:error.message,stderr:error.stderr});process.exitCode=1;
} finally {
  if(started){
    await run(pgctl,['-D',data,'-m','fast','-w','stop'],{windowsHide:true,timeout:30000});
    await fs.copyFile(log,path.join(work,'postgres.log'));
    console.log(`Stopped isolated cluster. Evidence: ${work}`);
  }
}
