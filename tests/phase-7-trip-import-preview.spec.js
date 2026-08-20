import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  buildTripPreviewRoute,
  isTripPreviewTransitNode,
  selectTripPreviewRepresentativeVisit,
  tripPreviewDistanceKm,
} from "../src/lib/tripImportPreview.js";
import {
  buildWikimediaImageInfoUrl,
  buildWikimediaTripImageSearchUrl,
  normalizeWikimediaImageInfoResponse,
  normalizeWikimediaPageImageCandidates,
  normalizeWikimediaPageImageResponse,
  selectBestWikimediaTripImage,
} from "../src/lib/wikimediaTripImages.js";

function visit(title, latitude, longitude, category = "attraction") {
  return { category, title, location: { latitude, longitude, name: title } };
}

function day(dayIndex, visits, transports = []) {
  return { day_index: dayIndex, transports, visits };
}

test("representative visit filters first and uses the deterministic earlier middle", () => {
  const selected = selectTripPreviewRepresentativeVisit(day(0, [
    visit("機場", 25.08, 121.23),
    visit("景點 A", 25.03, 121.56),
    visit("備忘", 25.04, 121.57, "note"),
    visit("景點 B", 25.05, 121.58),
    visit("缺座標", null, null),
    visit("景點 C", 25.06, 121.59),
    visit("景點 D", 25.07, 121.6),
  ]));
  expect(selected.title).toBe("景點 B");
});

test("transit-node detection stays scoped to title and location name", () => {
  expect(isTripPreviewTransitNode(visit("京都駅", 35, 135))).toBe(true);
  expect(isTripPreviewTransitNode(visit("Central Railway Station", 35, 135))).toBe(true);
  expect(isTripPreviewTransitNode({
    ...visit("京都塔", 35, 135),
    location: { address: "京都駅前", latitude: 35, longitude: 135, name: "京都塔" },
  })).toBe(false);
  expect(selectTripPreviewRepresentativeVisit(day(0, [visit("移動", 35, 135, "transport")]))).toBeNull();
});

test("route keeps one point per eligible day and classifies normal, flight, and broken segments", () => {
  const route = buildTripPreviewRoute([
    day(0, [visit("台北", 25.033, 121.565)]),
    day(1, [visit("沖繩", 26.212, 127.681)], [{ category: "flight", name: "航班" }]),
    day(2, [visit("東京", 35.681, 139.767)]),
    day(3, [visit("巴黎", 48.857, 2.352)]),
    day(4, [visit("No point", null, null)]),
  ], { longSegmentKm: 2000 });

  expect(route.points.map((point) => point.dayLabel)).toEqual(["D1", "D2", "D3", "D4"]);
  expect(route.segments.map((segment) => segment.type)).toEqual(["flight", "normal", "broken"]);
  expect(tripPreviewDistanceKm(route.points[2], route.points[3])).toBeGreaterThan(9000);
});

test("preview board uses the existing Google Maps loader without route or photo APIs", () => {
  const source = readFileSync(new URL("../src/components/trip-import/TripImportPreviewBoard.jsx", import.meta.url), "utf8");
  expect(source).toContain("loadGoogleMapsApi");
  expect(source).toContain("VITE_GOOGLE_MAPS_API_KEY");
  expect(source).toContain("new PolylineConstructor");
  expect(source).not.toContain("tile.openstreetmap.org");
  expect(source).not.toContain("Directions");
  expect(source).not.toContain("Places");
});

test("Wikimedia helpers build keyless queries and normalize image attribution", () => {
  const searchUrl = new URL(buildWikimediaTripImageSearchUrl({ name: "清水寺" }, { city: "京都", country: "日本" }));
  expect(searchUrl.hostname).toBe("zh.wikipedia.org");
  expect(searchUrl.searchParams.get("origin")).toBe("*");
  expect(searchUrl.searchParams.get("gsrsearch")).toBe("清水寺 京都 日本");
  expect(searchUrl.searchParams.has("key")).toBe(false);

  const pageImage = normalizeWikimediaPageImageResponse({ query: { pages: {
    1: { pageimage: "Kiyomizu.jpg", thumbnail: { height: 700, source: "https://upload.wikimedia.org/thumb.jpg", width: 1400 }, title: "Kiyomizu-dera" },
  } } });
  expect(pageImage).toEqual({
    fileName: "Kiyomizu.jpg",
    pageTitle: "Kiyomizu-dera",
    thumbnailHeight: 700,
    thumbnailUrl: "https://upload.wikimedia.org/thumb.jpg",
    thumbnailWidth: 1400,
  });
  expect(new URL(buildWikimediaImageInfoUrl(pageImage.fileName)).hostname).toBe("commons.wikimedia.org");

  const normalized = normalizeWikimediaImageInfoResponse({ query: { pages: {
    2: { imageinfo: [{ descriptionurl: "https://commons.wikimedia.org/wiki/File:Kiyomizu.jpg", height: 2000, width: 4000, extmetadata: {
      Artist: { value: "<b>Example Author</b>" }, LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
    } }] },
  } } }, pageImage);
  expect(normalized.author).toBe("Example Author");
  expect(normalized.aspectRatio).toBe(2);
  expect(normalized.width).toBe(4000);
  expect(normalized.license).toBe("CC BY-SA 4.0");
});

test("Wikimedia candidates prefer a sufficiently large landscape image near the target ratio", () => {
  const candidates = normalizeWikimediaPageImageCandidates({ query: { pages: {
    1: { pageimage: "Portrait.jpg", thumbnail: { height: 1200, source: "portrait", width: 800 }, title: "Portrait" },
    2: { pageimage: "Wide.jpg", thumbnail: { height: 700, source: "wide", width: 1400 }, title: "Wide" },
    3: { pageimage: "Panorama.jpg", thumbnail: { height: 400, source: "panorama", width: 1400 }, title: "Panorama" },
  } } });
  expect(candidates).toHaveLength(3);
  expect(selectBestWikimediaTripImage([
    { ...candidates[0], aspectRatio: 0.67, height: 2400, width: 1600 },
    { ...candidates[1], aspectRatio: 2, height: 2100, width: 4200 },
    { ...candidates[2], aspectRatio: 3.5, height: 800, width: 2800 },
  ])?.fileName).toBe("Wide.jpg");
});
