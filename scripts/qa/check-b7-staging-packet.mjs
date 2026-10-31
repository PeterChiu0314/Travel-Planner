// Offline read-only verification. Never connects, generates, reseals or applies SQL.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {packet} from './build-b7-staging-packet.mjs';
import {bundleDir,hash,normalize} from './b7-forward-artifacts.mjs';
import {businessRaises,tokens} from './audit-budget-migration-conflicts.mjs';
const read=async name=>normalize(await fs.readFile(`${bundleDir}/${name}`,'utf8'));
const manifest=JSON.parse(await read('packet-manifest.json'));
const raw=await fs.readFile(`${bundleDir}/dormant-schema.sql`),sql=raw.toString('utf8');
assert.equal(hash(raw),manifest.packetSha256);assert.equal(raw.length,manifest.packetBytes);
assert.equal(manifest.sources.length,15);assert.equal(manifest.sources[0].file,'20260811150000_atomic_apply_itinerary_alternative.sql');
assert.equal(manifest.sources.at(-1).file,'20261031130000_budget_business_conflicts_forward.sql');
assert.equal(manifest.retainedHotfix.replayed,false);
assert.equal(sql,(await packet()).sql,'Packet diverges from the existing immutable inputs');
for(const [name,sha] of Object.entries(manifest.supportingHashes))assert.equal(hash(await read(name)),sha,name);
const seal=JSON.parse(await read('compiled-seal.json')),defs=JSON.parse(await read('compiled-definitions.json')),review=JSON.parse(await read('error-classification.json'));
assert.equal(seal.functions.length,38);let total=0,business=0,integrity=0;
for(const f of seal.functions){const d=defs.functions.find(x=>x.signature===f.signature),r=review.functions.find(x=>x.signature===f.signature);assert(d&&r);assert.deepEqual(f.sites,r.sites);assert.equal(hash(d.beforeBody),f.beforeSha256);assert.equal(hash(d.afterBody),f.afterSha256);
 const raises=businessRaises(d.beforeBody),ts=tokens(d.beforeBody);assert.equal(raises.length,f.sites.length);let mapped=d.beforeBody;
 for(let i=raises.length-1;i>=0;i--){assert.equal(raises[i].message,f.sites[i].message);const at=ts.findIndex(t=>t.start===raises[i].offset),literal=ts[at+2];assert.equal(literal.value,'40001');mapped=mapped.slice(0,literal.start)+`'${f.sites[i].code}'`+mapped.slice(literal.end);}
 assert.equal(mapped,d.afterBody,'Only reviewed literal substitutions permitted');assert.equal(businessRaises(d.afterBody).length,0);
 total+=f.sites.length;business+=f.sites.filter(x=>x.code==='PT409').length;integrity+=f.sites.filter(x=>x.code==='PT500').length;
}
assert.equal(total,78);assert.equal(business,54);assert.equal(integrity,24);
const top=tokens(sql);let from=0,begin=0,commit=0;for(let i=0;i<top.length;i++)if(top[i].value===';'){const part=top.slice(from,i);if(part.length===1&&part[0].value==='begin')begin++;if(part.length===1&&part[0].value==='commit')commit++;from=i+1;}assert.equal(begin,1);assert.equal(commit,1);
for(const flag of ['src/lib/budgetMetadataConfig.js','src/lib/budgetReceiptConfig.js']){const text=await fs.readFile(flag,'utf8');assert.match(text,/===\s*["']true["']/);}
console.log(JSON.stringify({packetSha256:manifest.packetSha256,bytes:raw.length,orderedSources:15,exactGeneratedSql:true,outerTransactions:{begin,commit},compiledFunctions:38,classifiedSites:total,PT409:business,PT500:integrity,resealed:false,hostedAccess:false},null,2));
