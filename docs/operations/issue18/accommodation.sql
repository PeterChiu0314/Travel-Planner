begin;
alter table public.accommodations add column expense_id uuid;
alter table public.accommodations add constraint accommodations_expense_trip_fk foreign key(expense_id,trip_id)
 references expense_stage_b.expense_items(id,trip_id) on delete restrict;
create index accommodations_expense_id_idx on public.accommodations(expense_id) where expense_id is not null;
commit;
