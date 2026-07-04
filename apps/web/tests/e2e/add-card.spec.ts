import { test, expect } from "@playwright/test";

test("creates a new card via + tambah kartu in a column", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "wilson@datum.local");
  await page.fill('input[name="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");

  await page.getByRole("link", { name: /BDG-H1/ }).click();
  await page.waitForURL("**/project/BDG-H1");

  // Use a unique title (timestamp suffix) so this test is idempotent
  const title = `E2E test card ${Date.now()}`;

  // Find any "+ tambah kartu" button and click it (use .first() since every column has one).
  // Target the button by role: empty columns also render the literal text "+ tambah kartu"
  // inside a help paragraph, and getByText would match that inert <p> first.
  await page.getByRole("button", { name: "+ tambah kartu" }).first().click();

  // The form input has placeholder "Judul kartu — contoh..."
  const titleInput = page.getByPlaceholder(/Judul kartu/);
  await titleInput.fill(title);
  await page.getByRole("button", { name: "Simpan" }).click();

  // The new card should appear somewhere on the board
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
});
