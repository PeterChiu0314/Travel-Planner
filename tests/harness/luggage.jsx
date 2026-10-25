// Component integration fixture: no Auth, Storage or hosted writes.
// ?drafts=1 explicitly enables the real local draft hook for restoration tests.
// BroadcastChannel models incoming trip snapshots; SQL tests separately verify RLS.
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ActiveEditorGuardDialog, LuggagePanel } from "../../src/App.jsx";
import { reorderLuggageSnapshot, privatizeLuggageSnapshot, assignLuggageSnapshot, luggageErrorMessage, transitionSharedLuggage } from "../../src/lib/luggageService.js";
import "../../src/styles.css";
import "../../src/components/budget/budget-page.css";

const parameters = new URLSearchParams(location.search);
const actors = [
  { user_id: "owner", display_name: "總召 Peter", status: "approved", role: "owner" },
  { user_id: "packer", display_name: "旅伴 Chloe", status: "approved", role: "editor" },
  { user_id: "viewer", display_name: "旅伴 Dennis", status: "approved", role: "viewer" },
  { user_id: "pending", display_name: "尚待核准成員", status: "pending", role: "viewer" },
];
const trip = { id: "luggage-trip", title: "京都同行", start_date: "2090-04-05", end_date: "2090-04-10", owner_id: "owner" };
const initialTime = "2026-10-23T01:00:00.000Z";
const personal = (id, owner_id, title, category = "隨身必備", packed = false, trip_id = trip.id) => ({ id, owner_id, title, category, packed, trip_id, updated_at: initialTime });
const shared = (id, title, assigned_to, packed = false, confirmed = false, category = "團隊裝備", trip_id = trip.id) => ({ id, title, assigned_to, category, trip_id, packed_by_assignee: packed, confirmed_by_owner: confirmed, updated_at: initialTime });
const initial = () => ({
  luggageItems: parameters.has("empty") ? [] : [personal("own", "owner", "護照"), personal("other", "packer", "Chloe 私人藥物"), personal("viewer", "viewer", "Dennis 私人證件"), personal("cross-trip", "owner", "另一旅程私人行李", "證件", false, "other-trip"), { ...personal("legacy-proxy", "owner", "過期共用物品複本"), is_shared_assigned_item: true }, ...(parameters.has("long") ? Array.from({ length: 55 }, (_, i) => personal(`long-${i}`, "owner", `長清單物品 ${i + 1}`, i % 2 ? "換洗衣物" : "電子用品", i < 10)) : [])],
  sharedLuggageItems: parameters.has("empty") ? [] : [shared("shared", "共享充電器", "packer"), shared("owner-assigned", "團隊文件", "owner"), shared("unassigned", "露營急救包", null), shared("ready", "團隊相機", "packer", true, true), shared("cross-team", "另一旅程共用物品", "owner", false, false, "團隊裝備", "other-trip"), ...(parameters.has("assigned") ? Array.from({ length: 36 }, (_, i) => shared(`assigned-${i}`, `指派共用物品 ${i + 1}`, "owner")) : [])],
});

