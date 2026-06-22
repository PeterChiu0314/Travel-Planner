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
  await expect(page.locator('.day-tab.active[data-day-index="0"]')).toHaveCount(1);
  await expect(page.locator('.timeline-day-column.active[data-day-index="0"]')).toHaveCount(1);
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

test("demo timed visit drag inserts destination content without moving time slots", async ({ page }) => {
  const failures = collectConsoleFailures(page);
  const supabaseRequests = collectSupabaseRequests(page);

  await page.goto("/demo/timeline");

  const source = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "平安出國停車場" }) });
  const target = page.locator(".timeline-item").filter({ has: page.getByRole("heading", { name: "關西機場" }) });
  await expect(source).toHaveCount(1);
  await expect(target).toHaveCount(1);

  await source.click();
  await source.getByTitle("編輯").click();
  await expect(page.locator('.timeline-item[draggable="true"]')).toHaveCount(0);
  await page.locator(".item-form").getByRole("button", { name: "取消" }).click();
  await expect(source).toHaveAttribute("draggable", "true");

  await source.dragTo(target);
  await expect(page.getByRole("heading", { name: "確認移動行程？" })).toBeVisible();
  await expect(page.getByText("移動行程卡後，部分交通卡可能會自動移除")).toBeVisible();
  await page.getByRole("button", { name: "確定" }).click();

  const firstSlot = page.locator(".timeline-item").filter({ hasText: "02:20" });
  const secondSlot = page.locator(".timeline-item").filter({ hasText: "06:40" });
  const thirdSlot = page.locator(".timeline-item").filter({ hasText: "11:30" });
  await expect(firstSlot.getByRole("heading", { name: "桃園機場" })).toBeVisible();
  await expect(secondSlot.getByRole("heading", { name: "平安出國停車場" })).toBeVisible();
  await expect(thirdSlot.getByRole("heading", { name: "關西機場" })).toBeVisible();
  await expect(firstSlot.locator(".time-block")).toContainText("02:20");
  await expect(secondSlot.locator(".time-block")).toContainText("06:40");
  await expect(thirdSlot.locator(".time-block")).toContainText("11:30");
  await expect(page.locator(".transport-warning-stack")).toHaveCount(0);

  await firstSlot.getByTitle("鎖定").click();
  await expect(page.locator('.timeline-item[draggable="true"]')).toHaveCount(0);
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
