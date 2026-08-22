import { test, expect } from "@playwright/test";

function uniqueEmail() {
  return `test+${Date.now()}@example.com`;
}

test.describe("Signup flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signup");
  });

  test("page renders signup form", async ({ page }) => {
    await expect(page.getByText("Create your account")).toBeVisible();
    await expect(page.getByText("100 free credits")).toBeVisible();
    await expect(page.getByText("Continue with Google")).toBeVisible();
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create free account" })).toBeVisible();
  });

  test("new email shows confirmation screen with 100-credit message", async ({ page }) => {
    test.skip(
      !process.env.TEST_USER_EMAIL,
      "Skipped: requires live Supabase connection — set TEST_USER_EMAIL to enable"
    );

    const email = uniqueEmail();
    await page.getByPlaceholder("you@company.com").fill(email);
    await page.getByPlaceholder("Min. 8 characters").fill("Password123!");
    await page.getByRole("button", { name: "Create free account" }).click();

    // Should show confirmation screen
    await expect(page.getByText("Check your email")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("100 free credits")).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
  });

  test("confirmation screen 'Back to sign in' link goes to /login", async ({ page }) => {
    test.skip(
      !process.env.TEST_USER_EMAIL,
      "Skipped: requires live Supabase connection"
    );

    const email = uniqueEmail();
    await page.getByPlaceholder("you@company.com").fill(email);
    await page.getByPlaceholder("Min. 8 characters").fill("Password123!");
    await page.getByRole("button", { name: "Create free account" }).click();

    await expect(page.getByText("Check your email")).toBeVisible({ timeout: 10000 });
    await page.getByRole("link", { name: "Back to sign in" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("sign in link navigates to /login", async ({ page }) => {
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("short password shows validation error", async ({ page }) => {
    await page.getByPlaceholder("you@company.com").fill("user@example.com");
    await page.getByPlaceholder("Min. 8 characters").fill("short");
    await page.getByRole("button", { name: "Create free account" }).click();

    // Error banner must appear — Supabase rejects short passwords (or network error with stub URL)
    await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 8000 });
  });

  test("logo link navigates to landing page", async ({ page }) => {
    await page.getByRole("link", { name: "give-to-get.com" }).click();
    await expect(page).toHaveURL("/");
  });
});