function Harness() {
  const [state, setState] = useState(initial);
  const stateRef = useRef(state); stateRef.current = state;
  const [actorId, setActorId] = useState(parameters.get("actor") || "owner");
  const actor = actors.find((member) => member.user_id === actorId);
  const [activeTab, setActiveTab] = useState("personal");
  const [notice, setNotice] = useState("");
  const [failNext, setFailNext] = useState(false);
  const channel = useRef(null);
  useEffect(() => {
    if (!parameters.get("room")) return undefined;
    channel.current = new BroadcastChannel(`travel-luggage-qa:${parameters.get("room")}`);
    channel.current.onmessage = ({ data }) => {
      if (data.type === "request") channel.current.postMessage({ type: "snapshot", state: stateRef.current });
      if (data.type === "snapshot") { stateRef.current = data.state; setState(data.state); }
    };
    channel.current.postMessage({ type: "request" });
    return () => channel.current?.close();
  }, []);
  function publish(next) {
    stateRef.current = next; setState(next);
    channel.current?.postMessage({ type: "snapshot", state: next });
  }
  function update(scope, action, payload, id, meta = {}) {
    if (failNext) { setFailNext(false); setNotice("暫時無法連線，請重試。"); return { ok: false }; }
    try {
      if (actor.status !== "approved") throw new Error("luggage_forbidden");
      const key = scope === "personal" ? "luggageItems" : "sharedLuggageItems";
      const rows = stateRef.current[key];
      const record = rows.find((row) => row.id === id);
      if (id && (!record || record.trip_id !== trip.id || scope === "personal" && record.owner_id !== actorId)) throw new Error("luggage_forbidden");
      if (record && meta.baseUpdatedAt && meta.baseUpdatedAt !== record.updated_at) throw new Error("luggage_stale");
      const now = new Date(Date.parse(record?.updated_at || initialTime) + 1000).toISOString();
      let next;
      if (action === "delete") next = rows.filter((row) => row.id !== id);
      else {
        const clean = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
        let value = record || { id: crypto.randomUUID(), trip_id: trip.id, owner_id: actorId, packed: false, packed_by_assignee: false, confirmed_by_owner: false, assigned_to: null };
        if (scope === "shared") value = transitionSharedLuggage(value, clean, { userId: actorId, isOwner: actorId === trip.owner_id, approvedMemberIds: actors.filter((member) => member.status === "approved").map((member) => member.user_id) });
        else value = { ...value, ...clean };
        value.updated_at = now;
        next = record ? rows.map((row) => row.id === id ? value : row) : [...rows, value];
      }
      publish({ ...stateRef.current, [key]: next }); setNotice("");
      return { ok: true };
    } catch (error) { setNotice(luggageErrorMessage(error)); return { ok: false, error }; }
  }
  async function save(scope, payload, id, meta) {
    const latency = Math.min(500, Number(parameters.get("latency")) || 0);
    if (latency > 0) await new Promise(resolve => setTimeout(resolve, latency));
    return update(scope, "save", payload, id, meta);
  }
  async function assign(scope, item, assignedTo) {
    const latency = Math.min(500, Number(parameters.get("latency")) || 0);
    if (latency > 0) await new Promise(resolve => setTimeout(resolve, latency));
    if (failNext) { setFailNext(false); return { ok: false, error: new Error("暫時無法連線，請重試。") }; }
    try {
      const next = assignLuggageSnapshot(stateRef.current, { scope, item, assignedTo, tripId: trip.id, userId: actorId, approvedMemberIds: actors.filter(member => member.status === "approved").map(member => member.user_id) });
      publish(next); setNotice(""); return { ok: true };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }
  async function privatize(item, category) {
    const latency = Math.min(500, Number(parameters.get("latency")) || 0);
    if (latency > 0) await new Promise(resolve => setTimeout(resolve, latency));
    if (failNext) { setFailNext(false); return { ok: false, error: new Error("暫時無法連線，請重試。") }; }
    try {
      const next = privatizeLuggageSnapshot(stateRef.current, { item, category, tripId: trip.id, userId: actorId, approvedMemberIds: actors.filter(member => member.status === "approved").map(member => member.user_id) });
      publish(next); setNotice(""); return { ok: true };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }
  async function reorder(scope, item, target, placement, items) {
    const latency = Math.min(500, Number(parameters.get("latency")) || 0);
    if (latency) await new Promise(resolve => setTimeout(resolve, latency));
    if (failNext) { setFailNext(false); return { ok: false, error: new Error("暫時無法連線，請重試。") }; }
    try {
      const next = reorderLuggageSnapshot(stateRef.current, { scope, item, target, placement, items, tripId: trip.id,
        userId: actorId, approvedMemberIds: actors.filter(member => member.status === "approved").map(member => member.user_id) });
      publish(next); setNotice(""); return { ok: true };
    } catch (error) { return { ok: false, error: new Error(luggageErrorMessage(error)) }; }
  }
  return <main style={{ padding: "12px", maxWidth: "1600px", margin: "auto" }}>
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
      <label>測試使用者<select aria-label="測試使用者" value={actorId} onChange={(event) => setActorId(event.target.value)}>{actors.map((member) => <option value={member.user_id} key={member.user_id}>{member.display_name}</option>)}</select></label>
      <button type="button" onClick={() => publish({ ...stateRef.current, luggageItems: stateRef.current.luggageItems.map((item) => ({ ...item })), sharedLuggageItems: stateRef.current.sharedLuggageItems.map((item) => ({ ...item })) })}>模擬遠端重新載入</button>
      <button type="button" onClick={() => setFailNext(true)}>下一次操作失敗</button>
    </div>
    {notice ? <p role="alert">{notice}</p> : null}
    <LuggagePanel key={actorId} activeTrip={{ ...trip }} activeTab={activeTab} onTabChange={setActiveTab} currentUserId={actorId} canEdit={actor.status === "approved"} isOwner={actorId === trip.owner_id} members={actors.map(member => ({ ...member }))} {...state} disableDraftAutosave={!parameters.has("drafts")} restoreDrafts={parameters.has("drafts")} useEditLocks={false}
      onSavePersonal={(payload, id, meta) => save("personal", payload, id, meta)}
      onSaveShared={(payload, id, meta) => save("shared", payload, id, meta)}
      onAssign={assign}
      onPrivatize={privatize}
      onReorder={reorder}
      onDeletePersonal={(id) => update("personal", "delete", {}, id)} onDeleteShared={(id) => update("shared", "delete", {}, id)}
      onTogglePersonal={(item) => update("personal", "patch", { packed: !item.packed }, item.id)}
      onUpdateShared={(id, patch) => update("shared", "patch", patch, id)} />
    <ActiveEditorGuardDialog />
    <output data-testid="luggage-canonical-state" hidden>{JSON.stringify(state)}</output>
  </main>;
}
createRoot(document.getElementById("root")).render(<Harness />);
