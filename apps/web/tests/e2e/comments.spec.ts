import { test, expect } from "@playwright/test";

test("comment add → edit → soft-delete cycle on a card", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "wilson@datum.local");
  await page.fill('input[name="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");

  await page.getByRole("link", { name: /BDG-H1/ }).click();
  await page.getByText("Master bathroom").first().click();
  await page.waitForURL("**/cards/master-bathroom");

  // 1. Add
  const orig = `E2E komen ${Date.now()}`;
  const commentBox = page.getByPlaceholder(/Tambah komentar/i);
  await commentBox.fill(orig);
  await page.getByRole("button", { name: /Kirim komentar/i }).click();
  await expect(page.getByText(orig).first()).toBeVisible({ timeout: 10_000 });

  // 2. Edit
  const edited = `${orig} (diedit)`;
  // The comment list is an <ol> of <li> elements; find the li containing our text.
  // Use .last() because the new comment is appended at the end of the list.
  const commentRow = page.locator(`li:has-text("${orig}")`).last();
  await commentRow.getByText("edit").click();
  const editArea = commentRow.locator("textarea");
  await editArea.fill(edited);
  await commentRow.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText(edited).first()).toBeVisible({ timeout: 10_000 });

  // 3. Soft-delete: clicking "hapus" now shows an inline confirm strip (no browser dialog).
  const editedRow = page.locator(`li:has-text("${edited}")`).last();
  await editedRow.getByText("hapus").click();

  // Inline confirm strip should appear — click "Ya, hapus" to confirm deletion.
  await editedRow.getByRole("button", { name: /Ya, hapus/i }).click();

  // After soft-delete, the server re-renders the comment list excluding deleted rows.
  await expect(page.getByText(edited)).toHaveCount(0, { timeout: 10_000 });
});
