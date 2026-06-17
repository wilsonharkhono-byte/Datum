import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Single worker: tests share the linked pilot DB and dev server; parallel
  // workers race on textarea focus + RLS-revalidation timing. Serial keeps
  // them deterministic. Re-enable parallel when we move to per-test DB resets.
  workers: 1,
  // Timing-sensitive specs (e.g. cache-paint budgets) can spike on a loaded CI
  // runner; a couple of retries absorbs transient variance without masking a
  // real, consistently-failing assertion.
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
