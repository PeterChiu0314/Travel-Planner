import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Catalog audit against the fresh native cluster. Does not impersonate real
// Auth/Storage HTTP, and does not rerun completed functional test suites.
export async function securityAuditCases({test,admin}){
 await test('B7 Security audit verified TLS is negotiated on the actual PostgreSQL connection',async()=>{
  const [ssl]=await admin('select ssl,version,bits from pg_stat_ssl where pid=pg_backend_pid()');assert.equal(ssl.ssl,true);assert(ssl.bits>=128);assert(/^TLSv1\.[23]$/.test(ssl.version));return {tls:ssl,certificateVerification:'CA and 127.0.0.1 SAN verified by node-postgres'};
 });
 await test('B7 Security audit all new protocols and content attestation remain default off',async()=>{
  const rows=await admin("select 'metadata' name,enabled from app_private.budget_metadata_protocol union all select 'finance',enabled from app_private.budget_finance_protocol union all select 'payment',enabled from app_private.budget_payment_protocol union all select 'source',enabled from app_private.budget_source_protocol union all select 'receipts',enabled from app_private.budget_receipt_protocol union all select 'lifecycle',enabled from app_private.budget_lifecycle_protocol union all select 'undo',enabled or full_enabled from app_private.budget_metadata_undo_protocol union all select 'content_worker_verified',content_worker_verified from app_private.budget_receipt_protocol");assert(rows.every(r=>r.enabled===false));return {protocols:rows};
 });
 await test('B7 Security audit private tables require RLS no client grants and no Realtime publication',async()=>{
  const tables=await admin("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app_private' and c.relkind='r' order by c.relname");assert(tables.length>10);assert(tables.every(t=>t.relrowsecurity));assert.deepEqual(await admin("select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='app_private' and grantee in('PUBLIC','anon','authenticated','budget_receipt_worker')"),[]);assert.deepEqual(await admin("select tablename from pg_publication_tables where schemaname='app_private'"),[]);return {tables};
 });
 await test('B7 Security audit financial public tables have RLS and trip-bound policies',async()=>{
  const names=['budget_items','actual_expenses','budget_item_participants','actual_expense_participants','itinerary_budget_items','attachments','trip_budget_baselines'];
  const tables=await admin("select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1) order by c.relname",[names]);assert.equal(tables.length,names.length);assert(tables.every(t=>t.relrowsecurity));const policies=await admin("select tablename,policyname,cmd,qual,with_check from pg_policies where schemaname='public' and tablename=any($1) order by tablename,policyname",[names]);for(const n of names)assert(policies.some(p=>p.tablename===n));assert(policies.every(p=>p.qual!=='true'&&p.with_check!=='true'));for(const p of policies)for(const predicate of [p.qual,p.with_check].filter(Boolean))assert(/app_private\.can_(read|edit)_trip\(/.test(predicate),`${p.tablename}.${p.policyname} must check trip permission`);return {tables,policies};
 });
 await test('B7 Security audit public mutation RPCs are invoker and cannot execute as anon',async()=>{
  const names=['mutate_budget_payment_v2','mutate_budget_source','mutate_budget_receipts','undo_budget_workspace','create_budget_workspace_placeholder','delete_itinerary_item_budget_safe'];const apis=await admin("select p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1) order by p.proname",[names]);assert.equal(apis.length,names.length);assert(apis.every(p=>!p.prosecdef&&!p.anon));return {apis};
 });
 await test('B7 Security audit new privileged helpers pin search_path and never grant PUBLIC execute',async()=>{
  const names=['guard_budget_group_children_required','guard_budget_external_parent','fence_budget_protocol_transition','claim_receipt_verification','finish_receipt_verification','receipt_worker_object_allowed','replay_legacy_budget','legacy_budget_blocked'];const helpers=await admin("select p.proname,p.prosecdef,p.proconfig,exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where x.grantee=0 and x.privilege_type='EXECUTE') public_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname=any($1) order by p.proname",[names]);assert.equal(helpers.length,names.length);assert(helpers.every(p=>p.prosecdef&&p.proconfig?.some(c=>c.startsWith('search_path='))&&!p.public_execute));return {helpers};
 });
 await test('B7 Security audit dedicated Worker has no bypass inherited user roles or Storage write privileges',async()=>{
  const [role]=await admin("select rolname,rolsuper,rolbypassrls,rolcanlogin,rolinherit from pg_roles where rolname='budget_receipt_worker'");assert(role&&!role.rolsuper&&!role.rolbypassrls&&!role.rolcanlogin&&!role.rolinherit);
  for(const r of ['anon','authenticated','service_role'])assert.equal((await admin("select pg_has_role('budget_receipt_worker',$1,'member') v",[r]))[0].v,false);
  assert.equal((await admin("select has_table_privilege('budget_receipt_worker','storage.objects','INSERT,UPDATE') v"))[0].v,false);
  const policies=await admin("select tablename,policyname,cmd,roles,qual from pg_policies where schemaname='storage' and 'budget_receipt_worker'=any(roles) order by tablename,policyname");assert.equal(policies.length,3);assert(policies.filter(p=>p.tablename==='objects').every(p=>p.qual.includes('receipt_worker_object_allowed')));return {role,policies,storageHTTP:'Blocked; catalog fixture is not the real Storage service'};
 });
 await test('B7 Security audit Preflight and financial readback execute without changing default flags',async()=>{
  await admin(await fs.readFile(new URL('../docs/operations/budget-b7-preflight.sql',import.meta.url),'utf8'));await admin(await fs.readFile(new URL('../docs/operations/budget-b7-readback.sql',import.meta.url),'utf8'));assert.equal((await admin('select enabled from app_private.budget_metadata_protocol'))[0].enabled,false);
 });
 await test('B7 Security audit activation fence and financial effect guards are enabled on their expected tables',async()=>{
  const triggers=await admin("select n.nspname,c.relname,t.tgname,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where t.tgname in('a_budget_protocol_transition','a_group_effect_required','a_budget_parent_delete') order by n.nspname,c.relname,t.tgname");assert.equal(triggers.filter(t=>t.tgname==='a_budget_protocol_transition').length,11);assert.equal(triggers.filter(t=>t.tgname==='a_group_effect_required').length,3);assert.equal(triggers.filter(t=>t.tgname==='a_budget_parent_delete').length,4);assert(triggers.every(t=>t.tgenabled==='O'));return {triggers};
 });
}
