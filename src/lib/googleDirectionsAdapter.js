import { supabase } from "./supabase.js";

export const GOOGLE_DIRECTIONS_TRANSIT_FUNCTION = "google-directions-transit-duration";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function latLngLiteral(item) {
  const latitude = finiteNumber(item?.latitude);
  const longitude = finiteNumber(item?.longitude);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

function locationLabel(item) {
  const value = item?.location_name || item?.location || item?.title || item?.name || "";
  return typeof value === "string" ? value.trim() : "";
}

export function buildGoogleDirectionsTransitDurationRequest({ fromItem, toItem } = {}) {
  const origin = latLngLiteral(fromItem);
  const destination = latLngLiteral(toItem);
  if (!origin || !destination) {
    return { ok: false, reason: "missing_coordinates", source: "directions-transit-fallback" };
  }

  return {
    ok: true,
    body: {
      destination,
      destinationLabel: locationLabel(toItem) || null,
      origin,
      originLabel: locationLabel(fromItem) || null,
    },
    functionName: GOOGLE_DIRECTIONS_TRANSIT_FUNCTION,
    source: "directions-transit-fallback",
  };
}

export function normalizeGoogleDirectionsTransitDuration(data = {}) {
  const durationMinutes = Number(data?.durationMinutes);
  if (data?.ok === true && Number.isFinite(durationMinutes) && durationMinutes > 0) {
    return {
      ok: true,
      durationMinutes,
      source: "directions-transit-fallback",
    };
  }

  return {
    ok: false,
    message: typeof data?.message === "string" ? data.message : "",
    reason: typeof data?.status === "string" && data.status ? data.status : "directions_failed",
    source: "directions-transit-fallback",
    status: typeof data?.status === "string" ? data.status : "",
  };
}

export async function fetchGoogleDirectionsTransitDuration({
  fromItem,
  invokeImpl = supabase?.functions?.invoke?.bind(supabase.functions),
  toItem,
} = {}) {
  if (typeof invokeImpl !== "function") {
    return { ok: false, reason: "supabase_unavailable", source: "directions-transit-fallback" };
  }

  const request = buildGoogleDirectionsTransitDurationRequest({ fromItem, toItem });
  if (!request.ok) return request;

  try {
    const { data, error } = await invokeImpl(request.functionName, {
      body: request.body,
    });
    if (error) {
      return {
        ok: false,
        message: error.message || "",
        reason: "directions_function_failed",
        source: "directions-transit-fallback",
      };
    }
    return normalizeGoogleDirectionsTransitDuration(data || {});
  } catch (error) {
    return {
      ok: false,
      message: error?.message || "",
      reason: "directions_function_failed",
      source: "directions-transit-fallback",
    };
  }
}
