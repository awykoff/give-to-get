import { test, expect } from "@playwright/test";

// Verifies the shared SelectionToolbar contract for the Contacts + Companies
// variants via the throwaway /sel-toolbar-test harness:
//   - Contacts: label "N contacts selected", Add to list, Export, Clear.
//   - Companies: label, Add to list, Clear, and NO Export button (companies
//     has no export backend; the button must be omitted, not greyed out).
//   - Popover opens, shows search + "+ Create new list", closes on Escape.
test("selection toolbar: contacts shows Export, companies omits it", async ({ page }) => {
  await page.goto("/sel-toolbar-test");

  const contactsBar = page.locator('[data-k="contacts"]');
  const compBar = page.locator('[data-k="companies"]');

  // Contacts variant
  await expect(contactsBar.getByText("3 contacts selected")).toBeVisible();
  await expect(contactsBar.getByRole("button", { name: "Add to list" })).toBeVisible();
  await expect(contactsBar.getByRole("button", { name: /Export/ })).toBeVisible();
  await expect(contactsBar.getByRole("button", { name: "Clear" })).toBeVisible();

  // Companies variant — label singular, no Export button at all
  await expect(compBar.getByText("1 company selected")).toBeVisible();
  await expect(compBar.getByRole("button", { name: "Add to list" })).toBeVisible();
  await expect(compBar.getByRole("button", { name: /Export/ })).toHaveCount(0);
  await expect(compBar.getByRole("button", { name: "Clear" })).toBeVisible();

  // Popover opens, exposes search + create UI, and closes on Escape
  await contactsBar.getByRole("button", { name: "Add to list" }).click();
  await expect(contactsBar.getByPlaceholder("Search lists…")).toBeVisible();
  await expect(contactsBar.getByText("+ Create new list")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(contactsBar.getByPlaceholder("Search lists…")).toHaveCount(0);
});