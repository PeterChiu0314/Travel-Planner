import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const styleSource = readFileSync("src/styles.css", "utf8");
const designColorTokenSource = readFileSync("src/lib/designColorTokens.js", "utf8");

test("formal UI exposes the DESIGN.md semantic color tokens", () => {
  const requiredTokens = [
    "--color-bg: #fcfbf7;",
    "--color-surface: #fcfbf7;",
    "--color-surface-subtle: #eeece5;",
    "--color-primary: #325248;",
    "--color-primary-hover: #436b5e;",
    "--color-primary-foreground: #ffffff;",
    "--color-accent: #755d43;",
    "--color-text: #2d312f;",
    "--color-text-secondary: #68706b;",
    "--color-text-muted: #66716b;",
    "--color-border: #d9d8d1;",
    "--color-error: #d25b51;",
    "--color-warning: #ab7a2b;",
    "--color-success: #3f654f;",
    "--color-info: #486b6d;",
    "--color-type-attraction: #82674a;",
    "--color-type-food: #cb8848;",
    "--color-type-hotel: #ac6885;",
    "--color-type-transport: #708e8f;",
    "--color-type-note: #6e6e6e;",
  ];

  for (const token of requiredTokens) {
    expect(styleSource).toContain(token);
  }
});

test("formal UI keeps legacy neutral aliases while using semantic colors for shared chrome", () => {
  expect(styleSource).toContain("--ink: var(--color-text);");
  expect(styleSource).toContain("--muted: var(--color-text-secondary);");
  expect(styleSource).toContain("--line: var(--color-border);");
  expect(styleSource).toContain("--paper: var(--color-bg);");
  expect(styleSource).toContain("--panel: var(--color-surface);");
  expect(styleSource).toMatch(/\.brand-mark\s*\{[\s\S]*?background:\s*var\(--color-primary\);/);
  expect(styleSource).toMatch(/\.primary-button\s*\{[\s\S]*?background:\s*var\(--color-primary\);/);
  expect(styleSource).toMatch(/\.trip-header-title-error\s*\{[\s\S]*?color:\s*var\(--color-error\);/);
});

test("Timeline and Map share the semantic type and status palette", () => {
  for (const token of [
    'primary: "#325248"',
    'error: "#d25b51"',
    'warning: "#ab7a2b"',
    'success: "#3f654f"',
    'info: "#486b6d"',
    'attraction: "#82674a"',
    'food: "#cb8848"',
    'hotel: "#ac6885"',
    'transport: "#708e8f"',
    'note: "#6e6e6e"',
  ]) {
    expect(designColorTokenSource).toContain(token);
  }

  expect(styleSource).toMatch(/\.section-nav-button\s*\{[\s\S]*?letter-spacing:\s*0\.04em;/);
});

test("existing Timeline and Map liquid-glass effect contracts remain intact", () => {
  expect(styleSource).toContain("--map-glass-bg: rgba(255, 255, 255, 0.4);");
  expect(styleSource).toContain("--map-glass-bg-fallback: rgba(20, 55, 46, 0.92);");
  expect(styleSource).toContain("--map-glass-border: rgba(255, 255, 255, 0.55);");
  expect(styleSource).toContain("--map-glass-blur: 8px;");
  expect(styleSource).toContain("--map-glass-saturation: 140%;");
  expect(styleSource).toContain("backdrop-filter: blur(var(--map-glass-blur)) saturate(var(--map-glass-saturation));");
});

test("formal login renders the semantic palette without console errors", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.locator(".login-panel")).toBeVisible();

  const rendered = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const panel = getComputedStyle(document.querySelector(".login-panel"));
    return {
      primary: root.getPropertyValue("--color-primary").trim(),
      text: root.getPropertyValue("--color-text").trim(),
      surface: root.getPropertyValue("--color-surface").trim(),
      error: root.getPropertyValue("--color-error").trim(),
      mapGlassBlur: root.getPropertyValue("--map-glass-blur").trim(),
      mapGlassSaturation: root.getPropertyValue("--map-glass-saturation").trim(),
      bodyColor: body.color,
      panelBackground: panel.backgroundColor,
      panelBorder: panel.borderColor,
    };
  });

  expect(rendered).toMatchObject({
    primary: "#325248",
    text: "#2d312f",
    surface: "#fcfbf7",
    error: "#d25b51",
    mapGlassBlur: "8px",
    mapGlassSaturation: "140%",
    bodyColor: "rgb(45, 49, 47)",
    panelBorder: "rgb(217, 216, 209)",
  });
  expect(rendered.panelBackground).toMatch(/0\.92\)$/);
  expect(errors).toEqual([]);
});
