// Test-only Formal controller + persistence adapter, backed by an isolated fake DB.
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import BudgetWorkspace from "../../src/components/budget/BudgetWorkspace.jsx";
import { saveDemoBudgetRecord } from "../../src/demo/saveBudgetRecord.js";
import { persistBudgetWorkspace } from "../../src/lib/budgetWorkspaceService.js";
import "../../src/styles.css";
import "../../src/components/budget/budget-page.css";

const parameters = new URLSearchParams(location.search);
const future = parameters.has("future");
const trip = { id: "test-trip", title: "Historical safety fixture", start_date: future ? "2090-01-01" : "2020-01-01", end_date: future ? "2090-01-05" : "2020-01-05", status: "planning" };
const members = ["a", "b"].map((user_id) => ({ user_id, display_name: user_id.toUpperCase(), status: "approved" }));
const record = { id: "history", trip_id: trip.id, title: "舊外幣預算", category: "交通", amount: 2800, currency: "JPY", exchange_rate: .22, twd_amount: 620, pricing_mode: "split_total", unit_amount: null, payer_id: "a", updated_at: "2020-01-01T00:00:00.000Z" };
function Harness() {
  const [state, setState] = useState({ budgetItems: [record], budgetParticipants: members.map((member) => ({ budget_item_id: record.id, user_id: member.user_id, share_amount: null })), actualExpenses: [], actualParticipants: [], itineraryBudgetLinks: [], attachments: [], tripBudgetRates: future ? { rates: { JPY: .22 } } : null });
  const current = useRef(state); current.current = state;
  const [calls, setCalls] = useState([]);
  const first = useRef(true);
  const client = { rpc: async (name, args) => {
    setCalls((list) => [...list, { name, request: args.p_request_id, action: args.p_payload.payment_action }]);
    if (parameters.get("fail") === "missing") return { error: { code: "PGRST202", message: "Missing RPC" } };
    if (parameters.get("fail") === "once" && first.current) { first.current = false; return { error: { code: "40001", message: "Injected conflict" } }; }
    const result = saveDemoBudgetRecord(current.current, args.p_kind, args.p_payload, args.p_id, { tripId: args.p_trip_id, operationId: args.p_request_id, baseUpdatedAt: args.p_base_updated_at }, trip, members);
    if (!result.ok) return { error: result.error || new Error("Conflict") };
    current.current = result.nextState; setState(result.nextState);
    return { data: result.data, error: null };
  } };
  const save = (kind) => (form, id, meta) => persistBudgetWorkspace({ supabase: client, tripId: trip.id, reload: async () => {} }, kind, form, id, meta);
  const services = { useGuard: () => {}, handoff: async () => true, isLocked: () => parameters.has("locked"),
    acquire: async (table, record) => ({ data: record }), release: async () => {},
    read: async (table, id) => ({ data: (table === "budget_items" ? current.current.budgetItems : current.current.actualExpenses).find((row) => row.id === id) }),
    readPayments: async (_, id) => ({ data: current.current.actualExpenses.filter((row) => row.budget_item_id === id) }) };
  return <><BudgetWorkspace activeTrip={trip} members={members} canEdit={!parameters.has("viewer")} currentUserId="a" services={services} {...state}
    restoreDrafts={false} onSave={save("budget")} onSaveActual={save("actual")} onDelete={() => ({ ok: true })} onDeleteActual={() => ({ ok: true })} items={[]} />
    <output data-testid="rpc-contract">{JSON.stringify(calls)}</output></>;
}
createRoot(document.getElementById("root")).render(<Harness />);
