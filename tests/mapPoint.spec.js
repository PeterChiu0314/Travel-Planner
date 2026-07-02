import { expect, test } from "@playwright/test";
import {
  countMissingMapPoints,
  getMapPointStatus,
  hasValidMapPoint,
  normalizeMapPointFields,
  parseMapUrlToPoint,
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

test("Phase 5.2 parseMapUrlToPoint fails quietly for invalid or empty values", () => {
  expect(() => parseMapUrlToPoint(null)).not.toThrow();
  expect(() => parseMapUrlToPoint("")).not.toThrow();
  expect(() => parseMapUrlToPoint("https://maps.app.goo.gl/example")).not.toThrow();
  expect(parseMapUrlToPoint(null)).toBeNull();
  expect(parseMapUrlToPoint("")).toBeNull();
  expect(parseMapUrlToPoint("https://maps.app.goo.gl/example")).toBeNull();
  expect(parseMapUrlToPoint("https://maps.google.com/?q=91,135")).toBeNull();
});

test("Phase 5.2 validates stored map point bounds and normalizes payload coordinates", () => {
  expect(hasValidMapPoint({ latitude: 35, longitude: 135 })).toBe(true);
  expect(hasValidMapPoint({ latitude: 91, longitude: 135 })).toBe(false);
  expect(getMapPointStatus({ map_url: "https://maps.google.com/?q=35,135" })).toBe("parsable-url");
  expect(normalizeMapPointFields({ map_url: "https://maps.google.com/?q=35,135" })).toEqual({
    latitude: 35,
    longitude: 135,
  });
  expect(normalizeMapPointFields({ map_url: "", latitude: "34.9895", longitude: "135.8175" })).toEqual({
    latitude: 34.9895,
    longitude: 135.8175,
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
      { id: "transport-a-b", item_type: "transport", latitude: null, longitude: null },
    ]),
  ).toBe(2);
});
