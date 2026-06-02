import { test, expect } from "@playwright/test";

test("adds a note event to Master bathroom card", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "wilson@datum.local");
  await page.fill('input[name="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");

  await page.getByRole("link", { name: /BDG-H1/ }).click();
  await page.waitForURL("**/project/BDG-H1");
  await page.getByText("Master bathroom").first().click();
  await page.waitForURL("**/cards/master-bathroom");

  // Open the event form
  await page.getByText("+ tambah aktivitas").click();

  // Default kind is "note" — fill the body
  const noteText = `E2E test note ${Date.now()}`;
  // Placeholder is "Tulis catatan…" (Indonesian ellipsis)
  const bodyTextarea = page.getByPlaceholder(/Tulis catatan/i);
  await bodyTextarea.fill(noteText);

  // Submit
  await page.getByRole("button", { name: "Simpan" }).first().click();

  // The new note should appear in the timeline
  await expect(page.getByText(noteText).first()).toBeVisible({ timeout: 10_000 });
});
