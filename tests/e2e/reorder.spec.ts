import { test, expect } from "@playwright/test";

// Verifies the drag-to-reorder contract on the shared DataTable using four
// columns whose per-row values are all mutually distinct — so the body either
// follows the header on a drag or it provably does not. (Email vs Email
// Normalized would mask this, since both are identical for every row.)
test("drag-reorder commits to BOTH header and body", async ({ page }) => {
  await page.goto("/reorder-test");

  // Grab header labels in DOM order.
  const headerLabels = () =>
    page.locator("thead th").filter({ has: page.locator("button") }).allTextContents();

  // Original header order: City, First Name, Company, Last Name.
  const before = await headerLabels();
  const stripArrow = (t: string) => t.replace(/[↑↓↕⇅]+/g, "").trim();
  const cleanBefore = before.map(stripArrow);
  expect(cleanBefore).toEqual(["City", "First Name", "Company", "Last Name"]);

  // Grab the current first-row cell texts in DOM order (body follows headers).
  const firstRowCells = async () => {
    const texts = await page.locator("tbody tr").first().locator("td").nth(0).allTextContents();
    return texts;
  };
  // Before drag, the first *display* column is City, so row 1 col 1 = London.
  expect((await firstRowCells())[0]).toBe("London");

  // Drag the "City" header grip to the END of the row (over "Last Name").
  const grip = page.getByLabel("Drag City to reorder");
  await grip.scrollIntoViewIfNeeded();
  const gripBox = (await grip.boundingBox())!;
  const gx = gripBox.x + gripBox.width / 2;
  const gy = gripBox.y + gripBox.height / 2;

  const target = page.getByLabel("Drag Last Name to reorder");
  await target.scrollIntoViewIfNeeded();
  const tBox = (await target.boundingBox())!;
  const tx = tBox.x + tBox.width / 2;
  const ty = tBox.y + tBox.height / 2;

  await page.mouse.move(gx, gy);
  await page.mouse.down();
  // Move in small increments so dnd-kit's PointerSensor + measurements track.
  await page.mouse.move(gx + (tx - gx) / 2, gy + (ty - gy) / 2, { steps: 10 });
  await page.mouse.move(tx, ty, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const after = (await headerLabels()).map(stripArrow);
  // City should now be last: First Name, Company, Last Name, City (or Last Name before City —
  // the point is City moved right past every distinct value). Assert City is last and count preserved.
  expect(after).toHaveLength(4);
  expect(after[3]).toBe("City");
  expect(after).not.toEqual(cleanBefore);

  // THE check: the body must follow. The last header is now City, and row 1's
  // city value is "London"; so the LAST cell of row 1 must now read "London".
  const row1Cells = await page.locator("tbody tr").first().locator("td").allTextContents();
  expect(row1Cells[row1Cells.length - 1].trim()).toBe("London");

  // And the first display column is now First Name: row 1 first cell = "Ada".
  expect(row1Cells[0].trim()).toBe("Ada");
});
