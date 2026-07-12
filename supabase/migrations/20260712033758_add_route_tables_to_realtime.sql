alter table public.itinerary_route_overrides replica identity full;
alter table public.itinerary_route_override_nodes replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.itinerary_route_overrides;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.itinerary_route_override_nodes;
exception when duplicate_object then null;
end $$;
