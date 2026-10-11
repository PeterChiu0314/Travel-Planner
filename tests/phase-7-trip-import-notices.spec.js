import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildTripImportNotices } from "../src/lib/tripImportNotices.js";
import { buildAiItineraryPromptExample } from "../src/lib/aiItineraryAdapters.js";
import { parseUnifiedTripJsonText } from "../src/lib/unifiedTripJsonImport.js";

const pendingDraftWarnings = [
  { code: "untimed_visit", path: "$.days[0].visits[0].schedule", message: "「抵達機場」是 Untimed 行程。" },
  { code: "untimed_visit", path: "$.days[0].visits[1].schedule", message: "「住宿入住」是 Untimed 行程。" },
  { code: "untimed_alternative", path: "$.days[0].visits[2].alternatives[0].schedule", message: "備案是 Untimed。" },
  { code: "untimed_alternative", path: "$.days[1].visits[0].alternatives[0].schedule", message: "備案是 Untimed。" },
  { code: "untimed_visit", path: "$.days[6].visits[0].schedule", message: "「機場候機」是 Untimed 行程。" },
  ...[0, 1, 2].map((index) => ({ code: "suspended_transport", path: `$.days[0].transports[${index}]`, message: "此交通會保留，但因未設定時間行程而暫停參與 Phase 6 排程。" })),
  { code: "missing_coordinates", path: "$.days", message: "尚有 5 個目的地缺少可用座標" },
];

test("pending flight/hotel times become one neutral note instead of repeated warnings", () => {
  const original = structuredClone(pendingDraftWarnings);
  expect(buildTripImportNotices(pendingDraftWarnings)).toEqual({
    draftNote: "部分行程尚未設定時間，匯入後可再安排；行程與交通都會保留。",
    reminders: ["尚有 5 個目的地缺少可用座標，可在匯入後補上位置。"],
  });
  expect(pendingDraftWarnings).toEqual(original);
});

test("untimed alternatives and successful continuation alone need no reminder", () => {
  expect(buildTripImportNotices([
    { code: "untimed_alternative", message: "備案是 Untimed。" },
    { code: "duration_auto_scheduled", message: "已自動接續。" },
  ])).toEqual({ draftNote: "", reminders: [] });
  expect(buildTripImportNotices()).toEqual({ draftNote: "", reminders: [] });
});

test("real unsafe continuation stays visible in one plain-language summary", () => {
  const warning = { code: "duration_schedule_conflict", path: "$.days[0].visits[1].schedule", message: "轉為 Untimed" };
  const result = buildTripImportNotices([
    warning, warning,
    { ...warning, path: "$.days[0].visits[2].schedule" },
    { code: "duration_without_anchor", path: "$.days[1].visits[0].schedule" },
  ]);
  expect(result.draftNote).toBeTruthy();
  expect(result.reminders).toEqual(["有 2 個行程的時間安排不下，已保留內容並暫不設定時間，可在匯入後調整。"]);
});

test("coordinate and location reminders do not duplicate and unknown warning types remain visible", () => {
  const result = buildTripImportNotices([
    ...pendingDraftWarnings,
    { code: "missing_location", message: "沒有地點" },
    { code: "missing_alternative_location", message: "沒有地點" },
    { code: "new_warning", message: "新的匯入提醒。" },
    { code: "new_warning", message: "新的匯入提醒。" },
  ]);
  expect(result.reminders).toEqual([
    "尚有 5 個目的地缺少可用座標，可在匯入後補上位置。",
    "新的匯入提醒。",
  ]);
  expect(buildTripImportNotices([{ code: "missing_coordinates" }]).reminders).toEqual(["部分目的地尚未設定位置，可在匯入後補上。"]);
});

test("empty and settled imports retain important reminders in plain language", () => {
  expect(buildTripImportNotices([
    { code: "empty_timeline" }, { code: "settled_trip" },
  ]).reminders).toEqual([
    "這份檔案尚未安排任何行程，匯入後會建立空白旅程。",
    "這份旅程已結算，匯入後會保留結算狀態，內容將鎖定。",
  ]);
});

test("simplifying presentation preserves raw diagnostics and blocking import validation", () => {
  const document = buildAiItineraryPromptExample();
  document.days[0].visits[0].schedule = { kind: "untimed" };
  const result = parseUnifiedTripJsonText(JSON.stringify(document));
  const before = structuredClone(result);
  const display = buildTripImportNotices(result.warnings);
  expect(display.draftNote).toBeTruthy();
  expect(display.reminders.join(" ")).not.toMatch(/Untimed|Phase 6|Timeline/);
  expect(result).toEqual(before);
  expect(result.ok).toBe(true);
  expect(result.warnings.some((issue) => issue.code === "duration_without_anchor")).toBe(true);

  const blocked = parseUnifiedTripJsonText(readFileSync("tests/fixtures/manual/phase-7-ai-blocking-error.json", "utf8"));
  expect(blocked.ok).toBe(false);
  expect(blocked.errors.some((issue) => issue.code === "fixed_requires_time")).toBe(true);
  const source = readFileSync("src/App.jsx", "utf8");
  expect(source).toContain("!hasBlockingError ? <TripImportNotices warnings={warnings} /> : null");
});

async function mountNotices(page, warnings) {
  await page.goto("/");
  await page.evaluate(async (issues) => {
    const [React, ReactDom, module] = await Promise.all([
      import("/@id/react"), import("/@id/react-dom/client"),
      import("/src/components/trip-import/TripImportNotices.jsx"),
    ]);
    document.querySelector("#root").hidden = true;
    const host = document.body.appendChild(document.createElement("div"));
    const element = (React.default || React).createElement;
    (ReactDom.default || ReactDom).createRoot(host).render(element("div", { className: "modal-backdrop" },
      element("section", { className: "dialog-card trip-import-preview-dialog", "aria-label": "匯入旅程預覽", style: { height: "auto" } },
        element("h2", null, "匯入旅程預覽"),
        element(module.default, { warnings: issues }),
      ),
    ));
  }, warnings);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`compact import reminders render without jargon or overflow at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mountNotices(page, pendingDraftWarnings);
    const preview = page.getByRole("region", { name: "匯入旅程預覽" });
    await expect(preview.getByText("部分行程尚未設定時間，匯入後可再安排；行程與交通都會保留。", { exact: true })).toBeVisible();
    await expect(preview.locator(".trip-import-issues li")).toHaveCount(1);
    await expect(preview).not.toContainText(/Untimed|Phase 6|Timeline/);
    await expect(preview.getByRole("alert")).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    await page.screenshot({ path: testInfo.outputPath(`import-notices-${viewport.width}.png`) });

    await mountNotices(page, pendingDraftWarnings.filter((issue) => issue.code !== "missing_coordinates"));
    await expect(page.locator(".trip-import-draft-note")).toBeVisible();
    await expect(page.locator(".trip-import-issues.warning")).toHaveCount(0);
  });
}
