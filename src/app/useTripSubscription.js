import { onPostgresChangesReady } from "../lib/realtimePostgresReadiness.js";
import { subscribeSharedLuggage } from "../lib/luggageSync.js";
import { useEffect } from "react";
import { supabase } from "../lib/supabase.js";

export function useTripSubscription({
    session,
    activeTripId,
    activeDay,
    syncFeedback,
    tripRealtimeAttempt,
    requestGuard,
    tripDataContext,
    budgetRefreshRef,
    luggageRefreshRef,
    loadTrips,
    loadTripData,
    loadRouteOverrides,
  }) {
  useEffect(() => {
    if (!activeTripId || !session?.user) return undefined;
    let subscriptionActive = true;
    const invalidateBudget = () => { if (requestGuard.sameContext(tripDataContext)) budgetRefreshRef.current.schedule(); };
    const channel = supabase
      // A fresh topic avoids reusing the old channel while unsubscribe is in flight.
      .channel(`trip-${activeTripId}${tripRealtimeAttempt ? `-retry-${tripRealtimeAttempt}` : ""}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trips", filter: `id=eq.${activeTripId}` },
        () => { invalidateBudget(); loadTrips(activeTripId); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "itinerary_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "itinerary_route_overrides", filter: `trip_id=eq.${activeTripId}` },
        () => loadRouteOverrides(activeTripId, activeDay),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "itinerary_alternatives" },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accommodations", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "guide_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "todo_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attachments", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pack_items", filter: `trip_id=eq.${activeTripId}` },
        () => loadTripData(activeTripId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "trip_members", filter: `trip_id=eq.${activeTripId}` },
        () => {
          loadTrips(activeTripId);
          loadTripData(activeTripId);
        },
      );
    channel.on("postgres_changes", { event: "*", schema: "public", table: "expense_signals", filter: `trip_id=eq.${activeTripId}` }, invalidateBudget);
    subscribeSharedLuggage(channel, activeTripId, luggageRefreshRef.current);
    // JOIN can succeed before Postgres Changes is live. Re-read through the
    // existing guarded/coalesced path when CDC becomes ready, including rejoin.
    onPostgresChangesReady(channel, () => {
      if (subscriptionActive && requestGuard.sameContext(tripDataContext)) invalidateBudget();
    });
    channel.subscribe(status => {
      if (!subscriptionActive || !requestGuard.sameContext(tripDataContext)) return;
      if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) syncFeedback.failure("realtime", "即時連線暫時中斷，資料同步尚未確認。");
      if (status === "SUBSCRIBED" && syncFeedback.pending().includes("realtime")) {
        // Existing subscription recovery already schedules these scoped reads.
        for (const source of ["budget", "luggage:personal", "luggage:shared"]) syncFeedback.failure(source, "正在重新核對資料，請稍候。");
        syncFeedback.verified("realtime");
      }
      if (status === "SUBSCRIBED") { luggageRefreshRef.current.schedule(["personal", "shared"]); invalidateBudget(); }
    });
    return () => { subscriptionActive = false; budgetRefreshRef.current.cancel(); luggageRefreshRef.current.cancel(); supabase.removeChannel(channel); };
  }, [activeDay, activeTripId, loadRouteOverrides, loadTripData, loadTrips, session?.user, tripRealtimeAttempt]);
}
