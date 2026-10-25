import { expect, test } from "@playwright/test"

import { boardItem, boardLabels, openBoard } from "./helpers"

test("MX-29 two guest tabs keep each other's work @desktop", async ({
  context,
}) => {
  const a = await context.newPage()
  await openBoard(a)
  const b = await context.newPage()
  await openBoard(b)

  const newFolder = async (page: typeof a, name: string) => {
    await page.bringToFront()
    await page.keyboard.press("Control+n")
    await page.getByRole("dialog").getByRole("textbox").fill(name)
    await page.keyboard.press("Enter")
    await expect(boardItem(page, name)).toHaveCount(1)
  }
  await newFolder(a, "From tab A")
  // Tab B must adopt tab A's save before it writes its own.
  await expect(boardItem(b, "From tab A")).toHaveCount(1)
  await newFolder(b, "From tab B")
  await expect(boardItem(a, "From tab B")).toHaveCount(1)

  await a.reload({ waitUntil: "load" })
  await a.locator("[data-board-item]").first().waitFor()
  await expect
    .poll(async () => (await boardLabels(a)).join("|"))
    .toMatch(/From tab A[\s\S]*From tab B|From tab B[\s\S]*From tab A/)
})
