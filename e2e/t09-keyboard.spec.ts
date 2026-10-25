import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

import {
  boardItem,
  createNoteFromSidebar,
  openBoard,
  openFolderByClick,
} from "./helpers"

const activeLabel = (page: Page) =>
  page.evaluate(
    () =>
      document.activeElement?.getAttribute("aria-label") ??
      document.activeElement?.tagName ??
      null
  )

test("MX-11 note toolbar menus work from the keyboard and have names @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await openFolderByClick(page, "Vibe Coding")
  await createNoteFromSidebar(page)
  await page.keyboard.type("Keyboard note")

  const toolbar = page.locator("[data-note-toolbar]")
  await expect(
    toolbar.getByRole("button", { name: "Note color" })
  ).toBeVisible()
  await expect(toolbar.getByRole("button", { name: "Font" })).toBeVisible()
  await expect(toolbar.getByRole("button", { name: /Text size/ })).toBeVisible()

  // Tab from the editor into the toolbar.
  await page.keyboard.press("Tab")
  expect(await activeLabel(page)).toBe("Note color")
  await page.keyboard.press("Tab")
  expect(await activeLabel(page)).toBe("Font")

  await page.keyboard.press("Enter")
  const menu = toolbar.getByRole("menu")
  await expect(menu).toBeVisible()
  await expect(menu.getByRole("menuitemradio").first()).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await expect(menu.getByRole("menuitemradio", { name: "Serif" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(menu).toHaveCount(0)
  // The choice applied: reopen and check Serif is the checked option.
  await toolbar.getByRole("button", { name: "Font" }).focus()
  await page.keyboard.press("Enter")
  await expect(
    toolbar.getByRole("menu").getByRole("menuitemradio", { name: "Serif" })
  ).toHaveAttribute("aria-checked", "true")
  await page.keyboard.press("Escape")

  const size = toolbar.getByRole("button", { name: /Text size/ })
  await size.focus()
  await page.keyboard.press(" ")
  await expect(toolbar.getByRole("menu")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(toolbar.getByRole("menu")).toHaveCount(0)
  await expect(size).toBeFocused()
  // The note is still being edited, with the chosen font.
  await expect(page.locator(".ProseMirror")).toHaveCount(1)
  await expect(toolbar.getByRole("button", { name: "Font" })).toBeVisible()
})

test("MX-27 focus returns to the item after the rename dialog closes @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await openFolderByClick(page, "Vibe Coding")
  await page.keyboard.press("Shift") // keyboard modality: focus selects
  await boardItem(page, "Cursor").focus()
  const label = await activeLabel(page)
  await page.keyboard.press("F2")
  await page.getByRole("dialog").waitFor()
  await page.keyboard.press("Escape")
  await page.waitForTimeout(400)
  expect(await activeLabel(page)).toBe(label)
})

test("MX-27 focus moves to a neighbor item after a keyboard delete @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await openFolderByClick(page, "Vibe Coding")
  await page.keyboard.press("Shift")
  await boardItem(page, "Linear").focus()
  await page.keyboard.press("Delete")
  await page.waitForTimeout(500)
  await expect(boardItem(page, "Linear")).toHaveCount(0)
  const focused = await page.evaluate(() => ({
    item: document.activeElement?.hasAttribute("data-board-item") ?? false,
    label: document.activeElement?.getAttribute("aria-label") ?? "",
  }))
  expect(focused.item).toBe(true)
  expect(focused.label).not.toContain("Linear")
})

test("MX-27 focus lands on the board after confirming a folder delete @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await page.keyboard.press("Shift")
  await boardItem(page, "Vibe Coding").focus()
  await page.keyboard.press("Delete")
  const dialog = page.getByRole("alertdialog")
  await dialog.waitFor()
  await dialog.getByRole("button", { name: "Delete" }).click()
  await page.waitForTimeout(500)
  const focused = await page.evaluate(() =>
    document.activeElement?.hasAttribute("data-board-item")
  )
  expect(focused).toBe(true)
})
