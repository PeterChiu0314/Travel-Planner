import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { roundMinutesUpToStep } from "../src/lib/timelineTime.js";

const baseUrl = "http://127.0.0.1:5173";
let viteServer = null;

async function isServerReady() {
  try {
    const response = await fetch(baseUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isServerReady()) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

test.beforeAll(async () => {
  if (await isServerReady()) return;
  viteServer = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173"],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      windowsHide: true,
    },
  );
  await waitForServer();
});

test.afterAll(() => {
  if (viteServer && !viteServer.killed) {
    viteServer.kill();
  }
});

function collectConsoleFailures(page) {
  const failures = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("pageerror", (error) => failures.push(error.message));
  return failures;
}

function collectSupabaseRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/^https?:\/\/[^/]*supabase/i.test(url) || /\/auth\/v1\/|\/rest\/v1\/|\/realtime\/v1\//i.test(url)) requests.push(url);
  });
  return requests;
}

async function setTimelineTime(form, name, value) {
  const field = form.locator(`.timeline-segmented-time-field[data-name="${name}"]`);
  await field.locator(".timeline-time-menu-toggle").click();
  await field.getByRole("option", { name: value, exact: true }).click();
}

async function openDemoNewVisitForm(page, title, startTime, endTime) {
  await page.locator(".timeline-add-button").click();
  const form = page.locator(".timeline-day-column.active .item-form:not(.transport-editor-form)");
  await expect(form.locator(".form-mode-label")).toHaveText("新增行程");
  await form.locator('input[name="location_name"]').fill(title);
  await form.getByRole("button", { name: "更改地點" }).click();
  const mapUrlInput = form.locator('.visit-map-url-editor input[name="map_url"]');
  await mapUrlInput.fill("https://www.google.com/maps?q=25.033,121.5654");
  await mapUrlInput.blur();
  await form.getByRole("button", { name: "更改地點" }).click();
  await expect(form.locator(".visit-map-url-editor")).toHaveCount(0);
  if (startTime !== null) await setTimelineTime(form, "start_time", startTime);
  if (endTime !== null) await setTimelineTime(form, "end_time", endTime);
  return form;
}

