// Requires the get_board_bundle migration to be applied (see plan Phase 1).
import { test, expect } from "@playwright/test";

test.describe("Project board (client cache)", () => {
  test("board paints from cache before a slow API resolves", async ({ page }) => {
    // 1) Sign in — same login/auth setup and project code as board.spec.ts.
    await page.goto("/login");
    await page.fill('input[name="email"]', "wilson@datum.local");
    await page.fill('input[name="password"]', "password123");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/");

    // Open the board once to seed the IndexedDB-backed query cache. Navigate via
    // the project-list link, matching board.spec.ts's flow.
    await expect(page.getByRole("link", { name: /BDG-H1/ })).toBeVisible();
    await page.getByRole("link", { name: /BDG-H1/ }).click();
    await page.waitForURL("**/project/BDG-H1");

    // The board header is an <h1> "{project_code} · {project_name}" (see
    // project/[slug]/page.tsx), so the project code matches the heading role.
    await expect(page.getByRole("heading", { name: /BDG-H1/ })).toBeVisible();

    // 2) Make the board API slow (~3s), then reload. The persisted cache should
    // hydrate the board immediately while this request is still in flight.
    await page.route("**/api/board/**", async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });

    const start = Date.now();
    await page.reload();

    // 3) Cached content paints well under the 3s API delay, and the whole revisit
    // settles in under 2.5s — proving the board renders without waiting on the API.
    await expect(page.getByRole("heading", { name: /BDG-H1/ })).toBeVisible({ timeout: 1200 });
    expect(Date.now() - start).toBeLessThan(2500);
  });
});
