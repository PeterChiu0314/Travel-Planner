import { expenseFinancialSnapshot, expenseTimelineCostsByItem, olderExpenseSnapshot } from "../../lib/expenseSnapshot.js";
import { readOfflineTripData, updateOfflineBudget } from "../../lib/offlineCache.js";
import { createBudgetRefresh, emptyBudgetSnapshot, cachedExpenseGraph, readBudgetSnapshot } from "../../lib/budgetSync.js";
import { useCallback, useMemo, useRef, useState } from "react";
import { budgetAuthorityTimeoutMs } from "../../lib/budgetMetadataService.js";
import { supabase } from "../../lib/supabase.js";

export function useExpenseSnapshot({
  setTrips,
  syncFeedback,
  requestGuard,
  tripDataContext,
  tripReadAccessRef,
  canReadTrip,
}) {
  const [budgetSnapshotState, setBudgetSnapshotState] = useState(null);
  const budgetSnapshot = canReadTrip(tripDataContext.key) && budgetSnapshotState
    && requestGuard.sameContext(budgetSnapshotState.context) ? budgetSnapshotState.data : null;

  const { budgetItems, budgetParticipants, actualExpenses, actualParticipants, itineraryBudgetLinks } = budgetSnapshot ?? emptyBudgetSnapshot();

  const expenseGraph = budgetSnapshot?.expenseGraph;

  const budgetsByItem = useMemo(
    () => expenseTimelineCostsByItem(expenseGraph, itineraryBudgetLinks),
    [expenseGraph, itineraryBudgetLinks],
  );

  const budgetSnapshotRef = useRef({ context: tripDataContext, data: emptyBudgetSnapshot() });

  if (!requestGuard.sameContext(budgetSnapshotRef.current.context)) {
    budgetSnapshotRef.current = { context: tripDataContext, data: emptyBudgetSnapshot() };
  }

  function applyBudgetSnapshot(data, key, cache = true) {
    const context = requestGuard.context();
    if (context.key !== key) return;
    if (olderExpenseSnapshot(budgetSnapshotRef.current.data.expenseGraph, data.expenseGraph)) return;
    const verifiedAt = data.expenseVerified ? Date.now() : undefined;
    const snapshot = { context, data, verifiedAt };
    budgetSnapshotRef.current = snapshot;
    setBudgetSnapshotState(snapshot);
    if (key && cache) {
      const [userId, tripId] = JSON.parse(key);
      updateOfflineBudget(tripId, userId, cachedExpenseGraph(data.expenseGraph, tripId), localStorage, verifiedAt);
    }
    if (data.expenseVerified && data.tripBudgetRates) {
      setTrips(current => current.map(t => t.id === data.tripId ? { ...t, budget_exchange_rates: data.tripBudgetRates } : t));
    }
  }

  const budgetRefreshRef = useRef(null);

  if (!budgetRefreshRef.current) budgetRefreshRef.current = createBudgetRefresh({
    guard: requestGuard,
    timeoutMs: budgetAuthorityTimeoutMs,
    read: async key => {
      const feedbackCheckpoint = syncFeedback.checkpoint();
      const access = tripReadAccessRef.current;
      if (!canReadTrip(key)) return { data: emptyBudgetSnapshot(), feedbackCheckpoint };
      const result = await readBudgetSnapshot(supabase, JSON.parse(key)[1]);
      return { ...(tripReadAccessRef.current === access && canReadTrip(key) ? result : { data: emptyBudgetSnapshot() }), feedbackCheckpoint };
    },
    apply: applyBudgetSnapshot,
    onVerified: result => syncFeedback.verified("budget", result.feedbackCheckpoint),
    onError: error => {
      const { context, data } = budgetSnapshotRef.current;
      const { key } = context;
      if (!requestGuard.sameContext(context) || !canReadTrip(key)) return;
      if (error.code === "42501") {
        applyBudgetSnapshot({ ...emptyBudgetSnapshot(), expenseUnavailable: true }, key);
      } else {
        let visible = data;
        if (!data.expenseGraph && !data.expenseUnavailable) {
          const [userId, tripId] = JSON.parse(key);
          const cached = readOfflineTripData(tripId, userId);
          const graph = cachedExpenseGraph(cached?.expenseGraph ?? cached?.budgetSnapshot?.expenseGraph, tripId);
          if (graph) visible = expenseFinancialSnapshot(graph);
        }
        applyBudgetSnapshot({ ...visible, expenseVerified: false, expenseUnavailable: true }, key, false);
      }
      syncFeedback.failure("budget", error.code === "PGRST202" ? "目前無法讀取支出，請稍後重試。" : error);
    },
  });

  const refreshBudget = useCallback((tripId) => {
    if (!requestGuard.sameContext(tripDataContext) || !tripDataContext.key || JSON.parse(tripDataContext.key)[1] !== tripId) return Promise.resolve({ ok: false, stale: true });
    return budgetRefreshRef.current.committed();
  }, [tripDataContext.key, tripDataContext.generation]);

  return {
    budgetSnapshot,
    budgetItems,
    budgetParticipants,
    actualExpenses,
    actualParticipants,
    itineraryBudgetLinks,
    budgetsByItem,
    budgetSnapshotRef,
    applyBudgetSnapshot,
    budgetRefreshRef,
    refreshBudget,
  };
}
