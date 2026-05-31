import { test, expect } from "@playwright/test";

test("chat answers a question with an inline card snippet", async ({ page }) => {
  test.skip(!process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY not set");

  await page.goto("/login");
  await page.fill('input[name="email"]', "wilson@datum.local");
  await page.fill('input[name="password"]', "datum-pilot-2026");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");

  await page.getByRole("link", { name: /BDG-H1/ }).click();
  await page.waitForURL("**/project/BDG-H1");

  const input = page.getByPlaceholder("Tanya atau cari di kartu…");
  await input.fill("apa keputusan terakhir untuk master bath?");
  await page.getByRole("button", { name: "Kirim" }).click();

  // Allow up to 30s for the LLM round-trip
  await expect(page.getByText("Statuario", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  // The amber-bordered inline snippet shows the topic name
  await expect(page.getByText("A09 — Detail Kamar Mandi").first()).toBeVisible();
});
