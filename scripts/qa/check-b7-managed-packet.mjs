// Offline: validates candidate identity and the explicitly reviewed supersession.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {hash,normalize} from './b7-forward-artifacts.mjs';
import {tokens,definitions} from './audit-budget-migration-conflicts.mjs';
import {managedArtifacts,managedDir,replacementFile,supersededFile,newRoleBlock} from './build-b7-managed-packet.mjs';
const built=await managedArtifacts();
const [sql,source,manifest]=await Promise.all([fs.readFile(`${managedDir}/dormant-schema.sql`,'utf8'),fs.readFile(`${managedDir}/${replacementFile}`,'utf8'),fs.readFile(`${managedDir}/packet-manifest.json`,'utf8')]);
assert.equal(normalize(sql),built.sql);assert.equal(normalize(source),built.source);assert.deepEqual(JSON.parse(manifest),built.manifest);
const origin=normalize(await fs.readFile(`supabase/migrations/${supersededFile}`,'utf8'));
const oldDefinitions=definitions(origin),newDefinitions=definitions(source);
const semanticDefs=defs=>defs.map(({line,raises,...rest})=>({...rest,raises:raises.map(({line,...raise})=>raise)}));
assert.deepEqual(semanticDefs(newDefinitions.defs),semanticDefs(oldDefinitions.defs),'Function definitions must remain identical, including original Guards');
// The sole executable role block has explicit capability checks and one grant.
assert(source.includes(newRoleBlock));assert(!source.includes("array['authenticator','supabase_storage_admin']"));
assert(source.includes('grant budget_receipt_worker to authenticator with inherit false, set true;'));
assert(!/grant\s+(?:anon|authenticated|service_role)\s+to\s+budget_receipt_worker/i.test(source));
assert(!/grant\s+budget_receipt_worker\s+to\s+supabase_storage_admin/i.test(source));
const top=tokens(sql),statements=[];let from=0;
for(let i=0;i<top.length;i++)if(top[i].value===';'){statements.push(top.slice(from,i));from=i+1;}
assert.equal(statements.filter(s=>s.length===1&&s[0].value==='begin').length,1);
assert.equal(statements.filter(s=>s.length===1&&s[0].value==='commit').length,1);
assert.equal(built.manifest.sources.length,15);assert.equal(new Set(built.manifest.sources.map(s=>s.file.split('_')[0])).size,15);
assert(!built.manifest.sources.some(s=>s.file===supersededFile));
assert.equal(built.manifest.deploymentAuthorization,false);assert.equal(built.manifest.retainedHotfix.replayed,false);
assert.equal(built.manifest.supersession.originalLedgerRowMustRemainAbsent,true);
assert.equal(hash(normalize(sql)),built.manifest.packetSha256);
console.log(JSON.stringify({packetSha256:built.manifest.packetSha256,bytes:built.manifest.packetBytes,sourceCount:15,originalPacketUnchanged:true,exactGeneratedSql:true,functionDefinitionDeltas:0,explicitSupersession:true,explicitWorkerSetGrantOnlyToAuthenticator:true,implicitCreatorAdminHasNoSetOrInherit:true,reservedRoleGrant:false,outerBegin:1,outerCommit:1,hostedAccess:false}));
