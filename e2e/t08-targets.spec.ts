import { expect, test } from "@playwright/test"

import {
  boardItem,
  centerOf,
  createNoteFromToolsSheet,
  longPress,
  openBoard,
  shotPath,
  smallTargets,
  touch,
  touchDrag,
} from "./helpers"

test("MX-10 note toolbar buttons are at least 44px on a phone @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  await createNoteFromToolsSheet(page)
  await page.keyboard.type("Shopping list")
  const sizes = await page
    .locator(".note-toolbar-in button")
    .evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { w: r.width, h: r.height }
      })
    )
  await page.screenshot({
    path: shotPath(`mx10-note-toolbar-${test.info().project.name}`),
  })
  expect(sizes.length).toBeGreaterThan(0)
  for (const s of sizes) {
    expect(s.w).toBeGreaterThanOrEqual(44)
    expect(s.h).toBeGreaterThanOrEqual(44)
  }
  // The toolbar stays inside the screen.
  const box = (await page.locator(".note-toolbar-in").boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
})

test("MX-24 phone header, Tools sheet, long-press menu, and toast targets are at least 44px @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  expect(await smallTargets(page)).toEqual([])

  await page.getByRole("button", { name: "Tools" }).click()
  await page.getByRole("dialog").waitFor()
  await page.waitForTimeout(400)
  expect(await smallTargets(page)).toEqual([])
  await page.keyboard.press("Escape")
  await page.waitForTimeout(400)

  await longPress(page, await centerOf(boardItem(page, "shadcn")), 650)
  await page.getByRole("menu").waitFor()
  await page.waitForTimeout(300)
  expect(await smallTargets(page)).toEqual([])
  await page.screenshot({
    path: shotPath(`mx24-long-press-menu-${test.info().project.name}`),
  })
  await page.getByRole("menuitem", { name: "Delete" }).click()
  await page.waitForTimeout(400)
  const toastButtons = await page
    .locator("[data-sonner-toast] button")
    .evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { w: r.width, h: r.height }
      })
    )
  await page.screenshot({
    path: shotPath(`mx24-toast-${test.info().project.name}`),
  })
  for (const s of toastButtons) {
    expect(s.w).toBeGreaterThanOrEqual(44)
    expect(s.h).toBeGreaterThanOrEqual(44)
  }
})

test("MX-24 iPad header targets are at least 44px @tablet", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  await page.screenshot({ path: shotPath("mx24-ipad-header") })
  expect(await smallTargets(page)).toEqual([])
})

test("MX-30 a drag near the corner of an unselected card moves it @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  const card = boardItem(page, "shadcn")
  const box = (await card.boundingBox())!
  const from = { x: box.x + box.width - 30, y: box.y + box.height - 30 }
  const session = await touchDrag(page, from, {
    x: from.x - 60,
    y: from.y - 80,
  })
  await touch(session, "touchEnd", [])
  await page.waitForTimeout(300)
  const after = (await card.boundingBox())!
  expect(Math.round(after.width)).toBe(Math.round(box.width))
  expect(Math.round(after.height)).toBe(Math.round(box.height))
  expect(Math.abs(after.x - (box.x - 60))).toBeLessThan(8)
})

test("MX-30 a selected card resizes from its visible corner handle @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  const card = boardItem(page, "shadcn")
  const c = await centerOf(card)
  await page.touchscreen.tap(c.x, c.y)
  await page.waitForTimeout(300)
  const handle = card.locator(".cursor-se-resize")
  const hb = (await handle.boundingBox())!
  expect(hb.width).toBeGreaterThanOrEqual(26)
  const box = (await card.boundingBox())!
  const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }
  const session = await touchDrag(page, from, {
    x: from.x - 40,
    y: from.y + 60,
  })
  await touch(session, "touchEnd", [])
  await page.waitForTimeout(300)
  await page.screenshot({
    path: shotPath(`mx30-resize-selected-${test.info().project.name}`),
  })
  const after = (await card.boundingBox())!
  expect(after.height).toBeGreaterThan(box.height + 20)
})
