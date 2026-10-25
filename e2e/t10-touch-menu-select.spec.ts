import { expect, test } from "@playwright/test"

import {
  boardItem,
  boardLabels,
  centerOf,
  longPress,
  openBoard,
  shotPath,
  touch,
  touchDrag,
} from "./helpers"

for (const hold of [700, 1500]) {
  test(`MX-22 the long-press menu stays open after a ${hold}ms hold @phone`, async ({
    page,
  }) => {
    await openBoard(page, "/folder/folder-vibe-coding")
    await longPress(page, await centerOf(boardItem(page, "Cursor")), hold)
    await page.waitForTimeout(600)
    await expect(page.getByRole("menu")).toBeVisible()
    if (hold === 1500) {
      await page.screenshot({
        path: shotPath(`mx22-menu-after-lift-${test.info().project.name}`),
      })
    }
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeEnabled()
  })
}

test("MX-23 phones can select several items and delete them together @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  const cursor = await centerOf(boardItem(page, "Cursor"))
  await page.touchscreen.tap(cursor.x, cursor.y)
  await page.waitForTimeout(300)

  const bar = page.getByRole("group", { name: "Selection" })
  await expect(bar).toBeVisible()
  await bar.getByRole("button", { name: "Select more" }).click()
  await page.waitForTimeout(200)

  const shadcn = await centerOf(boardItem(page, "shadcn"))
  await page.touchscreen.tap(shadcn.x, shadcn.y)
  await page.waitForTimeout(300)
  await expect(bar).toContainText("2 selected")

  // A drag on blank space draws a marquee in select mode instead of panning.
  const linear = (await boardItem(page, "Linear").boundingBox())!
  const session = await touchDrag(
    page,
    { x: Math.max(8, linear.x - 190), y: linear.y - 12 },
    { x: linear.x + 24, y: linear.y + 18 }
  )
  await touch(session, "touchEnd", [])
  await page.waitForTimeout(300)
  await expect(bar).toContainText("3 selected")
  await page.screenshot({
    path: shotPath(`mx23-multi-select-${test.info().project.name}`),
  })

  await bar.getByRole("button", { name: "Delete" }).click()
  await page.waitForTimeout(500)
  const labels = (await boardLabels(page)).join("|")
  expect(labels).not.toContain("Cursor")
  expect(labels).not.toContain("shadcn")
  expect(labels).not.toContain("Linear")
})
