export const MAX_CUSTOM_ROUTE_POINTS_PER_SEGMENT = 5;

export function routeOverrideSegmentKey(fromItemId, toItemId) {
  return `${fromItemId}:${toItemId}`;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeRouteOverridePoints(points = []) {
  if (!Array.isArray(points)) return [];
  return points.reduce((normalized, point) => {
    const lat = finiteNumber(point?.lat);
    const lng = finiteNumber(point?.lng);
    if (lat === null || lng === null) return normalized;
    const id = typeof point?.id === "string" && point.id.trim()
      ? point.id.trim()
      : `legacy-${normalized.length}-${lat}-${lng}`;
    normalized.push({ id, lat, lng });
    return normalized;
  }, []);
}

export function routeOverridePointsEqual(left = [], right = []) {
  const normalizedLeft = normalizeRouteOverridePoints(left);
  const normalizedRight = normalizeRouteOverridePoints(right);
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((point, index) => (
    point.id === normalizedRight[index].id &&
    point.lat === normalizedRight[index].lat && point.lng === normalizedRight[index].lng
  ));
}

export function routeOverridesToSegmentMap(overrides = [], validSegmentKeys = null) {
  const validKeys = validSegmentKeys instanceof Set ? validSegmentKeys : null;
  return (Array.isArray(overrides) ? overrides : []).reduce((map, override) => {
    const key = routeOverrideSegmentKey(override?.from_item_id, override?.to_item_id);
    if (!override?.from_item_id || !override?.to_item_id || (validKeys && !validKeys.has(key))) return map;
    const points = normalizeRouteOverridePoints(override.points_json);
    if (!points.length) return map;
    map[key] = points;
    return map;
  }, {});
}

export function validRouteSegmentKeysFromStops(stops = []) {
  const keys = new Set();
  for (let index = 0; index < stops.length - 1; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    if (!from?.itemId || !to?.itemId) continue;
    keys.add(routeOverrideSegmentKey(from.itemId, to.itemId));
  }
  return keys;
}
