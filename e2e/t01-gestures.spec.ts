import { expect, test } from "@playwright/test"

import {
  boardItem,
  centerOf,
  createNoteFromToolsSheet,
  openBoard,
  openFolderByTap,
  shotPath,
  touch,
  touchDrag,
} from "./helpers"

test("MX-21 a touch-dragged note follows the finger (up 100px) @phone", async ({
  page,
}) => {
  await openBoard(page)
  await openFolderByTap(page, "Vibe Coding")
  await createNoteFromToolsSheet(page)
  await page.keyboard.type("Drag me")
  await page.touchscreen.tap(30, 700)
  await page.waitForTimeout(400)

  const note = boardItem(page, "Note: Drag me")
  const before = await note.boundingBox()
  const from = await centerOf(note)
  const session = await touchDrag(page, from, { x: from.x, y: from.y - 100 })
  await touch(session, "touchEnd", [])
  await page.waitForTimeout(400)
  const after = await note.boundingBox()
  await page.screenshot({
    path: shotPath(`mx21-note-drag-${test.info().project.name}`),
  })

  expect(before).not.toBeNull()
  expect(after).not.toBeNull()
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(8)
  expect(Math.abs(after!.y - (before!.y - 100))).toBeLessThan(12)
})

test("MX-21 a drag ended by touchcancel reverts instead of committing @phone", async ({
  page,
}) => {
  await openBoard(page)
  const folder = boardItem(page, "Design Engineer")
  const before = await folder.boundingBox()
  const from = await centerOf(folder)
  const session = await touchDrag(page, from, { x: from.x, y: from.y + 150 })
  await touch(session, "touchCancel", [])
  await page.waitForTimeout(400)
  const after = await folder.boundingBox()
  expect(Math.round(after!.y)).toBe(Math.round(before!.y))
  expect(Math.round(after!.x)).toBe(Math.round(before!.x))
})
