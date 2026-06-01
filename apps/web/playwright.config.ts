import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Single worker: tests share the linked pilot DB and dev server; parallel
  // workers race on textarea focus + RLS-revalidation timing. Serial keeps
  // them deterministic. Re-enable parallel when we move to per-test DB resets.
  workers: 1,
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
