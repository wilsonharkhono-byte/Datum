import { test, expect } from "@playwright/test";

test.describe("Project board (read-only)", () => {
  test("logs in, opens BDG-H1 board, drills into Master bathroom card", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "wilson@datum.local");
    await page.fill('input[name="password"]', "password123");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/");

    // Project list
    await expect(page.getByRole("link", { name: /BDG-H1/ })).toBeVisible();
    await page.getByRole("link", { name: /BDG-H1/ }).click();
    await page.waitForURL("**/project/BDG-H1");

    // Board columns
    await expect(page.getByText("A09 — Detail Kamar Mandi")).toBeVisible();
    await expect(page.getByText("A05 — Kusen")).toBeVisible();

    // Drill into Master bathroom
    await page.getByText("Master bathroom").click();
    await page.waitForURL("**/cards/master-bathroom");

    // Timeline
    await expect(page.getByText("keputusan", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Statuario", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Pelebaran shower", { exact: false }).first()).toBeVisible();
  });
});
