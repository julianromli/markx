import { expect, test } from "@playwright/test"

import {
  boardItem,
  boardLabels,
  centerOf,
  createNoteFromToolsSheet,
  openBoard,
  shotPath,
} from "./helpers"

test("MX-14 phones show Undo and Redo @phone @webkit", async ({ page }) => {
  await openBoard(page)
  await expect(
    page.getByRole("button", { name: "Undo" }).filter({ visible: true })
  ).toHaveCount(1)
  await page.getByRole("button", { name: "More" }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByRole("button", { name: "Undo" })).toBeVisible()
  await expect(sheet.getByRole("button", { name: "Redo" })).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({
    path: shotPath(`mx14-more-sheet-undo-${test.info().project.name}`),
  })
})

test("MX-14 a deleted note comes back from the toast Undo and from the header Undo @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  await createNoteFromToolsSheet(page)
  await page.keyboard.type("Keep me")
  await page.touchscreen.tap(20, page.viewportSize()!.height - 140)
  await page.waitForTimeout(400)

  // Long-press menus are covered by MX-22; here only the undo path matters.
  const deleteNote = async () => {
    const at = await centerOf(boardItem(page, "Note: Keep me"))
    await page.touchscreen.tap(at.x, at.y)
    await page.waitForTimeout(400)
    await page.keyboard.press("Delete")
    await page.waitForTimeout(400)
    expect((await boardLabels(page)).join("|")).not.toContain("Keep me")
  }

  await deleteNote()
  const toast = page.locator("[data-sonner-toast]").last()
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible()
  await page.screenshot({
    path: shotPath(`mx14-note-delete-toast-${test.info().project.name}`),
  })
  await toast.getByRole("button", { name: "Undo" }).click()
  await page.waitForTimeout(300)
  expect((await boardLabels(page)).join("|")).toContain("Keep me")

  await deleteNote()
  await page
    .getByRole("button", { name: "Undo" })
    .filter({ visible: true })
    .first()
    .click()
  await page.waitForTimeout(300)
  expect((await boardLabels(page)).join("|")).toContain("Keep me")
})
