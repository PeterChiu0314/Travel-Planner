import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {createStagingCredentialProvider,credentialProject} from '../scripts/qa/staging-worker-credentials.mjs';
const sign=(c,s)=>{const head=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url'),body=Buffer.from(JSON.stringify({ref:credentialProject,exp:Math.floor(Date.now()/1000)+3600,...c})).toString('base64url');return head+'.'+body+'.'+createHmac('sha256',s).update(head+'.'+body).digest('base64url');};
const make=(secret,overrides={})=>({secret,admin:sign({role:'service_role'},secret),anon:sign({role:'anon'},secret),...overrides});
test('Provider issues only dedicated900-second Staging JWT with trusted HMAC and no master secret in result',()=>{
 const secret=randomBytes(48),copy=Buffer.from(secret),provider=createStagingCredentialProvider(make(secret));
 const r=provider.issue(),[h,p,s]=r.worker.split('.'),c=JSON.parse(Buffer.from(p,'base64url'));
 assert.equal(c.exp-c.iat,900);assert.equal(c.role,'budget_receipt_worker');assert.equal(c.ref,credentialProject);assert.equal(createHmac('sha256',copy).update(h+'.'+p).digest('base64url'),s);assert.deepEqual(Object.keys(r).sort(),['admin','anon','worker']);
 provider.stop();assert(secret.every(x=>x===0));assert.throws(()=>provider.issue(),/stopped/);
});
test('Wrong project, role or mismatched signing material fails before use',()=>{
 const s=randomBytes(48);for(const overrides of [{admin:sign({role:'service_role',ref:'wrong-project'},s)},{admin:sign({role:'authenticated'},s)},{anon:sign({role:'anon'},randomBytes(48))},{admin:sign({role:'service_role',exp:1},s)}]){const copy=Buffer.from(s);assert.throws(()=>createStagingCredentialProvider(make(copy,overrides)));assert(copy.every(x=>x===0));}
});
test('Modern publishable key is accepted only with the exact Staging URL; admin signer checks remain strict',()=>{
 const secret=randomBytes(48),provider=createStagingCredentialProvider(make(secret,{anon:'sb_publishable_synthetic_public_key',projectUrl:`https://${credentialProject}.supabase.co`}));
 const c=provider.issue();assert.equal(c.anon,'sb_publishable_synthetic_public_key');assert.equal(JSON.parse(Buffer.from(c.worker.split('.')[1],'base64url')).role,'budget_receipt_worker');provider.stop();
 for(const override of [{projectUrl:'https://other-project.supabase.co'},{projectUrl:undefined},{anon:'sb_publishable_invalid space',projectUrl:`https://${credentialProject}.supabase.co`},{admin:'sb_secret_not_a_legacy_jwt',projectUrl:`https://${credentialProject}.supabase.co`}]){const s=randomBytes(48);assert.throws(()=>createStagingCredentialProvider(make(s,{anon:'sb_publishable_synthetic_public_key',...override})));assert(s.every(x=>x===0));}
});
