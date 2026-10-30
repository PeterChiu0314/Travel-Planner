-- READ ONLY. Output counts and digests, never receipt paths, claims or keys.
begin transaction read only;
set local statement_timeout='10s';
select kind,count(*) rows,encode(sha256(convert_to(coalesce(jsonb_agg(v order by v::text),'[]')::text,'UTF8')),'hex') sha256
from (
 select 'budget' kind,to_jsonb(t) v from public.budget_items t union all
 select 'actual',to_jsonb(t) from public.actual_expenses t union all
 select 'budget_people',to_jsonb(t) from public.budget_item_participants t union all
 select 'actual_people',to_jsonb(t) from public.actual_expense_participants t union all
 select 'links',to_jsonb(t) from public.itinerary_budget_items t union all
 select 'receipts',to_jsonb(t) from public.attachments t where target_type='actual_expense' union all
 select 'baselines',to_jsonb(t) from public.trip_budget_baselines t
) rows group by kind order by kind;
select 'intents' kind,status,count(*) from app_private.budget_receipt_intents group by status union all
select 'cleanup',status,count(*) from app_private.budget_receipt_cleanup group by status;
select count(*) missing_objects from public.attachments a where a.target_type='actual_expense'
 and not exists(select 1 from storage.objects o where o.bucket_id='trip-attachments' and o.name=a.file_url);
select c.oid::regclass::text protected_parent,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where t.tgname='a_budget_parent_delete' and not t.tgisinternal order by 1;
commit;
