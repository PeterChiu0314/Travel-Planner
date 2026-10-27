import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  publicDir: "design",
  // Explicit Preview-only QA build; normal production output omits this page.
  build: process.env.BUDGET_QA === "1" ? { rollupOptions: { input: { main: resolve("index.html"), budgetQA: resolve("tests/live-budget/index.html") } } } : undefined,
});
