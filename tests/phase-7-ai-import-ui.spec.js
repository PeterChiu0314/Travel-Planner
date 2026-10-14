import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { buildAiItineraryCreatePrompt, buildAiItineraryUsageInstructions, buildBlankAiItineraryTemplate } from "../src/lib/aiItineraryAdapters.js";

const validFixture = JSON.parse(readFileSync("tests/fixtures/manual/phase-7-ai-valid-complete.json", "utf8"));

async function prepareHarness(page) {
  await page.goto("/");
}

async function mountExchangeDialog(page, { document = validFixture, fileName = "京都-ai-itinerary-v1.json", mode = "revise_copy" } = {}) {
  await page.evaluate(async ({ fileName: downloadName, mode: exchangeMode, payload }) => {
    const [React, ReactDom, module] = await Promise.all([
      import("/@id/react"),
      import("/@id/react-dom/client"),
      import("/src/components/trip-import/AiTripExchangeDialog.jsx"),
    ]);
    window.__dialogRoot?.unmount();
    window.document.querySelector("#root").hidden = true;
    const rootElement = window.document.querySelector("#qa-dialog-root") || window.document.body.appendChild(Object.assign(window.document.createElement("div"), { id: "qa-dialog-root" }));
    rootElement.replaceChildren();
    window.__copied = "";
    window.__importFiles = [];
    window.__backCount = 0;
    window.__closeCount = 0;
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { window.__copied = value; } },
    });
    const ReactApi = React.default || React;
    const ReactDomApi = ReactDom.default || ReactDom;
    window.__dialogRoot = ReactDomApi.createRoot(rootElement);
    window.__dialogRoot.render(ReactApi.createElement(module.default, {
      document: payload,
      fileName: downloadName,
      mode: exchangeMode,
      onBack: () => { window.__backCount += 1; },
      onClose: () => { window.__closeCount += 1; },
      onImportFile: async (file) => {
        window.__importFiles.push({ name: file.name, text: await file.text(), type: file.type });
      },
    }));
  }, { fileName, mode, payload: document });
  await expect(page.getByRole("heading", { name: mode === "create" ? "AI 規劃" : "給 AI 調整", exact: true })).toBeVisible();
}

test("existing Trip exchange imports JSON directly without a paste dialog", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareHarness(page);
  await mountExchangeDialog(page);

  await expect(page.getByText("匯入後建立新旅程，原旅程不變。", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "貼上 AI 回覆" })).toHaveCount(0);
  await expect(page.getByText("貼上 AI 行程", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("給 AI 的提示詞")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "只複製 JSON" })).toHaveCount(0);
  await expect(page.getByLabel("AI 行程 JSON")).toHaveCount(0);
  await page.getByRole("button", { name: "複製給 AI 的提示詞", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("給 AI 的提示詞已複製。");
  const copied = await page.evaluate(() => window.__copied);
  expect(copied).toBe(buildAiItineraryUsageInstructions(validFixture));
  expect(copied).not.toContain(validFixture.trip.title);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載旅程 JSON", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("京都-ai-itinerary-v1.json");
  expect(JSON.parse(readFileSync(await download.path(), "utf8"))).toEqual(validFixture);

  await page.getByLabel("選擇行程 JSON 檔案").setInputFiles({
    name: "ai-result.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(validFixture)),
  });
  await expect.poll(() => page.evaluate(() => window.__importFiles)).toEqual([
    expect.objectContaining({ name: "ai-result.json", type: "application/json" }),
  ]);
  await page.screenshot({ path: testInfo.outputPath("ai-exchange-unified-import-desktop.png") });
});

