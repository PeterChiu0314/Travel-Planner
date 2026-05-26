insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-attachments',
  'trip-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Approved members can read trip attachment files" on storage.objects;
create policy "Approved members can read trip attachment files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'trip-attachments'
  and (storage.foldername(name))[1] = 'trips'
  and app_private.can_read_trip(((storage.foldername(name))[2])::uuid, auth.uid())
);

drop policy if exists "Editors can upload trip attachment files" on storage.objects;
create policy "Editors can upload trip attachment files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'trip-attachments'
  and (storage.foldername(name))[1] = 'trips'
  and app_private.can_edit_trip(((storage.foldername(name))[2])::uuid, auth.uid())
);

drop policy if exists "Editors can update trip attachment files" on storage.objects;
create policy "Editors can update trip attachment files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'trip-attachments'
  and (storage.foldername(name))[1] = 'trips'
  and app_private.can_edit_trip(((storage.foldername(name))[2])::uuid, auth.uid())
)
with check (
  bucket_id = 'trip-attachments'
  and (storage.foldername(name))[1] = 'trips'
  and app_private.can_edit_trip(((storage.foldername(name))[2])::uuid, auth.uid())
);

drop policy if exists "Editors can delete trip attachment files" on storage.objects;
create policy "Editors can delete trip attachment files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'trip-attachments'
  and (storage.foldername(name))[1] = 'trips'
  and app_private.can_edit_trip(((storage.foldername(name))[2])::uuid, auth.uid())
);
