const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

type LatLngLiteral = {
  latitude: number;
  longitude: number;
};

const directionsEndpoint = "https://maps.googleapis.com/maps/api/directions/json";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: corsHeaders,
    status,
  });
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseLatLng(value: unknown): LatLngLiteral | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const latitude = finiteNumber(record.latitude);
  const longitude = finiteNumber(record.longitude);
  if (latitude === null || longitude === null) return null;
  return { latitude, longitude };
}

function parseLabel(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function durationFromDirections(data: Record<string, unknown>) {
  const routes = Array.isArray(data.routes) ? data.routes : [];
  const firstRoute = routes[0] as Record<string, unknown> | undefined;
  const legs = Array.isArray(firstRoute?.legs) ? firstRoute.legs : [];
  const firstLeg = legs[0] as Record<string, unknown> | undefined;
  const duration = firstLeg?.duration as Record<string, unknown> | undefined;
  const seconds = finiteNumber(duration?.value);
  if (seconds === null || seconds <= 0) return null;
  return Math.ceil(seconds / 60);
}

function directionsPointValue(point: LatLngLiteral | string) {
  return typeof point === "string" ? point : `${point.latitude},${point.longitude}`;
}

function buildDirectionsUrl(apiKey: string, origin: LatLngLiteral | string, destination: LatLngLiteral | string) {
  const params = new URLSearchParams({
    departure_time: "now",
    destination: directionsPointValue(destination),
    key: apiKey,
    language: "zh-TW",
    mode: "transit",
    origin: directionsPointValue(origin),
    region: "jp",
  });
  return `${directionsEndpoint}?${params.toString()}`;
}

async function fetchDirections(apiKey: string, origin: LatLngLiteral | string, destination: LatLngLiteral | string) {
  const response = await fetch(buildDirectionsUrl(apiKey, origin, destination), {
    method: "GET",
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { data, response };
}

function failurePayload(data: Record<string, unknown> | null, fallbackStatus: string, fallbackMessage: string) {
  return {
    ok: false,
    status: typeof data?.status === "string" ? data.status : fallbackStatus,
    message: typeof data?.error_message === "string" ? data.error_message : fallbackMessage,
  };
}

function successPayload(data: Record<string, unknown> | null) {
  if (!data) return null;
  const durationMinutes = durationFromDirections(data);
  if (durationMinutes === null) return null;
  return {
    ok: true,
    durationMinutes,
    source: "directions-transit-fallback",
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, status: "METHOD_NOT_ALLOWED", message: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, status: "INVALID_JSON", message: "Invalid JSON body" }, 400);
  }

  const origin = parseLatLng(body.origin);
  const destination = parseLatLng(body.destination);
  if (!origin || !destination) {
    return jsonResponse({ ok: false, status: "INVALID_COORDINATES", message: "Missing origin or destination" }, 400);
  }
  const originLabel = parseLabel(body.originLabel);
  const destinationLabel = parseLabel(body.destinationLabel);

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") || Deno.env.get("GOOGLE_DIRECTIONS_API_KEY") || "";
  if (!apiKey) {
    return jsonResponse({ ok: false, status: "MISSING_API_KEY", message: "Directions API key is not configured" }, 500);
  }

  try {
    const { data, response } = await fetchDirections(apiKey, origin, destination);
    if (!response.ok || !data) {
      return jsonResponse(failurePayload(data, String(response.status), "Directions request failed"), 200);
    }

    const firstResult = successPayload(data);
    if (firstResult) return jsonResponse(firstResult);

    if (data.status === "ZERO_RESULTS" && originLabel && destinationLabel) {
      const labelResult = await fetchDirections(apiKey, originLabel, destinationLabel);
      if (!labelResult.response.ok || !labelResult.data) {
        return jsonResponse(failurePayload(labelResult.data, String(labelResult.response.status), "Directions label retry failed"), 200);
      }
      const labelSuccess = successPayload(labelResult.data);
      if (labelSuccess) return jsonResponse(labelSuccess);
      return jsonResponse(failurePayload(labelResult.data, "NO_DURATION", "No transit duration found"));
    }

    return jsonResponse(failurePayload(data, "NO_DURATION", "No transit duration found"));
  } catch (error) {
    return jsonResponse({
      ok: false,
      status: "REQUEST_FAILED",
      message: error instanceof Error ? error.message : "Directions request failed",
    });
  }
});
