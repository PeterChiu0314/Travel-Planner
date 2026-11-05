begin;
create table public.expense_signals(trip_id uuid primary key references public.trips(id),revision bigint not null default 0);
alter table public.expense_signals enable row level security;
create policy expense_signal_read on public.expense_signals for select to authenticated using(app_private.can_read_trip(trip_id,auth.uid()));
revoke all on public.expense_signals from public,anon,authenticated;
grant select on public.expense_signals to authenticated;
create function expense_stage_b.signal(tid uuid) returns void language sql security definer set search_path='' as $$
 insert into public.expense_signals(trip_id,revision) values(tid,1) on conflict(trip_id) do update set revision=expense_signals.revision+1
$$;
revoke all on function expense_stage_b.signal(uuid) from public,anon,authenticated;
create function expense_stage_b.signal_item() returns trigger language plpgsql security definer set search_path='' as $$begin perform expense_stage_b.signal(new.trip_id);return new;end$$;
create function expense_stage_b.signal_child() returns trigger language plpgsql security definer set search_path='' as $$begin perform expense_stage_b.signal((select trip_id from expense_stage_b.expense_items where id=coalesce(new.expense_id,old.expense_id)));return coalesce(new,old);end$$;
create function expense_stage_b.signal_rates() returns trigger language plpgsql security definer set search_path='' as $$begin perform expense_stage_b.signal(new.trip_id);return new;end$$;
revoke all on function expense_stage_b.signal_item(),expense_stage_b.signal_child(),expense_stage_b.signal_rates() from public,anon,authenticated;
create trigger expense_item_signal after insert or update on expense_stage_b.expense_items for each row execute function expense_stage_b.signal_item();
create trigger expense_group_signal after insert or update on expense_stage_b.groups for each row execute function expense_stage_b.signal_child();
create trigger expense_people_signal after insert or update or delete on expense_stage_b.expense_participants for each row execute function expense_stage_b.signal_child();
create trigger expense_links_signal after insert or delete on expense_stage_b.expense_itinerary_links for each row execute function expense_stage_b.signal_child();
create trigger expense_rates_signal after insert or update on expense_stage_b.rate_leases for each row execute function expense_stage_b.signal_rates();
alter publication supabase_realtime add table public.expense_signals;
commit;
