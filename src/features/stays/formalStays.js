export function readTripStays(client, tripId) {
  return client.from("accommodations").select("*").eq("trip_id", tripId).order("check_in_date");
}

export function saveTripStay({ client, trip, payload, editingId, meta, updateWithConflictCheck }) {
  const safeCheckOut =
    payload.check_out_date && payload.check_out_date < payload.check_in_date
      ? payload.check_in_date
      : payload.check_out_date;
  const nextPayload = {
    trip_id: trip.id,
    name: payload.name.trim(),
    check_in_date: payload.check_in_date || trip.start_date,
    check_out_date: safeCheckOut || payload.check_in_date || trip.start_date,
    check_in_time: payload.check_in_time || null,
    check_out_time: payload.check_out_time || null,
    address: payload.address.trim() || null,
    map_url: payload.map_url.trim() || null,
    booking_code: payload.booking_code.trim() || null,
    payment_status: payload.payment_status || "unpaid",
    expense_id: payload.expense_id || null,
    custom_notes: payload.custom_notes.trim() || null,
  };
  return editingId
    ? updateWithConflictCheck("accommodations", nextPayload, editingId, meta)
    : client.from("accommodations").insert(nextPayload);
}

export function deleteTripStay(client, accommodationId) {
  return client.from("accommodations").delete().eq("id", accommodationId);
}