for (const layout of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 900, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Phase 5.8b ${layout.name} keeps the Map behind the Dayboard`, async ({ page }) => {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto("/demo/timeline");

    const metrics = await page.evaluate(() => {
      const workbench = document.querySelector(".timeline-workbench:not(.hidden-section)");
      const board = workbench?.querySelector(".itinerary-panel");
      const map = workbench?.querySelector(".side-panels > .route-panel");
      const tabs = document.querySelector(".timeline-top-row .day-tabs-shell");
      const rect = (element) => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { bottom: box.bottom, left: box.left, right: box.right, top: box.top, width: box.width };
      };
      const workbenchRect = rect(workbench);
      const boardRect = rect(board);
      const mapRect = rect(map);
      const tabsRect = rect(tabs);
      const workspace = document.querySelector(".workspace");
      const boardStyle = board ? getComputedStyle(board) : null;
      const scrollbarStyle = board ? getComputedStyle(board, "::-webkit-scrollbar") : null;
      const scrollbarButtonStyle = board ? getComputedStyle(board, "::-webkit-scrollbar-button") : null;
      return {
        boardOverflowY: boardStyle?.overflowY ?? null,
        boardPadding: boardStyle?.padding ?? null,
        boardRect,
        boardScrollbarButtonDisplay: scrollbarButtonStyle?.display ?? null,
        boardScrollbarButtonHeight: scrollbarButtonStyle?.height ?? null,
        boardScrollbarGutter: boardStyle?.scrollbarGutter ?? null,
        boardScrollbarWidth: scrollbarStyle?.width ?? null,
        mapRect,
        pageClientWidth: document.documentElement.clientWidth,
        pageScrollWidth: document.documentElement.scrollWidth,
        tabsRight: tabsRect?.right ?? null,
        viewportHeight: window.innerHeight,
        workspacePaddingBottom: workspace ? getComputedStyle(workspace).paddingBottom : null,
        workbenchRect,
      };
    });

    expect(metrics.workbenchRect).not.toBeNull();
    expect(metrics.boardRect).not.toBeNull();
    expect(metrics.mapRect).not.toBeNull();
    expect(metrics.boardOverflowY).toBe("auto");
    expect(metrics.mapRect.width).toBeGreaterThanOrEqual(metrics.workbenchRect.width - 2);
    expect(metrics.boardRect.width).toBeLessThanOrEqual(metrics.workbenchRect.width);
    expect(metrics.boardRect.left).toBeLessThan(metrics.mapRect.right);
    expect(metrics.boardRect.top).toBeLessThan(metrics.mapRect.bottom);
    expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.pageClientWidth + 1);
    expect(metrics.tabsRight).toBeLessThanOrEqual(metrics.pageClientWidth + 1);
    if (layout.width > 1100) {
      expect(Math.abs(metrics.boardRect.left - metrics.workbenchRect.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.boardRect.right - metrics.tabsRight)).toBeLessThanOrEqual(1);
      expect(metrics.boardPadding).toBe("0px 6px 5px 10px");
      expect(metrics.boardScrollbarGutter).toBe("stable");
      expect(metrics.boardScrollbarWidth).toBe("4px");
      expect(metrics.boardScrollbarButtonDisplay).toBe("none");
      expect(metrics.boardScrollbarButtonHeight).toBe("0px");
      expect(metrics.workspacePaddingBottom).toBe("0px");
      expect(metrics.workbenchRect.bottom).toBeGreaterThanOrEqual(metrics.viewportHeight - 1);
      expect(metrics.workbenchRect.bottom).toBeLessThanOrEqual(metrics.viewportHeight + 3);
    }
  });
}

test("Phase 5.8 trip header typography stays consistent while renaming", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo/timeline");

  const header = page.locator(".trip-header");
  const titleButton = header.locator(".trip-header-title-button");
  const meta = header.locator(".trip-header-meta");

  await expect(titleButton).toBeVisible();
  expect(await titleButton.evaluate((element) => getComputedStyle(element).fontSize)).toBe("24px");
  expect(await titleButton.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("500");
  expect(await meta.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("500");
  expect(await header.evaluate((element) => getComputedStyle(element).padding)).toBe("14px 10px 8px");
  expect(await header.evaluate((element) => getComputedStyle(element).flexShrink)).toBe("0");
  expect(await header.evaluate((element) => getComputedStyle(element, "::after").backdropFilter)).toBe("none");
  expect(await header.evaluate((element) => getComputedStyle(element, "::after").backgroundImage)).toContain("linear-gradient");
  expect(await header.locator(".trip-header-main").evaluate((element) => getComputedStyle(element).gap)).toBe("2px");

  const headerBeforeDenseBoard = await header.boundingBox();
  const denseBoardMetrics = await page.evaluate(() => {
    const activeDay = document.querySelector(".timeline-day-column.active");
    const card = activeDay?.querySelector(".timeline-flow-entry");
    if (!activeDay || !card) return null;
    const scrollHeightBefore = activeDay.scrollHeight;
    for (let index = 0; index < 24; index += 1) activeDay.append(card.cloneNode(true));
    return {
      addedCards: 24,
      scrollHeightAfter: activeDay.scrollHeight,
      scrollHeightBefore,
    };
  });
  const headerAfterDenseBoard = await header.boundingBox();
  expect(denseBoardMetrics).not.toBeNull();
  expect(denseBoardMetrics.addedCards).toBe(24);
  expect(denseBoardMetrics.scrollHeightAfter).toBeGreaterThan(denseBoardMetrics.scrollHeightBefore);
  expect(headerBeforeDenseBoard).not.toBeNull();
  expect(headerAfterDenseBoard).not.toBeNull();
  expect(Math.abs(headerAfterDenseBoard.height - headerBeforeDenseBoard.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(headerAfterDenseBoard.y - headerBeforeDenseBoard.y)).toBeLessThanOrEqual(1);

  await titleButton.click();
  const titleInput = header.locator(".trip-header-title-input");
  await expect(titleInput).toBeVisible();
  expect(await titleInput.evaluate((element) => getComputedStyle(element).fontSize)).toBe("24px");
  expect(await titleInput.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("500");
});

test("Phase 5.8 Timeline confirmation dialogs stay viewport-centered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo/timeline");

  await page.locator('.timeline-item button[title="刪除"]:not([disabled])').first().click();
  const backdrop = page.locator("body > .modal-backdrop");
  const dialog = backdrop.locator('.dialog-card[role="dialog"]');

  await expect(backdrop).toBeVisible();
  await expect(dialog).toBeVisible();

  const metrics = await page.evaluate(() => {
    const backdropElement = document.querySelector("body > .modal-backdrop");
    const dialogElement = backdropElement?.querySelector('.dialog-card[role="dialog"]');
    if (!backdropElement || !dialogElement) return null;
    const backdropRect = backdropElement.getBoundingClientRect();
    const dialogRect = dialogElement.getBoundingClientRect();
    const backdropStyle = getComputedStyle(backdropElement);
    const dialogStyle = getComputedStyle(dialogElement);
    return {
      backdropBackground: backdropStyle.backgroundColor,
      backdropBottom: backdropRect.bottom,
      backdropLeft: backdropRect.left,
      backdropPosition: backdropStyle.position,
      backdropRight: backdropRect.right,
      backdropTop: backdropRect.top,
      dialogBackground: dialogStyle.backgroundColor,
      dialogBorderRadius: dialogStyle.borderRadius,
      dialogCenterX: dialogRect.left + dialogRect.width / 2,
      dialogCenterY: dialogRect.top + dialogRect.height / 2,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics.backdropPosition).toBe("fixed");
  expect(metrics.backdropBackground).toBe("rgba(24, 32, 28, 0.36)");
  expect(metrics.dialogBackground).toBe("rgb(255, 255, 255)");
  expect(metrics.dialogBorderRadius).toBe("8px");
  expect(Math.abs(metrics.backdropLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.backdropTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.backdropRight - metrics.viewportWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.backdropBottom - metrics.viewportHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.dialogCenterX - metrics.viewportWidth / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.dialogCenterY - metrics.viewportHeight / 2)).toBeLessThanOrEqual(1);
});

test("Phase 5.8 transport insertion stays centered and triggers from adjacent card edges", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/demo/timeline");

  const zone = page.locator(".transport-insert-zone:not(.tail)").first();
  await expect(zone).toBeVisible();

  const restingMetrics = await zone.evaluate((element) => {
    const entry = element.closest(".timeline-sortable-entry");
    const previousCard = entry?.querySelector(":scope > .timeline-item");
    const nextCard = entry?.nextElementSibling?.querySelector(":scope > .timeline-item");
    if (!previousCard || !nextCard) return null;
    const previousRect = previousCard.getBoundingClientRect();
    const nextRect = nextCard.getBoundingClientRect();
    const zoneRect = element.getBoundingClientRect();
    return {
      nextTop: nextRect.top,
      previousBottom: previousRect.bottom,
      zoneHeight: zoneRect.height,
      zoneWidth: zoneRect.width,
      previousWidth: previousRect.width,
    };
  });

  expect(restingMetrics).not.toBeNull();
  expect(Math.abs(restingMetrics.zoneHeight - 4)).toBeLessThanOrEqual(1);
  expect(Math.abs(restingMetrics.nextTop - restingMetrics.previousBottom - 4)).toBeLessThanOrEqual(1);
  expect(Math.abs(restingMetrics.zoneWidth - restingMetrics.previousWidth)).toBeLessThanOrEqual(1);

  const upperEdgeTarget = await zone.evaluate((element) => {
    const entry = element.closest(".timeline-sortable-entry");
    const previousCard = entry?.querySelector(":scope > .timeline-item");
    if (!previousCard) return null;
    const cardRect = previousCard.getBoundingClientRect();
    const zoneRect = element.getBoundingClientRect();
    return { x: zoneRect.left + zoneRect.width / 2, y: cardRect.bottom - 3 };
  });
  expect(upperEdgeTarget).not.toBeNull();
  await page.mouse.move(upperEdgeTarget.x, upperEdgeTarget.y);
  await expect.poll(async () => (await zone.boundingBox())?.height ?? 0).toBeGreaterThan(20);

  const expandedMetrics = await zone.evaluate((element) => {
    const entry = element.closest(".timeline-sortable-entry");
    const previousCard = entry?.querySelector(":scope > .timeline-item");
    const nextCard = entry?.nextElementSibling?.querySelector(":scope > .timeline-item");
    const timeText = previousCard?.querySelector(".time-block > span:first-child");
    const icon = element.querySelector(".transport-insert-icon");
    const line = element.querySelector(".transport-insert-line");
    if (!previousCard || !nextCard || !timeText || !icon || !line) return null;
    const previousRect = previousCard.getBoundingClientRect();
    const nextRect = nextCard.getBoundingClientRect();
    const timeRect = timeText.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const zoneRect = element.getBoundingClientRect();
    const ghostStyle = getComputedStyle(element, "::before");
    const zoneStyle = getComputedStyle(element);
    return {
      contentStartOffset: iconRect.left - timeRect.left,
      gapCenter: previousRect.bottom + (nextRect.top - previousRect.bottom) / 2,
      ghostBackground: ghostStyle.backgroundColor,
      ghostBorderWidth: ghostStyle.borderTopWidth,
      ghostBottom: ghostStyle.bottom,
      ghostBoxShadow: ghostStyle.boxShadow,
      ghostOpacity: ghostStyle.opacity,
      ghostTop: ghostStyle.top,
      lineCenter: lineRect.top + lineRect.height / 2,
      nextTop: nextRect.top,
      previousBottom: previousRect.bottom,
      zoneCenter: zoneRect.top + zoneRect.height / 2,
      zoneHeight: zoneRect.height,
      zoneWidth: zoneRect.width,
      previousWidth: previousRect.width,
      rightPadding: zoneStyle.paddingRight,
    };
  });

  expect(expandedMetrics).not.toBeNull();
  expect(Math.abs(expandedMetrics.zoneHeight - 22)).toBeLessThanOrEqual(1);
  expect(Math.abs(expandedMetrics.nextTop - expandedMetrics.previousBottom - 22)).toBeLessThanOrEqual(1);
  expect(Math.abs(expandedMetrics.zoneCenter - expandedMetrics.gapCenter)).toBeLessThanOrEqual(1);
  expect(expandedMetrics.lineCenter - expandedMetrics.gapCenter).toBeGreaterThanOrEqual(0.5);
  expect(expandedMetrics.lineCenter - expandedMetrics.gapCenter).toBeLessThanOrEqual(1.5);
  expect(Math.abs(expandedMetrics.zoneWidth - expandedMetrics.previousWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(expandedMetrics.contentStartOffset)).toBeLessThanOrEqual(4);
  expect(expandedMetrics.ghostBackground).toBe("rgba(36, 43, 38, 0.06)");
  expect(expandedMetrics.ghostBorderWidth).toBe("0px");
  expect(expandedMetrics.ghostTop).toBe("2px");
  expect(expandedMetrics.ghostBottom).toBe("2px");
  expect(expandedMetrics.ghostBoxShadow).toBe("none");
  expect(Number(expandedMetrics.ghostOpacity)).toBeGreaterThan(0.9);
  expect(expandedMetrics.rightPadding).toBe("20px");

  await page.mouse.move(0, 0);
  await expect.poll(async () => (await zone.boundingBox())?.height ?? 0).toBeLessThan(6);

  const lowerEdgeTarget = await zone.evaluate((element) => {
    const entry = element.closest(".timeline-sortable-entry");
    const nextCard = entry?.nextElementSibling?.querySelector(":scope > .timeline-item");
    if (!nextCard) return null;
    const cardRect = nextCard.getBoundingClientRect();
    const zoneRect = element.getBoundingClientRect();
    return { x: zoneRect.left + zoneRect.width / 2, y: cardRect.top + 3 };
  });
  expect(lowerEdgeTarget).not.toBeNull();
  await page.mouse.move(lowerEdgeTarget.x, lowerEdgeTarget.y);
  await expect.poll(async () => (await zone.boundingBox())?.height ?? 0).toBeGreaterThan(20);
});

test("app shell loads without crashing", async ({ page }) => {
  const failures = collectConsoleFailures(page);

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /一起把旅程排好|需要 Supabase 設定/ }),
  ).toBeVisible();
  expect(failures).toEqual([]);

});

test("demo timeline renders without authentication", async ({ page }) => {
  const failures = collectConsoleFailures(page);

  await page.goto("/demo/timeline");

  await expect(page.getByText("Demo Mode 資料不會永久保存。")).toBeVisible();
  await expect(page.getByRole("button", { name: "京都琵琶湖之旅-TEST，目前旅程" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的旅程" })).toBeVisible();
  await expect(page.getByText("回到登入", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "平安出國停車場" })).toBeVisible();
  await expect(page.getByRole("button", { name: /隱藏地圖|顯示地圖/ })).toBeVisible();
  expect(failures).toEqual([]);

  await page.getByRole("button", { name: "Return to login" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("Phase 5.9 visit editor keeps the compact layout and normalizes linked time input", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/demo/timeline");

  const firstVisit = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "平安出國停車場" }) });
  await firstVisit.click();
  await firstVisit.getByTitle("編輯").click();
  const form = page.locator(".timeline-day-column.active .item-form:not(.transport-editor-form)");
  await expect(form.locator(".form-mode-label")).toHaveText("編輯行程");
  await expect(form.locator(".form-mode-label")).toHaveCSS("font-weight", "600");

  await expect(form.locator(".outlined-field > legend")).toHaveText(["類型", "目的地", "開始", "結束", "停留時間", "備註"]);
  expect(await form.locator(".outlined-field > legend").first().evaluate((legend) => getComputedStyle(legend).fontWeight)).toBe("400");
  const primaryFields = form.locator(".visit-editor-primary-row > .outlined-field");
  const typeBox = await primaryFields.nth(0).boundingBox();
  const destinationBox = await primaryFields.nth(1).boundingBox();
  const typeControlBox = await primaryFields.nth(0).locator("select").boundingBox();
  const destinationControlBox = await primaryFields.nth(1).locator("input").boundingBox();
  expect(Math.abs(typeBox.y - destinationBox.y)).toBeLessThan(2);
  expect(destinationBox.width).toBeGreaterThan(typeBox.width * 2);
  expect(typeBox.height).toBeCloseTo(42, 0);
  expect(destinationBox.height).toBeCloseTo(42, 0);
  expect(typeControlBox.height).toBeGreaterThan(20);
  expect(destinationControlBox.height).toBeGreaterThan(20);

  const startField = form.locator('.timeline-segmented-time-field[data-name="start_time"]');
  const endField = form.locator('.timeline-segmented-time-field[data-name="end_time"]');
  const durationField = form.locator(".visit-time-field.duration");
  const startBox = await startField.boundingBox();
  const endBox = await endField.boundingBox();
  const durationBox = await durationField.boundingBox();
  expect(Math.max(startBox.y, endBox.y, durationBox.y) - Math.min(startBox.y, endBox.y, durationBox.y)).toBeLessThanOrEqual(2);
  expect(startBox.height).toBeCloseTo(42, 0);
  expect(endBox.height).toBeCloseTo(42, 0);
  expect(durationBox.height).toBeCloseTo(42, 0);
  await expect(startField.locator(".timeline-time-separator")).toHaveCSS("font-weight", "500");
  const timeAlignment = await form.locator(".visit-editor-time-row").evaluate((row) => {
    const start = row.querySelector('.timeline-segmented-time-field[data-name="start_time"]')?.getBoundingClientRect();
    const link = row.querySelector(".visit-time-link")?.getBoundingClientRect();
    const separator = row.querySelector(".timeline-time-separator")?.getBoundingClientRect();
    const toggle = row.querySelector(".timeline-time-menu-toggle")?.getBoundingClientRect();
    return {
      fieldCenter: start ? start.top + start.height / 2 : null,
      linkCenter: link ? link.top + link.height / 2 : null,
      linkWidth: link?.width ?? null,
      separatorCenter: separator ? separator.top + separator.height / 2 : null,
      toggleWidth: toggle?.width ?? null,
    };
  });
  expect(timeAlignment.linkCenter - timeAlignment.fieldCenter).toBeCloseTo(4, 0);
  expect(timeAlignment.linkWidth).toBeCloseTo(12, 0);
  expect(timeAlignment.separatorCenter - timeAlignment.fieldCenter).toBeCloseTo(0, 0);
  expect(timeAlignment.toggleWidth).toBeCloseTo(42, 0);

  const startInput = form.locator('input[name="start_time"]');
  await setTimelineTime(form, "start_time", "09:45");
  await expect(startInput).toHaveValue("09:45");
  await startField.locator(".timeline-time-segment.minute").press("ArrowUp");
  await expect(startInput).toHaveValue("09:50");

  await startField.locator(".timeline-time-menu-toggle").click();
  await expect(startField.locator(".timeline-time-menu")).toBeVisible();
  expect(await startField.locator('.timeline-time-menu [role="option"]').count()).toBeGreaterThan(20);
  await startField.locator('.timeline-time-menu [role="option"]', { hasText: "10:00" }).click();
  await expect(startInput).toHaveValue("10:00");

  const durationInput = form.locator('input[name="duration_minutes"]');
  await durationInput.fill("90");
  await durationInput.blur();
  await expect(durationInput).toHaveValue("1小時30分鐘");
  await expect(form.locator('input[name="end_time"]')).toHaveValue("11:30");
  await form.locator(".visit-time-field.duration .timeline-time-menu-toggle").click();
  await expect(form.locator(".visit-time-field.duration .timeline-time-menu")).toBeVisible();
  await form.getByRole("option", { name: "1小時", exact: true }).click();
  await expect(durationInput).toHaveValue("1小時");
  await expect(form.locator('input[name="end_time"]')).toHaveValue("11:00");

  await expect(form.getByRole("button", { name: "更改地點" })).toBeVisible();
  await expect(form.getByRole("button", { name: "調整點位" })).toHaveCount(0);
  await expect(form.getByRole("button", { name: "搜尋替換" })).toHaveCount(0);
  await expect(form.locator(".visit-maps-link")).toContainText("Maps");
  await expect(form.locator(".visit-map-point-title")).toHaveCount(0);
  await expect(form.locator(".visit-map-point-header .lucide-external-link")).toHaveCount(1);
  const noteBox = await form.locator(".visit-note-field textarea").boundingBox();
  expect(noteBox.height).toBeLessThanOrEqual(56);
  await expect(form.locator('.visit-map-url-editor input[name="map_url"]')).toHaveCount(0);
  await form.getByRole("button", { name: "更改地點" }).click();
  await expect(form.getByRole("button", { name: "調整點位" })).toBeVisible();
  await expect(form.getByRole("button", { name: "搜尋替換" })).toBeVisible();
  await expect(form.locator(".visit-map-point-actions .lucide-map-pin")).toHaveCount(1);
  await expect(form.locator(".visit-map-point-actions .lucide-search")).toHaveCount(1);
  const mapUrlInput = form.locator('.visit-map-url-editor input[name="map_url"]');
  const mapUrlField = form.locator(".visit-map-url-editor");
  await expect(mapUrlInput).toBeVisible();
  await expect(mapUrlField.locator("legend")).toHaveText("Google Maps URL");
  await expect(mapUrlInput).toHaveAttribute("placeholder", "貼上 Google Maps 連結");
  const mapUrlBox = await mapUrlField.boundingBox();
  expect(mapUrlBox.height).toBeCloseTo(42, 0);
  await mapUrlInput.fill("https://www.google.com/maps/place/not-a-coordinate");
  await mapUrlInput.blur();
  await expect(mapUrlField).toHaveClass(/invalid/);
  await expect(form.locator(".visit-map-url-error")).toBeVisible();
  const invalidMapUrlBox = await mapUrlField.boundingBox();
  expect(invalidMapUrlBox).toEqual(mapUrlBox);
  await expect(form.getByRole("button", { name: "套用" })).toHaveCount(0);
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(failures).toEqual([]);
});

test("Phase 5.9 new visit editor uses the same transparent card controls as the existing editor", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo/timeline");

  await page.locator(".timeline-add-button").click();
  const form = page.locator(".timeline-day-column.active .timeline-add-editor-anchor .item-form");
  await expect(form.locator(".form-mode-label")).toHaveText("新增行程");
  await expect(form.locator(".outlined-field > legend")).toHaveText(["類型", "目的地", "開始", "結束", "停留時間", "備註"]);
  await expect(form.locator(".visit-time-field.duration input")).toBeDisabled();
  await expect(form.locator(".visit-time-field.duration input")).toHaveValue("1小時");

  const visualStyles = await form.evaluate((element) => ({
    marginBottom: getComputedStyle(element).marginBottom,
    destinationBackground: getComputedStyle(element.querySelector('input[name="location_name"]')).backgroundColor,
    typeBackground: getComputedStyle(element.querySelector('select[name="type"]')).backgroundColor,
    noteBackground: getComputedStyle(element.querySelector('textarea[name="description"]')).backgroundColor,
    cancelBackground: getComputedStyle(element.querySelector(".item-form-cancel-button")).backgroundColor,
  }));

  expect(visualStyles).toEqual({
    marginBottom: "0px",
    destinationBackground: "rgba(0, 0, 0, 0)",
    typeBackground: "rgba(0, 0, 0, 0)",
    noteBackground: "rgba(0, 0, 0, 0)",
    cancelBackground: "rgba(0, 0, 0, 0)",
  });
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(failures).toEqual([]);
});

test("demo trip switch resets an out-of-range selected day board", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");

  const daySixTab = page.locator('.day-tab[data-day-index="5"]');
  await expect(daySixTab).toHaveCount(1);
  await daySixTab.click();
  await expect(page.locator('.timeline-day-column.active[data-day-index="5"]')).toHaveCount(1);

  await page.getByRole("button", { name: "A_TEST" }).click();

  await expect(page.getByRole("button", { name: "A_TEST", exact: true })).toBeVisible();
  await expect(page.locator(".day-tab")).toHaveCount(3);
  await expect(page.locator(".day-tab.active")).toHaveCount(1);
  await expect(page.locator(".timeline-day-column.active")).toHaveCount(1);
  await expect(page.locator('.timeline-day-column[data-day-index="5"]')).toHaveCount(0);
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("Phase 5.8 Timeline cards stage focus before expansion and reset across markers and days", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo/timeline");

  const firstVisit = page.locator(".timeline-day-column.active .timeline-item").first();
  await firstVisit.click();
  await expect(firstVisit).toHaveClass(/focused/);
  await expect(firstVisit).not.toHaveClass(/expanded/);

  await firstVisit.click();
  await expect(firstVisit).toHaveClass(/focused/);
  await expect(firstVisit).toHaveClass(/expanded/);

  const markers = page.locator(".static-map-marker");
  expect(await markers.count()).toBeGreaterThan(1);
  await markers.nth(1).evaluate((marker) => marker.click());
  await expect(firstVisit).not.toHaveClass(/focused/);
  await expect(firstVisit).not.toHaveClass(/expanded/);
  await expect(page.locator(".timeline-day-column.active .timeline-item.focused")).toHaveCount(1);
  await expect(page.locator(".timeline-day-column.active .timeline-item.expanded")).toHaveCount(0);

  const firstTransport = page.locator(".timeline-day-column.active .transport-card").first();
  await firstTransport.click();
  await expect(firstTransport).toHaveClass(/focused/);
  await expect(firstTransport).not.toHaveClass(/expanded/);

  await firstTransport.click();
  await expect(firstTransport).toHaveClass(/focused/);
  await expect(firstTransport).toHaveClass(/expanded/);

  await page.locator('.day-tab[data-day-index="1"]').click();
  await expect(page.locator('.timeline-day-column.active[data-day-index="1"]')).toHaveCount(1);
  await expect(page.locator(".timeline-day-column.active .focused")).toHaveCount(0);
  await expect(page.locator(".timeline-day-column.active .expanded")).toHaveCount(0);

  await page.locator('.day-tab[data-day-index="0"]').click();
  await expect(page.locator('.timeline-day-column.active[data-day-index="0"]')).toHaveCount(1);
  await expect(page.locator(".timeline-day-column.active .focused")).toHaveCount(0);
  await expect(page.locator(".timeline-day-column.active .expanded")).toHaveCount(0);
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

for (const scenario of [
  { durationMinutes: "1", expectedStartTime: "21:35", label: "rounds one minute up to five minutes" },
  { durationMinutes: "17", expectedStartTime: "21:50", label: "rounds up to the next five-minute step" },
  { durationMinutes: "15", expectedStartTime: "21:45", label: "keeps an exact five-minute step" },
  { durationMinutes: "23", expectedStartTime: "21:55", label: "rounds twenty-three minutes up to twenty-five" },
]) {
  test(`demo tail transportation ${scenario.label}`, async ({ page }) => {
    const failures = collectConsoleFailures(page);
    const supabaseRequests = collectSupabaseRequests(page);

    await page.goto("/demo/timeline");

    const lastVisit = page.locator(".timeline .timeline-item").last();
    await lastVisit.click();
    await lastVisit.getByTitle("編輯").click();
    const editForm = page.locator(".item-form");
    await setTimelineTime(editForm, "end_time", "21:30");
    await editForm.getByRole("button", { name: "儲存" }).click();

    await page.getByRole("button", { name: "新增尾端交通" }).click({ force: true });
    await page.locator('input[name="transport_duration_minutes"]').fill(scenario.durationMinutes);
    await page.locator('input[name="transport_name"]').fill("前往下一站");
    await page.locator(".transport-editor-form").getByRole("button", { name: "保存" }).click();

    await expect(page.getByText("下一目的地尚未設定", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新增行程" }).click();
    const startTimeInput = page.locator('input[name="start_time"]');
    await expect(startTimeInput).toHaveValue(scenario.expectedStartTime);
    await setTimelineTime(page.locator(".item-form"), "start_time", "22:00");
    await expect(startTimeInput).toHaveValue("22:00");
    expect(supabaseRequests).toEqual([]);
    expect(failures).toEqual([]);
  });
}

test("tail transportation rounding covers zero and exact five-minute boundaries", () => {
  const previousEnd = 10 * 60;
  expect([0, 1, 15, 17, 23].map((duration) => roundMinutesUpToStep(previousEnd + duration))).toEqual([
    10 * 60,
    10 * 60 + 5,
    10 * 60 + 15,
    10 * 60 + 20,
    10 * 60 + 25,
  ]);
});

test("demo timeline exposes dnd-kit visit drag handles without native card dragging", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");

  const source = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "平安出國停車場" }) });
  const target = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "關西機場" }) });
  await expect(source).toHaveCount(1);
  await expect(target).toHaveCount(1);

  await source.click();
  await source.getByTitle("編輯").click();
  await expect(page.locator('.timeline-item .time-block[data-drag-handle="true"]')).toHaveCount(0);
  await page.locator(".item-form").getByRole("button", { name: "取消" }).click();
  const sourceHandle = source.locator('.time-block[data-drag-handle="true"]');
  await expect(sourceHandle).toHaveCount(1);
  await expect(page.locator('.transport-card [data-drag-handle="true"]')).toHaveCount(0);

  const airportCard = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "桃園機場" }) });
  const parkingCard = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "平安出國停車場" }) });
  const lunchCard = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "關西機場" }) });
  await expect(airportCard).toHaveCount(1);
  await expect(parkingCard).toHaveCount(1);
  await expect(lunchCard).toHaveCount(1);
  await expect(page.locator(".transport-warning-stack")).toHaveCount(0);

  await airportCard.getByTitle("鎖定").click();
  await expect(airportCard.locator('.time-block[data-drag-handle="true"]')).toHaveCount(0);
  await expect(parkingCard.locator('.time-block[data-drag-handle="true"]')).toHaveCount(1);
  await expect(lunchCard.locator('.time-block[data-drag-handle="true"]')).toHaveCount(1);
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("demo adjacent no-op drop does not open reorder confirmation", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");
  const source = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "桃園機場" }) });
  const target = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "關西機場" }) });
  await expect(source).toHaveCount(1);
  await expect(target).toHaveCount(1);

  await source.dragTo(target);

  await expect(page.getByRole("heading", { name: "確認移動行程？" })).toHaveCount(0);
  await expect(page.locator(".timeline-item").filter({ hasText: "06:40" }).getByRole("heading", { name: "桃園機場" })).toBeVisible();
  await expect(page.locator(".timeline-item").filter({ hasText: "11:30" }).getByRole("heading", { name: "關西機場" })).toBeVisible();
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("demo new timed visit pair conflict supports restore and delete", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");
  const initialTransportCount = await page.locator(".timeline .transport-card").count();
  const form = await openDemoNewVisitForm(page, "Phase 4.3 新行程", "10:55", "11:20");
  await form.locator('button[type="submit"]').click();

  const dialog = page.getByTestId("transport-pair-conflict-dialog");
  await expect(dialog.getByRole("heading", { name: "這個時間會插入既有交通卡中間" })).toBeVisible();
  await expect(dialog).toContainText("桃園機場");
  await expect(dialog).toContainText("關西機場");

  await dialog.getByRole("button", { name: "恢復" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(page.locator(".timeline-item").filter({ hasText: "Phase 4.3 新行程" })).toHaveCount(0);
  await expect(page.locator(".timeline .transport-card")).toHaveCount(initialTransportCount);

  await form.locator('button[type="submit"]').click();
  await page.getByTestId("transport-pair-conflict-dialog").getByRole("button", { name: "刪除交通卡" }).click();
  await expect(page.getByTestId("transport-pair-conflict-dialog")).toHaveCount(0);
  await expect(form).toHaveCount(0);
  await expect(page.locator(".timeline-item").filter({ hasText: "Phase 4.3 新行程" })).toHaveCount(1);
  await expect(page.locator(".timeline .transport-card")).toHaveCount(initialTransportCount - 1);
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("demo edited timed visit prompts when moved into a valid pair gap", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");
  const originalCard = page.locator(".timeline-item").filter({ hasText: "02:20" });
  await originalCard.click();
  await originalCard.getByTitle("編輯").click();
  const form = page.locator(".timeline-day-column.active .item-form:not(.transport-editor-form)");
  await setTimelineTime(form, "start_time", "10:55");
  await setTimelineTime(form, "end_time", "11:20");
  await form.locator('button[type="submit"]').click();

  await expect(page.getByTestId("transport-pair-conflict-dialog")).toBeVisible();
  await expect(page.getByTestId("auto-continuation-dialog")).toHaveCount(0);
  await page.getByTestId("transport-pair-conflict-dialog").getByRole("button", { name: "恢復" }).click();
  await expect(form).toBeVisible();
  await expect(form.locator('input[name="start_time"]')).toHaveValue("10:55");
  page.once("dialog", (dialog) => dialog.accept());
  await form.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".timeline-item").filter({ hasText: "02:20" }).locator(".time-block")).toContainText("02:20");
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("demo blank gap and untimed saves do not show the pair prompt", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");
  let form = await openDemoNewVisitForm(page, "沒有交通卡的空隙", "04:00", "05:00");
  await form.locator('button[type="submit"]').click();
  await expect(page.getByTestId("transport-pair-conflict-dialog")).toHaveCount(0);
  await expect(page.locator(".timeline-item").filter({ hasText: "沒有交通卡的空隙" })).toHaveCount(1);

  form = await openDemoNewVisitForm(page, "未排時間行程", null, null);
  await form.locator('button[type="submit"]').click();
  await expect(page.getByTestId("transport-pair-conflict-dialog")).toHaveCount(0);
  await expect(page.locator(".timeline-item").filter({ hasText: "未排時間行程" })).toHaveCount(1);
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("demo invalid and overlapping times stay in existing validation without pair prompt", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");
  let form = await openDemoNewVisitForm(page, "時間錯誤", "11:20", "11:00");
  await form.locator('button[type="submit"]').click();
  await expect(form.locator(".inline-error")).toContainText("結束時間必須晚於開始時間");
  await expect(page.getByTestId("transport-pair-conflict-dialog")).toHaveCount(0);
  await expect(page.getByTestId("auto-continuation-dialog")).toHaveCount(0);

  await page.goto("/demo/timeline");
  form = await openDemoNewVisitForm(page, "重疊行程", "10:45", "11:20");
  await form.locator('button[type="submit"]').click();
  await expect(form.locator(".inline-error")).toContainText("重疊");
  await expect(page.getByTestId("transport-pair-conflict-dialog")).toHaveCount(0);
  await expect(page.getByTestId("auto-continuation-dialog")).toHaveCount(0);
  await expect(form).toBeVisible();
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("demo time edit can save only the current visit", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");
  const firstVisit = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "平安出國停車場" }) });
  await firstVisit.click();
  await firstVisit.getByTitle("編輯").click();
  const form = page.locator(".timeline-day-column.active .item-form:not(.transport-editor-form)");
  await expect(form.locator(".form-actions").getByRole("button")).toHaveText(["取消", "接續", "儲存"]);
  await expect(form.getByRole("button", { name: "接續", exact: true })).toBeDisabled();
  await setTimelineTime(form, "start_time", "02:30");
  await expect(form.getByRole("button", { name: "接續", exact: true })).toBeEnabled();
  await form.getByRole("button", { name: "儲存", exact: true }).click();
  await expect(page.getByTestId("auto-continuation-dialog")).toHaveCount(0);

  const updatedFirst = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "平安出國停車場" }) });
  const unchangedSecond = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "桃園機場" }) });
  await expect(updatedFirst.locator(".time-block")).toContainText("02:30");
  await expect(updatedFirst.locator(".time-block")).toContainText("03:40");
  await expect(unchangedSecond.locator(".time-block")).toContainText("06:40");
  await expect(unchangedSecond.locator(".time-block")).toContainText("10:50");
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("demo auto continuation preserves downstream durations and gaps", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");
  const firstVisit = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "平安出國停車場" }) });
  await firstVisit.click();
  await firstVisit.getByTitle("編輯").click();
  const form = page.locator(".timeline-day-column.active .item-form:not(.transport-editor-form)");
  await setTimelineTime(form, "start_time", "02:30");
  await form.getByRole("button", { name: "接續", exact: true }).click();
  const dialog = page.getByTestId("auto-continuation-dialog");
  await expect(dialog.getByRole("heading", { name: "自動接續後續行程？" })).toBeVisible();
  await dialog.getByRole("button", { name: "確定接續" }).click();

  const shiftedSecond = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "桃園機場" }) });
  const shiftedThird = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "關西機場" }) });
  await expect(shiftedSecond.locator(".time-block")).toContainText("06:50");
  await expect(shiftedSecond.locator(".time-block")).toContainText("11:00");
  await expect(shiftedThird.locator(".time-block")).toContainText("11:40");
  await expect(shiftedThird.locator(".time-block")).toContainText("12:40");
  await expect(page.getByText("未排時間行程", { exact: true })).toHaveCount(0);
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("demo continuation can be cancelled without saving", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");
  const firstVisit = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "平安出國停車場" }) });
  await firstVisit.click();
  await firstVisit.getByTitle("編輯").click();
  const form = page.locator(".timeline-day-column.active .item-form:not(.transport-editor-form)");
  await setTimelineTime(form, "start_time", "02:30");
  await form.getByRole("button", { name: "接續", exact: true }).click();
  await page.getByTestId("auto-continuation-dialog").getByRole("button", { name: "取消" }).click();

  await expect(page.getByTestId("auto-continuation-dialog")).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(form.locator('input[name="start_time"]')).toHaveValue("02:30");
  page.once("dialog", (dialog) => dialog.accept());
  await form.getByRole("button", { name: "取消", exact: true }).click();
  await expect(firstVisit.locator(".time-block")).toContainText("02:20");
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("demo fixed anchor stays put and overflowing followers become untimed", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");
  const fixedVisit = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "關西機場" }) });
  await fixedVisit.click();
  await fixedVisit.getByTitle("鎖定").click();

  const firstVisit = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "平安出國停車場" }) });
  await firstVisit.click();
  await firstVisit.getByTitle("編輯").click();
  const form = page.locator(".timeline-day-column.active .item-form:not(.transport-editor-form)");
  await setTimelineTime(form, "end_time", "06:40");
  await form.getByRole("button", { name: "接續", exact: true }).click();

  const dialog = page.getByTestId("auto-continuation-dialog");
  await expect(dialog).toContainText("固定行程不會移動，放不下的行程會改為未設定時間");
  await dialog.getByRole("button", { name: "確定接續" }).click();

  const overflowVisit = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "桃園機場" }) });
  await expect(overflowVisit.locator(".time-block")).toContainText("--:--");
  await expect(fixedVisit.locator(".time-block")).toContainText("11:30");
  expect(supabaseRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test("demo partial-time visit is treated as untimed", async ({ page }) => {
  await page.goto("/demo/timeline");
  const partialTimeVisit = page
    .locator('.timeline-item[data-timing="untimed"]')
    .filter({ has: page.getByRole("heading", { name: "京都山科山樂酒店" }) });
  await expect(partialTimeVisit).toBeVisible();
  await expect(partialTimeVisit.locator(".time-block")).toContainText("--:--");
});

test("demo navigation can switch to budget and luggage", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");
  await page.getByRole("button", { name: /預算/ }).first().click();
  await expect(page).toHaveURL(/\/demo\/budget$/);
  await expect(page.getByRole("heading", { name: "預算" }).first()).toBeVisible();

  await page.getByRole("button", { name: /行李/ }).first().click();
  await expect(page).toHaveURL(/\/demo\/luggage$/);
  expect(supabaseRequests).toEqual([]);
  await expect(page.getByRole("heading", { name: /個人行李|行李/ }).first()).toBeVisible();
  expect(failures).toEqual([]);
});

test("demo header member entry opens members dialog", async ({ page }) => {
  const failures = collectConsoleFailures(page);

  await page.goto("/demo/timeline");
  const memberPreview = page.locator(".trip-header-member-preview");

  await expect(memberPreview).toHaveAttribute("aria-label", "成員與邀請");
  await expect(memberPreview).toHaveAttribute("title", "成員與邀請");
  await expect(memberPreview.locator(".member-avatar.compact")).toHaveCount(5);
  await expect(memberPreview.locator(".member-avatar.more")).toHaveText("+1");
  await memberPreview.click();

  await expect(page.locator(".members-dialog")).toBeVisible();
  await expect(page.locator(".members-dialog h2")).toHaveText("成員與邀請");
  await expect(page.locator(".members-dialog-section")).toHaveCount(3);
  await page.locator(".members-dialog .ghost-button").click();
  await expect(page.locator(".members-dialog")).toHaveCount(0);

  await page.locator(".trip-header-meta .trip-header-meta-action").last().click();
  await expect(page.locator(".members-dialog")).toBeVisible();
  await page.locator(".modal-backdrop").click({ position: { x: 8, y: 8 } });
  await expect(page.locator(".members-dialog")).toHaveCount(0);
  expect(failures).toEqual([]);
});

test("share route is public and does not show login for invalid token", async ({ page }) => {
  const failures = collectConsoleFailures(page);

  await page.route("**/rest/v1/rpc/get_share_snapshot", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: "null",
    });
  });

  await page.goto("/?share=e2e-invalid-token");

  await expect(page.getByRole("heading", { name: "無法開啟分享頁" })).toBeVisible();
  await expect(page.getByRole("button", { name: "使用 Google 登入" })).toHaveCount(0);
  expect(failures).toEqual([]);
});
