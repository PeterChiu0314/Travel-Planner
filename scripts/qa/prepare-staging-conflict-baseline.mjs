// Generate a reviewable packet for the named Staging only. Never connects to DB.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const target='uyqdopksfysbobhjcepk';
const dir='supabase/migrations';
const files=(await fs.readdir(dir)).filter(f=>f.startsWith('2026102')&&f<='20261028104333_budget_selection_activity.sql').sort();
files.push('20261031003000_rpc_business_conflicts_no_retry.sql');
const sources=await Promise.all(files.map(async file=>({file,source:(await fs.readFile(path.join(dir,file),'utf8')).replace(/\r\n/g,'\n')})));
const preflight=`begin;
set local lock_timeout='5s'; set local statement_timeout='60s';
do $guard$ begin
 if coalesce(current_setting('request.jwt.claims',true),'') not in ('','{}') then
  raise exception 'Run only in the authenticated Staging Dashboard SQL Editor'; end if;
 if (select max(version) from supabase_migrations.schema_migrations) <> '20260819125851'
  or to_regprocedure('public.delete_budget_workspace_record(uuid,text,uuid,timestamptz)') is not null then
  raise exception 'Staging baseline drift; re-inventory'; end if;
 if (select count(*) from public.trips)<>2 or (select count(*) from auth.users)<>1
  or exists(select 1 from public.budget_items) or exists(select 1 from public.actual_expenses)
  or exists(select 1 from public.luggage_items) or exists(select 1 from public.shared_luggage_items) then
  raise exception 'Existing data drift; no automatic financial conversion or cleanup allowed'; end if;
end $guard$;
create temporary table conflict_baseline_before(name text, cols text[], digest text) on commit drop;
alter table conflict_baseline_before enable row level security;
do $snapshot$ declare r record; d text; keys text[]; begin
 for r in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' loop
  select array_agg(column_name::text order by ordinal_position) into keys from information_schema.columns
   where table_schema='public' and table_name=r.relname;
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text) from public.%I t',r.relname) into d;
  insert into conflict_baseline_before values(r.relname,keys,d);
 end loop;
end $snapshot$;
`;
let packet=preflight;
for(const {file,source} of sources){
 if(/^begin;$/mi.test(source)!==/^commit;\s*$/mi.test(source))throw Error('Unexpected transaction shape: '+file);
 const body=source.replace(/^begin;\s*$/mi,'').replace(/^commit;\s*$/mi,'');
 const [version,...parts]=file.replace(/\.sql$/,'').split('_');
 packet+=`\n-- exact migration body: ${file}\n${body}\n`;
 packet+=`insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${parts.join('_')}',ARRAY[$migration_source$${source}$migration_source$]);\n`;
}
packet+=`
set constraints all immediate;
do $verify$ declare r record; d text; begin
 for r in select * from conflict_baseline_before loop
  execute format('select md5(coalesce(jsonb_agg(projected order by projected::text),''[]''::jsonb)::text) from
   (select (select jsonb_object_agg(k,v) from jsonb_each(to_jsonb(t)) e(k,v) where k=any($1)) projected from public.%I t) q',r.name) into d using r.cols;
  if d is distinct from r.digest then raise exception 'Existing table data changed: %',r.name; end if;
 end loop;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private')
  and p.prosrc ~* $re$errcode[[:space:]]*=[[:space:]]*'PT409'$re$)<>13 then raise exception 'Expected thirteen mapped routines'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private')
  and p.prosrc ~* $re$errcode[[:space:]]*=[[:space:]]*'40001'$re$) then raise exception 'Business 40001 remains'; end if;
 if to_regclass('app_private.budget_metadata_protocol') is not null then raise exception 'B7 must remain absent'; end if;
end $verify$;
notify pgrst,'reload schema';
`;
const finish=`select '${target}' as staging_target,${sources.length} as migrations_verified,true as original_public_data_preserved,true as no_b7_installed;
`;
const out='.tmp-staging-conflict';await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,'baseline-rollback.sql'),packet+'rollback;\n'+finish);
await fs.writeFile(path.join(out,'baseline-apply.sql'),packet+'commit;\n'+finish);
await fs.writeFile(path.join(out,'baseline-manifest.json'),JSON.stringify({target,files:sources.map(({file,source})=>({file,sha256:createHash('sha256').update(source).digest('hex')})),applyBytes:Buffer.byteLength(packet+'commit;\n'+finish)},null,2));
console.log(JSON.stringify({target,migrations:sources.length,files,output:out,applyBytes:Buffer.byteLength(packet+'commit;\n'+finish)}));
