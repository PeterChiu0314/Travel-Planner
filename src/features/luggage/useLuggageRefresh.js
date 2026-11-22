import { updateOfflineSharedLuggage } from "../../lib/offlineCache.js";
import { createLuggageRefresh, readLuggageScope } from "../../lib/luggageSync.js";
import { useCallback, useRef } from "react";
import { supabase } from "../../lib/supabase.js";

export function useLuggageRefresh({
  setLuggageItems,
  setSharedLuggageItems,
  syncFeedback,
  requestGuard,
  tripReadAccessRef,
  canReadTrip,
}) {
  const sharedSnapshotRef = useRef({ key: null, rows: [] });

  if (sharedSnapshotRef.current.key !== requestGuard.context().key) sharedSnapshotRef.current = { key: requestGuard.context().key, rows: [] };

  function updateSharedCache(tripId, userId, update) {
    sharedSnapshotRef.current.rows = update(sharedSnapshotRef.current.rows);
    updateOfflineSharedLuggage(tripId, userId, () => sharedSnapshotRef.current.rows);
  }

  const luggageRefreshRef = useRef(null);

  if (!luggageRefreshRef.current) luggageRefreshRef.current = createLuggageRefresh({
    guard: requestGuard,
    read: async (scope, key) => {
      const feedbackCheckpoint = syncFeedback.checkpoint();
      const [userId, tripId] = JSON.parse(key);
      const access = tripReadAccessRef.current;
      if (!canReadTrip(key)) return { data: [], feedbackCheckpoint };
      const result = await readLuggageScope(supabase, { scope, tripId, userId });
      return { ...(tripReadAccessRef.current === access && canReadTrip(key) ? result : { data: [] }), feedbackCheckpoint };
    },
    apply: (scope, rows) => {
      (scope === "personal" ? setLuggageItems : setSharedLuggageItems)(rows);
      if (scope === "shared") {
        const [userId, tripId] = JSON.parse(requestGuard.context().key);
        sharedSnapshotRef.current.rows = rows;
        updateOfflineSharedLuggage(tripId, userId, () => rows);
      }
    },
    onError: (error, scope) => syncFeedback.failure(`luggage:${scope}`, error),
    onVerified: (scope, result) => syncFeedback.verified(`luggage:${scope}`, result.feedbackCheckpoint),
  });

  const refreshLuggage = useCallback((tripId, scopes = ["personal", "shared"]) => {
    const key = requestGuard.context().key;
    if (!key || JSON.parse(key)[1] !== tripId) return Promise.resolve();
    return luggageRefreshRef.current.refresh(scopes);
  }, [requestGuard]);

  return { sharedSnapshotRef, updateSharedCache, luggageRefreshRef, refreshLuggage };
}
