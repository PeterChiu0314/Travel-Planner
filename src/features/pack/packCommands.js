import { notify } from "../../lib/notifications.js";
import { supabase } from "../../lib/supabase.js";

export function createPackCommands({ activeTrip, canEditActiveTripContent, loadTripData }) {
  async function addPackItem(title) {
    if (!activeTrip || !canEditActiveTripContent || !title.trim()) return;
    const { error } = await supabase
      .from("pack_items")
      .insert({ trip_id: activeTrip.id, title: title.trim() });
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function togglePackItem(item) {
    if (!canEditActiveTripContent) return;
    const { error } = await supabase
      .from("pack_items")
      .update({ done: !item.done })
      .eq("id", item.id);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  async function deletePackItem(itemId) {
    if (!canEditActiveTripContent) return;
    const { error } = await supabase.from("pack_items").delete().eq("id", itemId);
    if (error) notify.error(error.message);
    else await loadTripData(activeTrip.id);
  }

  return { addPackItem, togglePackItem, deletePackItem };
}

export function readPackItems(client, tripId) {
  return client.from("pack_items").select("*").eq("trip_id", tripId).order("created_at");
}
