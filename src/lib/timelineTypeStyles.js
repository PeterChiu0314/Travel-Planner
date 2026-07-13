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

export const timelineTypeMarkerFillColors = Object.freeze({
  attraction: "#dcefe8",
  food: "#f9dfd8",
  hotel: "#e8e1f2",
  transport: "#e0edf6",
  note: "#faeac6",
});

// Marker number colors only: deepen each marker color by the same K increase
// represented by the approved food color change from #d85f49 to #974333.
export const timelineTypeMarkerTextColors = Object.freeze({
  attraction: "#1a4e3e",
  food: "#974333",
  hotel: "#4a3e67",
  transport: "#3d5c77",
  note: "#774e10",
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

export function timelineTypeMarkerFillColor(type) {
  return timelineTypeMarkerFillColors[timelineTypeKey(type)];
}

export function timelineTypeMarkerTextColor(type) {
  return timelineTypeMarkerTextColors[timelineTypeKey(type)];
}
