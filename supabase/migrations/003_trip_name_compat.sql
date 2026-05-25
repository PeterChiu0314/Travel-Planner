create or replace function public.sync_trip_name_title()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.name is null or length(trim(new.name)) = 0 then
    new.name = new.title;
  end if;

  if new.title is null or length(trim(new.title)) = 0 then
    new.title = new.name;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_trip_name_title on public.trips;
create trigger sync_trip_name_title
before insert or update on public.trips
for each row execute function public.sync_trip_name_title();
