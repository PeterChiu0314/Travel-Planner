import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";

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

  await expect(page.getByText("Demo Mode：這是展示資料，操作不會永久保存。")).toBeVisible();
  await expect(page.getByRole("button", { name: "京都琵琶湖之旅-TEST，目前旅程" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的旅程" })).toBeVisible();
  await expect(page.getByText("Demo User")).toBeVisible();
  await expect(page.getByRole("heading", { name: "成田機場" })).toBeVisible();
  await expect(page.getByRole("button", { name: /隱藏地圖|顯示地圖/ })).toBeVisible();
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
