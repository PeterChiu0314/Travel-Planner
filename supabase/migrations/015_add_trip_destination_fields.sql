alter table public.trips
  add column if not exists destination_country text,
  add column if not exists destination_city text;

with parsed as (
  select
    id,
    string_to_array(destination, ' · ') as parts
  from public.trips
  where destination is not null
    and btrim(destination) <> ''
    and destination_country is null
    and destination_city is null
)
update public.trips as trip
set
  destination_country = nullif(btrim(parsed.parts[1]), ''),
  destination_city = nullif(btrim(parsed.parts[2]), '')
from parsed
where trip.id = parsed.id
  and array_length(parsed.parts, 1) = 2;

update public.trips
set destination_city = nullif(btrim(destination), '')
where destination is not null
  and btrim(destination) <> ''
  and destination_country is null
  and destination_city is null;
