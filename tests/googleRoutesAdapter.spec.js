import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  buildGoogleRoutesDurationRequest,
  fetchGoogleRoutesDuration,
  normalizeGoogleRoutesDuration,
} from "../src/lib/googleRoutesAdapter.js";
import { buildGoogleMapsDirectionsUrl, travelModeForTransportCategory } from "../src/lib/googleMapsNavigation.js";

const fromItem = { id: "from", latitude: 35.0116, longitude: 135.7681 };
const toItem = { id: "to", latitude: 35.0037, longitude: 135.7786 };
const fromStationItem = { id: "from", latitude: 35.0116, longitude: 135.7681, provider_place_id: "yamashina-station-place" };
const toShrineItem = { id: "to", latitude: 35.0037, longitude: 135.7786, placeId: "yasaka-shrine-place" };

test("Phase 5.7a keeps transportation cards navigation-only in App UI", () => {
  const appSource = readFileSync("src/App.jsx", "utf8");

  expect(appSource).not.toContain("查詢交通");
  expect(appSource).not.toContain("fetchGoogleRoutesDuration");
  expect(appSource).not.toContain("getGoogleRoutesRuntimeConfig");
  expect(appSource).not.toContain("google-directions-transit-duration");
  expect(appSource).toContain("buildGoogleMapsDirectionsUrl");
});

test("Phase 5.7a builds Google Maps navigation URL from endpoint coordinates", () => {
  expect(travelModeForTransportCategory("jr")).toBe("transit");
  expect(travelModeForTransportCategory("taxi")).toBe("driving");
  expect(travelModeForTransportCategory("walk")).toBe("walking");
  expect(travelModeForTransportCategory("flight")).toBe("");
  expect(travelModeForTransportCategory("unknown")).toBe("transit");

  const url = buildGoogleMapsDirectionsUrl({ fromItem, toItem, transportCategory: "taxi" });
  expect(url).toContain("https://www.google.com/maps/dir/");
  expect(url).toContain("api=1");
  expect(url).toContain("origin=35.0116%2C135.7681");
  expect(url).toContain("destination=35.0037%2C135.7786");
  expect(url).toContain("travelmode=driving");

  const flightUrl = buildGoogleMapsDirectionsUrl({ fromItem, toItem, transportCategory: "flight" });
  expect(flightUrl).toContain("travelmode=");
  expect(flightUrl).not.toContain("travelmode=transit");
});

test("Phase 5.7a disables navigation and Routes requests without endpoint coordinates", () => {
  expect(buildGoogleMapsDirectionsUrl({ fromItem, toItem: { id: "missing" }, transportCategory: "jr" })).toBe("");
  expect(buildGoogleRoutesDurationRequest({ fromItem, toItem: { id: "missing" }, mode: "transit" })).toEqual({
    ok: false,
    errorCode: "missing_coordinates",
  });
});

test("Phase 5.7a Routes request is duration-only and does not request polylines", () => {
  const request = buildGoogleRoutesDurationRequest({ fromItem, mode: "walking", toItem });

  expect(request).toEqual({
    ok: true,
    fieldMask: "routes.duration,routes.staticDuration",
    body: {
      origin: { location: { latLng: { latitude: 35.0116, longitude: 135.7681 } } },
      destination: { location: { latLng: { latitude: 35.0037, longitude: 135.7786 } } },
      travelMode: "WALK",
    },
  });
  expect(JSON.stringify(request)).not.toMatch(/polyline|encodedPolyline|routeLabels|legs|distanceMeters/i);
});

test("Phase 5.7a transit Routes request omits allowed travel modes for default selections", () => {
  const allSelected = buildGoogleRoutesDurationRequest({
    fromItem,
    mode: "transit",
    routeOptions: ["公車", "地鐵", "火車", "電車及輕軌電車"],
    toItem,
  });
  const noneSelected = buildGoogleRoutesDurationRequest({
    fromItem,
    mode: "transit",
    routeOptions: [],
    toItem,
  });

  expect(allSelected.body.travelMode).toBe("TRANSIT");
  expect(allSelected.body.departureTime).toBeUndefined();
  expect(noneSelected.body.departureTime).toBeUndefined();
  expect(allSelected.body.transitPreferences).toBeUndefined();
  expect(noneSelected.body.transitPreferences).toBeUndefined();
  expect(allSelected.body.routingPreference).toBeUndefined();
  expect(allSelected.body.routeModifiers).toBeUndefined();
});

