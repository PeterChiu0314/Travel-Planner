// Unranked/new items follow the saved list. Keep legacy input order on equal dates.
export function sortLuggageItems(items) {
  return [...items].sort((a, b) => {
    if (a.sort_order != null || b.sort_order != null) {
      const difference = (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity);
      if (difference) return difference;
    }
    return (a.created_at || "").localeCompare(b.created_at || "") || (a.created_at && b.created_at ? a.id.localeCompare(b.id) : 0);
  });
}

export function planLuggageOrder(items, itemId, targetId, placement) {
  if (!["before", "after"].includes(placement)) throw new Error("luggage_invalid_payload");
  const ordered = sortLuggageItems(items);
  const source = ordered.find(item => item.id === itemId), target = ordered.find(item => item.id === targetId);
  if (!source || !target) throw new Error("luggage_not_found");
  if (itemId === targetId) return ordered;
  const rest = ordered.filter(item => item.id !== itemId);
  rest.splice(rest.findIndex(item => item.id === targetId) + (placement === "after" ? 1 : 0), 0, source);
  return rest;
}
