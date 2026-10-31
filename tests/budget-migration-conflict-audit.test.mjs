import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tokens,businessRaises,definitions,audit} from '../scripts/qa/audit-budget-migration-conflicts.mjs';

test('lexical audit ignores comments, strings and genuine serialization handlers',()=>{
 const code=`-- raise exception 'fake' using errcode='40001';
 /* /* nested */ fake '40001' */
 begin perform 'errcode=''40001''';
 raise exception 'group_conflict' using errcode = '40001';
 exception when sqlstate '40001' then raise; end;`;
 assert.deepEqual(businessRaises(code).map(s=>s.message),['group_conflict']);
 assert.equal(tokens(code).filter(t=>t.value==='errcode').length,1);
});
test('explicit SQLSTATE and named-condition RAISE are also identified',()=>{
 assert.equal(businessRaises("begin raise sqlstate '40001'; end;").length,1);
 assert.equal(businessRaises("begin raise exception sqlstate '40001'; end;").length,1);
 assert.equal(businessRaises('begin raise serialization_failure; end;').length,1);
 assert.equal(businessRaises('begin raise exception serialization_failure; end;').length,1);
 assert.equal(businessRaises("begin raise exception 'permission' using errcode='42501'; end;").length,0);
});
test('function parser preserves signature, body boundaries and dynamic rewrite separation',()=>{
 const r=definitions(`create or replace function public.demo(p_id uuid,p_default jsonb default '{"x":"a,b"}'::jsonb) returns void language plpgsql as $f$ begin raise exception 'stale' using errcode='40001'; end $f$;
 do $$ begin perform pg_get_functiondef('public.demo(uuid,jsonb)'::regprocedure); raise exception 'install conflict' using errcode='40001'; end $$;`);
 assert.equal(r.defs.length,1);assert.equal(r.defs[0].signature,'public.demo(uuid,jsonb)');assert.equal(r.defs[0].raises.length,1);assert.equal(r.dynamic.length,1);assert.equal(r.doRaises.length,1);
});
test('malformed SQL is rejected rather than silently partially audited',()=>{
 for(const code of ["'unfinished",'/* unfinished','do $x$ unfinished'])assert.throws(()=>tokens(code));
});
test('reviewed chain has the pinned source-site counts and explicit hotfix overwrite',async()=>{
 const r=await audit();assert.equal(r.summary.repositoryMigrations,61);assert.equal(r.summary.pendingB7Migrations,13);assert.equal(r.summary.pendingRaiseSites,141);assert.equal(r.summary.projectedTerminalDirectFunctions,38);assert.equal(r.summary.projectedTerminalRaiseSites,78);assert.equal(r.summary.hotfixSignatures,13);
 assert.deepEqual(r.overwrite.map(x=>[x.signature,x.raises]),[['public.save_budget_workspace_record(uuid,text,uuid,timestamptz,jsonb)',3]]);
 assert.equal(r.dynamicRewrites.length,2);
 assert(r.terminal.every(f=>f.raises.every(s=>s.form==='explicit-errcode')));
});
