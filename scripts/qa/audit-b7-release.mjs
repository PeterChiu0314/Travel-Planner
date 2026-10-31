// Offline reconciliation only. Never connects to Supabase, writes a ledger or reseals sources.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const file=process.argv[2];if(!file)throw Error('Provide controlled read-only Staging ledger JSON');
const live=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
assert.equal(live.ledger.length,64);assert(live.seven_off);assert.equal(live.ledger.at(-1).version,'20261031140648');
const sha=s=>createHash('sha256').update(s).digest('hex');
const files=[];async function walk(dir){for(const f of await fs.readdir(dir,{withFileTypes:true})){const p=path.posix.join(dir,f.name);if(f.isDirectory())await walk(p);else if(/^\d{14}_.+\.sql$/.test(f.name))files.push(p);}}
await walk('supabase/migrations');await walk('docs/operations');
const sources=await Promise.all(files.map(async p=>({path:p,version:path.basename(p).split('_')[0],name:path.basename(p).replace(/^\d{14}_|\.sql$/g,''),sha256:sha((await fs.readFile(p,'utf8')).replace(/\r\n/g,'\n'))})));
const ledger=live.ledger.map(row=>{const candidates=sources.filter(s=>s.version===row.version&&s.name===row.name),matches=candidates.filter(s=>s.sha256===row.source_sha256);return {...row,status:!row.source_sha256?'Historical source unavailable':matches.length?'Matched':'Source mismatch or missing',matchingPaths:matches.map(x=>x.path),...(matches.length?{}:{localCandidates:candidates})};});
// An optional exact ledger-source readback can explain a discrepancy, never
// change its sealed hash or turn byte inequality into an exact-match result.
if(process.argv[3]){
 const proof=JSON.parse(await fs.readFile(process.argv[3],'utf8')),row=ledger.find(x=>x.version===proof.version&&x.name===proof.name);
 assert(row);assert.equal(sha(proof.source.replace(/\r\n/g,'\n')),row.source_sha256,'Source readback lost bytes');
 const local=row.localCandidates?.find(x=>x.name===proof.name);assert(local);
 const text=(await fs.readFile(local.path,'utf8')).replace(/\r\n/g,'\n');
 if(proof.source.replace(/\r\n/g,'\n')===text+'\n')row.explanation='Exact readback differs by one trailing LF only; executable SQL unchanged; source hashes remain unequal';
}
const managed=JSON.parse(await fs.readFile('docs/operations/budget-b7-staging-managed/packet-manifest.json','utf8'));
const sourceOrder=[...managed.sources.map(x=>x.file),'20261031130414_budget_dormant_parent_cascade_guard.sql','20261031140648_budget_trip_cascade_lease_admission.sql'];
const forwardOrder=sourceOrder.map((name,index)=>{const installed=ledger.find(x=>x.version===name.split('_')[0]);assert(installed?.status==='Matched');return {order:index+1,file:name,sourceSha256:installed.source_sha256,sourcePaths:installed.matchingPaths,stagingInstalled:true,productionInstalled:'Unconfirmed; no Production access this round'};});
const report={project:'uyqdopksfysbobhjcepk',observedAt:live.observed_at,readOnly:true,hostedWrites:false,ledgerCount:64,matched:ledger.filter(x=>x.status==='Matched').length,historicalWithoutFullSource:ledger.filter(x=>x.status==='Historical source unavailable').length,sourceByteMismatches:ledger.filter(x=>x.status==='Source mismatch or missing').length,allKnownDifferencesExplained:ledger.filter(x=>x.status==='Source mismatch or missing').every(x=>x.explanation),ledger,forwardOrder,uninstalledSuperseded:{version:'20261030125028',replacement:'20261031083437',rule:'Retain old source unchanged; do not db push --include-all or fabricate ledger entry'},localVersionsAbsentFromStaging:[...new Set(sources.filter(x=>!ledger.some(y=>y.version===x.version)).map(x=>x.version))].sort(),productionDecision:'NO-GO: Staging real service/Activation/E2E gates incomplete; Production baseline/catalog/backups unverified; this inventory is not an executable Production packet'};
console.log(JSON.stringify(report,null,2));
if(!report.allKnownDifferencesExplained)process.exitCode=1;
