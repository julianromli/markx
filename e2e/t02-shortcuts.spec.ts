import { expect, test } from "@playwright/test"

import { boardItem, openBoard, openFolderByClick, shotPath } from "./helpers"

test("MX-16 Backspace inside the Move dialog does not delete the selection @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await openFolderByClick(page, "Vibe Coding")
  await boardItem(page, "Linear").click({
    button: "right",
    position: { x: 40, y: 40 },
  })
  await page.getByRole("menuitem", { name: "Move to…" }).click()
  await page.getByRole("dialog").waitFor()
  await page.keyboard.press("Backspace")
  await page.keyboard.press("Delete")
  await page.waitForTimeout(300)
  await page.screenshot({ path: shotPath("mx16-move-dialog-backspace") })
  await page.keyboard.press("Escape")
  await page.waitForTimeout(300)
  await expect(boardItem(page, "Linear")).toHaveCount(1)
})
