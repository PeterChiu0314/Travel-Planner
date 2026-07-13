export const timelineTypeColors = Object.freeze({
  attraction: "#2f8f72",
  food: "#d85f49",
  hotel: "#7865a8",
  transport: "#5f8fb8",
  note: "#f3b64b",
});

// Keep the existing Timeline hue, but deepen the light note color so a white
// sequence number remains readable inside a small map marker.
export const timelineTypeMarkerColors = Object.freeze({
  ...timelineTypeColors,
  note: "#b87918",
});

export function timelineTypeKey(type) {
  const key = String(type || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(timelineTypeColors, key) ? key : "attraction";
}

export function timelineTypeColor(type) {
  return timelineTypeColors[timelineTypeKey(type)];
}

export function timelineTypeMarkerColor(type) {
  return timelineTypeMarkerColors[timelineTypeKey(type)];
}
