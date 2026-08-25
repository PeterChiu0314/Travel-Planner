import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildBlankAiItineraryTemplate } from "../src/lib/aiItineraryAdapters.js";

const validFixture = JSON.parse(readFileSync("tests/fixtures/manual/phase-7-ai-valid-complete.json", "utf8"));

function uiDocument() {
  const document = structuredClone(validFixture);
  document.trip.end_date = document.trip.start_date;
  document.days = [{
    ...document.days[0],
    visits: [{ ...document.days[0].visits[0], alternatives: [] }],
    transports: [],
  }];
  return document;
}

async function prepareHarness(page) {
  await page.route(/wikimedia\.org|wikipedia\.org/, async (route) => {
    await route.fulfill({ contentType: "application/json", json: { query: { pages: {} } } });
  });
  await page.route("https://maps.googleapis.com/**", async (route) => {
    await route.fulfill({
      contentType: "text/javascript",
      body: "google.maps.importLibrary = async () => ({}); google.maps.__ib__();",
    });
  });
  await page.goto("/");
}

async function mountImportDialog(page, document = uiDocument(), { mockPlaces = false, mode = "create" } = {}) {
  await page.evaluate(async ({ mockPlaces, mode: exchangeMode, payload }) => {
    const [React, ReactDom, module] = await Promise.all([
      import("/@id/react"),
      import("/@id/react-dom/client"),
      import("/src/components/trip-import/AiTripImportDialog.jsx"),
    ]);
    window.__dialogRoot?.unmount();
    window.document.querySelector("#root").hidden = true;
    const rootElement = window.document.querySelector("#qa-dialog-root") || window.document.body.appendChild(Object.assign(window.document.createElement("div"), { id: "qa-dialog-root" }));
    rootElement.replaceChildren();
    window.__importCalls = [];
    window.__closeCalls = 0;
    window.__importResult = { ok: true, tripId: "qa-trip" };
    window.__placeQueries = [];
    const placePrediction = (id, mainText, secondaryText, latitude, longitude) => ({
      placeId: id,
      mainText: { text: mainText },
      secondaryText: { text: secondaryText },
      text: { text: `${mainText} ${secondaryText}` },
      toPlace: () => ({
        id,
        displayName: mainText,
        location: { lat: () => latitude, lng: () => longitude },
        googleMapsURI: `https://www.google.com/maps?q=${latitude},${longitude}`,
        fetchFields: async () => {},
      }),
    });
    const mockPlacesApi = mockPlaces ? {
      AutocompleteSessionToken: class AutocompleteSessionToken {},
      AutocompleteSuggestion: {
        fetchAutocompleteSuggestions: async ({ input }) => {
          window.__placeQueries.push(input);
          const predictions = input === "京都 清水寺 本堂"
            ? [placePrediction("kiyomizu-selected", "清水寺", "京都府京都市東山區", 34.9948561, 135.7850463)]
            : [
              placePrediction("kiyomizu-kyoto", "清水寺", "京都府京都市東山區", 34.9948561, 135.7850463),
              placePrediction("kiyomizu-shizuoka", "清水寺", "静岡県静岡市", 35.033, 138.111),
            ];
          return { suggestions: predictions.map((prediction) => ({ placePrediction: prediction })) };
        },
      },
    } : null;
    const ReactApi = React.default || React;
    const ReactDomApi = ReactDom.default || ReactDom;
    window.__dialogRoot = ReactDomApi.createRoot(rootElement);
    window.__dialogRoot.render(ReactApi.createElement(module.default, {
      ...(mockPlaces ? { loadPlacesApi: async () => mockPlacesApi } : {}),
      mode: exchangeMode,
      onClose: () => { window.__closeCalls += 1; },
      onImport: async (formalDocument) => {
        window.__importCalls.push(formalDocument);
        return window.__importResult;
      },
    }));
    window.__aiFixture = payload;
  }, { mockPlaces, mode, payload: document });
  await expect(page.getByRole("heading", { name: "貼上 AI 行程" })).toBeVisible();
}

