import { clearOfflineAccount } from "../lib/offlineCache.js";
import { useEffect } from "react";
import { hasSupabaseConfig, supabase } from "../lib/supabase.js";

export function useAccountSession({
    setSession,
    setAuthReady,
    setTrips,
    setActiveTripId,
    accountRef,
    requestGuard,
    budgetRefreshRef,
    luggageRefreshRef,
    loadTripData,
  }) {
  useEffect(() => {
    if (!hasSupabaseConfig) {
      setAuthReady(true);
      return;
    }

    let alive = true, authEvent = 0;
    function acceptSession(nextSession) {
      if (!alive) return;
      const nextId = nextSession?.user?.id || null, previous = accountRef.current;
      if (previous.userId !== nextId) {
        clearOfflineAccount(previous.userId);
        accountRef.current = { userId: nextId, generation: previous.generation + 1 };
        requestGuard.setContext(null);
        luggageRefreshRef.current.cancel();
        budgetRefreshRef.current.cancel();
        setTrips([]); setActiveTripId(null);
        void loadTripData(null);
      }
      setSession(nextSession);
      setAuthReady(true);
    }
    supabase.auth.getSession().then(({ data }) => { if (!authEvent) acceptSession(data.session); });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      authEvent++;
      acceptSession(nextSession);
      if (event === "SIGNED_OUT" || !nextSession) clearOfflineAccount(accountRef.current.userId);
    });

    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);
}
