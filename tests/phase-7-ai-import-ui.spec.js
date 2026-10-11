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
      onClose: () => {},
      onImportFile: async (file) => {
        window.__importFiles.push({ name: file.name, text: await file.text(), type: file.type });
      },
    }));
  }, { fileName, mode, payload: document });
  await expect(page.getByRole("heading", { name: mode === "create" ? "AI 規劃" : "給 AI 調整" })).toBeVisible();
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

  await expect(page.getByText("下載模板，交給 AI 規劃後匯入。")).toBeVisible();
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
