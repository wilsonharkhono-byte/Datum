/**
 * Guard against Playwright ever running against the production Supabase
 * project. Prod data was previously polluted with "E2E test note …" rows
 * written by e2e specs pointed at the wrong database — this closes that hole
 * by hard-failing BEFORE any test (or the dev server under test) runs.
 *
 * Pure and dependency-free so it's usable from both playwright.config.ts
 * (at config-load time, before the webServer starts) and vitest.
 */

/** The DATUM production Supabase project ref. Never let e2e tests target it. */
export const PROD_SUPABASE_REF = "nsmyazmxwdvwtdtqjrpx";

/**
 * Throws when `supabaseUrl` looks like it points at the production Supabase
 * project. Safe to call with `undefined`/local/other-project URLs — those are
 * left alone.
 */
export function assertNotProdSupabaseUrl(supabaseUrl: string | undefined): void {
  if (!supabaseUrl) return;
  if (!supabaseUrl.toLowerCase().includes(PROD_SUPABASE_REF.toLowerCase())) return;

  throw new Error(
    "REFUSING TO RUN E2E TESTS AGAINST PRODUCTION.\n" +
      `NEXT_PUBLIC_SUPABASE_URL resolves to the prod Supabase project (ref "${PROD_SUPABASE_REF}").\n` +
      "Playwright specs write and delete data (e2e-tester notes, cards, events) — running them here " +
      "will pollute real project data again, like it already has once.\n" +
      "Point NEXT_PUBLIC_SUPABASE_URL / apps/web/.env.local at the local Supabase stack " +
      "(http://127.0.0.1:55321) or a disposable/staging project before running `pnpm test:e2e`.\n\n" +
      "MENOLAK MENJALANKAN E2E TEST KE DATABASE PRODUKSI.\n" +
      "NEXT_PUBLIC_SUPABASE_URL mengarah ke project Supabase produksi — ini akan mengotori data asli lagi. " +
      "Arahkan ke stack Supabase lokal atau project staging sebelum menjalankan test e2e.",
  );
}
