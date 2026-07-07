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

function buildDirectionsUrl(apiKey: string, origin: LatLngLiteral, destination: LatLngLiteral) {
  const params = new URLSearchParams({
    departure_time: "now",
    destination: `${destination.latitude},${destination.longitude}`,
    key: apiKey,
    language: "zh-TW",
    mode: "transit",
    origin: `${origin.latitude},${origin.longitude}`,
    region: "jp",
  });
  return `${directionsEndpoint}?${params.toString()}`;
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

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY") || Deno.env.get("GOOGLE_DIRECTIONS_API_KEY") || "";
  if (!apiKey) {
    return jsonResponse({ ok: false, status: "MISSING_API_KEY", message: "Directions API key is not configured" }, 500);
  }

  try {
    const response = await fetch(buildDirectionsUrl(apiKey, origin, destination), {
      method: "GET",
    });
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !data) {
      return jsonResponse(
        {
          ok: false,
          status: typeof data?.status === "string" ? data.status : String(response.status),
          message: typeof data?.error_message === "string" ? data.error_message : "Directions request failed",
        },
        200,
      );
    }

    const durationMinutes = durationFromDirections(data);
    if (durationMinutes === null) {
      return jsonResponse({
        ok: false,
        status: typeof data.status === "string" ? data.status : "NO_DURATION",
        message: typeof data.error_message === "string" ? data.error_message : "No transit duration found",
      });
    }

    return jsonResponse({
      ok: true,
      durationMinutes,
      source: "directions-transit-fallback",
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      status: "REQUEST_FAILED",
      message: error instanceof Error ? error.message : "Directions request failed",
    });
  }
});
