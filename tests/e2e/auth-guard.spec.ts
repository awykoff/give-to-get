import { test, expect } from "@playwright/test";

const PROTECTED_ROUTES = [
  { path: "/dashboard", next: "/dashboard" },
  { path: "/contacts",  next: "/contacts"  },
  { path: "/import",    next: "/import"    },
  { path: "/credits",   next: "/credits"   },
];

test.describe("Auth guard — unauthenticated redirects", () => {
  for (const { path, next } of PROTECTED_ROUTES) {
    test(`GET ${path} redirects to /login?next=${next}`, async ({ page }) => {
      await page.goto(path);

      // Must land on /login
      await expect(page).toHaveURL(/\/login/, { timeout: 8000 });

      // ?next= param must match the originally requested path
      const url = new URL(page.url());
      expect(url.searchParams.get("next")).toBe(next);
    });
  }
});

test.describe("Auth guard — authenticated redirect away from auth pages", () => {
  test("authenticated user hitting /login is redirected to /dashboard", async ({ page, context }) => {
    test.skip(
      !process.env.TEST_USER_EMAIL,
      "Skipped: requires a valid session cookie — set TEST_USER_EMAIL / TEST_USER_PASSWORD"
    );

    // Sign in first to get a valid session
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(process.env.TEST_USER_EMAIL!);
    await page.getByPlaceholder("••••••••").fill(process.env.TEST_USER_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    // Now navigate to /login — should bounce back to /dashboard
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 });
  });

  test("authenticated user hitting /signup is redirected to /dashboard", async ({ page }) => {
    test.skip(
      !process.env.TEST_USER_EMAIL,
      "Skipped: requires a valid session"
    );

    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(process.env.TEST_USER_EMAIL!);
    await page.getByPlaceholder("••••••••").fill(process.env.TEST_USER_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

    await page.goto("/signup");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 });
  });
});
