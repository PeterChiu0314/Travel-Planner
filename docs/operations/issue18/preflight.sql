-- Captured 2026-11-05 08:04 UTC from Staging read-only SQL. Fail closed on drift.
do $$begin
 if (select count(*) from supabase_migrations.schema_migrations)<>66 or (select max(version) from supabase_migrations.schema_migrations)<>'20261103113253' then raise exception 'Ledger changed';end if;
 if (select count(*) from public.actual_expenses)<>8 or (select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text,'UTF8')),'hex') from public.actual_expenses a)<>'54583d96dd90ae339569bec4f14bdbe344a8d4a5f11925955636755f9e9ef324' then raise exception 'Actual changed';end if;
 if (select count(*) from public.actual_expense_participants)<>11 or (select encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(p) order by actual_expense_id,user_id),'[]')::text,'UTF8')),'hex') from public.actual_expense_participants p)<>'0dd2f7f21fd07d9041ee244152ae237d4144e6af4aef39a8ce4fa716fc67bd16' then raise exception 'Actual people changed';end if;
 if (select count(*) from public.accommodations)<>1 or (select count(*) from public.accommodations where budget_item_id is not null)<>0 then raise exception 'Accommodation changed';end if;
 if (select count(*) from public.budget_items)<>18 then raise exception 'Old Budget count changed';end if;
 if exists(select 1 from pg_namespace where nspname='expense_stage_b') then raise exception 'Native schema already exists';end if;
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then raise exception 'Realtime publication missing';end if;
end$$;