test("Phase 5.7a transit Routes request sends allowed travel modes only for partial selections", () => {
  const request = buildGoogleRoutesDurationRequest({
    fromItem,
    mode: "transit",
    routeOptions: ["公車", "火車"],
    toItem,
  });

  expect(request.body).toEqual({
    origin: { location: { latLng: { latitude: 35.0116, longitude: 135.7681 } } },
    destination: { location: { latLng: { latitude: 35.0037, longitude: 135.7786 } } },
    travelMode: "TRANSIT",
    transitPreferences: {
      allowedTravelModes: ["BUS", "TRAIN"],
    },
  });
  expect(request.body.routingPreference).toBeUndefined();
  expect(request.body.routeModifiers).toBeUndefined();
});

test("Phase 5.7a transit debug Routes request uses expanded field mask", () => {
  const request = buildGoogleRoutesDurationRequest({
    debugRoutes: true,
    fromItem: fromStationItem,
    mode: "transit",
    toItem: toShrineItem,
  });

  expect(request.body.travelMode).toBe("TRANSIT");
  expect(request.fieldMask).toBe("*");
  expect(request.body.departureTime).toBe("2026-07-10T12:00:00+09:00");
});

test("Phase 5.7a drive Routes request may send route modifiers", () => {
  const request = buildGoogleRoutesDurationRequest({
    fromItem,
    mode: "driving",
    routeOptions: ["避開高速", "避開收費", "避開渡輪"],
    toItem,
  });

  expect(request.body.travelMode).toBe("DRIVE");
  expect(request.body.departureTime).toBeUndefined();
  expect(request.body.routeModifiers).toEqual({
    avoidFerries: true,
    avoidHighways: true,
    avoidTolls: true,
  });
  expect(request.body.transitPreferences).toBeUndefined();
});

test("Phase 5.7a drive debug Routes request keeps duration-only field mask", () => {
  const request = buildGoogleRoutesDurationRequest({
    debugRoutes: true,
    fromItem,
    mode: "driving",
    toItem,
  });

  expect(request.body.travelMode).toBe("DRIVE");
  expect(request.fieldMask).toBe("routes.duration,routes.staticDuration");
});

test("Phase 5.7a fetches and normalizes Routes duration only", async () => {
  const calls = [];
  const result = await fetchGoogleRoutesDuration({
    apiKey: "fake-key",
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      return {
        ok: true,
        json: async () => ({ routes: [{ duration: "1530s" }] }),
      };
    },
    fromItem: fromStationItem,
    mode: "transit",
    toItem: toShrineItem,
  });

  expect(result).toEqual({ ok: true, durationMinutes: 26, durationSource: "routes.duration", source: "routes" });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain("routes.googleapis.com/directions/v2:computeRoutes");
  expect(calls[0].options.method).toBe("POST");
  expect(calls[0].options.headers["X-Goog-FieldMask"]).toBe(
    "routes.duration,routes.staticDuration",
  );
  expect(calls[0].options.headers["X-Goog-Api-Key"]).toBe("fake-key");
  expect(JSON.parse(calls[0].options.body).departureTime).toBeUndefined();
  expect(calls[0].options.body).not.toMatch(/polyline|encodedPolyline|computeAlternativeRoutes/i);
});

test("Phase 5.7a fetches transit debug Routes with expanded field mask", async () => {
  const originalDebug = console.debug;
  const calls = [];
  let result;
  console.debug = () => {};
  try {
    result = await fetchGoogleRoutesDuration({
      apiKey: "fake-key",
      debugRoutes: true,
      fetchImpl: async (url, options) => {
        calls.push({ options, url });
        return {
          ok: true,
          json: async () => ({ routes: [{ legs: [{ duration: "1260s" }] }] }),
        };
      },
      fromItem,
      mode: "transit",
      toItem,
    });
  } finally {
    console.debug = originalDebug;
  }

  expect(result).toEqual({ ok: true, durationMinutes: 21, durationSource: "routes.legs.duration", source: "routes" });
  expect(calls[0].options.headers["X-Goog-FieldMask"]).toBe("*");
  expect(JSON.parse(calls[0].options.body).departureTime).toBe("2026-07-10T12:00:00+09:00");
});

