export const DESTINATION_MARKER_WIDTH = 32;
export const DESTINATION_MARKER_HEIGHT = 40;
export const DESTINATION_MARKER_ANCHOR_X = 16;
export const DESTINATION_MARKER_ANCHOR_Y = 40;

const DESTINATION_MARKER_CENTER_X = 16;
const DESTINATION_MARKER_CENTER_Y = 16;
const DESTINATION_MARKER_RADIUS = 13.8;
const DESTINATION_MARKER_TRIANGLE_PATH = "M 8 25.2 L 24 25.2 L 16 38 Z";

function safeHexColor(color, fallback = "#2f8f72") {
  return /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : fallback;
}

function markerOrderLabel(order) {
  const numericOrder = Number(order);
  return Number.isFinite(numericOrder) && numericOrder > 0 ? String(Math.floor(numericOrder)) : "1";
}

export function buildDestinationMarkerSvg({
  order = 1,
  color = "#2f8f72",
  fillColor = "#dcefe8",
  focused = false,
  dimmed = false,
  hovered = false,
} = {}) {
  const label = markerOrderLabel(order);
  const borderColor = safeHexColor(color);
  const innerColor = safeHexColor(fillColor, "#dcefe8");
  const opacity = dimmed ? 0.72 : 1;
  const fontSize = label.length > 1 ? 11.5 : 13.5;
  const shadowOpacity = focused ? 0.34 : hovered ? 0.3 : 0.24;
  const hoverRing = hovered && !focused
    ? `<circle cx="${DESTINATION_MARKER_CENTER_X}" cy="${DESTINATION_MARKER_CENTER_Y}" r="${DESTINATION_MARKER_RADIUS + 1.4}" fill="none" stroke="${borderColor}" stroke-width="2.8" stroke-opacity="0.36"/>`
    : "";
  const focusRing = focused
    ? `<circle cx="${DESTINATION_MARKER_CENTER_X}" cy="${DESTINATION_MARKER_CENTER_Y}" r="${DESTINATION_MARKER_RADIUS + 2.2}" fill="none" stroke="#2f8f72" stroke-width="3.2" stroke-opacity="0.42"/>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DESTINATION_MARKER_WIDTH}" height="${DESTINATION_MARKER_HEIGHT}" viewBox="0 0 ${DESTINATION_MARKER_WIDTH} ${DESTINATION_MARKER_HEIGHT}">`,
    `<defs><filter id="marker-shadow" x="-35%" y="-25%" width="170%" height="170%"><feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#1f2723" flood-opacity="${shadowOpacity}"/></filter></defs>`,
    `<g opacity="${opacity}" filter="url(#marker-shadow)">`,
    hoverRing,
    focusRing,
    `<path d="${DESTINATION_MARKER_TRIANGLE_PATH}" fill="${borderColor}"/>`,
    `<circle cx="${DESTINATION_MARKER_CENTER_X}" cy="${DESTINATION_MARKER_CENTER_Y}" r="${DESTINATION_MARKER_RADIUS}" fill="${innerColor}" stroke="${borderColor}" stroke-width="2.6"/>`,
    `<text x="${DESTINATION_MARKER_CENTER_X}" y="16.5" fill="${borderColor}" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="${fontSize}" font-weight="900" text-anchor="middle" dominant-baseline="central">${label}</text>`,
    "</g>",
    "</svg>",
  ].join("");
}
