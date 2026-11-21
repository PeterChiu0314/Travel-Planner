import { readOfflineTripData, writeOfflineTripData } from "../lib/offlineCache.js";
import { emptyBudgetSnapshot, cachedExpenseGraph, nonFinancialAttachments } from "../lib/budgetSync.js";
import { readLuggageScope } from "../lib/luggageSync.js";
import { useCallback } from "react";
import { supabase } from "../lib/supabase.js";
import { readTripStays } from "../features/stays/formalStays.js";

export function useTripDataLoad({
    setItems,
    setAlternatives,
    setAccommodations,
    setGuideItems,
    setTodoItems,
    setLuggageItems,
    setSharedLuggageItems,
    setAttachments,
    clearRouteOverrides,
    setPackItems,
    setMembers,
    syncFeedback,
    invalidateChangedEndpoints,
    accountRef,
    requestGuard,
    tripDataContext,
    tripReadAccessRef,
    canReadTrip,
    budgetSnapshotRef,
    applyBudgetSnapshot,
    budgetRefreshRef,
    sharedSnapshotRef,
    activeMembership,
  }) {
  const loadTripData = useCallback(async (tripId) => {
    const userId = accountRef.current.userId;
    // A queued callback must belong to this context's generation before it can
    // advance any scope. Comparing IDs alone would accept an A -> B -> A callback.
    if (tripId) {
      if (!userId || !requestGuard.sameContext(tripDataContext) || tripDataContext.key !== JSON.stringify([userId, tripId])) return;
    } else if (requestGuard.context().key !== null) return;
    // Auth resets the guard to null before clearing, even through an older closure.
    const token = requestGuard.begin("trip");
    const personalToken = requestGuard.begin("personal"), sharedToken = requestGuard.begin("shared");
    const access = tripReadAccessRef.current;
    if (!tripId || !canReadTrip(tripDataContext.key)) {
      setItems([]);
      setAlternatives([]);
      applyBudgetSnapshot(emptyBudgetSnapshot(), token.key, false);
      sharedSnapshotRef.current.rows = [];
      setAccommodations([]);
      setGuideItems([]);
      setTodoItems([]);
      setLuggageItems([]);
      setSharedLuggageItems([]);
      setAttachments([]);
      clearRouteOverrides();
      setPackItems([]);
      setMembers([]);
      return;
    }

    // A financial read can fail or wait independently of the trip workspace.
    void budgetRefreshRef.current.committed();
    const feedbackCheckpoint = syncFeedback.checkpoint();
    const [itemsResult, alternativesResult, accommodationsResult, guideResult, todoResult, luggageResult, sharedLuggageResult,
      attachmentsResult, packResult, membersResult] = await Promise.all([
      supabase.from("itinerary_items").select("*").eq("trip_id", tripId),
      supabase.from("itinerary_alternatives").select("*"),
      readTripStays(supabase, tripId),
      supabase.from("guide_items").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("todo_items").select("*").eq("trip_id", tripId).order("due_date", { nullsFirst: false }),
      readLuggageScope(supabase, { scope: "personal", tripId, userId }),
      readLuggageScope(supabase, { scope: "shared", tripId }),
      supabase.from("attachments").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("pack_items").select("*").eq("trip_id", tripId).order("created_at"),
      supabase.from("trip_members").select("id,trip_id,user_id,role,status,created_at,display_name,email").eq("trip_id", tripId).order("created_at"),
    ]);
    if (!requestGuard.valid(token) || tripReadAccessRef.current !== access || !canReadTrip(token.key)) return;
    const error = itemsResult.error || alternativesResult.error || accommodationsResult.error || guideResult.error || todoResult.error
      || luggageResult.error || sharedLuggageResult.error || attachmentsResult.error || packResult.error || membersResult.error;
    if (error) {
      const cached = readOfflineTripData(tripId, userId);
      if (cached) {
        setItems(cached.items || []); setAlternatives(cached.alternatives || []);
        setAccommodations(cached.accommodations || []); setGuideItems(cached.guideItems || []); setTodoItems(cached.todoItems || []);
        if (requestGuard.valid(sharedToken)) { sharedSnapshotRef.current.rows = cached.sharedLuggageItems || []; setSharedLuggageItems(sharedSnapshotRef.current.rows); }
        setAttachments(nonFinancialAttachments(cached.attachments || [])); setPackItems(cached.packItems || []); setMembers(cached.members || []);
        syncFeedback.failure("trip-data", error, { cached: true }); return { ok: false, error };
      }
      syncFeedback.failure("trip-data", error); return { ok: false, error };
    }
    const nextItems = itemsResult.data || [];
    const itemIds = new Set(nextItems.map(item => item.id));
    const nextAlternatives = (alternativesResult.data || []).filter(alternative => itemIds.has(alternative.itinerary_item_id));

    invalidateChangedEndpoints(nextItems);

    setItems(nextItems);
    setAlternatives(nextAlternatives);
    setAccommodations(accommodationsResult.data || []);
    setGuideItems(guideResult.data || []);
    setTodoItems(todoResult.data || []);
    if (requestGuard.valid(personalToken)) setLuggageItems(luggageResult.data || []);
    if (requestGuard.valid(sharedToken)) {
      sharedSnapshotRef.current.rows = sharedLuggageResult.data || [];
      setSharedLuggageItems(sharedLuggageResult.data || []);
    }
    const nextAttachments = nonFinancialAttachments(attachmentsResult.data || []);
    setAttachments(nextAttachments);
    setPackItems(packResult.data || []);
    setMembers(membersResult.data || []);
    const { data: finance, verifiedAt } = budgetSnapshotRef.current;
    // A successful core load can finish before the independent expense read.
    // Keep its scoped cache until that read supplies a graph or clears access.
    const prior = !finance.expenseVerified && (finance.expenseGraph || !finance.expenseUnavailable)
      ? readOfflineTripData(tripId, userId) : null;
    const expenseGraph = cachedExpenseGraph(finance.expenseVerified
      ? finance.expenseGraph : prior?.expenseGraph ?? prior?.budgetSnapshot?.expenseGraph, tripId);
    writeOfflineTripData(tripId, userId, {
      expenseGraph,
      expenseGraphCachedAt: expenseGraph ? verifiedAt ?? prior?.expenseGraphCachedAt : undefined,
      items: nextItems,
      alternatives: nextAlternatives,
      accommodations: accommodationsResult.data || [],
      guideItems: guideResult.data || [],
      todoItems: todoResult.data || [],
      luggageItems: luggageResult.data || [],
      sharedLuggageItems: sharedSnapshotRef.current.rows,
      attachments: nextAttachments,
      packItems: packResult.data || [],
      members: membersResult.data || [],
    });
    syncFeedback.verified(["trip-data", "connection", "action",
      ...(requestGuard.valid(personalToken) ? ["luggage:personal"] : []),
      ...(requestGuard.valid(sharedToken) ? ["luggage:shared"] : [])], feedbackCheckpoint);
    return { ok: true };
  }, [tripDataContext.key, tripDataContext.generation, activeMembership?.status]);

  return { loadTripData };
}