test("Phase 5.7a falls back to Directions only when transit Routes has no duration", async () => {
  const calls = [];
  const directionCalls = [];
  const result = await fetchGoogleRoutesDuration({
    apiKey: "fake-key",
    directionsInvokeImpl: async (functionName, options) => {
      directionCalls.push({ functionName, options });
      return {
        data: {
          ok: true,
          durationMinutes: 25,
          source: "directions-transit-fallback",
        },
        error: null,
      };
    },
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      return { ok: true, status: 200, json: async () => ({}) };
    },
    fromItem: fromStationItem,
    mode: "transit",
    toItem: toShrineItem,
  });

  expect(result).toEqual({
    ok: true,
    durationMinutes: 25,
    source: "directions-transit-fallback",
  });
  expect(calls).toHaveLength(1);
  expect(directionCalls).toEqual([
    {
      functionName: "google-directions-transit-duration",
      options: {
        body: {
          origin: { latitude: 35.0116, longitude: 135.7681 },
          originLabel: "place_id:yamashina-station-place",
          destination: { latitude: 35.0037, longitude: 135.7786 },
          destinationLabel: "place_id:yasaka-shrine-place",
        },
      },
    },
  ]);
});

test("Phase 5.7a does not call Directions fallback when transit Routes has duration", async () => {
  const calls = [];
  const result = await fetchGoogleRoutesDuration({
    apiKey: "fake-key",
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      return { ok: true, status: 200, json: async () => ({ routes: [{ duration: "600s" }] }) };
    },
    fromItem,
    mode: "transit",
    toItem,
  });

  expect(result).toMatchObject({ ok: true, durationMinutes: 10, source: "routes" });
  expect(calls).toHaveLength(1);
});

test("Phase 5.7a does not call Directions fallback for drive or walk missing duration", async () => {
  for (const mode of ["driving", "walking"]) {
    const calls = [];
    const result = await fetchGoogleRoutesDuration({
      apiKey: "fake-key",
      fetchImpl: async (url, options) => {
        calls.push({ options, url });
        return { ok: true, status: 200, json: async () => ({}) };
      },
      fromItem,
      mode,
      toItem,
    });

    expect(result).toEqual({ ok: false, errorCode: "missing_duration", source: "routes" });
    expect(calls).toHaveLength(1);
  }
});

test("Phase 5.7a does not call Directions fallback when Routes request fails", async () => {
  const calls = [];
  const result = await fetchGoogleRoutesDuration({
    apiKey: "fake-key",
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: { message: "denied", status: "PERMISSION_DENIED" } }),
      };
    },
    fromItem,
    mode: "transit",
    toItem,
  });

  expect(result).toMatchObject({ ok: false, errorCode: "routes_request_failed", source: "routes", status: 403 });
  expect(calls).toHaveLength(1);
});

test("Phase 5.7a debug summary reports fallback without API key", async () => {
  const originalDebug = console.debug;
  const logs = [];
  console.debug = (...args) => logs.push(args);
  try {
    await fetchGoogleRoutesDuration({
      apiKey: "fake-key",
      debugRoutes: true,
      directionsInvokeImpl: async () => ({
        data: {
          ok: true,
          durationMinutes: 15,
          source: "directions-transit-fallback",
        },
        error: null,
      }),
      fetchImpl: async (url) => {
        return { ok: true, status: 200, json: async () => ({}) };
      },
      fromItem,
      mode: "transit",
      toItem,
    });
  } finally {
    console.debug = originalDebug;
  }

  expect(logs).toHaveLength(1);
  expect(logs[0][0]).toBe("[Routes debug]");
  expect(logs[0][1]).toMatchObject({
    fallbackAttempted: true,
    fallbackSource: "directions",
    finalDurationMinutes: 15,
    finalSource: "directions-transit-fallback",
    travelMode: "TRANSIT",
  });
  expect(JSON.stringify(logs)).not.toContain("fake-key");
});

test("Phase 5.7a normalizes transit duration fallback fields", () => {
  expect(normalizeGoogleRoutesDuration({ routes: [{ duration: "1530s" }] })).toEqual({
    ok: true,
    durationMinutes: 26,
    durationSource: "routes.duration",
  });
  expect(normalizeGoogleRoutesDuration({ routes: [{ staticDuration: "1440s" }] })).toEqual({
    ok: true,
    durationMinutes: 24,
    durationSource: "routes.staticDuration",
  });
  expect(normalizeGoogleRoutesDuration({ routes: [{ legs: [{ duration: "1260s" }] }] })).toEqual({
    ok: true,
    durationMinutes: 21,
    durationSource: "routes.legs.duration",
  });
});

test("Phase 5.7a handles missing API key and missing duration without throwing", async () => {
  await expect(fetchGoogleRoutesDuration({ fromItem, toItem })).resolves.toEqual({
    ok: false,
    errorCode: "missing_api_key",
  });
  expect(normalizeGoogleRoutesDuration({ routes: [{}] })).toEqual({ ok: false, errorCode: "missing_duration" });
});
