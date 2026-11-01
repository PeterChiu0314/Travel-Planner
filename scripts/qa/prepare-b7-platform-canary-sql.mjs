import fs from 'node:fs/promises';
const m=JSON.parse(await fs.readFile('.tmp-b7-live/qa-state.json','utf8')),c=m.canary;
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
if(!c||c.objects.length!==4)throw Error('Exact uploaded canary manifest required');
const rows=c.objects.map(o=>`(${q(o.name)},${q(o.path)},${q(o.request)}::uuid,${q(o.digest)},${o.size},${q(o.type)})`).join(',\n');
const sql=`-- QA platform-only queue initialization; never a user Receipt Begin/Commit proof.
begin;set local lock_timeout='3s';set local statement_timeout='10s';
lock table app_private.budget_receipt_intents,app_private.budget_receipt_cleanup in exclusive mode nowait;
do $$begin
 if (select count(*) from supabase_migrations.schema_migrations)<>64 or (select max(version) from supabase_migrations.schema_migrations)<>'20261031140648' then raise exception 'Ledger drift';end if;
 if exists(select 1 from app_private.budget_receipt_protocol where enabled or activated or storage_verified or cleanup_worker_verified or content_worker_verified) then raise exception 'Protocol must remain dormant';end if;
 if exists(select 1 from app_private.budget_receipt_intents) or exists(select 1 from app_private.budget_receipt_cleanup) then raise exception 'Unscoped receipt jobs; stop';end if;
 if not exists(select 1 from public.trips where id=${q(m.tripIds[0])}::uuid and owner_id=${q(m.users[0])}::uuid and title=${q('QA B7 Closeout '+m.run)}) or not exists(select 1 from public.actual_expenses where id=${q(c.actual)}::uuid and trip_id=${q(m.tripIds[0])}::uuid and title=${q('QA Worker canary '+m.run)}) then raise exception 'Exact QA graph missing';end if;
end $$;
create temporary table qa_canary(name text,path text,request uuid,digest text,size bigint,mime text) on commit drop;
insert into qa_canary values ${rows};
do $$begin if (select count(*) from qa_canary q join storage.objects o on o.bucket_id='trip-attachments' and o.name=q.path and (o.metadata->>'size')::bigint=q.size and o.metadata->>'mimetype'=q.mime)<>4 or exists(select 1 from public.attachments a join qa_canary q on a.file_url=q.path) then raise exception 'Real uploaded objects mismatch';end if;end $$;
insert into app_private.budget_receipt_intents(request_id,user_id,session_id,trip_id,actual_id,signature,action,base_revision,versions,object_path,file_name,file_type,file_size,digest,expires_at)
select request,${q(m.users[0])}::uuid,${q(c.session)}::uuid,${q(m.tripIds[0])}::uuid,${q(c.actual)}::uuid,jsonb_build_object('qa_platform_canary',${q(m.run)},'not_user_receipt',true),'upload',0,'{}',path,name||'.png',mime,size,digest,clock_timestamp()+interval '6 minutes' from qa_canary where name<>'cleanup';
insert into app_private.budget_receipt_cleanup(request_id,trip_id,actual_id,object_path,object_id,reason)
select q.request,${q(m.tripIds[0])}::uuid,${q(c.actual)}::uuid,q.path,o.id,'Explicit disposable QA platform canary '||${q(m.run)} from qa_canary q join storage.objects o on o.bucket_id='trip-attachments' and o.name=q.path where q.name='cleanup';
select jsonb_build_object('qaPlatformCanaries',3,'cleanupCanaries',1,'readinessChanged',false,'businessReceiptAcceptance',false) result;
commit;`;
await fs.writeFile('.tmp-b7-live/seed-platform-canary.sql',sql);
console.log('Prepared exact QA-only source; no Storage bytes/metadata or readiness mutation');
