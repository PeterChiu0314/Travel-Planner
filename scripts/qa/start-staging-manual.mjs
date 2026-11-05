// Explicit local manual-test entry. No admin key, session seeding, Worker,
// database transition or Production fallback.
import assert from 'node:assert/strict';
import {createServer,loadEnv} from 'vite';
const env=loadEnv('staging',process.cwd(),'VITE_');
assert.equal(env.VITE_SUPABASE_URL,'https://uyqdopksfysbobhjcepk.supabase.co','Exact Staging configuration required');
assert(env.VITE_SUPABASE_ANON_KEY,'Staging public key required');
Object.assign(process.env,{VITE_SUPABASE_URL:env.VITE_SUPABASE_URL,VITE_SUPABASE_ANON_KEY:env.VITE_SUPABASE_ANON_KEY,VITE_BUDGET_METADATA_GROUPS:'true',VITE_BUDGET_FINANCE_GROUPS:'true',VITE_BUDGET_LIFECYCLE:'true',VITE_BUDGET_RECEIPTS:'false',VITE_BUDGET_RECEIPTS_DISABLED:'true',VITE_MAP_PROVIDER:'static'});
const server=await createServer({mode:'staging',server:{host:'127.0.0.1',port:5174,strictPort:true,watch:{ignored:['**/.tmp-*/**']}}});
await server.listen();console.log('Staging manual test: http://127.0.0.1:5174 (normal sign-in; static maps)');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await server.close();process.exit(0);});
