import { expect, test } from "@playwright/test";
import {
  buildGoogleRoutesDurationRequest,
  fetchGoogleRoutesDuration,
  normalizeGoogleRoutesDuration,
} from "../src/lib/googleRoutesAdapter.js";
import { buildGoogleMapsDirectionsUrl, travelModeForTransportCategory } from "../src/lib/googleMapsNavigation.js";

const fromItem = { id: "from", latitude: 35.0116, longitude: 135.7681 };
const toItem = { id: "to", latitude: 35.0037, longitude: 135.7786 };

test("Phase 5.7a builds Google Maps navigation URL from endpoint coordinates", () => {
  expect(travelModeForTransportCategory("jr")).toBe("transit");
  expect(travelModeForTransportCategory("taxi")).toBe("driving");
  expect(travelModeForTransportCategory("walk")).toBe("walking");
  expect(travelModeForTransportCategory("unknown")).toBe("transit");

  const url = buildGoogleMapsDirectionsUrl({ fromItem, toItem, transportCategory: "taxi" });
  expect(url).toContain("https://www.google.com/maps/dir/");
  expect(url).toContain("api=1");
  expect(url).toContain("origin=35.0116%2C135.7681");
  expect(url).toContain("destination=35.0037%2C135.7786");
  expect(url).toContain("travelmode=driving");
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
    fieldMask: "routes.duration",
    body: {
      origin: { location: { latLng: { latitude: 35.0116, longitude: 135.7681 } } },
      destination: { location: { latLng: { latitude: 35.0037, longitude: 135.7786 } } },
      travelMode: "WALK",
    },
  });
  expect(JSON.stringify(request)).not.toMatch(/polyline|encodedPolyline|routeLabels|legs|distanceMeters/i);
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
    fromItem,
    mode: "transit",
    toItem,
  });

  expect(result).toEqual({ ok: true, durationMinutes: 26 });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain("routes.googleapis.com/directions/v2:computeRoutes");
  expect(calls[0].options.method).toBe("POST");
  expect(calls[0].options.headers["X-Goog-FieldMask"]).toBe("routes.duration");
  expect(calls[0].options.headers["X-Goog-Api-Key"]).toBe("fake-key");
  expect(calls[0].options.body).not.toMatch(/polyline|encodedPolyline|computeAlternativeRoutes/i);
});

test("Phase 5.7a handles missing API key and missing duration without throwing", async () => {
  await expect(fetchGoogleRoutesDuration({ fromItem, toItem })).resolves.toEqual({
    ok: false,
    errorCode: "missing_api_key",
  });
  expect(normalizeGoogleRoutesDuration({ routes: [{}] })).toEqual({ ok: false, errorCode: "missing_duration" });
});