async function mountExchangeDialog(page, { document = uiDocument(), fileName = "京都-ai-itinerary-v1.json", mode = "revise_copy" } = {}) {
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
    window.__openImportCalls = 0;
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
      onClose: () => {},
      onOpenImport: () => { window.__openImportCalls += 1; },
    }));
  }, { fileName, mode, payload: document });
  await expect(page.getByRole("heading", { name: mode === "create" ? "AI 規劃" : "給 AI 調整" })).toBeVisible();
}

test("AI paste flow renders a compact blocking state without Hero, map, or confirm", async ({ page }, testInfo) => {
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareHarness(page);
  await mountImportDialog(page);

  await page.getByLabel("AI 回覆").fill("這不是 JSON");
  await page.getByRole("button", { name: "解析並預覽" }).click();

  await expect(page.getByRole("alert")).toContainText("無法匯入這份 AI 行程");
  await expect(page.locator(".trip-import-preview-board")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "確認匯入" })).toHaveCount(0);
  await expect(page.locator(".ai-place-resolution-panel")).toHaveCount(0);
  await page.getByText(/^查看細節/).click();
  await expect(page.getByRole("alert")).toContainText("找不到一份完整且可辨識的 JSON 物件");
  const box = await page.locator(".ai-import-dialog").boundingBox();
  expect(box.height).toBeLessThan(360);
  expect(consoleErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("ai-import-blocking-desktop.png") });
});

test("missing coordinates show the existing warning without blocking import and RPC errors stay compact", async ({ page }, testInfo) => {
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareHarness(page);
  const document = uiDocument();
  document.days[0].visits[0].location = null;
  await mountImportDialog(page, document);

  await page.getByLabel("AI 回覆").fill(`以下是你的行程：\n\`\`\`json\n${JSON.stringify(document)}\n\`\`\``);
  await page.getByRole("button", { name: "解析並預覽" }).click();

  await expect(page.getByRole("status")).toContainText("尚有 1 個目的地缺少可用座標");
  await expect(page.locator(".trip-import-preview-board")).toHaveCount(0);
  await expect(page.locator(".ai-place-resolution-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "確認匯入" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("ai-import-missing-coordinate-desktop.png") });

  await page.evaluate(() => { window.__importResult = { ok: false, error: { message: "原子 RPC 測試失敗" } }; });
  await page.getByRole("button", { name: "確認匯入" }).click();
  await expect(page.getByRole("alert")).toContainText("原子 RPC 測試失敗");
  await expect(page.locator(".trip-import-preview-board")).toHaveCount(0);
  const imported = await page.evaluate(() => window.__importCalls);
  expect(imported).toHaveLength(1);
  expect(imported[0]).toMatchObject({ document_type: "travel_studio_trip", schema_version: "1" });
  expect(imported[0].days[0].visits[0].location).toEqual({ name: null, map_url: null, latitude: null, longitude: null });
  expect(consoleErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("ai-import-rpc-error-desktop.png") });
});

test("AI import preview stays usable at a mobile viewport without horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareHarness(page);
  const document = uiDocument();
  document.days[0].visits[0].location = null;
  await mountImportDialog(page, document);
  await page.getByLabel("AI 回覆").fill(JSON.stringify(document));
  await page.getByRole("button", { name: "解析並預覽" }).click();

  await expect(page.getByRole("status")).toContainText("尚有 1 個目的地缺少可用座標");
  await expect(page.locator(".trip-import-preview-board")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "確認匯入" })).toBeEnabled();
  const dimensions = await page.evaluate(() => ({
    clientWidth: window.document.documentElement.clientWidth,
    scrollWidth: window.document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await page.screenshot({ path: testInfo.outputPath("ai-import-preview-mobile.png") });
});

test("provided coordinates are preserved without Places requests or map preview", async ({ page }, testInfo) => {
  const googleRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("maps.googleapis.com")) googleRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareHarness(page);
  const document = uiDocument();
  document.days[0].visits[0].location = {
    name: "清水寺",
    map_url: "https://www.google.com/maps?q=34.9948561,135.7850463",
    latitude: 34.9948561,
    longitude: 135.7850463,
  };
  await mountImportDialog(page, document);
  await page.getByLabel("AI 回覆").fill(JSON.stringify(document));
  await page.getByRole("button", { name: "解析並預覽" }).click();

  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator(".ai-place-resolution-panel")).toHaveCount(0);
  await expect(page.locator(".trip-import-preview-board")).toHaveCount(0);
  const confirmButton = page.getByRole("button", { name: "確認匯入" });
  await expect(confirmButton).toBeEnabled();
  expect(googleRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("ai-import-coordinate-ready-desktop.png") });
  await confirmButton.click();
  const imported = await page.evaluate(() => window.__importCalls);
  expect(imported).toHaveLength(1);
  expect(imported[0].days[0].visits[0].location).toMatchObject({
    name: "清水寺",
    latitude: 34.9948561,
    longitude: 135.7850463,
    map_url: "https://www.google.com/maps?q=34.9948561,135.7850463",
  });
  expect(imported[0].days[0].visits[0].location).not.toHaveProperty("address");
});

