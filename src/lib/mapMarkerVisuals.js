export const DESTINATION_MARKER_WIDTH = 32;
export const DESTINATION_MARKER_HEIGHT = 40;
export const DESTINATION_MARKER_ANCHOR_X = 16;
export const DESTINATION_MARKER_ANCHOR_Y = 40;

const DESTINATION_MARKER_PATH =
  "M 16 1.5 C 7.8 1.5 1.5 7.7 1.5 15.6 C 1.5 23.1 8.2 27.5 16 37.8 C 23.8 27.5 30.5 23.1 30.5 15.6 C 30.5 7.7 24.2 1.5 16 1.5 Z";

function safeHexColor(color, fallback = "#2f8f72") {
  return /^#[0-9a-f]{6}$/i.test(String(color || "")) ? color : fallback;
}

function markerOrderLabel(order) {
  const numericOrder = Number(order);
  return Number.isFinite(numericOrder) && numericOrder > 0 ? String(Math.floor(numericOrder)) : "1";
}

export function buildDestinationMarkerSvg({ order = 1, color = "#2f8f72", focused = false, dimmed = false, hovered = false } = {}) {
  const label = markerOrderLabel(order);
  const fillColor = safeHexColor(color);
  const opacity = dimmed ? 0.72 : 1;
  const fontSize = label.length > 1 ? 11.5 : 13.5;
  const shadowOpacity = focused ? 0.34 : hovered ? 0.3 : 0.24;
  const hoverRing = hovered && !focused
    ? `<path d="${DESTINATION_MARKER_PATH}" fill="none" stroke="${fillColor}" stroke-width="3.2" stroke-opacity="0.36" stroke-linejoin="round"/>`
    : "";
  const focusRing = focused
    ? `<path d="${DESTINATION_MARKER_PATH}" fill="none" stroke="#2f8f72" stroke-width="4" stroke-opacity="0.42" stroke-linejoin="round"/>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DESTINATION_MARKER_WIDTH}" height="${DESTINATION_MARKER_HEIGHT}" viewBox="0 0 ${DESTINATION_MARKER_WIDTH} ${DESTINATION_MARKER_HEIGHT}">`,
    `<defs><filter id="marker-shadow" x="-35%" y="-25%" width="170%" height="170%"><feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#1f2723" flood-opacity="${shadowOpacity}"/></filter></defs>`,
    `<g opacity="${opacity}" filter="url(#marker-shadow)">`,
    hoverRing,
    focusRing,
    `<path d="${DESTINATION_MARKER_PATH}" fill="${fillColor}" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>`,
    `<text x="16" y="16.5" fill="#ffffff" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="${fontSize}" font-weight="800" text-anchor="middle" dominant-baseline="central">${label}</text>`,
    "</g>",
    "</svg>",
  ].join("");
}
