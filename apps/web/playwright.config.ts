import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import { assertNotProdSupabaseUrl } from "./lib/e2e/prod-guard";

/**
 * Resolve the Supabase URL the webServer's `pnpm dev` will actually use.
 * Next.js loads `.env.local` inside that child process, but this config
 * file runs standalone (no Next env loading) — so mirror the CI env var
 * when present, and otherwise hand-parse `.env.local` for local runs.
 * Dependency-free by design: no `dotenv` package, just a minimal KEY=VALUE
 * line parser good enough for this one variable.
 */
function resolveEffectiveSupabaseUrl(): string | undefined {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  const envLocalPath = resolve(__dirname, ".env.local");
  if (!existsSync(envLocalPath)) return undefined;

  const contents = readFileSync(envLocalPath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== "NEXT_PUBLIC_SUPABASE_URL") continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

// Hard-fail before any test (or the dev server under test) starts if the
// effective target is the production Supabase project. Prod data was already
// polluted once by e2e specs pointed at the wrong database — never again.
assertNotProdSupabaseUrl(resolveEffectiveSupabaseUrl());

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
