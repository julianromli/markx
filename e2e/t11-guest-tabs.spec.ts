import { expect, test } from "@playwright/test"

import { boardLabels, openBoard } from "./helpers"

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
    await page.waitForTimeout(600)
  }
  await newFolder(a, "From tab A")
  await newFolder(b, "From tab B")

  await a.reload({ waitUntil: "load" })
  await a.locator("[data-board-item]").first().waitFor()
  await a.waitForTimeout(300)
  const labels = (await boardLabels(a)).join("|")
  expect(labels).toContain("From tab A")
  expect(labels).toContain("From tab B")
})
