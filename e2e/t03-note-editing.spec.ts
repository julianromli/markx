import { expect, test } from "@playwright/test"

import {
  boardLabels,
  createNoteFromSidebar,
  createNoteFromToolsSheet,
  openBoard,
  openFolderByClick,
  openFolderByTap,
  shotPath,
} from "./helpers"

test("MX-12 note text survives a reload while still typing @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await openFolderByClick(page, "Vibe Coding")
  await createNoteFromSidebar(page)
  await page.keyboard.type("Call the dentist on Monday")
  await page.waitForTimeout(1500)
  await page.reload({ waitUntil: "load" })
  await page.locator("[data-board-item]").first().waitFor()
  await page.waitForTimeout(400)
  expect((await boardLabels(page)).join("|")).toContain("dentist")
})

test("MX-12 note text survives an immediate reload (pagehide flush) @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await openFolderByClick(page, "Vibe Coding")
  await createNoteFromSidebar(page)
  await page.keyboard.type("Buy milk")
  await page.reload({ waitUntil: "load" })
  await page.locator("[data-board-item]").first().waitFor()
  await page.waitForTimeout(400)
  expect((await boardLabels(page)).join("|")).toContain("Buy milk")
})

test("MX-12 note text survives the tab going to the background @phone", async ({
  page,
}) => {
  await openBoard(page)
  await openFolderByTap(page, "Vibe Coding")
  await createNoteFromToolsSheet(page)
  await page.keyboard.type("Pick up keys")
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.waitForTimeout(300)
  await page.reload({ waitUntil: "load" })
  await page.locator("[data-board-item]").first().waitFor()
  await page.waitForTimeout(400)
  expect((await boardLabels(page)).join("|")).toContain("Pick up keys")
})

for (const tag of ["@phone", "@webkit"]) {
  test(`MX-34 a tap on blank canvas ends note editing and keeps the text ${tag}`, async ({
    page,
  }) => {
    await openBoard(page, "/folder/folder-vibe-coding")
    await createNoteFromToolsSheet(page)
    await page.keyboard.type("Tap outside")
    const vp = page.viewportSize()!
    await page.touchscreen.tap(20, vp.height - 140)
    await page.waitForTimeout(500)
    await page.screenshot({
      path: shotPath(`mx34-tap-outside-${test.info().project.name}`),
    })
    await expect(page.locator(".ProseMirror")).toHaveCount(0)
    const active = await page.evaluate(
      () => document.activeElement?.getAttribute("contenteditable") ?? null
    )
    expect(active).toBeNull()
    expect((await boardLabels(page)).join("|")).toContain("Tap outside")
  })
}
