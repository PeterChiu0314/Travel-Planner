revoke execute on function public.is_trip_owner(uuid, uuid) from public;
revoke execute on function public.is_trip_member(uuid, uuid) from public;
revoke execute on function public.is_approved_trip_member(uuid, uuid) from public;
revoke execute on function public.approved_trip_role(uuid, uuid) from public;
revoke execute on function public.can_read_trip(uuid, uuid) from public;
revoke execute on function public.can_edit_trip(uuid, uuid) from public;
revoke execute on function public.can_manage_trip(uuid, uuid) from public;
revoke execute on function public.enforce_shared_luggage_update_permissions() from public;
revoke execute on function public.sync_trip_name_title() from public;
revoke execute on function public.touch_updated_at() from public;
revoke execute on function public.request_trip_membership(text, text, text) from public;

grant execute on function public.request_trip_membership(text, text, text) to authenticated;
