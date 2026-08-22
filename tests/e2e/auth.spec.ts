import { test, expect } from "@playwright/test";

const VALID_EMAIL = process.env.TEST_USER_EMAIL ?? "test@example.com";
const VALID_PASSWORD = process.env.TEST_USER_PASSWORD ?? "testpassword123";

test.describe("Login flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("page renders login form with Google button", async ({ page }) => {
    await expect(page.getByText("Welcome back")).toBeVisible();
    await expect(page.getByText("Continue with Google")).toBeVisible();
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
    await expect(page.getByPlaceholder("••••••••")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("invalid credentials shows error message", async ({ page }) => {
    await page.getByPlaceholder("you@company.com").fill("wrong@example.com");
    await page.getByPlaceholder("••••••••").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Error banner must appear — message varies (real: "Invalid login credentials", stub: network error)
    await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 8000 });

    // Must stay on /login
    await expect(page).toHaveURL(/\/login/);
  });

  test("valid credentials redirect to /dashboard", async ({ page }) => {
    test.skip(
      !process.env.TEST_USER_EMAIL,
      "Skipped: set TEST_USER_EMAIL and TEST_USER_PASSWORD env vars to run auth tests against a real Supabase project"
    );

    await page.getByPlaceholder("you@company.com").fill(VALID_EMAIL);
    await page.getByPlaceholder("••••••••").fill(VALID_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.getByText("Dashboard")).toBeVisible();
  });

  test("Enter key submits the form", async ({ page }) => {
    await page.getByPlaceholder("you@company.com").fill("wrong@example.com");
    await page.getByPlaceholder("••••••••").fill("wrongpassword");
    await page.getByPlaceholder("••••••••").press("Enter");

    await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 8000 });
  });

  test("sign up link navigates to /signup", async ({ page }) => {
    await page.getByRole("link", { name: "Sign up free" }).click();
    await expect(page).toHaveURL(/\/signup/);
  });

  test("logo link navigates to landing page", async ({ page }) => {
    await page.getByRole("link", { name: "give-to-get.com" }).click();
    await expect(page).toHaveURL("/");
  });
});
