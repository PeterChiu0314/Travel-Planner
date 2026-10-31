// Catalog metadata only: no user rows, credentials, DDL, locks or mutations.
// The same canonical query runs on native reference and remote READ ONLY SQL.
export const catalogSql=`with objects as (
 select 'tables' section,n.nspname||'.'||c.relname key,
 jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) value
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','app_private') and c.relkind in('r','p','v','m','S')
 union all
 select 'columns',n.nspname||'.'||c.relname||'.'||a.attname,
 jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid))
 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where n.nspname in('public','app_private') and c.relkind in('r','p','v','m') and a.attnum>0 and not a.attisdropped
 union all
 select 'constraints',n.nspname||'.'||c.relname||'.'||x.conname,jsonb_build_object('definition',pg_get_constraintdef(x.oid),'deferrable',x.condeferrable,'deferred',x.condeferred,'validated',x.convalidated)
 from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private')
 union all
 select 'indexes',n.nspname||'.'||c.relname,jsonb_build_object('definition',pg_get_indexdef(c.oid),'valid',i.indisvalid)
 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private')
 union all
 select 'triggers',n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private') and not t.tgisinternal
 union all
 select 'policies',schemaname||'.'||tablename||'.'||policyname,to_jsonb(p)-'schemaname'-'tablename'-'policyname' from pg_policies p where schemaname in('public','app_private')
 union all
 select 'functions',n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',
 jsonb_build_object('body_sha256',encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex'),'security_definer',p.prosecdef,'config',p.proconfig,'result',pg_get_function_result(p.oid),'args',pg_get_function_arguments(p.oid),'volatility',p.provolatile,'strict',p.proisstrict,'parallel',p.proparallel,'language',l.lanname)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname in('public','app_private') and p.prokind='f'
 and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 union all
 select 'publication',pubname||'.'||schemaname||'.'||tablename,jsonb_build_object('columns',attnames,'rowfilter',rowfilter) from pg_publication_tables where schemaname in('public','app_private')
), sealed as (select section,key,encode(sha256(convert_to(value::text,'UTF8')),'hex') sha256 from objects)
select section,count(*)::int count,encode(sha256(convert_to(jsonb_agg(jsonb_build_object('key',key,'sha256',sha256) order by key)::text,'UTF8')),'hex') sha256,
 jsonb_agg(jsonb_build_object('key',key,'sha256',sha256) order by key) objects from sealed group by section order by section`;
