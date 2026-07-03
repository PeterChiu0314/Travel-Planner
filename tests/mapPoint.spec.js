import { expect, test } from "@playwright/test";
import {
  countMissingMapPoints,
  getMapPointStatus,
  hasValidMapPoint,
  isGoogleMapsShortUrl,
  normalizeMapPointFields,
  parseMapUrlToPoint,
  resolveDestinationMapUrlPoint,
  validateDestinationMapUrl,
} from "../src/lib/mapPoint.js";

test("Phase 5.2 parseMapUrlToPoint reads @lat,lng Google Maps URLs", () => {
  expect(parseMapUrlToPoint("https://www.google.com/maps/@35.0116,135.7681,15z")).toEqual({
    latitude: 35.0116,
    longitude: 135.7681,
  });
});

test("Phase 5.2 parseMapUrlToPoint reads q=lat,lng Google Maps URLs", () => {
  expect(parseMapUrlToPoint("https://www.google.com/maps/search/?api=1&q=35.0116,135.7681")).toEqual({
    latitude: 35.0116,
    longitude: 135.7681,
  });
});

test("Phase 5.2 parseMapUrlToPoint reads ll=lat,lng Google Maps URLs", () => {
  expect(parseMapUrlToPoint("https://maps.google.com/?ll=35.0116,135.7681")).toEqual({
    latitude: 35.0116,
    longitude: 135.7681,
  });
});

test("Phase 5.2 parseMapUrlToPoint reads !3dlat!4dlng Google Maps URLs", () => {
  expect(parseMapUrlToPoint("https://www.google.com/maps/place/Kyoto/data=!3d35.0116!4d135.7681")).toEqual({
    latitude: 35.0116,
    longitude: 135.7681,
  });
});

test("Phase 5.2 parseMapUrlToPoint prefers place coordinates before viewport center", () => {
  expect(
    parseMapUrlToPoint("https://www.google.com/maps/place/Kiyomizu-dera/@35.0001,135.0001,17z/data=!3d34.9949!4d135.785"),
  ).toEqual({
    latitude: 34.9949,
    longitude: 135.785,
  });
});

test("Phase 5.2 parseMapUrlToPoint fails quietly for invalid or empty values", () => {
  expect(() => parseMapUrlToPoint(null)).not.toThrow();
  expect(() => parseMapUrlToPoint("")).not.toThrow();
  expect(() => parseMapUrlToPoint("https://maps.app.goo.gl/example")).not.toThrow();
  expect(parseMapUrlToPoint(null)).toBeNull();
  expect(parseMapUrlToPoint("")).toBeNull();
  expect(parseMapUrlToPoint("https://maps.app.goo.gl/example")).toBeNull();
  expect(parseMapUrlToPoint("https://maps.google.com/?q=91,135")).toBeNull();
});

test("Phase 5.2b validates required destination Map URLs before save", () => {
  expect(validateDestinationMapUrl("")).toEqual({
    ok: false,
    errorMessage: "請貼上有效 Map URL",
    point: null,
  });
  expect(validateDestinationMapUrl("https://maps.google.com/not-a-point")).toEqual({
    ok: false,
    errorMessage: "無法取得有效點位",
    point: null,
  });
  expect(validateDestinationMapUrl("https://maps.app.goo.gl/example")).toEqual({
    ok: false,
    errorMessage: "無法取得有效點位",
    point: null,
  });
  expect(validateDestinationMapUrl("https://maps.google.com/?q=35.0116,135.7681")).toEqual({
    ok: true,
    errorMessage: "",
    point: { latitude: 35.0116, longitude: 135.7681 },
  });
});

test("Phase 5.2c detects Google Maps short URLs without accepting arbitrary URLs", () => {
  expect(isGoogleMapsShortUrl("https://maps.app.goo.gl/example")).toBe(true);
  expect(isGoogleMapsShortUrl("https://goo.gl/maps/example")).toBe(true);
  expect(isGoogleMapsShortUrl("https://example.com/maps.app.goo.gl/example")).toBe(false);
  expect(isGoogleMapsShortUrl("http://maps.app.goo.gl/example")).toBe(false);
});