test("AI planning returns to New Trip instead of exposing a second import action", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareHarness(page);
  await mountExchangeDialog(page, {
    document: buildBlankAiItineraryTemplate(),
    fileName: "travel-studio-ai-itinerary-template-v1.json",
    mode: "create",
  });

  await expect(page.getByText("使用你慣用的 AI 規劃，再將行程帶回旅程工房。")).toBeVisible();
  await expect(page.getByRole("button", { name: "貼上 AI 回覆" })).toHaveCount(0);
  await expect(page.getByLabel("選擇行程 JSON 檔案")).toHaveCount(0);
  await expect(page.getByLabel("給 AI 的提示詞")).not.toBeVisible();
  await page.getByRole("button", { name: "複製給 AI 的提示詞", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__copied)).toBe(buildAiItineraryCreatePrompt());
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載模板 JSON", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("travel-studio-ai-itinerary-template-v1.json");
  expect(JSON.parse(readFileSync(await download.path(), "utf8"))).toEqual(buildBlankAiItineraryTemplate());
  await page.getByRole("button", { name: "返回" }).click();
  await expect.poll(() => page.evaluate(() => window.__backCount)).toBe(1);
  const dimensions = await page.evaluate(() => ({
    clientWidth: window.document.documentElement.clientWidth,
    scrollWidth: window.document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await page.screenshot({ path: testInfo.outputPath("ai-planning-unified-import-mobile.png") });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`AI planning explains the three steps without overflow at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await prepareHarness(page);
    await mountExchangeDialog(page, { document: buildBlankAiItineraryTemplate(), mode: "create" });

    const dialog = page.getByRole("dialog", { name: "AI 規劃", exact: true });
    const steps = dialog.getByRole("list", { name: "AI 規劃步驟" });
    await expect(steps.getByRole("listitem")).toHaveCount(3);
    await expect(steps.getByRole("heading", { level: 3 })).toHaveText([
      "準備給 AI 的資料", "交給 AI 規劃", "把行程帶回來",
    ]);
    await expect(steps.getByRole("listitem").nth(0)).toContainText("兩項都要交給 AI");
    await expect(steps.getByRole("listitem").nth(0).getByRole("button")).toHaveCount(2);
    await expect(steps.getByRole("listitem").nth(1)).toContainText("上傳模板檔案、貼上提示詞");
    await expect(steps.getByRole("listitem").nth(1)).toContainText("已經討論好的行程");
    await expect(steps.getByRole("listitem").nth(2)).toContainText("在「新增旅程」選擇「匯入」");
    await expect(dialog.getByRole("button", { name: "匯入 JSON", exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel("給 AI 的提示詞")).not.toBeVisible();

    const bounds = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: element.clientWidth, scrollWidth: element.scrollWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(viewport.width);
    expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
    await dialog.getByRole("button", { name: "返回", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__backCount)).toBe(1);
    expect(await page.evaluate(() => window.__closeCount)).toBe(0);
  });
}

test("expanded AI prompt remains keyboard accessible and the footer stays reachable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await prepareHarness(page);
  await mountExchangeDialog(page, { document: buildBlankAiItineraryTemplate(), mode: "create" });
  const dialog = page.getByRole("dialog", { name: "AI 規劃", exact: true });
  const disclosure = dialog.locator("summary");
  await disclosure.press("Enter");
  await expect(dialog.getByLabel("給 AI 的提示詞")).toBeVisible();
  await expect(dialog.getByLabel("給 AI 的提示詞")).toHaveValue(buildAiItineraryCreatePrompt());
  await expect(dialog.getByLabel("給 AI 的提示詞")).toHaveAttribute("readonly", "");
  const bounds = await dialog.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width);
  await dialog.getByRole("button", { name: "關閉", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__closeCount)).toBe(1);
  expect(await page.evaluate(() => window.__backCount)).toBe(0);
});

test("clipboard failure exposes only the prompt for manual copying, without another dialog", async ({ page }) => {
  await prepareHarness(page);
  await mountExchangeDialog(page, { document: buildBlankAiItineraryTemplate(), mode: "create" });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
  });
  await page.getByRole("button", { name: "複製給 AI 的提示詞", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("瀏覽器無法存取剪貼簿");
  await expect(page.getByLabel("給 AI 的提示詞")).toBeVisible();
  await expect(page.getByLabel("給 AI 的提示詞")).toHaveValue(buildAiItineraryCreatePrompt());
  await page.getByText("查看給 AI 的提示詞", { exact: true }).click();
  await expect(page.getByLabel("給 AI 的提示詞")).not.toBeVisible();
});

test("App auto-detects both JSON contracts before one atomic confirmation path", async ({ page }) => {
  const source = readFileSync("src/App.jsx", "utf8");
  const previewBody = source.match(/async function previewTripImport\(file\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  async function confirmTripImport/)?.[1] || "";
  const confirmBody = source.match(/async function confirmTripImport\(\) \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  async function updateTrip/)?.[1] || "";

  expect(previewBody).toContain("parseUnifiedTripJsonText(text)");
  expect(previewBody).toContain("sourceDocumentType: parsed.sourceDocumentType");
  expect(previewBody).not.toContain("supabase.");
  expect(confirmBody.match(/supabase\.rpc\("import_trip_timeline_v1"/g)).toHaveLength(1);
  expect(source).not.toContain("AiTripImportDialog");
  expect(source).not.toContain("aiTripImportMode");
  expect(source).toContain('aria-label="AI 規劃"');
  const planningButton = source.match(/<button\s+aria-label="AI 規劃"[\s\S]*?<\/button>/)?.[0] || "";
  expect(planningButton).toContain('<Bot aria-hidden="true" size={18} />');
  expect(planningButton).toContain("<span>AI規劃</span>");
  expect(planningButton).toContain("onClick={onImportAi}");
  expect(source).toContain("<FileUp");
  expect(source).toContain("returnFromAiTripCreateExchange");
  expect(source).toContain('<TripImportPreviewBoard days={preview?.days} trip={trip} />');
  expect(source).not.toContain("isAiImport");
  expect(source).not.toContain("ai-trip-import-summary");
  expect(existsSync("src/components/trip-import/AiTripImportDialog.jsx")).toBe(false);

  await page.goto("/demo/timeline");
  await page.getByRole("button", { name: "更多操作" }).click();
  await expect(page.getByRole("menuitem", { name: "匯出 JSON" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "給 AI 調整" })).toHaveCount(0);
});