test("existing Trip exchange is labeled as an AI adjustment that creates a new Trip", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareHarness(page);
  await mountExchangeDialog(page);

  await expect(page.getByText("貼回後建立新旅程，原旅程不變。")).toBeVisible();
  await expect(page.getByText("給 AI 的提示詞", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "複製給 AI" }).click();
  await expect(page.getByRole("status")).toHaveText("給 AI 的提示詞與目前旅程 JSON 已複製。");
  const copied = await page.evaluate(() => window.__copied);
  expect(copied).toContain("不要輸出 address 或 Place ID");
  expect(copied).toContain('"document_type": "travel_studio_ai_itinerary"');
  expect(copied).not.toContain("OpenAI");
  expect(copied).not.toContain("Gemini");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載 JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("京都-ai-itinerary-v1.json");
  await page.getByRole("button", { name: "貼上 AI 回覆" }).click();
  expect(await page.evaluate(() => window.__openImportCalls)).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("ai-exchange-desktop.png") });
});

test("AI planning downloads a blank JSON template without rendering or copying JSON text", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepareHarness(page);
  await mountExchangeDialog(page, {
    document: buildBlankAiItineraryTemplate(),
    fileName: "travel-studio-ai-itinerary-template-v1.json",
    mode: "create",
  });

  await expect(page.getByText("下載模板，交給 AI 規劃後貼回。")).toBeVisible();
  await expect(page.getByLabel("AI 行程 JSON")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "只複製 JSON" })).toHaveCount(0);
  await expect(page.getByText("查看 AI JSON")).toHaveCount(0);

  await page.getByRole("button", { name: "複製給 AI 的提示詞" }).click();
  await expect(page.getByRole("status")).toHaveText("給 AI 的提示詞已複製。");
  const copied = await page.evaluate(() => window.__copied);
  expect(copied).toContain("先向使用者提問");
  expect(copied).not.toContain('"trip": {');

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下載模板 JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("travel-studio-ai-itinerary-template-v1.json");
  await page.getByRole("button", { name: "貼上 AI 回覆" }).click();
  expect(await page.evaluate(() => window.__openImportCalls)).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("ai-planning-template-desktop.png") });
});

test("Demo keeps AI actions hidden while Formal source reuses only the existing atomic import RPC", async ({ page }) => {
  await page.goto("/demo/timeline");
  await page.getByRole("button", { name: "更多操作" }).click();
  await expect(page.getByRole("menuitem", { name: "匯出 JSON" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "給 AI 調整" })).toHaveCount(0);

  const source = readFileSync("src/App.jsx", "utf8");
  const importBody = source.match(/async function importAiTripDocument\([^)]*\) \{([\s\S]*?)\n  \}/)?.[1] || "";
  expect(importBody.match(/supabase\.rpc\("import_trip_timeline_v1"/g)).toHaveLength(1);
  expect(importBody).not.toMatch(/supabase\.(?:from|functions\.invoke)\(/);
  expect(source).toContain("onAiExchange={openAiTripRevisionExchange}");
  expect(source).toContain("AI 規劃");
});