test("Phase 5.2c resolves Google Maps short URLs before coordinate parsing", async () => {
  const result = await resolveDestinationMapUrlPoint("https://maps.app.goo.gl/example", {
    resolveShortUrl: async () => "https://www.google.com/maps/place/Kyoto/data=!3d35.0116!4d135.7681",
  });

  expect(result).toEqual({
    ok: true,
    errorMessage: "",
    point: { latitude: 35.0116, longitude: 135.7681 },
    expandedUrl: "https://www.google.com/maps/place/Kyoto/data=!3d35.0116!4d135.7681",
    resolvedByShortLink: true,
  });
});

test("Phase 5.2c does not send non-Google URLs through the short-link resolver", async () => {
  let resolverCalled = false;
  const result = await resolveDestinationMapUrlPoint("https://example.com/not-a-map", {
    resolveShortUrl: async () => {
      resolverCalled = true;
      return "https://www.google.com/maps/?q=35,135";
    },
  });

  expect(resolverCalled).toBe(false);
  expect(result).toMatchObject({ ok: false, point: null, expandedUrl: "", resolvedByShortLink: false });
});

test("Phase 5.2c blocks save when short-link resolve fails or has no coordinates", async () => {
  await expect(
    resolveDestinationMapUrlPoint("https://maps.app.goo.gl/fails", {
      resolveShortUrl: async () => {
        throw new Error("resolve failed");
      },
    }),
  ).resolves.toMatchObject({ ok: false, point: null, expandedUrl: "", resolvedByShortLink: false });

  await expect(
    resolveDestinationMapUrlPoint("https://maps.app.goo.gl/no-point", {
      resolveShortUrl: async () => "https://www.google.com/maps/place/Kyoto",
    }),
  ).resolves.toMatchObject({ ok: false, point: null, expandedUrl: "https://www.google.com/maps/place/Kyoto", resolvedByShortLink: true });
});

test("Phase 5.2 validates stored map point bounds and normalizes payload coordinates", () => {
  expect(hasValidMapPoint({ latitude: 35, longitude: 135 })).toBe(true);
  expect(hasValidMapPoint({ latitude: 91, longitude: 135 })).toBe(false);
  expect(getMapPointStatus({ map_url: "https://maps.google.com/?q=35,135" })).toBe("parsable-url");
  expect(normalizeMapPointFields({ map_url: "https://maps.google.com/?q=35,135" })).toEqual({
    latitude: 35,
    longitude: 135,
  });
  expect(normalizeMapPointFields({ item_type: "visit", type: "transport", map_url: "https://maps.google.com/?q=35,135" })).toEqual({
    latitude: 35,
    longitude: 135,
  });
  expect(normalizeMapPointFields({ map_url: "", latitude: "34.9895", longitude: "135.8175" })).toEqual({
    latitude: null,
    longitude: null,
  });
  expect(normalizeMapPointFields({ map_url: null, latitude: "34.9895", longitude: "135.8175" })).toEqual({
    latitude: null,
    longitude: null,
  });
  expect(normalizeMapPointFields({ map_url: "https://maps.app.goo.gl/example", latitude: 34.9895, longitude: 135.8175 })).toEqual({
    latitude: null,
    longitude: null,
  });
  expect(normalizeMapPointFields({ item_type: "transport", map_url: "https://maps.google.com/?q=35,135" })).toEqual({
    latitude: null,
    longitude: null,
  });
});

test("Phase 5.2 missing map point count ignores transportation cards", () => {
  expect(
    countMissingMapPoints([
      { id: "visit-a", item_type: "visit", latitude: 35, longitude: 135 },
      { id: "visit-b", item_type: "visit", map_url: "https://maps.google.com/?q=35,135" },
      { id: "visit-c", item_type: "visit", latitude: null, longitude: null },
      { id: "visit-d", item_type: "visit", type: "transport", latitude: null, longitude: null },
      { id: "transport-a-b", item_type: "transport", latitude: null, longitude: null },
    ]),
  ).toBe(3);
});

test("Phase 5.2 missing map point count increases after Map URL and coordinates are cleared", () => {
  expect(
    countMissingMapPoints([
      { id: "visit-a", item_type: "visit", map_url: null, latitude: null, longitude: null },
      { id: "visit-b", item_type: "visit", map_url: "", latitude: null, longitude: null },
      { id: "transport-a-b", item_type: "transport", map_url: null, latitude: null, longitude: null },
    ]),
  ).toBe(2);
});
