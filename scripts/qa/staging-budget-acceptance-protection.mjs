import assert from 'node:assert/strict';
import {sha,preflightSql,assertPreflight} from './staging-budget-acceptance-scope.mjs';
import {captureUndoRemovalContractQuery} from './build-undo-removal-staging-packet.mjs';
import {schemaExpression,publicationUnion,stableSchemaExpression,managedPublicationsExpression} from './staging-budget-catalog-projections.mjs';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
export function baseScope(scope){
 assert(uuid(scope.run));assert(scope.trips?.length===2&&new Set(scope.trips).size===2&&scope.trips.every(uuid));assert(scope.users?.length===2&&new Set(scope.users).size===2&&scope.users.every(uuid));
 assert((scope.resources||[]).every(uuid));assert((scope.objects||[]).every(p=>/^[A-Za-z0-9_./-]+$/.test(p)&&scope.trips.some(t=>p.startsWith(`trips/${t}/attachments/`))&&p.includes(scope.run)&&!p.includes('..')));
 return {run:scope.run,trips:scope.trips,users:scope.users};
}
// New QA rows are excluded; all original application/financial/history/Storage
// rows stay in the projection. Only the two approved QA accounts' Auth runtime
// rows are exempt because real login/logout necessarily updates those records.
function protectedRelationsQuery(scope){
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
 return `select jsonb_build_object('relation',n.nspname||'.'||c.relname,'sha256',(xpath('/table/row/d/text()',query_to_xml(format('${literal}',n.nspname,c.relname,n.nspname||'.'||c.relname,n.nspname,c.relname,n.nspname||'.'||c.relname),true,false,'')))[1]::text) v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','auth','storage') and c.relkind in('r','p')`;
}
export function protectedDataExpression(scope){return `(select case when count(*)>0 and bool_and(coalesce((v->>'sha256')~'^[a-f0-9]{64}$',false)) then encode(sha256(convert_to(jsonb_agg(v order by v::text)::text,'UTF8')),'hex') else null end from (${protectedRelationsQuery(scope)}) protected_rows)`;}
export function scopedPreflightSql(scope){
 const tripList=scope.trips.map(v=>`'${v}'::uuid`).join(',');
 const fingerprints=`(select coalesce(jsonb_agg(jsonb_build_object('trip',t.id,'ratesSha256',encode(sha256(convert_to(to_jsonb(t.budget_exchange_rates)::text,'UTF8')),'hex'),'baselineSha256',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(b) order by b.trip_id),'[]'::jsonb)::text,'UTF8')),'hex') from public.trip_budget_baselines b where b.trip_id=t.id)) order by t.id),'[]'::jsonb) from public.trips t where t.id=any(array[${tripList}]))`;
 return preflightSql.replace("c.contract||jsonb_build_object('installation',extra.v)",()=>`c.contract||jsonb_build_object('installation',extra.v,'fixtureScopeSha256','${sha(baseScope(scope))}','scopeExistingTrips',(select count(*) from public.trips where id=any(array[${tripList}])),'originalProtection',${protectedDataExpression(scope)},'protectedRelations',(select jsonb_agg(v order by v->>'relation') from (${protectedRelationsQuery(scope)}) protected_rows),'originalSignals',(select coalesce(jsonb_agg(to_jsonb(s) order by s.trip_id),'[]'::jsonb) from public.budget_collaboration_signals s where s.trip_id<>all(array[${tripList}])),'originalSignalTargets',(select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from (select distinct g.trip_id id from app_private.budget_metadata_groups g join public.trips t on t.id=g.trip_id where g.trip_id<>all(array[${tripList}])) signal_targets))`).replace(' acceptance_preflight from c cross join extra;',()=>`||jsonb_build_object('qaTripFingerprints',${fingerprints},'stableSchemaDigest',${stableSchemaExpression},'managedPublications',${managedPublicationsExpression}) acceptance_preflight from c cross join extra;`);
}
export function verifyProtectedRows(before,after){
 const relations=p=>{assert(Array.isArray(p.protectedRelations)&&p.protectedRelations.length>0,'Per-relation protection evidence required');const map=new Map();for(const row of p.protectedRelations){assert(typeof row.relation==='string'&&/^[a-f0-9]{64}$/.test(row.sha256));assert(!map.has(row.relation));map.set(row.relation,row.sha256);}return map;};
 const a=relations(before),b=relations(after);assert.deepEqual([...a.keys()].sort(),[...b.keys()].sort(),'Protected relation coverage changed');
 for(const [name,digest] of a)if(name!=='public.budget_collaboration_signals')assert.equal(b.get(name),digest,`Original rows changed: ${name}`);
 assert(a.has('public.budget_collaboration_signals'));
 assert.deepEqual(after.originalSignalTargets,before.originalSignalTargets,'Original notification targets changed');
 assert(Array.isArray(before.originalSignalTargets)&&Array.isArray(before.originalSignals)&&Array.isArray(after.originalSignals));
 // Five immutable protocol triggers fire once on enable and once on Pause.
 // Keep each original row and all other fields; never reset live revisions.
 const targets=new Set(before.originalSignalTargets),expected=before.originalSignals.map(s=>{assert(Number.isSafeInteger(s.revision));return {...s,revision:s.revision+(targets.has(s.trip_id)?10:0)};});
 assert.deepEqual(after.originalSignals,expected,'Unexpected original Realtime notification changes');
 if(a.get('public.budget_collaboration_signals')===b.get('public.budget_collaboration_signals'))assert.equal(after.originalProtection,before.originalProtection,'Aggregate and relation evidence disagree');
 return {protectedRelations:a.size,protocolNotificationIncrement:10};
}
// One-off, independently observed managed publication additions. This SELECT
// reconstructs the old complete schema digest without changing live catalogs.
export function managedPublicationCaptureSql(scope,dates){
 assert(Array.isArray(dates)&&dates.length>0&&dates.length<=3&&new Set(dates).size===dates.length&&dates.every(d=>/^20\d{2}_\d{2}_\d{2}$/.test(d)));
 const q=captureUndoRemovalContractQuery,start=q.indexOf("'schemaDigest',")+"'schemaDigest',".length,end=q.indexOf(",'roleDigest',",start),needle='union all select to_jsonb(p) from pg_publication_tables p';
 const list=dates.map(d=>`'messages_${d}'`).join(','),condition=`p.pubname='supabase_realtime_messages_publication' and p.schemaname='realtime' and p.tablename in(${list})`,expression=q.slice(start,end);assert(expression.includes(needle));
 const originalProjection=expression.replace(needle,`${needle} where not(${condition})`);
 return scopedPreflightSql(scope).replace(' acceptance_preflight from c cross join extra;',()=>`||jsonb_build_object('schemaWithoutManagedPublicationAdditions',${originalProjection},'managedPublicationAdditions',(select jsonb_agg(to_jsonb(p) order by p.tablename) from pg_publication_tables p where ${condition})) acceptance_preflight from c cross join extra;`);
}
function assertRecordedManagedRows(rows){
 assert(Array.isArray(rows)&&rows.length>0&&rows.length<=3&&new Set(rows.map(r=>r.tablename)).size===rows.length);
 for(const row of rows){assert.deepEqual(Object.keys(row).sort(),['attnames','pubname','rowfilter','schemaname','tablename']);assert.equal(row.pubname,'supabase_realtime_messages_publication');assert.equal(row.schemaname,'realtime');assert(/^messages_20\d{2}_\d{2}_\d{2}$/.test(row.tablename));assert.equal(row.rowfilter,null);assert(Array.isArray(row.attnames)&&row.attnames.length>0&&row.attnames.every(c=>/^[a-z_]+$/.test(c)));}
}
export function recordedManagedPublicationCaptureSql(scope,rows){
 assertRecordedManagedRows(rows);const literal=JSON.stringify(rows).replaceAll("'","''");
 const reconstructed=schemaExpression.replace(publicationUnion,`${publicationUnion} union all select value from jsonb_array_elements('${literal}'::jsonb)`);
 return scopedPreflightSql(scope).replace(' acceptance_preflight from c cross join extra;',()=>`||jsonb_build_object('schemaWithRecordedManagedPublications',${reconstructed},'recordedRemovedManagedPublications','${literal}'::jsonb) acceptance_preflight from c cross join extra;`);
}
export function verifyAfter({before,after,scope}){
 assertPreflight(after);assert.equal(after.fixtureScopeSha256,sha(baseScope(scope)));assert.equal(before.fixtureScopeSha256,after.fixtureScopeSha256);
 assert(/^[a-f0-9]{64}$/.test(before.originalProtection)&&/^[a-f0-9]{64}$/.test(after.originalProtection));const protection=verifyProtectedRows(before,after);
 for(const k of ['ledgerDigest','allFunctionBodies','functionAttributes','roleDigest','unaffectedAcls'])assert.equal(after[k],before[k],k);
 if(before.stableSchemaDigest)assert.equal(after.stableSchemaDigest,before.stableSchemaDigest,'Application or other publication schema drift');
 if(after.schemaDigest!==before.schemaDigest&&!before.stableSchemaDigest){
  if(after.schemaWithRecordedManagedPublications){assertRecordedManagedRows(after.recordedRemovedManagedPublications);assert.equal(after.schemaWithRecordedManagedPublications,before.schemaDigest,'Recorded managed rows do not reconstruct the original schema');}
  else{assert.equal(after.schemaWithoutManagedPublicationAdditions,before.schemaDigest,'Unexplained schema drift');const additions=after.managedPublicationAdditions;assert(Array.isArray(additions)&&additions.length>0&&additions.length<=3);assert.equal(new Set(additions.map(p=>p.tablename)).size,additions.length);assert(additions.every(p=>p.pubname==='supabase_realtime_messages_publication'&&p.schemaname==='realtime'&&/^messages_20\d{2}_\d{2}_\d{2}$/.test(p.tablename)&&p.rowfilter===null),'Only exact managed Realtime publication additions may explain drift');}
 }
 assert.deepEqual(after.protocolRows,before.protocolRows,'All enabled values/latches/readiness must match original OFF contract');
 assert.equal(after.installation.receiptDigest,before.installation.receiptDigest);assert.equal(after.installation.storageDigest,before.installation.storageDigest);assert.equal(after.installation.qaSessionCount,0);
 assert.equal(scope.objects.length,0,'Owned attachment cleanup must complete');
 return {originalNonQaRowsPreserved:true,...protection,qaAuthRuntimeExcludedExplicitly:true,existingReceiptsAndObjectsPreserved:true,allProtocolsOff:true,ownedFinancialFixturesRetainedForAudit:true,qaSessionsZero:true};
}
