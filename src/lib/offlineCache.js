const prefix = "travel-planner-offline-v2:";
const ttl = 12 * 60 * 60 * 1000;
const oldTrip = /^travel-planner-offline-(?!trips-|v2:)/;
const key = (userId, tripId) => `${prefix}${encodeURIComponent(userId)}:${tripId ? `trip:${encodeURIComponent(tripId)}` : "trips"}`;

function cleanLegacy(storage) {
  for (const name of Object.keys(storage)) if (oldTrip.test(name)) storage.removeItem(name);
}
function read(userId, tripId, storage, now) {
  if (!userId) return null;
  try {
    cleanLegacy(storage);
    const name = key(userId, tripId), cached = JSON.parse(storage.getItem(name) || "null");
    if (!cached || cached.userId !== userId || cached.tripId !== tripId || !Number.isFinite(cached.cachedAt)
      || cached.cachedAt > now || now - cached.cachedAt > ttl) {
      storage.removeItem(name); return null;
    }
    // Private luggage is never recovered from persistent storage, including
    // a malformed/older envelope written by an earlier client.
    if (!tripId) return cached.payload;
    const payload = { ...cached.payload, luggageItems: [] };
    if (payload.expenseGraph || payload.budgetSnapshot?.expenseGraph) {
      const cachedAt = payload.expenseGraphCachedAt ?? cached.cachedAt;
      if (!Number.isFinite(cachedAt) || cachedAt > now || now - cachedAt > ttl) {
        delete payload.expenseGraph;
        delete payload.budgetSnapshot;
        delete payload.expenseGraphCachedAt;
      } else {
        payload.expenseGraphCachedAt = cachedAt;
      }
    }
    return payload;
  } catch { return null; }
}
function write(userId, tripId, payload, storage, now) {
  if (!userId) return;
  try {
    cleanLegacy(storage);
    const safe = { ...payload };
    if (tripId) delete safe.luggageItems;
    storage.setItem(key(userId, tripId), JSON.stringify({ userId, tripId, cachedAt: now, payload: safe }));
  } catch { /* Best effort when storage is unavailable or full. */ }
}
export const readOfflineTrips = (userId, storage = localStorage, now = Date.now()) => read(userId, null, storage, now);
export const writeOfflineTrips = (userId, payload, storage = localStorage, now = Date.now()) => write(userId, null, payload, storage, now);
export const readOfflineTripData = (tripId, userId, storage = localStorage, now = Date.now()) => read(userId, tripId, storage, now);
export const writeOfflineTripData = (tripId, userId, payload, storage = localStorage, now = Date.now()) => write(userId, tripId, payload, storage, now);
export function updateOfflineSharedLuggage(tripId, userId, update, storage = localStorage, now = Date.now()) {
  const cached = read(userId, tripId, storage, now);
  if (cached) write(userId, tripId, { ...cached, sharedLuggageItems: update(cached.sharedLuggageItems || []) }, storage, now);
}
export function updateOfflineBudget(tripId, userId, expenseGraph, storage = localStorage, now = Date.now()) {
  const cached = read(userId, tripId, storage, now);
  if (!cached) return;
  for (const key of ["budgetSnapshot", "budgetBaseline", "budgetItems", "budgetParticipants",
    "actualExpenses", "actualParticipants", "itineraryBudgetLinks"]) delete cached[key];
  cached.attachments = (cached.attachments || []).filter(row => !["budget_item", "actual_expense"].includes(row.target_type));
  write(userId, tripId, { ...cached, expenseGraph, expenseGraphCachedAt: expenseGraph ? now : undefined }, storage, now);
}
export function clearOfflineAccount(userId, storage = localStorage) {
  try {
    cleanLegacy(storage);
    for (const name of Object.keys(storage)) {
      if (userId && (name.startsWith(`${prefix}${encodeURIComponent(userId)}:`) || name === `travel-planner-offline-trips-${userId}`)) storage.removeItem(name);
    }
  } catch { /* Storage can be unavailable. */ }
}
