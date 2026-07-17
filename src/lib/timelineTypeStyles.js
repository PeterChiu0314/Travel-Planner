import {
  designTypeColors,
  designTypeFillColors,
  designTypeTextColors,
} from "./designColorTokens.js";

export const timelineTypeColors = designTypeColors;
export const timelineTypeMarkerColors = designTypeColors;
export const timelineTypeMarkerFillColors = designTypeFillColors;
export const timelineTypeMarkerTextColors = designTypeTextColors;

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
