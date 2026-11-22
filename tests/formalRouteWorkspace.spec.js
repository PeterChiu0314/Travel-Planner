import { expect, test } from "@playwright/test";
import { backend, boot } from "./helpers/formalBudgetMock.js";

test("route previews, save recovery and itinerary endpoint invalidation share one scoped owner", async ({ page }) => {
  const db = backend();
  db.rows.itinerary_items = ["a", "b"].map((id, index) => ({
    id, trip_id: "trip", day_index: 0, sort_order: index, item_type: "visit",
    title: id, location_name: id, latitude: 25 + index, longitude: 121,
  }));
  db.rows.itinerary_route_overrides = [{ id: "route", trip_id: "trip", day_index: 0, from_item_id: "a", to_item_id: "b" }];
  db.rows.itinerary_route_override_nodes = [{ route_override_id: "route", node_key: "via", order_key: 1000, lat: 25, lng: 121 }];
  const request = db.request.bind(db);
  let rejectUpdate = false;
  db.request = call => rejectUpdate && call.table === "itinerary_route_override_nodes" && call.patch
    ? { data: null, error: { message: "write refused" } }
    : request(call);

  // Exercise the public map callbacks without loading Google Maps.
  await page.route("**/src/components/map/RoutePanel.jsx*", route => route.fulfill({
    contentType: "text/javascript",
    body: "export default function RoutePanel(props) { window.routePanel = props; return null; }",
  }));
  await boot(page, db, "A", { waitForBudget: false });
  await page.locator(".section-nav-button").getByText("行程路線", { exact: true }).click();
  const currentPoints = () => page.evaluate(() => window.routePanel?.routeOverridePointsBySegment["a:b"] || []);
  await expect.poll(currentPoints).toMatchObject([{ id: "via", lat: 25 }]);

  await page.evaluate(() => window.budgetMock.broadcast("route-edit-update", {
    tripId: "trip", dayIndex: 0, sessionId: "peer", userId: "B", segmentKey: "a:b",
    nodeId: "via", phase: "node-drag-move", eventVersion: 1, node: { id: "via", lat: 28, lng: 121 },
  }));
  await expect.poll(() => page.evaluate(() => window.routePanel.routeEditCollaboration.remoteUpdates["a:b:via:position"]?.node.lat)).toBe(28);
  expect(await currentPoints()).toMatchObject([{ lat: 25 }]);

  const save = lat => page.evaluate(latitude => {
    const node = { id: "via", lat: latitude, lng: 121 };
    return window.routePanel.onRouteOverrideChange({
      fromItemId: "a", toItemId: "b", segmentKey: "a:b", points: [node], operation: { type: "update", node },
    });
  }, lat);
  expect(await save(28)).toMatchObject({ ok: true, points: [{ lat: 28 }] });
  rejectUpdate = true;
  expect(await save(29)).toMatchObject({ ok: false, points: [{ lat: 28 }] });
  await expect.poll(currentPoints).toMatchObject([{ id: "via", lat: 28 }]);

  db.rows.itinerary_items[0].latitude = 30;
  await page.evaluate(() => window.budgetMock.emit("itinerary_items"));
  await expect.poll(currentPoints).toEqual([]);
});
