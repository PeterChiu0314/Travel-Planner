import { requestActiveEditorHandoff, useActiveEditorGuard } from "../../app/activeEditorGuard.jsx";
import ExpenseWorkspace from "./ExpenseWorkspace.jsx";
import { supabase } from "../../lib/supabase.js";

export const budgetEditorServices = {
  useGuard: useActiveEditorGuard,
  handoff: requestActiveEditorHandoff,
};

export function BudgetPanel(props) {
  if (props.activeTrip.membership && props.activeTrip.membership.status !== "approved") return null;
  return <ExpenseWorkspace key={`${props.currentUserId}:${props.activeTrip.id}`} {...props} supabase={supabase} services={budgetEditorServices} />;
}
