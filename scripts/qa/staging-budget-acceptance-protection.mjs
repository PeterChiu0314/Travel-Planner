import assert from 'node:assert/strict';
import {sha,preflightSql,assertPreflight} from './staging-budget-acceptance-scope.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
export function baseScope(scope){
 assert(uuid(scope.run));assert(scope.trips?.length===2&&new Set(scope.trips).size===2&&scope.trips.every(uuid));assert(scope.users?.length===2&&new Set(scope.users).size===2&&scope.users.every(uuid));
 assert((scope.resources||[]).every(uuid));assert((scope.objects||[]).every(p=>/^[A-Za-z0-9_./-]+$/.test(p)&&scope.trips.some(t=>p.startsWith(`trips/${t}/attachments/`))&&p.includes(scope.run)&&!p.includes('..')));
 return {run:scope.run,trips:scope.trips,users:scope.users};
}
// New QA rows are excluded; all original application/financial/history/Storage
// rows stay in the projection. Only the two approved QA accounts' Auth runtime
// rows are exempt because real login/logout necessarily updates those records.
export function protectedDataExpression(scope){
 baseScope(scope);const arr=values=>`array[${values.map(v=>`'${v}'`).join(',')}]::text[]`,trips=arr(scope.trips),users=arr(scope.users),resources=arr([...scope.trips,...(scope.resources||[])]),objects=arr(scope.objects||[]);
 const filter=`not(coalesce(to_jsonb(t)->>'trip_id'=any(${trips}),false)
 or coalesce(to_jsonb(t)->>'resource_id'=any(${resources}),false)
 or coalesce(to_jsonb(t)->>'budget_item_id'=any(${resources}),false)
 or coalesce(to_jsonb(t)->>'actual_expense_id'=any(${resources}),false)
 or coalesce(to_jsonb(t)->>'budget_id'=any(${resources}),false)
 or coalesce(to_jsonb(t)->>'actual_id'=any(${resources}),false)
 or (%L='public.trips' and coalesce(to_jsonb(t)->>'id'=any(${trips}),false))
 or (%L='auth' and (coalesce(to_jsonb(t)->>'user_id'=any(${users}),false) or (%L='users' and coalesce(to_jsonb(t)->>'id'=any(${users}),false))))
 or (%L='storage.objects' and coalesce(to_jsonb(t)->>'name'=any(${objects}),false)))`;
 const sql=`select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex') d from %I.%I t where ${filter}`;
 const literal=sql.replaceAll("'","''");
 return `(select case when count(*)>0 and bool_and(coalesce((v->>'sha256')~'^[a-f0-9]{64}$',false)) then encode(sha256(convert_to(jsonb_agg(v order by v::text)::text,'UTF8')),'hex') else null end from (select jsonb_build_object('relation',n.nspname||'.'||c.relname,'sha256',(xpath('/table/row/d/text()',query_to_xml(format('${literal}',n.nspname,c.relname,n.nspname||'.'||c.relname,n.nspname,c.relname,n.nspname||'.'||c.relname),true,false,'')))[1]::text) v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','auth','storage') and c.relkind in('r','p')) protected_rows)`;
}
export function scopedPreflightSql(scope){return preflightSql.replace("c.contract||jsonb_build_object('installation',extra.v)",()=>`c.contract||jsonb_build_object('installation',extra.v,'fixtureScopeSha256','${sha(baseScope(scope))}','scopeExistingTrips',(select count(*) from public.trips where id=any(array[${scope.trips.map(v=>`'${v}'::uuid`).join(',')}])),'originalProtection',${protectedDataExpression(scope)})`);}
export function verifyAfter({before,after,scope}){
 assertPreflight(after);assert.equal(after.fixtureScopeSha256,sha(baseScope(scope)));assert.equal(before.fixtureScopeSha256,after.fixtureScopeSha256);
 assert(/^[a-f0-9]{64}$/.test(before.originalProtection));assert.equal(after.originalProtection,before.originalProtection,'Original non-QA rows changed');
 for(const k of ['ledgerDigest','allFunctionBodies','functionAttributes','schemaDigest','roleDigest','unaffectedAcls'])assert.equal(after[k],before[k],k);
 assert.deepEqual(after.protocolRows,before.protocolRows,'All enabled values/latches/readiness must match original OFF contract');
 assert.equal(after.installation.receiptDigest,before.installation.receiptDigest);assert.equal(after.installation.storageDigest,before.installation.storageDigest);assert.equal(after.installation.qaSessionCount,0);
 assert.equal(scope.objects.length,0,'Owned attachment cleanup must complete');
 return {originalNonQaRowsPreserved:true,qaAuthRuntimeExcludedExplicitly:true,existingReceiptsAndObjectsPreserved:true,allProtocolsOff:true,ownedFinancialFixturesRetainedForAudit:true,qaSessionsZero:true};
}
