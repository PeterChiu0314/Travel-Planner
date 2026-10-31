import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {businessRaises,tokens} from './audit-budget-migration-conflicts.mjs';
export const bundleDir='docs/operations/budget-b7-staging';
export const forwardFile='20261031130000_budget_business_conflicts_forward.sql';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const normalize=s=>s.replace(/\r\n/g,'\n');
export async function migrationSources(){const dir='supabase/migrations';return Promise.all((await fs.readdir(dir)).filter(f=>f.endsWith('.sql')).sort().map(async file=>({file,version:file.split('_')[0],source:normalize(await fs.readFile(`${dir}/${file}`,'utf8'))})));}
export function transactionBody(source){
 const ts=tokens(source),ranges=[];let start=0;
 for(let i=0;i<ts.length;i++)if(ts[i].value===';'){const part=ts.slice(start,i);if(part.length===1&&['begin','commit'].includes(part[0].value))ranges.push([part[0].start,ts[i].end]);start=i+1;}
 for(const [a,b] of ranges.reverse())source=source.slice(0,a)+source.slice(b);
 return source;
}
export async function classification(){return JSON.parse(await fs.readFile(`${bundleDir}/error-classification.json`,'utf8'));}
export async function captureCatalog(db,review){
 const signatures=review.functions.map(f=>f.signature);
 return (await db.query(`select s.signature,p.prosrc body,to_jsonb(p)-'prosrc' attributes
 from unnest($1::text[]) s(signature) join pg_proc p on p.oid=to_regprocedure(s.signature) order by s.signature`,[signatures])).rows;
}
export async function sealForward(catalog){
 const review=await classification();if(catalog.length!==38)throw Error('Expected 38 compiled routines');
 const sealed=[],definitions=[];
 for(const f of review.functions){const actual=catalog.find(x=>x.signature===f.signature);if(!actual)throw Error('Missing '+f.signature);
  const body=normalize(actual.body),sites=businessRaises(body);if(sites.length!==f.sites.length||sites.some((s,i)=>s.message!==f.sites[i].message))throw Error('Unreviewed compiled RAISE sites '+f.signature);
  const ts=tokens(body);let mapped=body;
  for(let i=sites.length-1;i>=0;i--){const at=ts.findIndex(t=>t.start===sites[i].offset),literal=ts[at+2];if(literal?.value!=='40001')throw Error('Unsupported raise form');mapped=mapped.slice(0,literal.start)+`'${f.sites[i].code}'`+mapped.slice(literal.end);}
  if(f.signature.startsWith('public.save_budget_workspace_record(')&&!body.includes('IF app_private.legacy_budget_blocked(p_trip_id) THEN RETURN'))throw Error('Final B7 legacy guard missing');
  sealed.push({signature:f.signature,beforeSha256:hash(body),afterSha256:hash(mapped),sites:f.sites});
  definitions.push({signature:f.signature,beforeBody:body,afterBody:mapped});
 }
 await fs.writeFile(`${bundleDir}/compiled-seal.json`,JSON.stringify({version:review.version,sourceCommit:review.sourceCommit,functions:sealed},null,2)+'\n');
 await fs.writeFile(`${bundleDir}/compiled-definitions.json`,JSON.stringify({scope:'Actual compiled final B7 bodies; fixture OIDs are deliberately excluded',functions:definitions},null,2)+'\n');
 const values=sealed.map(f=>` ('${f.signature}','${f.beforeSha256}','${f.afterSha256}',array[${f.sites.map(s=>`'${s.code}'`).join(',')}])`).join(',\n');
 const sql=`-- Reviewed terminal forward; generated from compiled final B7 functions.
-- NON-AUTO-APPLY: kept outside supabase/migrations. No Hosted authorization.
-- 38 routines / 78 sites: 54 business PT409; 24 internal-integrity PT500.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $forward$
declare target record; routine oid; old_body text; old_def text; mapped text;
 before_row jsonb; after_row jsonb; observed text; n integer; site integer; verified integer:=0; changed integer:=0;
 pattern text:=$pattern$(errcode[[:space:]]*=[[:space:]]*)'40001'$pattern$;
begin
 if to_regprocedure('public.read_budget_metadata_snapshot_v10(uuid,uuid)') is null
  or to_regprocedure('public.delete_itinerary_item_budget_safe(uuid,uuid)') is null then raise exception 'Complete B7 chain required';end if;
 if coalesce((select enabled from app_private.budget_metadata_protocol),true)
  or coalesce((select enabled or activated from app_private.budget_finance_protocol),true)
  or coalesce((select enabled from app_private.budget_payment_protocol),true)
  or coalesce((select enabled from app_private.budget_source_protocol),true)
  or coalesce((select enabled or activated from app_private.budget_receipt_protocol),true)
  or coalesce((select enabled or activated from app_private.budget_lifecycle_protocol),true)
  or coalesce((select enabled or full_enabled from app_private.budget_metadata_undo_protocol),true) then raise exception 'Dormant-only forward; enabled or latched protocol found';end if;
 -- Each known routine must match an exact compiled before/after fingerprint,
 -- including the final dynamic guard. Unknown custom raises abort the entire
 -- transaction at the final catalog check, rolling back every earlier rewrite.
 for target in select * from (values
${values}
 ) reviewed(signature,before_hash,after_hash,codes) loop
  routine:=to_regprocedure(target.signature);if routine is null then raise exception 'Missing reviewed routine: %',target.signature;end if;
  select to_jsonb(p),p.prosrc,pg_get_functiondef(p.oid) into before_row,old_body,old_def from pg_proc p where p.oid=routine;
  observed:=encode(sha256(convert_to(replace(old_body,chr(13),''),'UTF8')),'hex');verified:=verified+1;
  if observed=target.after_hash then continue;end if;
  if observed<>target.before_hash then raise exception 'Function hash drift: %',target.signature;end if;
  select count(*) into n from regexp_matches(old_body,pattern,'gi');if n<>cardinality(target.codes) then raise exception 'RAISE count drift: %',target.signature;end if;
  mapped:=old_body;
  for site in reverse n..1 loop mapped:=regexp_replace(mapped,pattern,'\\1'||quote_literal(target.codes[site]),1,site,'i');end loop;
  if encode(sha256(convert_to(replace(mapped,chr(13),''),'UTF8')),'hex')<>target.after_hash then raise exception 'Mapped body does not match classified seal';end if;
  if position(old_body in old_def)=0 then raise exception 'Unknown function source shape';end if;
  execute replace(old_def,old_body,mapped);
  select to_jsonb(p) into after_row from pg_proc p where p.oid=routine;
  if after_row->>'prosrc'<>mapped or (before_row-'prosrc') is distinct from (after_row-'prosrc') then raise exception 'Routine identity owner ACL security or settings changed';end if;
  changed:=changed+1;
 end loop;
 if verified<>38 then raise exception 'Incomplete reviewed catalog';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.prosrc ~* pattern) then raise exception 'Unknown custom 40001 remains';end if;
 raise notice 'B7 forward verified % routines; changed %',verified,changed;
end $forward$;
commit;
`;
 await fs.writeFile(`${bundleDir}/${forwardFile}`,sql);return {sealed,source:sql};
}
