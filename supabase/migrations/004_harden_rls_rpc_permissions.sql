revoke execute on function public.is_trip_owner(uuid, uuid) from anon, authenticated;
revoke execute on function public.is_trip_member(uuid, uuid) from anon, authenticated;
revoke execute on function public.is_approved_trip_member(uuid, uuid) from anon, authenticated;
revoke execute on function public.approved_trip_role(uuid, uuid) from anon, authenticated;
revoke execute on function public.can_read_trip(uuid, uuid) from anon, authenticated;
revoke execute on function public.can_edit_trip(uuid, uuid) from anon, authenticated;
revoke execute on function public.can_manage_trip(uuid, uuid) from anon, authenticated;
revoke execute on function public.enforce_shared_luggage_update_permissions() from anon, authenticated;
revoke execute on function public.sync_trip_name_title() from anon, authenticated;
revoke execute on function public.touch_updated_at() from anon, authenticated;

revoke execute on function public.request_trip_membership(text, text, text) from anon;
grant execute on function public.request_trip_membership(text, text, text) to authenticated;
