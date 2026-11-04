import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {captureUndoRemovalContractQuery} from './build-undo-removal-staging-packet.mjs';
import {stableSchemaExpression} from './staging-budget-catalog-projections.mjs';

export const project='uyqdopksfysbobhjcepk';
export const endpoint=`https://${project}.supabase.co`;
export const allowedProtocols=['metadata','finance','payment','source','lifecycle'];
export const sha=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const cases=[
 ['R01','Live ledger, immutable source and twelve Undo ACLs','readonly'],
 ['R02','Seven protocols OFF; latches and readiness recorded','readonly'],
 ['R03','Existing receipts, objects, data coverage and reusable QA inventory','readonly'],
 ['R04','Realtime publication, RLS and subscription grants','readonly'],
 ['R05','Staging public Auth health and settings','public-http'],
 ['A01','Two real users and three distinct verified Auth sessions','auth'],
 ['A02','All five public Undo RPC signatures reject ordinary JWTs','auth'],
 ['A03','No custom Undo API or global key interception in live frontend','browser'],
 ['A04','Native title and note Undo; number key remains unprevented','browser'],
 ['A05','Saved data unchanged by outside-input Ctrl/Cmd+Z','browser'],
 ['B01','Create and delete Budget through Lifecycle HTTP','finance'],
 ['B02','Title and note autosave reach canonical HTTP data','browser'],
 ['B03','Category and payer edits','finance'],
 ['B04','Pricing equal and custom splits, currency and exchange rate','finance'],
 ['B05','Pay, unpay and pay reuse one Actual and preserve history','finance'],
 ['B06','Manual Actual first Source link and detach preserve financial data','finance'],
 ['B07','Planning Baseline freezes; traveling/settlement match canonical financial graph','travel'],
 ['B08','Failed stale save preserves complete financial graph','finance'],
 ['C01','Different groups edit concurrently','finance'],
 ['C02','Same group blocks peer and second session of same user','finance'],
 ['C03','Lease acquire, renew and release','finance'],
 ['C04','Real stale version returns HTTP409/PT409','finance'],
 ['C05','Actual websocket postgres_changes delivery and peer UI convergence','realtime'],
 ['C06','Three contexts reload to canonical data','browser'],
 ['C07','Real hidden/visible background page preserves edit','browser'],
 ['C08','Real offline context reconnects and restores canonical data','browser'],
 ['C09','Cancel unsaved draft after rejected real admission','browser'],
 ['C10','Nonmember trip and revoked editor permissions isolated','finance'],
 ['D01','Financial receipt metadata insert and upload reject','storage'],
 ['D02','New financial receipt signing request rejects','storage'],
 ['D03','Preexisting signed URL actual access before and after genuine expiry','legacy-url'],
 ['D04','Accommodation attachment upload, sign, bytes read and delete','storage'],
 ['D05','Original receipt metadata and objects unchanged after QA','after'],
 ['Z01','Owned fixtures cleaned or retained for audit; sessions revoked; all protocols OFF','after'],
];

