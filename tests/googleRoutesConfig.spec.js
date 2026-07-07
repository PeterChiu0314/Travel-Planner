import { expect, test } from "@playwright/test";
import {
  getGoogleRoutesConfig,
  GOOGLE_ROUTES_FIELD_MASK_DURATION_ONLY,
  isRoutesQueryEnabled,
  normalizeGoogleRoutesTravelMode,
} from "../src/lib/googleRoutesConfig.js";

test("Phase 5.7a gates Routes query behind formal Google provider and API key", () => {
  const enabled = getGoogleRoutesConfig({
    apiKey: "fake-test-key",
    enableRoutesQuery: true,
    mode: "formal",
    providerId: "google",
  });

  expect(enabled).toMatchObject({
    apiKeyAvailable: true,
    canQueryRoutes: true,
    mode: "formal",
    providerId: "google",
    routesQueryEnabled: true,
  });
  expect(isRoutesQueryEnabled(enabled)).toBe(true);

  [
    getGoogleRoutesConfig({ apiKey: "fake", enableRoutesQuery: true, mode: "demo", providerId: "google" }),
    getGoogleRoutesConfig({ apiKey: "fake", enableRoutesQuery: true, mode: "formal", providerId: "static" }),
    getGoogleRoutesConfig({ enableRoutesQuery: true, mode: "formal", providerId: "google" }),
    getGoogleRoutesConfig({ apiKey: "fake", mode: "formal", providerId: "google" }),
  ].forEach((config) => {
    expect(isRoutesQueryEnabled(config)).toBe(false);
    expect(config.canQueryRoutes).toBe(false);
  });
});

test("Phase 5.7a Routes query asks for duration only", () => {
  expect(GOOGLE_ROUTES_FIELD_MASK_DURATION_ONLY).toBe("routes.duration,routes.staticDuration");
  expect(GOOGLE_ROUTES_FIELD_MASK_DURATION_ONLY).not.toMatch(/polyline|distanceMeters|legs|steps|transitFare/i);
});

test("Phase 5.7a normalizes supported route travel modes", () => {
  expect(normalizeGoogleRoutesTravelMode("transit")).toBe("TRANSIT");
  expect(normalizeGoogleRoutesTravelMode("drive")).toBe("DRIVE");
  expect(normalizeGoogleRoutesTravelMode("driving")).toBe("DRIVE");
  expect(normalizeGoogleRoutesTravelMode("walk")).toBe("WALK");
  expect(normalizeGoogleRoutesTravelMode("walking")).toBe("WALK");
  expect(normalizeGoogleRoutesTravelMode("ferry")).toBe("TRANSIT");
});
