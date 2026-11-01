// Offline builder. Official CLI version; never connects or applies a migration.
import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {transactionBody} from './b7-forward-artifacts.mjs';
export const cutoverDir='docs/operations/budget-b7-legacy-cutover',cutoverVersion='20261101032853',cutoverName='budget_receipt_legacy_cutover';
export const hash=s=>createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const expected={
 'app_private.guard_receipt_metadata()':'8d8577fcf0803cd3cab51429a58dcf025d3b62279e5f7f79b1e3593cf5c59965',
 'app_private.latch_budget_receipts()':'2b9737d0470fb13d6f8d7ee3e12444a9b1549b9f95f7a1b6dcac1c7d9e15e83b',
 'app_private.receipt_path_protected(text,text)':'4dfc4622d6fbd4edd0287e5cfd199cebcbe81b44195541bd7fc1a77a96cb6a30',
};
const replaceOnce=(s,a,b)=>{assert.equal(s.split(a).length,2,'Exact existing guard shape required');return s.replace(a,b);};
export async function buildCutover(){
 const inventory=JSON.parse(await fs.readFile(cutoverDir+'/baseline-functions.json','utf8'));assert.equal(inventory.ledger.count,64);assert.equal(inventory.ledger.head,'20261031140648');
 const old=inventory.functions;assert.equal(old.length,3);for(const f of old)assert.equal(hash(f.body),expected[f.signature],'Unknown before hash; never auto-reseal');
 const definitions=old.map(f=>{
  let body=f.body;
  if(f.signature.includes('receipt_path_protected'))body=replaceOnce(body,'app_private.receipts_activated() and','(app_private.receipts_activated() or app_private.budget_receipt_legacy_frozen()) and');
  else if(f.signature.includes('guard_receipt_metadata'))body=replaceOnce(body," if (a->>'target_type'='actual_expense' or b->>'target_type'='actual_expense') and app_private.receipts_activated() then",` if (a->>'target_type'='actual_expense' or b->>'target_type'='actual_expense') and app_private.budget_receipt_legacy_frozen() and not app_private.receipts_activated() then
  raise exception 'Receipt writes paused for secure cutover; existing receipts preserved' using errcode='55000';
 end if;
 if (a->>'target_type'='actual_expense' or b->>'target_type'='actual_expense') and app_private.receipts_activated() then`);
  else{
   body=replaceOnce(body,'new.legacy_grants_expire_at is null or new.legacy_grants_expire_at>clock_timestamp()','not app_private.budget_receipt_legacy_exhausted()');
   body=replaceOnce(body,'expired legacy upload grants','verified legacy capability invalidation');
  }
  assert.equal(f.definition.split(f.body).length,2);return {signature:f.signature,beforeSha256:hash(f.body),afterSha256:hash(body),body,definition:f.definition.replace(f.body,body)};
 });
 const helpers=[
 {signature:'app_private.budget_receipt_legacy_frozen()',kind:'sql stable security definer',returns:'boolean',args:'',body:`select exists(select 1 from app_private.budget_receipt_legacy_cutover where event='stopped')`},
 {signature:'app_private.budget_receipt_legacy_exhausted()',kind:'sql stable security definer',returns:'boolean',args:'',body:`select exists(select 1 from app_private.budget_receipt_legacy_cutover a join app_private.budget_receipt_legacy_cutover s on s.event='stopped' and s.request_id=a.request_id and a.recorded_at>=s.recorded_at where a.event='invalidated' and a.details->>'strategy'='url_signing_key_revocation' and a.proof_sha256 ~ '^[a-f0-9]{64}$')`},
 {signature:'app_private.guard_budget_receipt_cutover_journal()',kind:'plpgsql volatile security definer',returns:'trigger',args:'',body:`begin raise exception 'Legacy cutover journal is append-only; use forward repair' using errcode='55000';end`},
 {signature:'app_private.stop_budget_receipt_legacy_issuance(uuid,uuid[],text)',kind:'plpgsql volatile security invoker',returns:'jsonb',args:'p_request uuid,p_accepted_kids uuid[],p_before_sha text',body:`
declare oldrow app_private.budget_receipt_legacy_cutover;keys jsonb;detail jsonb;begin
 if current_setting('app.b7_install_target',true) is distinct from 'uyqdopksfysbobhjcepk' then raise exception 'Explicit Staging target required' using errcode='55000';end if;
 if p_request is null or p_before_sha is null or p_before_sha !~ '^[a-f0-9]{64}$' or cardinality(p_accepted_kids) is null or cardinality(p_accepted_kids) not between 1 and 2 or array_position(p_accepted_kids,null) is not null or cardinality(p_accepted_kids)<>(select count(distinct k) from unnest(p_accepted_kids) k) then raise exception 'Exact accepted URL key inventory and proof required' using errcode='22023';end if;
 select jsonb_agg(k::text order by k::text) into keys from unnest(p_accepted_kids) k;
 detail:=jsonb_build_object('project','uyqdopksfysbobhjcepk','accepted_kids',keys);
 lock table app_private.budget_receipt_legacy_cutover in exclusive mode nowait;
 select * into oldrow from app_private.budget_receipt_legacy_cutover where event='stopped';
 if found then
  if oldrow.request_id is distinct from p_request or oldrow.details is distinct from detail or oldrow.proof_sha256 is distinct from p_before_sha then raise exception 'Legacy cutover stop request mismatch' using errcode='22023';end if;
  return to_jsonb(oldrow);
 end if;
 lock table app_private.budget_metadata_protocol,app_private.budget_finance_protocol,app_private.budget_payment_protocol,app_private.budget_source_protocol,app_private.budget_receipt_protocol,app_private.budget_lifecycle_protocol,app_private.budget_metadata_undo_protocol in share row exclusive mode nowait;
 if exists(select 1 from app_private.budget_metadata_protocol where enabled) or exists(select 1 from app_private.budget_finance_protocol where enabled or activated) or exists(select 1 from app_private.budget_payment_protocol where enabled) or exists(select 1 from app_private.budget_source_protocol where enabled) or exists(select 1 from app_private.budget_receipt_protocol where enabled or activated) or exists(select 1 from app_private.budget_lifecycle_protocol where enabled or activated) or exists(select 1 from app_private.budget_metadata_undo_protocol where enabled or full_enabled) then raise exception 'Start cutover only while all protocols are dormant' using errcode='55000';end if;
 if exists(select 1 from app_private.budget_edit_leases where expires_at>clock_timestamp()) or exists(select 1 from app_private.budget_metadata_groups where expires_at>clock_timestamp()) or exists(select 1 from app_private.budget_rates_leases where expires_at>clock_timestamp()) then raise exception 'Drain active leases before cutover' using errcode='55000';end if;
 insert into app_private.budget_receipt_legacy_cutover(event,request_id,proof_sha256,details) values('stopped',p_request,p_before_sha,detail) returning * into oldrow;
 return to_jsonb(oldrow);
end`},
 {signature:'app_private.attest_budget_receipt_legacy_invalidation(uuid,jsonb,text)',kind:'plpgsql volatile security invoker',returns:'jsonb',args:'p_request uuid,p_proof jsonb,p_evidence_sha text',body:`
declare stopped app_private.budget_receipt_legacy_cutover;oldrow app_private.budget_receipt_legacy_cutover;retired jsonb;accepted jsonb;active uuid;required jsonb;begin
 if current_setting('app.b7_install_target',true) is distinct from 'uyqdopksfysbobhjcepk' then raise exception 'Explicit Staging target required' using errcode='55000';end if;
 lock table app_private.budget_receipt_legacy_cutover in exclusive mode nowait;
 select * into stopped from app_private.budget_receipt_legacy_cutover where event='stopped';
 if stopped.event is null or stopped.request_id is distinct from p_request then raise exception 'Matching issuance stop required' using errcode='55000';end if;
 select * into oldrow from app_private.budget_receipt_legacy_cutover where event='invalidated';
 if found then
  if oldrow.request_id is distinct from p_request or oldrow.details is distinct from p_proof or oldrow.proof_sha256 is distinct from p_evidence_sha then raise exception 'Legacy invalidation proof replay mismatch' using errcode='22023';end if;
  return to_jsonb(oldrow);
 end if;
 required:=jsonb_build_object('new_signed_upload_denied',true,'old_signed_upload_denied',true,'old_signed_tus_denied',true,'old_authenticated_tus_denied',true,'old_s3_session_denied',true,'download_scope_upload_denied',true,'fresh_signed_download_works',true,'qa_bytes_preserved',true,'no_unfinished_multipart',true,'signers_quiesced',true);
 if p_evidence_sha is null or p_evidence_sha !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_proof) is distinct from 'object' or p_proof-array['project','strategy','stop_at','retired_kids','accepted_kids','active_kid','checks','http_evidence_sha256']<>'{}' or p_proof->>'project' is distinct from 'uyqdopksfysbobhjcepk' or p_proof->>'strategy' is distinct from 'url_signing_key_revocation' or p_proof->'stop_at' is distinct from to_jsonb(stopped.recorded_at) or p_proof->'checks' is distinct from required or coalesce(p_proof->>'http_evidence_sha256','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_proof->'retired_kids') is distinct from 'array' or jsonb_typeof(p_proof->'accepted_kids') is distinct from 'array' then raise exception 'Complete real HTTP and URL-key revocation evidence required; never invent expiry' using errcode='22023';end if;
 active:=(p_proof->>'active_kid')::uuid;
 select jsonb_agg(k::uuid::text order by k::uuid::text) into retired from jsonb_array_elements_text(p_proof->'retired_kids') k;
 select jsonb_agg(k::uuid::text order by k::uuid::text) into accepted from jsonb_array_elements_text(p_proof->'accepted_kids') k;
 if active is null or retired is distinct from stopped.details->'accepted_kids' or accepted is distinct from jsonb_build_array(active::text) or retired ? active::text then raise exception 'Every previously accepted URL key must be revoked; no unknown accepted key' using errcode='22023';end if;
 if exists(select 1 from storage.s3_multipart_uploads) or exists(select 1 from storage.s3_multipart_uploads_parts) or exists(select 1 from app_private.budget_receipt_cleanup where status in('waiting','claimed','blocked')) or exists(select 1 from app_private.budget_receipt_intents where status='pending') then raise exception 'Drain outstanding uploads and receipt work before attestation' using errcode='55000';end if;
 insert into app_private.budget_receipt_legacy_cutover(event,request_id,proof_sha256,details) values('invalidated',p_request,p_evidence_sha,p_proof) returning * into oldrow;
 -- Cryptographic revocation is not natural expiration. Do not manufacture or
 -- backdate budget_receipt_protocol.legacy_grants_expire_at.
 return to_jsonb(oldrow);
end`},
 ];
 for(const h of helpers){h.name=h.signature.split('(')[0];h.definition=`create function ${h.name}(${h.args}) returns ${h.returns} language ${h.kind} set search_path='' as $cutover_function$${h.body}$cutover_function$;`;h.afterSha256=hash(h.body);}
 const ddl=`create table app_private.budget_receipt_legacy_cutover(
 event text primary key constraint budget_receipt_cutover_event check(event in('stopped','invalidated')),
 request_id uuid not null,recorded_at timestamptz not null default clock_timestamp(),
 proof_sha256 text not null constraint budget_receipt_cutover_proof check(proof_sha256 ~ '^[a-f0-9]{64}$'),
 details jsonb not null constraint budget_receipt_cutover_details check(jsonb_typeof(details)='object'));
 alter table app_private.budget_receipt_legacy_cutover enable row level security;
 revoke all on app_private.budget_receipt_legacy_cutover from public,anon,authenticated,service_role,budget_receipt_worker;
 ${helpers.map(h=>h.definition).join('\n')}
 create trigger immutable_budget_receipt_cutover before update or delete on app_private.budget_receipt_legacy_cutover for each row execute function app_private.guard_budget_receipt_cutover_journal();
 revoke all on function ${helpers.map(h=>h.signature).join(',')} from public,anon,authenticated,service_role,budget_receipt_worker;
 ${definitions.map(f=>f.definition.trim().replace(/;+$/,'')+';').join('\n')}`;
 const values=definitions.map(f=>`('${f.signature}','${f.beforeSha256}','${f.afterSha256}')`).join(','),newValues=helpers.map(h=>`('${h.signature}','${h.afterSha256}','${h.kind}','${h.returns}')`).join(',');
 const checks=`
 for f in select * from (values ${values}) s(signature,before_sha,after_sha) loop
  if (select encode(sha256(convert_to(replace(prosrc,chr(13),''),'UTF8')),'hex') from pg_proc where oid=to_regprocedure(f.signature)) is distinct from f.after_sha then raise exception 'Cutover final function drift: %',f.signature;end if;
 end loop;
 for f in select * from (values ${newValues}) s(signature,after_sha,kind,returns) loop
  select * into p from pg_proc where oid=to_regprocedure(f.signature);
  if p.oid is null or encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex') is distinct from f.after_sha or p.proowner<>owner_oid or p.proconfig is distinct from array['search_path=""']::text[] or p.prosecdef is distinct from (f.kind like '%security definer') or p.provolatile::text is distinct from (case when f.kind like '% stable %' then 's' else 'v' end) or p.prolang<>(select oid from pg_language where lanname=split_part(f.kind,' ',1)) or p.prorettype<>(f.returns)::regtype::oid or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner) then raise exception 'Private cutover helper drift: %',f.signature;end if;
 end loop;
 select * into t from pg_class where oid='app_private.budget_receipt_legacy_cutover'::regclass;
 if not t.relrowsecurity or t.relowner<>owner_oid or exists(select 1 from aclexplode(coalesce(t.relacl,acldefault('r',t.relowner))) a where a.grantee<>t.relowner) or exists(select 1 from pg_policies where schemaname='app_private' and tablename='budget_receipt_legacy_cutover') then raise exception 'Cutover private table RLS/ACL drift';end if;
 if (select array_agg(attname::text order by attnum) from pg_attribute where attrelid=t.oid and attnum>0 and not attisdropped) is distinct from array['event','request_id','recorded_at','proof_sha256','details'] or (select count(*) from pg_constraint where conrelid=t.oid)<>4 or (select count(*) from pg_attribute where attrelid=t.oid and attnum>0 and not attisdropped and attnotnull)<>5 then raise exception 'Cutover table shape drift';end if;
 if (select array_agg(atttypid order by attnum) from pg_attribute where attrelid=t.oid and attnum>0 and not attisdropped) is distinct from array['text'::regtype::oid,'uuid'::regtype::oid,'timestamptz'::regtype::oid,'text'::regtype::oid,'jsonb'::regtype::oid] or (select pg_get_expr(adbin,adrelid) from pg_attrdef where adrelid=t.oid and adnum=3) is distinct from 'clock_timestamp()' or (select count(*) from pg_attrdef where adrelid=t.oid)<>1 then raise exception 'Cutover table type/default drift';end if;
 if (select count(*) from pg_trigger where tgrelid=t.oid and not tgisinternal)<>1 or not exists(select 1 from pg_trigger where tgrelid=t.oid and tgname='immutable_budget_receipt_cutover' and tgtype=27 and tgenabled='O' and tgfoid='app_private.guard_budget_receipt_cutover_journal()'::regprocedure and tgqual is null and tgnargs=0) then raise exception 'Cutover journal trigger drift';end if;`;
 const source=`-- Forward-only, Staging-only. No automatic activation, readiness or expiry writes.
-- Stop legacy authorization first; record real cryptographic invalidation separately.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $cutover_migration$
declare f record;p pg_proc;t pg_class;owner_oid oid;before_attrs jsonb;after_attrs jsonb;old_count integer:=0;new_count integer:=0;begin
 lock table app_private.budget_metadata_protocol,app_private.budget_finance_protocol,app_private.budget_payment_protocol,app_private.budget_source_protocol,app_private.budget_receipt_protocol,app_private.budget_lifecycle_protocol,app_private.budget_metadata_undo_protocol in share row exclusive mode nowait;
 if exists(select 1 from app_private.budget_metadata_protocol where enabled) or exists(select 1 from app_private.budget_finance_protocol where enabled or activated) or exists(select 1 from app_private.budget_payment_protocol where enabled) or exists(select 1 from app_private.budget_source_protocol where enabled) or exists(select 1 from app_private.budget_receipt_protocol where enabled or activated) or exists(select 1 from app_private.budget_lifecycle_protocol where enabled or activated) or exists(select 1 from app_private.budget_metadata_undo_protocol where enabled or full_enabled) then raise exception 'Dormant-only cutover Forward';end if;
 select proowner into owner_oid from pg_proc where oid='app_private.receipt_path_protected(text,text)'::regprocedure;
 if owner_oid is distinct from (select oid from pg_roles where rolname=current_user) then raise exception 'Existing private function owner required';end if;
 for f in select * from (values ${values}) s(signature,before_sha,after_sha) loop
  select * into p from pg_proc where oid=to_regprocedure(f.signature);
  if p.oid is null then raise exception 'Missing existing receipt guard: %',f.signature;end if;
  if encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')=f.before_sha then old_count:=old_count+1;
  elsif encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')=f.after_sha then new_count:=new_count+1;
  else raise exception 'Unknown receipt guard hash: %',f.signature;end if;
 end loop;
 if new_count=3 then
  if to_regclass('app_private.budget_receipt_legacy_cutover') is null then raise exception 'Incomplete cutover state';end if;
  ${checks}
  return;
 end if;
 if old_count<>3 or to_regclass('app_private.budget_receipt_legacy_cutover') is not null then raise exception 'Partial or unknown cutover state';end if;
 for f in select * from (values ${newValues}) s(signature,after_sha,kind,returns) loop if to_regprocedure(f.signature) is not null then raise exception 'Unknown pre-existing cutover helper: %',f.signature;end if;end loop;
 select jsonb_object_agg(s,to_jsonb(procrow)-'prosrc') into before_attrs from unnest(array[${definitions.map(f=>`'${f.signature}'`).join(',')}]) s join pg_proc procrow on procrow.oid=to_regprocedure(s);
 execute $cutover_ddl$${ddl}$cutover_ddl$;
 select jsonb_object_agg(s,to_jsonb(procrow)-'prosrc') into after_attrs from unnest(array[${definitions.map(f=>`'${f.signature}'`).join(',')}]) s join pg_proc procrow on procrow.oid=to_regprocedure(s);
 if after_attrs is distinct from before_attrs then raise exception 'Original receipt function non-body attributes changed';end if;
 ${checks}
 -- CUTOVER_POST_REPLACE_CHECK
end $cutover_migration$;
commit;
`;
 const sourceSha256=hash(source),name=cutoverVersion+'_'+cutoverName+'.sql';
 const wrapper=`-- Atomic Staging-only Forward; verify project-bound connection outside SQL.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in exclusive mode nowait;
lock table public.trips,public.trip_members,public.budget_items,public.budget_item_participants,public.actual_expenses,public.actual_expense_participants,public.attachments,public.trip_budget_baselines in share mode nowait;
do $cutover_ledger$declare r supabase_migrations.schema_migrations;n int;h text;begin
 if current_setting('app.b7_install_target',true) is distinct from 'uyqdopksfysbobhjcepk' then raise exception 'Explicit Staging target required';end if;
 select count(*),max(version) into n,h from supabase_migrations.schema_migrations;
 select * into r from supabase_migrations.schema_migrations where version='${cutoverVersion}';
 if found then if n<>65 or h<>'${cutoverVersion}' or r.name is distinct from '${cutoverName}' or cardinality(r.statements) is distinct from 1 or encode(sha256(convert_to(replace(r.statements[1],chr(13),''),'UTF8')),'hex') is distinct from '${sourceSha256}' then raise exception 'Cutover ledger/source collision';end if;
 elsif n<>64 or h<>'20261031140648' then raise exception 'Unexpected starting cutover ledger';end if;
end $cutover_ledger$;
${transactionBody(source)}
insert into supabase_migrations.schema_migrations(version,name,statements) values('${cutoverVersion}','${cutoverName}',array[$cutover_source$${source}$cutover_source$]) on conflict(version) do nothing;
do $cutover_after$begin if (select count(*) from supabase_migrations.schema_migrations)<>65 or (select max(version) from supabase_migrations.schema_migrations)<>'${cutoverVersion}' then raise exception 'Cutover ledger readback failed';end if;end $cutover_after$;
commit;
`;
 await fs.writeFile(cutoverDir+'/'+name,source);await fs.writeFile(cutoverDir+'/deployment.sql',wrapper);
 await fs.writeFile(cutoverDir+'/function-seal.json',JSON.stringify({existing:definitions.map(({signature,beforeSha256,afterSha256,body,definition})=>({signature,beforeSha256,afterSha256,beforeBody:old.find(f=>f.signature===signature).body,afterBody:body})),helpers:helpers.map(({signature,afterSha256,kind})=>({signature,afterSha256,kind}))},null,2)+'\n');
 await fs.writeFile(cutoverDir+'/packet-manifest.json',JSON.stringify({version:cutoverVersion,name:cutoverName,file:name,issuedByOfficialCli:true,officialCli:'2.106.0',sourceSha256,sourceBytes:Buffer.byteLength(source),wrapperSha256:hash(wrapper),startingLedger:{count:64,head:'20261031140648'},endingLedger:{count:65,head:cutoverVersion},defaultState:'Not stopped; not invalidated; all protocols/readiness OFF',legacyExpiry:'Never backdated or synthesized; key revocation is recorded separately',automaticallyApplied:false,deploymentEvidence:'../../2026-11-01-budget-b7-legacy-cutover-and-e2e.md'},null,2)+'\n');
 console.log(JSON.stringify({version:cutoverVersion,sourceSha256,wrapperSha256:hash(wrapper),bytes:Buffer.byteLength(wrapper),hostedApplied:false}));
}
if(process.argv[1]?.endsWith('prepare-b7-legacy-cutover.mjs'))await buildCutover();
