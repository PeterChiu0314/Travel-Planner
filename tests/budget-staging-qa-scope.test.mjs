import test from 'node:test';import assert from 'node:assert/strict';
import {execute as service} from '../scripts/qa/b7-staging-service-checks.mjs';
import {execute as worker} from '../scripts/qa/b7-staging-platform-worker-checks.mjs';
import {execute as large} from '../scripts/qa/b7-staging-large-storage-check.mjs';
import {execute as recover} from '../scripts/qa/b7-staging-large-storage-recover.mjs';
for(const [name,execute] of Object.entries({service,worker,large,recover})){
 test(`${name} refuses wrong project or endpoint before any credential or network use`,async()=>{
  const credentials=new Proxy({},{get(){throw Error('Credentials accessed before target validation');}});
  for(const runtime of [{project:'wrong-project',url:'https://wrong-project.invalid'},{project:'uyqdopksfysbobhjcepk',url:'https://wrong-project.invalid'}])await assert.rejects(execute({credentials,runtime,args:{mode:'initialize'}}),/Staging-only QA/);
 });
}
