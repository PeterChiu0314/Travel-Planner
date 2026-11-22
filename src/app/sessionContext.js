import { tripDays } from "../lib/timelineTime.js";
import { timelineDraftEntityType } from "../components/timeline/timelineDrafts.js";
import { desktopNavItems, mobileNavItems } from "./navigation.js";

export const activeEditDraftEntityTypes = [timelineDraftEntityType, "budget_item", "accommodation", "todo_item"];

const sessionContextStoragePrefix = "travel-planner-session-context";

const sessionContextSections = new Set([...desktopNavItems, ...mobileNavItems].map((item) => item.id));

const luggageTabs = new Set(["personal", "shared"]);

function sessionContextKey(userId) {
  return `${sessionContextStoragePrefix}:${userId || "anonymous"}`;
}

export function readSessionContext(userId) {
  try {
    const raw = localStorage.getItem(sessionContextKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSessionContext(userId, context) {
  try {
    localStorage.setItem(
      sessionContextKey(userId),
      JSON.stringify({
        ...context,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Session context restore is best effort; storage can be unavailable in private windows.
  }
}

export function normalizeSessionContext(context, trip) {
  if (!context || !trip) return null;
  const dayCount = tripDays(trip).length;
  const activeDay = Number.isInteger(context.activeDay)
    ? Math.min(Math.max(context.activeDay, 0), Math.max(dayCount - 1, 0))
    : null;
  return {
    activeDay,
    activeSection: sessionContextSections.has(context.activeSection) ? context.activeSection : null,
    luggageTab: luggageTabs.has(context.luggageTab) ? context.luggageTab : null,
  };
}
