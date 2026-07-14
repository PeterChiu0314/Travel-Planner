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

async function openDemoNewVisitForm(page, title, startTime, endTime) {
  await page.locator(".timeline-add-button").click();
  const form = page.locator(".timeline-day-column.active .item-form:not(.transport-editor-form)");
  await form.locator('input[name="location_name"]').fill(title);
  if (startTime !== null) await form.locator('select[name="start_time"]').selectOption(startTime);
  if (endTime !== null) await form.locator('select[name="end_time"]').selectOption(endTime);
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
      expect(metrics.boardPadding).toBe("0px 10px 5px 14px");
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
  expect(await header.locator(".trip-header-main").evaluate((element) => getComputedStyle(element).gap)).toBe("2px");

  await titleButton.click();
  const titleInput = header.locator(".trip-header-title-input");
  await expect(titleInput).toBeVisible();
  expect(await titleInput.evaluate((element) => getComputedStyle(element).fontSize)).toBe("24px");
  expect(await titleInput.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("500");
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
    await page.locator('select[name="end_time"]').selectOption("21:30");
    await page.locator(".item-form").getByRole("button", { name: "儲存" }).click();

    await page.getByRole("button", { name: "新增尾端交通" }).click({ force: true });
    await page.locator('input[name="transport_duration_minutes"]').fill(scenario.durationMinutes);
    await page.locator('input[name="transport_name"]').fill("前往下一站");
    await page.locator(".transport-editor-form").getByRole("button", { name: "保存" }).click();

    await expect(page.getByText("下一目的地尚未設定", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新增行程" }).click();
    const startTimeSelect = page.locator('select[name="start_time"]');
    await expect(startTimeSelect).toHaveValue(scenario.expectedStartTime);
    await startTimeSelect.selectOption("22:00");
    await expect(startTimeSelect).toHaveValue("22:00");
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
  await form.locator('select[name="start_time"]').selectOption("10:55");
  await form.locator('select[name="end_time"]').selectOption("11:20");
  await form.locator('button[type="submit"]').click();

  await expect(page.getByTestId("transport-pair-conflict-dialog")).toBeVisible();
  await expect(page.getByTestId("auto-continuation-dialog")).toHaveCount(0);
  await page.getByTestId("transport-pair-conflict-dialog").getByRole("button", { name: "恢復" }).click();
  await expect(form).toBeVisible();
  await expect(form.locator('select[name="start_time"]')).toHaveValue("10:55");
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
  await expect(form.getByRole("button")).toHaveText(["取消", "接續", "儲存"]);
  await expect(form.getByRole("button", { name: "接續", exact: true })).toBeDisabled();
  await form.locator('select[name="start_time"]').selectOption("02:30");
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
  await form.locator('select[name="start_time"]').selectOption("02:30");
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
  await form.locator('select[name="start_time"]').selectOption("02:30");
  await form.getByRole("button", { name: "接續", exact: true }).click();
  await page.getByTestId("auto-continuation-dialog").getByRole("button", { name: "取消" }).click();

  await expect(page.getByTestId("auto-continuation-dialog")).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(form.locator('select[name="start_time"]')).toHaveValue("02:30");
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
  await form.locator('select[name="end_time"]').selectOption("06:40");
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
