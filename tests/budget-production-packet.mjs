// Isolated native PG fixture. Never uses a Hosted URL or credential.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
import {nativeBootstrap} from './helpers/b7-native-bootstrap.mjs';
import {migrationSources,hash} from '../scripts/qa/b7-forward-artifacts.mjs';
import {productionPacket,productionTarget,catalogContractQuery,resetTables} from '../scripts/qa/build-b7-production-packet.mjs';
const port=Number(process.env.BUDGET_NATIVE_PORT),marker=process.env.BUDGET_NATIVE_MARKER;
assert(port>1024&&/^[a-f0-9-]{36}$/.test(marker||''));
const pg=await import(pathToFileURL(process.env.BUDGET_NATIVE_PG_MODULE).href),{Client}=pg.default||pg;
const db=new Client({host:'127.0.0.1',port,user:'budget_local_admin',database:'postgres'});
const installer=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres'});
const q=async(sql,args)=>(await db.query(sql,args)).rows;
const iq=async(sql,args)=>(await installer.query(sql,args)).rows;
const results=[];
let installerConnected=false;
const test=async(name,fn)=>{try{await fn();results.push({name,status:'passed'});console.log('PASS '+name);}catch(e){results.push({name,status:'failed',code:e.code,message:e.message});throw e;}};
const user=uuid(),trip=uuid(),budget=uuid(),actual=uuid(),item=uuid(),stay=uuid();
const fingerprint=async()=>({ledger:await q('select * from supabase_migrations.schema_migrations order by version'),data:await q("select * from (select 'budget' k,to_jsonb(t) v from budget_items t union all select 'actual',to_jsonb(t) from actual_expenses t union all select 'baseline',to_jsonb(t) from trip_budget_baselines t union all select 'trip',to_jsonb(t) from trips t union all select 'stay',to_jsonb(t) from accommodations t) s order by k,v::text")});
async function rejected(sql,pattern){const before=await fingerprint();await assert.rejects(()=>iq(sql),e=>pattern.test(e.message));await iq('rollback');assert.deepEqual(await fingerprint(),before);}
try{
 await db.connect();assert.equal((await q("select current_setting('budget_metadata.test_cluster',true) marker"))[0].marker,marker);
 await q(nativeBootstrap);
 await q('create role postgres login noinherit createrole bypassrls;grant authenticator to supabase_storage_admin with inherit false,set true');
 const all=await migrationSources();
 for(const f of all.filter(f=>f.file<='20261028104333_budget_selection_activity.sql'||f.file.startsWith('20261031003000'))){
  await q(f.source);
  const v=f.version==='20260819125851'?'20260819134935':f.version;
  await q('insert into supabase_migrations.schema_migrations values($1,$2,$3)',[v,f.file.slice(f.version.length+1,-4),[f.source]]);
 }
 assert.equal((await q('select count(*)::int n from supabase_migrations.schema_migrations'))[0].n,48);
 await q('insert into auth.users values($1,$2,$3)',[user,'native-production-packet@example.invalid',{}]);
 await q("insert into trips(id,title,name,destination,start_date,end_date,owner_id) values($1,'Keep trip','Keep trip','Fixture','2099-01-01','2099-01-03',$2)",[trip,user]);
 await q("insert into trip_members(trip_id,user_id,role,status) values($1,$2,'owner','approved')",[trip,user]);
 await q("insert into itinerary_items(id,trip_id,day_index,sort_order,type,title) values($1,$2,0,0,'attraction','Keep itinerary')",[item,trip]);
 await q("insert into budget_items(id,trip_id,title,category,amount,twd_amount,payer_id) values($1,$2,'Disposable budget','交通',100,100,$3)",[budget,trip,user]);
 await q('insert into budget_item_participants(budget_item_id,user_id,share_amount) values($1,$2,100)',[budget,user]);
 await q('insert into itinerary_budget_items(itinerary_item_id,budget_item_id) values($1,$2)',[item,budget]);
 await q("insert into actual_expenses(id,trip_id,budget_item_id,title,amount,twd_amount,actual_twd_amount,payer_id,payment_history) values($1,$2,$3,'Disposable actual',100,100,100,$4,'[{\"cost\":100}]')",[actual,trip,budget,user]);
 await q('insert into actual_expense_participants(actual_expense_id,user_id,share_amount) values($1,$2,100)',[actual,user]);
 await q("insert into accommodations(id,trip_id,name,check_in_date,check_out_date,budget_item_id) values($1,$2,'Keep accommodation','2099-01-01','2099-01-02',$3)",[stay,trip,budget]);
 // Simulated managed role without superuser. Supautils itself is not emulated.
 await q(`do $$declare r record;begin
 for r in select nspname from pg_namespace where nspname in('public','app_private','auth','storage','supabase_migrations') loop execute format('grant usage,create on schema %I to postgres with grant option',r.nspname);end loop;
 alter schema public owner to postgres;alter schema app_private owner to postgres;
 for r in select n.nspname,c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','auth','storage','supabase_migrations') and c.relkind in('r','p','S') order by c.relkind='S',c.oid loop execute format('alter %s %I.%I owner to postgres',case r.relkind when 'S' then 'sequence' else 'table' end,r.nspname,r.relname);end loop;
 for r in select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private','auth','storage') and p.prokind='f' loop execute format('alter function %s owner to postgres',r.signature);end loop;
 end$$;`);
 await installer.connect();installerConnected=true;await iq("select set_config('app.b7_install_target',$1,false)",[productionTarget]);
 const plan=JSON.parse(await fs.readFile('docs/operations/budget-b7-production/migration-plan.json','utf8'));
 const tables=await q("select n.nspname||'.'||c.relname relation from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private') and c.relkind='r' order by 1");
 const protection=[];for(const t of tables){const v=(await q(`select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') old_column_sha256 from ${t.relation} t`))[0];protection.push({...t,...v});}
 const hotfix=[];for(const f of plan.hotfix)hotfix.push({signature:f.signature,sha256:(await q("select encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex') h from pg_proc where oid=to_regprocedure($1)",[f.signature]))[0].h});
 const ledger=await q("select version,encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') \"rawRowSha256\" from supabase_migrations.schema_migrations m order by version");
 const catalogContract=(await iq(catalogContractQuery+' contract'))[0].contract;
 const profile={ledger,hotfix,protection,catalogContract};
 const built=await productionPacket(profile),before=await fingerprint();
 await test('Production packet selects exactly17 immutable sources and excludes T0 alias old hotfix',async()=>{assert.equal(built.manifest.sources.length,17);assert(!built.manifest.sources.some(x=>['20260811150000','20260819125851','20261031003000','20261030125028'].includes(x.version)));});
 await test('Incorrect target refuses atomically before reset',async()=>{await iq("set app.b7_install_target='wrong'");await rejected(built.sql,/target binding/);await iq("select set_config('app.b7_install_target',$1,false)",[productionTarget]);});
 await test('Unknown hotfix hash rejects without clearing financial graph',async()=>{const drift=structuredClone(profile);drift.hotfix[0].sha256='0'.repeat(64);await rejected((await productionPacket(drift)).sql,/hotfix body drift/);});
 await test('Raw original ledger hash collision refuses before reset',async()=>{const drift=structuredClone(profile);drift.ledger[0].rawRowSha256='0'.repeat(64);await rejected((await productionPacket(drift)).sql,/ledger raw row drift/);});
 await test('Catalog/RLS drift refuses atomically',async()=>{const drift=structuredClone(profile);drift.catalogContract={};await rejected((await productionPacket(drift)).sql,/catalog\/RLS\/ACL drift/);});
 await test('Protected data mismatch refuses before budget deletion',async()=>{const drift=structuredClone(profile);drift.protection[0].old_column_sha256='0'.repeat(64);await rejected((await productionPacket(drift)).sql,/baseline data drift/);});
 await test('Active editor blocks even privileged budget reset',async()=>{
  await q('begin');
  // Uncommitted row writer must block the packet at its lock boundary. The
  // transaction rollback restores the exact original fixture, no re-sealing.
  await q('update budget_items set locked_by=$2,locked_at=clock_timestamp() where id=$1',[budget,user]);
  try { await assert.rejects(()=>iq(built.sql),e=>e.code==='55P03');await iq('rollback'); }
  finally { await q('rollback'); }
  assert.deepEqual(await fingerprint(),before);
  // Explicit active-lease predicate is exercised through a transaction-local
  // packet prefix after locks; this never changes a published source/profile.
  const sql=built.sql.replace('do $identity$ begin',`update public.budget_items set locked_by='${user}',locked_at=clock_timestamp() where id='${budget}';\ndo $identity$ begin`);
  await rejected(sql,/Active editor/);
 });
 const final=await productionPacket(profile);
 await test('Late injected failure restores reset rows schema roles and ledger',async()=>{await rejected(final.sql.replace("notify pgrst,'reload schema';",'select 1/0;'),/division by zero/);assert.equal((await q("select to_regclass('app_private.budget_metadata_protocol') r"))[0].r,null);assert.equal((await q("select count(*)::int n from pg_roles where rolname='budget_receipt_worker'"))[0].n,0);});
 await test('Budget-only reset and complete17-source install commit in one transaction',async()=>{await iq(final.sql);assert.equal((await q('select count(*)::int n from supabase_migrations.schema_migrations'))[0].n,65);for(const t of resetTables)assert.equal((await q(`select count(*)::int n from ${t}`))[0].n,0,t);assert.equal((await q('select name,budget_item_id from accommodations where id=$1',[stay]))[0].name,'Keep accommodation');assert.equal((await q('select budget_item_id from accommodations where id=$1',[stay]))[0].budget_item_id,null);assert.equal((await q('select title from itinerary_items where id=$1',[item]))[0].title,'Keep itinerary');});
 await test('Original48 source rows unchanged and new17 full sources exact',async()=>{const after=await q("select version,encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') \"rawRowSha256\" from supabase_migrations.schema_migrations m order by version");assert.deepEqual(after.filter(x=>ledger.some(y=>x.version===y.version)),ledger);for(const s of final.manifest.sources){const row=(await q('select name,statements from supabase_migrations.schema_migrations where version=$1',[s.version]))[0];assert.equal(row.name,s.name);assert.equal(row.statements.length,1);assert.equal(hash(row.statements[0]),s.lfSha256);}});
 await test('Final38 hashes and54 PT409/24 PT500 with seven OFF and three false readiness',async()=>{let p409=0,p500=0;for(const f of plan.stagingFinal38Expected){const b=(await q('select prosrc from pg_proc where oid=to_regprocedure($1)',[f.signature]))[0].prosrc;assert.equal(hash(b.replaceAll('\r','')),f.bodySha256,f.signature);p409+=(b.match(/errcode\s*=\s*'PT409'/gi)||[]).length;p500+=(b.match(/errcode\s*=\s*'PT500'/gi)||[]).length;}assert.equal(p409,54);assert.equal(p500,24);for(const t of ['metadata','payment','source','finance','receipt','lifecycle','metadata_undo']){const row=(await q(`select to_jsonb(t) r from app_private.budget_${t}_protocol t`))[0].r;for(const k of ['enabled','activated','full_enabled','storage_verified','cleanup_worker_verified','content_worker_verified'])if(k in row)assert.equal(row[k],false,t+'.'+k);}});
 await test('Completed production packet cannot be replayed',async()=>{await rejected(final.sql,/ledger baseline drift/);});
}finally{
 await db.query('rollback').catch(()=>{});if(installerConnected)await installer.query('rollback').catch(()=>{});
 await Promise.allSettled([...(installerConnected?[installer.end()]:[]),db.end()]);
 await fs.writeFile(process.env.BUDGET_NATIVE_EVIDENCE+'/production-packet-results.json',JSON.stringify({scope:'isolated PostgreSQL fixture only; not Supabase Managed/Auth/HTTP acceptance',results,hostedWrites:false},null,2));
}