export function assertTarget(url){assert.equal(url,endpoint,'Exact Staging endpoint required before credentials/network');}
export function assertPublicKey(value,admin){
 assert(typeof value==='string'&&value!==admin,'Separate public key required');
 if(value.startsWith('eyJ')){assert(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value));const c=JSON.parse(Buffer.from(value.split('.')[1],'base64url'));assert.equal(c.role,'anon');assert.equal(c.ref,project);}
 else assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(value),'Only a publishable key may be saved in Vite config');
}
export function assertPreflight(p,{active=false,now=Date.now()}={}){
 assert.equal(p.target,project);assert.equal(p.ledgerCount,66);assert.equal(p.ledgerHead,'20261103113253');
 for(const k of ['ledgerDigest','dataDigest','allFunctionBodies','functionAttributes','schemaDigest','roleDigest','unaffectedAcls'])assert(/^[a-f0-9]{64}$/.test(p[k]),`${k} seal required`);
 if(p.stableSchemaDigest!==undefined)assert(/^[a-f0-9]{64}$/.test(p.stableSchemaDigest),'Stable application catalog seal required');
 assert.equal(p.dataProjectionCoverage?.complete,true);assert.equal(p.installation?.sourceSha256,'7d4a96959bbe928c4bf4488311b82f6d5a400315d62eb8b6823dada27ba2e34c');
 assert(now-Date.parse(p.capturedAt)>=0&&now-Date.parse(p.capturedAt)<15*60000,'Fresh read-only preflight required');
 assert.equal(p.protocolRows.undo.enabled,false);assert.equal(p.protocolRows.undo.full_enabled,false);assert.equal(p.protocolRows.receipt.enabled,false);
 for(const name of allowedProtocols)assert.equal(p.protocolRows[name].enabled,active,`${name} protocol state`);
 assert.equal(p.installation.undoAcl.length,12);assert(p.installation.undoAcl.every(v=>!v.anon&&!v.authenticated&&!v.worker));
 assert.equal(p.installation.financialReceiptMetadata,1);assert.equal(p.installation.storageObjects,2);
 assert.equal(p.installation.activeLeases,0);assert.equal(p.installation.activeRatesLeases,0);assert.equal(p.installation.pendingReceipts,0);assert.equal(p.installation.unfinishedCleanup,0);
 assert.equal(p.installation.guardSha256,'38b69ef5f66604f4e5b470593055b7378746db5d11cecb92a50f7c2a16449dd6');
 assert.equal(p.installation.receiptPolicyCount,2);assert(/CREATE UNIQUE INDEX.*WHERE \(budget_item_id IS NOT NULL\)/.test(p.installation.actualIndex));
 return p;
}
export function assertApproval(approval,p){
 assertPreflight(p,{active:true});assert.equal(approval?.target,project);
 assert.equal(approval?.scope,'isolated-budget-http-browser-storage-qa');
 assert(Date.parse(approval.expiresAt)>Date.now()&&Date.parse(approval.expiresAt)-Date.now()<=45*60000,'Bounded user-approved execution window required (maximum45minutes)');
 assert.equal(approval.contractSha256,sha(p),'Approval must identify this exact fresh contract');
 assert.equal(approval.reuseExistingQaUsers,true);assert.equal(approval.createAuthUsers,false);
 assert.equal(approval.modifyLatches,false);assert.equal(approval.enableReceipt,false);assert.equal(approval.enableUndo,false);
}

// Catalog reads only. No user rows, paths, emails, tokens or object bytes returned.
export const preflightSql=`begin read only;set local statement_timeout='30s';
with c as (${captureUndoRemovalContractQuery.replace(/ contract$/,' contract')}), extra as (
select jsonb_build_object(
 'observedAt',clock_timestamp(),'transactionReadOnly',current_setting('transaction_read_only'),
 'sourceSha256',(select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version='20261103113253'),
 'guardSha256',(select encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname='guard_removed_budget_receipts'),
 'actualIndex',(select indexdef from pg_indexes where schemaname='public' and indexname='actual_expenses_one_budget'),
 'receiptPolicyCount',(select count(*) from pg_policies where policyname in('removed_receipts_metadata_read','removed_receipts_storage') and permissive='RESTRICTIVE'),
 'undoAcl',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'),'worker',has_function_privilege('budget_receipt_worker',p.oid,'execute')) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.proname in('undo_budget_metadata_group','undo_budget_workspace','budget_workspace_undo_lease','read_budget_metadata_undo','clear_budget_metadata_undo','prepare_budget_metadata_undo','workspace_undo_lease','prepare_workspace_inverse','workspace_inverse_manifest','finish_workspace_inverse')),
 'financialReceiptMetadata',(select count(*) from public.attachments where target_type in('budget_item','actual_expense')),
 'storageObjects',(select count(*) from storage.objects),
 'receiptDigest',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)::text,'UTF8')),'hex') from public.attachments t where target_type in('budget_item','actual_expense')),
 'receiptPathHashes',(select coalesce(jsonb_agg(encode(sha256(convert_to(file_url,'UTF8')),'hex')),'[]'::jsonb) from public.attachments where target_type in('budget_item','actual_expense')),
 'storageDigest',(select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)::text,'UTF8')),'hex') from storage.objects t),
 'authUserCount',(select count(*) from auth.users),'qaTaggedUserCount',(select count(*) from auth.users where raw_user_meta_data ? 'qa_run'),
 'qaIdentities',(select coalesce(jsonb_agg(jsonb_build_object('idSha256',encode(sha256(convert_to(id::text,'UTF8')),'hex'),'runSha256',encode(sha256(convert_to(raw_user_meta_data->>'qa_run','UTF8')),'hex'))),'[]'::jsonb) from auth.users where raw_user_meta_data ? 'qa_run'),
 'qaSessionCount',(select count(*) from auth.sessions s join auth.users u on u.id=s.user_id where u.raw_user_meta_data ? 'qa_run'),
 'activeLeases',(select count(*) from app_private.budget_metadata_groups where expires_at>clock_timestamp())+(select count(*) from app_private.budget_edit_leases where expires_at>clock_timestamp()),
 'activeRatesLeases',(select count(*) from app_private.budget_rates_leases where expires_at>clock_timestamp()),
 'pendingReceipts',(select count(*) from app_private.budget_receipt_intents where status='pending'),
 'unfinishedCleanup',(select count(*) from app_private.budget_receipt_cleanup where status<>'done'),
 'realtimeTables',(select coalesce(jsonb_agg(tablename order by tablename),'[]'::jsonb) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public'),
 'realtimeSignalSelect',has_table_privilege('authenticated','public.budget_collaboration_signals','select'),
 'applicationRlsOff',(select count(*) from pg_class t join pg_namespace n on n.oid=t.relnamespace where n.nspname in('public','app_private') and t.relkind='r' and not t.relrowsecurity)
) v)
select c.contract||jsonb_build_object('installation',extra.v) acceptance_preflight from c cross join extra;commit;`;

