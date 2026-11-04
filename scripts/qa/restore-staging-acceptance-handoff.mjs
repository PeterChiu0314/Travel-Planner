// Offline restore of non-secret QA scope only. Never restores credentials,
// sessions, execution approval, or a supposedly fresh before.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {project,sha} from './staging-budget-acceptance-scope.mjs';
import {baseScope,scopedPreflightSql} from './staging-budget-acceptance-protection.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const handoff=JSON.parse(await fs.readFile(path.join(root,'docs/qa/2026-11-04-budget-staging-handoff.json'),'utf8'));
assert.equal(handoff.version,1);assert.equal(handoff.project,project);
assert.equal(execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim(),handoff.branch,'Switch to the original feature branch first');
baseScope(handoff.plan);assert.deepEqual(handoff.plan.users,handoff.qaIdentity.users);
assert.equal(handoff.fixtureScope.run,handoff.plan.run);assert.equal(handoff.continuation.run,handoff.plan.run);
assert(handoff.fixtureScope.resources.includes(handoff.continuation.budget));
assert.equal(sha(handoff.continuation),handoff.continuationSha256);
assert(Object.values(handoff.lastOff.protocolRows).every(p=>p.enabled===false));
assert.equal(handoff.lastOff.protocolRows.undo.full_enabled,false);

const dir=path.join(root,'.tmp-staging-budget-acceptance');
await fs.mkdir(dir,{recursive:true});await fs.mkdir(path.join(root,'.tmp-b7-p1'),{recursive:true});
const files=[
 ['.tmp-b7-p1/qa-scope.json',handoff.qaIdentity],
 ['.tmp-staging-budget-acceptance/qa-plan.json',handoff.plan],
 ['.tmp-staging-budget-acceptance/fixture-scope.json',handoff.fixtureScope],
 ['.tmp-staging-budget-acceptance/continuation.json',handoff.continuation],
 ['.tmp-staging-budget-acceptance/last-handoff-off.json',handoff.lastOff],
];
// Check every conflict before writing anything. A different pending run must
// be inspected and preserved by the operator, never silently overwritten.
for(const [relative,value] of files){try{assert.equal(sha(JSON.parse(await fs.readFile(path.join(root,relative),'utf8'))),sha(value),`Different local QA artifact: ${relative}`);}catch(error){if(error.code!=='ENOENT')throw error;}}
for(const [relative,value] of files){try{await fs.writeFile(path.join(root,relative),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}}
await fs.writeFile(path.join(dir,'home-preflight.sql'),scopedPreflightSql(handoff.fixtureScope));
console.log('Non-secret QA scope restored. No Hosted request or credential restored.');
console.log('Execute home-preflight.sql READ ONLY on the exact Staging project; compare with last-handoff-off.json before any Resume.');
