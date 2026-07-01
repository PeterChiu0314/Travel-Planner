import { expect, test } from "@playwright/test";
import {
  buildRoutePanelStops,
  getFocusedMapState,
  getTransportEndpointMarkerIds,
} from "../src/lib/timelineMapMarkers.js";

const dayItems = [
  { id: "visit-a", item_type: "visit", title: "A", location_name: "Kyoto Station" },
  {
    id: "transport-a-b",
    item_type: "transport",
    title: "Train",
    from_item_id: "visit-a",
    to_item_id: "visit-b",
    transport_role: "normal_pair",
  },
  { id: "visit-b", item_type: "visit", title: "B", location_name: "Fushimi Inari" },
  {
    id: "tail-transport",
    item_type: "transport",
    title: "Walk",
    from_item_id: "visit-b",
    to_item_id: null,
    transport_role: "tail_pending",
  },
];

test("Phase 4.9b keeps RoutePanel stops provider-neutral and destination-focused", () => {
  const stops = buildRoutePanelStops(dayItems, { requireLocation: true });
  const focusState = getFocusedMapState(dayItems, stops, "visit-b");

  expect(stops.map((stop) => stop.itemId)).toEqual(["visit-a", "visit-b"]);
  expect(focusState).toMatchObject({
    focusedItemId: "visit-b",
    focusedItemType: "destination",
    focusedMarkerId: "map-marker:visit-b",
  });
  expect(JSON.stringify(focusState).toLowerCase()).not.toContain("google");
});

test("Phase 4.9b maps focused transport cards to from and to endpoint stops", () => {
  const stops = buildRoutePanelStops(dayItems, { requireLocation: true });
  const endpoints = getTransportEndpointMarkerIds(dayItems, stops, "transport-a-b");
  const focusState = getFocusedMapState(dayItems, stops, "transport-a-b");

  expect(endpoints).toEqual({
    fromItemId: "visit-a",
    toItemId: "visit-b",
    fromMarkerId: "map-marker:visit-a",
    toMarkerId: "map-marker:visit-b",
    markerIds: ["map-marker:visit-a", "map-marker:visit-b"],
  });
  expect(focusState.focusedItemType).toBe("transport");
  expect(focusState.focusedMarkerId).toBeNull();
  expect(focusState.transportEndpointMarkerIds.markerIds).toEqual(["map-marker:visit-a", "map-marker:visit-b"]);
});

test("Phase 4.9b handles tail transport and missing endpoints without throwing", () => {
  const stops = buildRoutePanelStops(dayItems, { requireLocation: true });

  expect(() => getFocusedMapState(dayItems, stops, "tail-transport")).not.toThrow();
  expect(getFocusedMapState(dayItems, stops, "tail-transport").transportEndpointMarkerIds).toEqual({
    fromItemId: "visit-b",
    toItemId: null,
    fromMarkerId: "map-marker:visit-b",
    toMarkerId: null,
    markerIds: ["map-marker:visit-b"],
  });

  expect(() =>
    getTransportEndpointMarkerIds(
      [...dayItems, { id: "missing-endpoint-transport", item_type: "transport", from_item_id: "missing" }],
      stops,
      "missing-endpoint-transport",
    ),
  ).not.toThrow();
});

test("Phase 4.9b ignores transportation cards as marker records", () => {
  const stops = buildRoutePanelStops(dayItems, { requireLocation: true });

  expect(stops.find((stop) => stop.itemId === "transport-a-b")).toBeUndefined();
  expect(stops.find((stop) => stop.itemId === "tail-transport")).toBeUndefined();
});
