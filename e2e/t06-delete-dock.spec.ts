import { expect, test } from "@playwright/test"

import {
  boardItem,
  centerOf,
  openBoard,
  shotPath,
  touch,
  touchDrag,
} from "./helpers"

test("MX-13 a drop in the bottom-left corner does not delete @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  const card = boardItem(page, "shadcn")
  const vp = page.viewportSize()!
  const session = await touchDrag(page, await centerOf(card), {
    x: 24,
    y: vp.height - 60,
  })
  await page.waitForTimeout(400)
  await page.screenshot({
    path: shotPath(`mx13-bottom-left-not-armed-${test.info().project.name}`),
  })
  await expect(page.locator("[data-open='true'][data-armed]")).toHaveAttribute(
    "data-armed",
    "false"
  )
  await touch(session, "touchEnd", [])
  await page.waitForTimeout(500)
  await expect(card).toHaveCount(1)
})

test("MX-13 holding the item on the Delete pill deletes it @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  const card = boardItem(page, "shadcn")
  const from = await centerOf(card)
  const session = await touchDrag(page, from, { x: from.x, y: from.y + 40 })
  await page.waitForTimeout(250)
  const pill = page.locator("[data-open='true'][data-armed]")
  const target = await centerOf(pill)
  for (let i = 1; i <= 10; i += 1) {
    await touch(session, "touchMove", [
      {
        x: from.x + (target.x - from.x) * (i / 10),
        y: from.y + 40 + (target.y - from.y - 40) * (i / 10),
      },
    ])
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(400)
  await expect(pill).toHaveAttribute("data-armed", "true")
  await page.screenshot({
    path: shotPath(`mx13-pill-armed-${test.info().project.name}`),
  })
  await touch(session, "touchEnd", [])
  await page.waitForTimeout(500)
  await expect(card).toHaveCount(0)
})
