const tripPresencePageLabels = {
  accommodation: "Accommodation",
  budget: "Budget",
  overview: "Overview",
  packing: "Packing",
  settings: "Settings",
  settlement: "Settlement",
  timeline: "Timeline",
  todo: "Todo",
};

export function tripPresencePageKey(section) {
  if (section === "today") return "overview";
  if (section === "luggage") return "packing";
  return tripPresencePageLabels[section] ? section : "";
}

export function tripPresencePageLabel(payload) {
  const pageLabel = tripPresencePageLabels[payload?.pageKey] || payload?.pageKey || "Unknown";
  if (payload?.pageKey === "timeline" && Number.isInteger(Number(payload.dayIndex))) {
    return `${pageLabel} · Day ${Number(payload.dayIndex) + 1}`;
  }
  return pageLabel;
}
