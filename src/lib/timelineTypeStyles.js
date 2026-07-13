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
