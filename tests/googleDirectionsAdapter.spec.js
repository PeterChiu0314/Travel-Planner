import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  buildGoogleDirectionsTransitDurationRequest,
  fetchGoogleDirectionsTransitDuration,
  GOOGLE_DIRECTIONS_TRANSIT_FUNCTION,
  normalizeGoogleDirectionsTransitDuration,
} from "../src/lib/googleDirectionsAdapter.js";

const fromItem = { id: "from", latitude: 34.9923359, longitude: 135.8172561, provider_place_id: "yamashina-station-place" };
const toItem = { id: "to", latitude: 35.0036625, longitude: 135.7785487, placeId: "yasaka-shrine-place" };
const repoRoot = process.cwd();

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Phase 5.7a Directions fallback builds Supabase Edge Function request", () => {
  const request = buildGoogleDirectionsTransitDurationRequest({
    fromItem,
    toItem,
  });

  expect(request).toEqual({
    ok: true,
    body: {
      destination: { latitude: 35.0036625, longitude: 135.7785487 },
      destinationLabel: "place_id:yasaka-shrine-place",
      origin: { latitude: 34.9923359, longitude: 135.8172561 },
      originLabel: "place_id:yamashina-station-place",
    },
    functionName: "google-directions-transit-duration",
    source: "directions-transit-fallback",
  });
});

test("Phase 5.7a Directions fallback normalizes Edge Function duration only", () => {
  expect(
    normalizeGoogleDirectionsTransitDuration({
      ok: true,
      durationMinutes: 25,
      source: "directions-transit-fallback",
      steps: [{ ignored: true }],
      overview_polyline: { points: "do-not-keep-me" },
    }),
  ).toEqual({
    ok: true,
    durationMinutes: 25,
    source: "directions-transit-fallback",
  });
});

test("Phase 5.7a Directions fallback returns safe failure without throwing", async () => {
  await expect(
    fetchGoogleDirectionsTransitDuration({
      fromItem,
      invokeImpl: async () => {
        throw new Error("function down");
      },
      toItem,
    }),
  ).resolves.toEqual({
    ok: false,
    message: "function down",
    reason: "directions_function_failed",
    source: "directions-transit-fallback",
  });

  expect(normalizeGoogleDirectionsTransitDuration({ ok: false, status: "ZERO_RESULTS", message: "No route" })).toEqual({
    ok: false,
    message: "No route",
    reason: "ZERO_RESULTS",
    source: "directions-transit-fallback",
    status: "ZERO_RESULTS",
  });
});

test("Phase 5.7a Directions fallback invokes Supabase function without Google API key", async () => {
  const calls = [];
  const result = await fetchGoogleDirectionsTransitDuration({
    fromItem,
    invokeImpl: async (functionName, options) => {
      calls.push({ functionName, options });
      return {
        data: {
          ok: true,
          durationMinutes: 25,
          source: "directions-transit-fallback",
        },
        error: null,
      };
    },
    toItem,
  });

  expect(result).toEqual({
    ok: true,
    durationMinutes: 25,
    source: "directions-transit-fallback",
  });
  expect(calls).toEqual([
    {
      functionName: GOOGLE_DIRECTIONS_TRANSIT_FUNCTION,
      options: {
        body: {
          origin: { latitude: 34.9923359, longitude: 135.8172561 },
          originLabel: "place_id:yamashina-station-place",
          destination: { latitude: 35.0036625, longitude: 135.7785487 },
          destinationLabel: "place_id:yasaka-shrine-place",
        },
      },
    },
  ]);
  expect(JSON.stringify(calls)).not.toMatch(/key|maps\.googleapis\.com|directions\/json/i);
});

test("Phase 5.7a Directions fallback keeps Google request inside Edge Function", () => {
  const adapterSource = readRepoFile("src/lib/googleDirectionsAdapter.js");
  const edgeFunctionSource = readRepoFile("supabase/functions/google-directions-transit-duration/index.ts");

  expect(adapterSource).toContain('GOOGLE_DIRECTIONS_TRANSIT_FUNCTION = "google-directions-transit-duration"');
  expect(adapterSource).toContain("supabase");
  expect(adapterSource).toContain("invokeImpl");
  expect(adapterSource).not.toContain("maps.googleapis.com/maps/api/directions/json");
  expect(adapterSource).not.toContain("departure_time");
  expect(edgeFunctionSource).toContain("https://maps.googleapis.com/maps/api/directions/json");
  expect(edgeFunctionSource).toContain('departure_time: "now"');
  expect(edgeFunctionSource).toContain('mode: "transit"');
  expect(edgeFunctionSource).toContain('language: "zh-TW"');
  expect(edgeFunctionSource).toContain('region: "jp"');
  expect(edgeFunctionSource).toContain('source: "directions-transit-fallback"');
  expect(edgeFunctionSource).toContain('data.status === "ZERO_RESULTS"');
  expect(edgeFunctionSource).toContain("originLabel && destinationLabel");
  expect(edgeFunctionSource).toContain("fetchDirections(apiKey, originLabel, destinationLabel)");
  expect(edgeFunctionSource).not.toContain("overview_polyline");
  expect(edgeFunctionSource).not.toContain("steps");
});
