import { expect, test } from "@playwright/test";
import { collaboratorColors } from "../src/lib/collaboratorColors.js";

test("collapsed Demo previews switch dates by keyboard and card click", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo/timeline");
  await page.getByRole("button", { name: "隱藏地圖", exact: true }).click();
  const preview = (day) => page.locator(`.timeline-day-preview[data-day-index="${day}"]`);
  const active = (day) => page.locator(`.timeline-day-column.active[data-day-index="${day}"]`);

  await expect(preview(0)).toHaveCount(0);
  await preview(1).press("Enter");
  await expect(active(1)).toBeVisible();
  await preview(0).press("Space");
  await expect(active(0)).toBeVisible();

  await preview(1).getByRole("button", { name: /伏見稻荷大社/ }).click();
  await expect(active(1)).toBeVisible();
  await expect(active(1).locator(".focused")).toHaveCount(0);

  const transport = preview(3).getByRole("button", { name: "步行・12分鐘・12 分鐘", exact: true });
  await expect(transport.locator("svg.lucide-footprints")).toHaveAttribute("aria-hidden", "true");
  await transport.click();
  await expect(active(3)).toBeVisible();
  await expect(active(3).locator(".focused")).toHaveCount(0);

  await page.getByRole("button", { name: "顯示地圖", exact: true }).click();
  const route = page.locator(".side-panels > .route-panel");
  await expect(route).toBeVisible();
  await expect(page.locator(".timeline-day-preview")).toHaveCount(0);
  await expect(active(3)).toBeVisible();
  await expect(route.locator(".focused, .route-stop-transport-endpoint")).toHaveCount(0);
});

test("read-only day shows adjacent transport and up to three presence dots", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const [react, reactDom, columns] = await Promise.all([
      import("/@id/react"),
      import("/@id/react-dom/client"),
      import("/src/components/timeline/MultiDayTimelineColumns.jsx"),
    ]);
    const host = document.body.appendChild(document.createElement("div"));
    host.id = "day-preview-fixture";
    const visit = (id, start_time) => ({ id, item_type: "visit", title: id, start_time, end_time: start_time });
    const transport = (id, from_item_id, to_item_id) => ({
      id, from_item_id, to_item_id, item_type: "transport", transport_role: "normal_pair",
      transport_name: id, transport_category: "walk", transport_duration_minutes: 12,
    });
    const presence = [
      { userId: "one", userName: "First member", colorKey: "purple" },
      { userId: "two", colorKey: "unknown" },
      { userId: "three", userName: "Third member", colorKey: "orange" },
      { userId: "four", userName: "Fourth member", colorKey: "cyan" },
    ];
    (reactDom.default || reactDom).createRoot(host).render((react.default || react).createElement(columns.default, {
      activeDay: 0,
      days: [new Date(2026, 10, 15), new Date(2026, 10, 16)],
      itemsByDay: [[], [
        visit("C", "11:00"), visit("A", "09:00"), visit("B", "10:00"),
        transport("Adjacent walk", "A", "B"),
        transport("Duplicate walk", "A", "B"),
        transport("Nonadjacent walk", "A", "C"),
        transport("Reversed walk", "B", "A"),
      ]],
      dayBoardPresenceByDay: new Map([[1, presence]]),
    }));
  });

  const preview = page.locator("#day-preview-fixture .timeline-day-preview");
  await expect(preview.locator(".timeline-preview-card strong")).toHaveText(["A", "Adjacent walk・12 分鐘", "B", "C"]);
  await expect(preview.locator(".transport-preview-card svg.lucide-footprints")).toHaveCount(1);
  const dots = preview.getByLabel("Remote members on this day").locator(".timeline-day-presence-dot");
  await expect(dots).toHaveCount(3);
  expect(await dots.evaluateAll((nodes) => nodes.map((node) => [node.title, node.style.getPropertyValue("--trip-presence-color")]))).toEqual([
    ["First member", collaboratorColors.purple],
    ["Remote member", collaboratorColors.blue],
    ["Third member", collaboratorColors.orange],
  ]);
});
