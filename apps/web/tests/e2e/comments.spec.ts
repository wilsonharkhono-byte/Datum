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

test("@mention autocomplete suggests project members and posts the tag", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "wilson@datum.local");
  await page.fill('input[name="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");

  await page.getByRole("link", { name: /BDG-H1/ }).click();
  await page.getByText("Master bathroom").first().click();
  await page.waitForURL("**/cards/master-bathroom");

  // Typing "@car" opens the suggestion listbox filtered to matching project
  // members (Carissa is seeded onto BDG-H1).
  const marker = `E2E mention ${Date.now()}`;
  const commentBox = page.getByPlaceholder(/Tambah komentar/i);
  await commentBox.click();
  await commentBox.pressSequentially(`${marker} @car`);
  const option = page.getByRole("option", { name: /Carissa/i });
  await expect(option).toBeVisible();

  // Selecting inserts the @tag (handle when set, first name otherwise —
  // seeded staff have no handle, so the fallback tag is the first name).
  await option.click();
  await expect(commentBox).toHaveValue(new RegExp(`@[Cc]arissa\\s`));

  await page.getByRole("button", { name: /Kirim komentar/i }).click();
  await expect(page.getByText(marker).first()).toBeVisible({ timeout: 10_000 });

  // Clean up so reruns don't accumulate comments.
  const row = page.locator(`li:has-text("${marker}")`).last();
  await row.getByText("hapus").click();
  await row.getByRole("button", { name: /Ya, hapus/i }).click();
  await expect(page.getByText(marker)).toHaveCount(0, { timeout: 10_000 });
});
