import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

import {
  boardItem,
  boardLabels,
  centerOf,
  createNoteFromToolsSheet,
  openBoard,
  shotPath,
} from "./helpers"

async function addNote(page: Page, text: string) {
  await createNoteFromToolsSheet(page)
  await page.keyboard.type(text)
  await page.touchscreen.tap(20, page.viewportSize()!.height - 160)
  await page.waitForTimeout(400)
}

async function deleteWithKey(page: Page, label: string) {
  const at = await centerOf(boardItem(page, label))
  await page.touchscreen.tap(at.x, at.y)
  await page.waitForTimeout(300)
  await page.keyboard.press("Delete")
  await page.waitForTimeout(600)
}

const toasts = (page: Page) => page.locator("[data-sonner-toast]")

test("toast one delete shows exactly one Undo toast and no selection toolbar behind it @phone @webkit", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  await addNote(page, "Keep me")
  await deleteWithKey(page, "Note: Keep me")

  await expect(toasts(page)).toHaveCount(1)
  // The focus moved to a neighbour card must not select it (that opened the
  // phone Selection toolbar, the box that peeked out under the toast).
  await expect(
    page.locator('[data-board-item][aria-pressed="true"]')
  ).toHaveCount(0)
  await expect(page.getByRole("toolbar", { name: "Selection" })).toHaveCount(0)

  const toast = toasts(page).first()
  const undo = toast.getByRole("button", { name: "Undo" })
  const box = (await undo.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.width).toBeGreaterThanOrEqual(44)
  // Design system: the action is the shared secondary pill, not Sonner's
  // default black block, on the same floating surface as the zoom pill.
  await expect(undo).toHaveClass(/bg-secondary/)
  await expect(undo).toHaveClass(/rounded-4xl/)
  const bg = await undo.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(bg).not.toBe("rgb(0, 0, 0)")
  await expect(toast).toHaveClass(/markx-toast/)
  // Live region for screen readers, and the toast clears the iOS home bar.
  await expect(page.locator("section[aria-live='polite']")).toHaveCount(1)
  const vp = page.viewportSize()!
  const toastBox = (await toast.boundingBox())!
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(vp.height - 12)

  await page.waitForTimeout(300)
  await page.screenshot({
    path: shotPath(`toast-undo-mobile-${test.info().project.name}`),
  })

  await undo.click()
  await page.waitForTimeout(400)
  expect((await boardLabels(page)).join("|")).toContain("Keep me")
})

test("toast a second delete replaces the Undo toast instead of stacking @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  await addNote(page, "First")
  await addNote(page, "Second")
  await deleteWithKey(page, "Note: First")
  await deleteWithKey(page, "Note: Second")

  await expect(toasts(page)).toHaveCount(1)
  await toasts(page).first().getByRole("button", { name: "Undo" }).click()
  await page.waitForTimeout(400)
  const labels = (await boardLabels(page)).join("|")
  expect(labels).toContain("Second")
  expect(labels).not.toContain("First")
})

test("toast stays above the phone Selection toolbar @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  const at = await centerOf(boardItem(page, "Cursor"))
  await page.touchscreen.tap(at.x, at.y)
  await page.waitForTimeout(300)
  const bar = page.getByRole("toolbar", { name: "Selection" })
  await expect(bar).toBeVisible()

  // Paste something that is not a link: shows a toast while the bar is up.
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData("text", "http://")
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data }))
  })
  const toast = toasts(page).first()
  await expect(toast).toBeVisible()
  await page.waitForTimeout(400)
  const barBox = (await bar.boundingBox())!
  const toastBox = (await toast.boundingBox())!
  await page.screenshot({
    path: shotPath(`toast-above-selection-bar-${test.info().project.name}`),
  })
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(barBox.y)
})

test("toast Undo is keyboard reachable on desktop @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await openBoard(page, "/folder/folder-vibe-coding")
  await page.keyboard.press("Shift")
  await boardItem(page, "Linear").focus()
  await page.keyboard.press("Delete")
  const undo = toasts(page).first().getByRole("button", { name: "Undo" })
  await expect(undo).toBeVisible()
  expect(await undo.evaluate((el) => (el as HTMLElement).tabIndex)).toBe(0)
  await undo.focus()
  await page.keyboard.press("Enter")
  await page.waitForTimeout(300)
  await expect(boardItem(page, "Linear")).toHaveCount(1)
})

test("toast matches the app theme when the OS is in dark mode @phone", async ({
  browser,
}) => {
  const context = await browser.newContext({
    ...test.info().project.use,
    colorScheme: "dark",
  })
  const page = await context.newPage()
  await openBoard(page, "/folder/folder-vibe-coding")
  await addNote(page, "Dark")
  await deleteWithKey(page, "Note: Dark")
  // markx has no dark theme (nothing sets .dark), so the toast must not
  // switch to Sonner's dark palette on its own.
  await expect(page.locator("[data-sonner-toaster]")).toHaveAttribute(
    "data-sonner-theme",
    "light"
  )
  const bg = await toasts(page)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  // White glass surface (Chromium reports it in oklab).
  expect(bg).toMatch(/^(rgba?\(255, 255, 255|oklab\(0\.99)/)
  await context.close()
})