export function freshMatrix(){return cases.map(([id,name,phase])=>({id,name,phase,status:phase==='public-http'?'Not Run':'Blocked',environment:phase==='readonly'?'Hosted catalog':'Hosted real Auth/HTTP/browser',reason:phase==='readonly'?'Fresh read-only capture pending':'Requires explicit Hosted QA authorization and/or real credential/session input'}));}

// Offline generation only. Executing these statements is a separate approved
// Dashboard step; the HTTP runner never connects with SQL/admin DDL privileges.
export function protocolControls(p){
 assertPreflight(p);for(const k of ['finance','receipt','lifecycle'])assert.equal(p.protocolRows[k].activated,true,'Existing latch must already be true; never set it');
 const literal=JSON.stringify(p.protocolRows).replaceAll("'","''");
 const body=enabled=>allowedProtocols.map(name=>`update app_private.budget_${name}_protocol set enabled=${enabled} where singleton;`).join('\n');
 const pre=`begin;set local lock_timeout='3s';set local statement_timeout='30s';
do $$begin
 if (select count(*) from supabase_migrations.schema_migrations)<>66 or not exists(select 1 from supabase_migrations.schema_migrations where version='20261103113253' and encode(sha256(convert_to(statements[1],'UTF8')),'hex')='${p.installation.sourceSha256}') then raise exception 'Ledger/source drift';end if;
 if exists(select 1 from app_private.budget_metadata_groups where expires_at>clock_timestamp()) or exists(select 1 from app_private.budget_edit_leases where expires_at>clock_timestamp()) or exists(select 1 from app_private.budget_rates_leases where expires_at>clock_timestamp()) then raise exception 'Active leases; refuse protocol transition';end if;
 if exists(select 1 from app_private.budget_receipt_intents where status='pending') or exists(select 1 from app_private.budget_receipt_cleanup where status<>'done') then raise exception 'In-flight Receipt job';end if;
end $$;`;
 const controlCapture=p.stableSchemaDigest?`select contract||jsonb_build_object('stableSchemaDigest',${stableSchemaExpression}) contract from (${captureUndoRemovalContractQuery}) original_capture`:captureUndoRemovalContractQuery;
 const compare=(active)=>`do $$
#variable_conflict use_column
declare v jsonb;state jsonb;begin select contract into state from (${controlCapture}) c;v:=state->'protocolRows';
 ${['ledgerDigest','allFunctionBodies','functionAttributes',p.stableSchemaDigest?'stableSchemaDigest':'schemaDigest','roleDigest','unaffectedAcls'].map(k=>`if state->>'${k}' is distinct from '${p[k]}' then raise exception '${k} drift';end if;`).join('\n')}
 if ${active?allowedProtocols.map(k=>`not coalesce((v->'${k}'->>'enabled')::boolean,false)`).join(' or '):`v is distinct from '${literal}'::jsonb`} then raise exception 'Protocol state drift';end if;
 ${active?allowedProtocols.map(k=>`v:=jsonb_set(v,'{${k},enabled}','false'::jsonb);`).join('\n'):''}
 if v is distinct from '${literal}'::jsonb then raise exception 'Latch/readiness/removed-feature drift';end if;
end $$;`;
 return {target:project,globalStagingScope:true,enable:`${pre}\n${compare(false)}\n${body(true)}\n${compare(true)}\ncommit;`,pause:`${pre}\n${compare(true)}\n${body(false)}\n${compare(false)}\ncommit;`};
}
