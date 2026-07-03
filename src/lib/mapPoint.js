import { isTransportationCard } from "./timelineTransportationRoles.js";

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

function parsedUrl(value) {
  try {
    return new URL(String(value));
  } catch {
    return null;
  }
}

export function isGoogleMapsShortUrl(mapUrl) {
  const url = parsedUrl(mapUrl);
  if (!url || url.protocol !== "https:") return false;

  const hostname = url.hostname.toLowerCase();
  if (hostname === "maps.app.goo.gl") return true;
  return hostname === "goo.gl" && url.pathname.toLowerCase().startsWith("/maps");
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
    coordinateFromMatch(decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)) ||
    parseUrlSearchPoint(decoded) ||
    coordinateFromMatch(decoded.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[,/?]|$)/)) ||
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
    if (!item || isTransportationCard(item)) return count;
    return hasValidMapPoint(item) ? count : count + 1;
  }, 0);
}

export function normalizeMapPointFields(payload) {
  if (isTransportationCard(payload)) {
    return { latitude: null, longitude: null };
  }
  const mapUrl = typeof payload?.map_url === "string" ? payload.map_url.trim() : payload?.map_url;
  if (!mapUrl) {
    return { latitude: null, longitude: null };
  }
  const point = parseMapUrlToPoint(mapUrl);
  return point || { latitude: null, longitude: null };
}

export function validateDestinationMapUrl(mapUrl) {
  const text = typeof mapUrl === "string" ? mapUrl.trim() : mapUrl;
  if (!text) {
    return { ok: false, errorMessage: "請貼上有效 Map URL", point: null };
  }

  const point = parseMapUrlToPoint(text);
  if (!point) {
    return { ok: false, errorMessage: "無法取得有效點位", point: null };
  }

  return { ok: true, errorMessage: "", point };
}

export async function resolveDestinationMapUrlPoint(mapUrl, options = {}) {
  const text = typeof mapUrl === "string" ? mapUrl.trim() : mapUrl;
  const directValidation = validateDestinationMapUrl(text);
  if (directValidation.ok) {
    return { ...directValidation, expandedUrl: "", resolvedByShortLink: false };
  }

  if (!text || !isGoogleMapsShortUrl(text)) {
    return { ...directValidation, expandedUrl: "", resolvedByShortLink: false };
  }

  if (typeof options.resolveShortUrl !== "function") {
    return {
      ok: false,
      errorMessage: directValidation.errorMessage,
      point: null,
      expandedUrl: "",
      resolvedByShortLink: false,
    };
  }

  try {
    const expandedUrl = await options.resolveShortUrl(text);
    const point = parseMapUrlToPoint(expandedUrl);
    if (!point) {
      return {
        ok: false,
        errorMessage: directValidation.errorMessage,
        point: null,
        expandedUrl: expandedUrl || "",
        resolvedByShortLink: true,
      };
    }
    return { ok: true, errorMessage: "", point, expandedUrl, resolvedByShortLink: true };
  } catch {
    return {
      ok: false,
      errorMessage: directValidation.errorMessage,
      point: null,
      expandedUrl: "",
      resolvedByShortLink: false,
    };
  }
}

export { finiteNumber, isValidLatitude, isValidLongitude };
