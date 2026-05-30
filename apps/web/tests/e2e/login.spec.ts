import { test, expect } from "@playwright/test";

test("Wilson can log in and sees the seeded project list", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("Masuk ke DATUM")).toBeVisible();

  await page.getByLabel("Email").fill("wilson@datum.local");
  await page.getByLabel("Kata sandi").fill("datum-pilot-2026");
  await page.getByRole("button", { name: "Masuk" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText("Proyek Aktif")).toBeVisible();
  await expect(page.getByText("BDG-H1")).toBeVisible();
  await expect(page.getByText("PKW-PC1012")).toBeVisible();
  await expect(page.getByText(/Wilson Harkhono.*principal/)).toBeVisible();
});
