import { expect, test } from "@playwright/test";
import {
  buildGoogleDirectionsTransitDurationRequest,
  fetchGoogleDirectionsTransitDuration,
  normalizeGoogleDirectionsTransitDuration,
} from "../src/lib/googleDirectionsAdapter.js";

const fromItem = { id: "from", latitude: 34.9923359, longitude: 135.8172561 };
const toItem = { id: "to", latitude: 35.0036625, longitude: 135.7785487 };

test("Phase 5.7a Directions fallback builds transit duration request", () => {
  const request = buildGoogleDirectionsTransitDurationRequest({
    apiKey: "fake-key",
    fromItem,
    toItem,
  });

  expect(request.ok).toBe(true);
  const url = new URL(request.url);
  expect(`${url.origin}${url.pathname}`).toBe("https://maps.googleapis.com/maps/api/directions/json");
  expect(url.searchParams.get("origin")).toBe("34.9923359,135.8172561");
  expect(url.searchParams.get("destination")).toBe("35.0036625,135.7785487");
  expect(url.searchParams.get("mode")).toBe("transit");
  expect(url.searchParams.get("departure_time")).toBe("now");
  expect(url.searchParams.get("language")).toBe("zh-TW");
  expect(url.searchParams.get("region")).toBe("jp");
  expect(url.searchParams.get("key")).toBe("fake-key");
});

test("Phase 5.7a Directions fallback normalizes duration value only", () => {
  const result = normalizeGoogleDirectionsTransitDuration({
    routes: [
      {
        legs: [
          {
            duration: { text: "24 分鐘", value: 1441 },
            steps: [{ html_instructions: "Do not keep me" }],
          },
        ],
        overview_polyline: { points: "do-not-keep-me" },
      },
    ],
    status: "OK",
  });

  expect(result).toEqual({
    ok: true,
    durationMinutes: 25,
    routesLength: 1,
    source: "directions-transit-fallback",
    status: "OK",
  });
  expect(JSON.stringify(result)).not.toMatch(/polyline|steps|html_instructions|24 分鐘/i);
});

test("Phase 5.7a Directions fallback returns safe failure without throwing", async () => {
  await expect(
    fetchGoogleDirectionsTransitDuration({
      apiKey: "fake-key",
      fetchImpl: async () => {
        throw new Error("network down");
      },
      fromItem,
      toItem,
    }),
  ).resolves.toMatchObject({
    ok: false,
    message: "network down",
    reason: "directions_request_failed",
    source: "directions-transit-fallback",
  });

  expect(normalizeGoogleDirectionsTransitDuration({ routes: [], status: "ZERO_RESULTS" })).toEqual({
    ok: false,
    reason: "missing_duration",
    routesLength: 0,
    source: "directions-transit-fallback",
    status: "ZERO_RESULTS",
  });
});

test("Phase 5.7a Directions fallback fetches duration with sanitized normalized result", async () => {
  const calls = [];
  const result = await fetchGoogleDirectionsTransitDuration({
    apiKey: "fake-key",
    fetchImpl: async (url, options) => {
      calls.push({ options, url });
      return {
        ok: true,
        json: async () => ({
          routes: [{ legs: [{ duration: { text: "25 分鐘", value: 1500 }, steps: [{ travel_mode: "TRANSIT" }] }] }],
          status: "OK",
        }),
      };
    },
    fromItem,
    toItem,
  });

  expect(result).toEqual({
    ok: true,
    durationMinutes: 25,
    routesLength: 1,
    source: "directions-transit-fallback",
    status: "OK",
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].options.method).toBe("GET");
  expect(new URL(calls[0].url).searchParams.get("departure_time")).toBe("now");
});
