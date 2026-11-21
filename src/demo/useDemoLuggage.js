import { useRef } from "react";
import {
  reorderLuggageSnapshot,
  privatizeLuggageSnapshot,
  assignLuggageSnapshot,
  transitionSharedLuggage,
  luggageErrorMessage,
} from "../lib/luggageService.js";
import { demoId, demoMembers } from "./timelineFixtures.js";

export function useDemoLuggage({ demoActiveTrip, setDemoSupportByTrip, support, setSupportField }) {
  const demoLuggageRef = useRef(support);

  demoLuggageRef.current = support;

  function mutateDemoLuggage(scope, action, payload, id, meta = {}) {
    if (meta.tripId && meta.tripId !== demoActiveTrip.id) return { ok: false, crossTrip: true };
    const key = scope === "personal" ? "luggageItems" : "sharedLuggageItems";
    const list = demoLuggageRef.current[key];
    const old = list.find(row => row.id === id);
    if (id && (!old || old.trip_id !== demoActiveTrip.id)) return { ok: false, error: new Error("找不到此旅程的物品。") };
    if (old && old.updated_at !== meta.baseUpdatedAt) return { ok: false, conflict: true };
    try {
      const normalized = action === "save" ? { title: payload.title.trim(), category: payload.category.trim(), notes: (payload.notes || "").trim(), ...(scope === "shared" ? { assigned_to: payload.assigned_to || null } : {}) } : payload;
      if (action === "save" && !normalized.title) return { ok: false };
      const next = action === "delete" ? null : { ...(scope === "shared" ? transitionSharedLuggage(old || { packed_by_assignee: false }, normalized, {
        userId: "demo-peter", isOwner: true, approvedMemberIds: demoMembers.filter(row => row.status === "approved").map(row => row.user_id),
      }) : { ...old, ...normalized, owner_id: "demo-peter", packed: action === "save" ? Boolean(old?.packed) : payload.packed }),
        id: id || demoId("demo-luggage"), trip_id: demoActiveTrip.id, updated_at: new Date(Math.max(Date.now(), Date.parse(old?.updated_at || 0) + 1)).toISOString() };
      const nextList = action === "delete" ? list.filter(row => row.id !== id) : id ? list.map(row => row.id === id ? next : row) : [...list, next];
      demoLuggageRef.current = { ...demoLuggageRef.current, [key]: nextList };
      setSupportField(key, nextList);
      return { ok: true, data: next };
    } catch(error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }

  function savePersonalLuggage(payload, editingId, meta) { return mutateDemoLuggage("personal", "save", payload, editingId, meta); }

  function saveSharedLuggage(payload, editingId, meta) { return mutateDemoLuggage("shared", "save", payload, editingId, meta); }

  function assignDemoLuggage(scope, item, assignedTo) {
    try {
      const next = assignLuggageSnapshot(demoLuggageRef.current, { scope, item, assignedTo, tripId: demoActiveTrip.id, userId: "demo-peter", approvedMemberIds: demoMembers.filter(member => member.status === "approved").map(member => member.user_id) });
      demoLuggageRef.current = next;
      setDemoSupportByTrip(current => ({ ...current, [demoActiveTrip.id]: next }));
      return { ok: true, data: next.sharedLuggageItems.find(row => row.id === item.id) };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }

  function privatizeDemoLuggage(item, category) {
    try {
      const next = privatizeLuggageSnapshot(demoLuggageRef.current, { item, category, tripId: demoActiveTrip.id, userId: "demo-peter", approvedMemberIds: demoMembers.filter(member => member.status === "approved").map(member => member.user_id) });
      demoLuggageRef.current = next;
      setDemoSupportByTrip(current => ({ ...current, [demoActiveTrip.id]: next }));
      return { ok: true, data: next.luggageItems.find(row => row.id === item.id) };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }

  function reorderDemoLuggage(scope, item, target, placement, items) {
    try {
      const next = reorderLuggageSnapshot(demoLuggageRef.current, { scope, item, target, placement, items, tripId: demoActiveTrip.id,
        userId: "demo-peter", approvedMemberIds: demoMembers.filter(member => member.status === "approved").map(member => member.user_id) });
      demoLuggageRef.current = next;
      setDemoSupportByTrip(current => ({ ...current, [demoActiveTrip.id]: next }));
      return { ok: true };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }

  return {
    mutateDemoLuggage,
    savePersonalLuggage,
    saveSharedLuggage,
    assignDemoLuggage,
    privatizeDemoLuggage,
    reorderDemoLuggage,
  };
}
