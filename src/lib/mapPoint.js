function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidLatitude(value) {
  const number = finiteNumber(value);
  return number !== null && number >= -90 && number <= 90;
}

function isValidLongitude(value) {
  const number = finiteNumber(value);
  return number !== null && number >= -180 && number <= 180;
}

function validPoint(latitude, longitude) {
  const lat = finiteNumber(latitude);
  const lng = finiteNumber(longitude);
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return null;
  return { latitude: lat, longitude: lng };
}

function coordinateFromMatch(match) {
  if (!match) return null;
  return validPoint(match[1], match[2]);
}

function decodedText(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUrlSearchPoint(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    try {
      url = new URL(`https://maps.google.com/${text.startsWith("?") ? text : `?${text}`}`);
    } catch {
      return null;
    }
  }

  const queryCandidates = [url.searchParams.get("q"), url.searchParams.get("ll")].filter(Boolean);
  for (const candidate of queryCandidates) {
    const point = coordinateFromMatch(String(candidate).match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/));
    if (point) return point;
  }
  return null;
}

export function parseMapUrlToPoint(mapUrl) {
  if (mapUrl === null || mapUrl === undefined) return null;
  const text = String(mapUrl).trim();
  if (!text) return null;

  const decoded = decodedText(text);
  return (
    coordinateFromMatch(decoded.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[,/?]|$)/)) ||
    parseUrlSearchPoint(decoded) ||
    coordinateFromMatch(decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)) ||
    null
  );
}

export function hasValidMapPoint(item) {
  if (!item) return false;
  return Boolean(validPoint(item.latitude, item.longitude));
}

export function getMapPointStatus(item) {
  if (hasValidMapPoint(item)) return "valid";
  const mapUrl = typeof item?.map_url === "string" ? item.map_url.trim() : item?.map_url;
  if (!mapUrl) return "missing-url";
  return parseMapUrlToPoint(mapUrl) ? "parsable-url" : "invalid-url";
}

export function countMissingMapPoints(dayItems = []) {
  if (!Array.isArray(dayItems)) return 0;
  return dayItems.reduce((count, item) => {
    if (!item || item.item_type === "transport" || item.type === "transport") return count;
    return hasValidMapPoint(item) ? count : count + 1;
  }, 0);
}

export function normalizeMapPointFields(payload) {
  if (payload?.item_type === "transport" || payload?.type === "transport") {
    return { latitude: null, longitude: null };
  }
  const mapUrl = typeof payload?.map_url === "string" ? payload.map_url.trim() : payload?.map_url;
  if (!mapUrl) {
    return validPoint(payload?.latitude, payload?.longitude) || { latitude: null, longitude: null };
  }
  const point = parseMapUrlToPoint(mapUrl);
  return point || { latitude: null, longitude: null };
}

export { finiteNumber, isValidLatitude, isValidLongitude };
