import { expect, test } from "@playwright/test"

import {
  boardItem,
  boardLabels,
  createNoteFromSidebar,
  openBoard,
  openFolderByClick,
  shotPath,
} from "./helpers"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAQklEQVR42u3PMQ0AAAgDILV/5w3hBg0ogEwD1gECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAH3BQ4AUQEBDyNG3QAAAABJRU5ErkJggg==",
  "base64"
)

test("MX-15 Move to… moves the selected note together with the bookmark @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await openFolderByClick(page, "Vibe Coding")
  await createNoteFromSidebar(page)
  await page.keyboard.type("Move me too")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
  await boardItem(page, "Cursor").click({ position: { x: 40, y: 40 } })
  await boardItem(page, "Note: Move me").click({
    modifiers: ["Control"],
    position: { x: 40, y: 40 },
  })
  await boardItem(page, "Note: Move me").click({
    button: "right",
    position: { x: 40, y: 40 },
  })
  await page.getByRole("menuitem", { name: "Move to…" }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "AI", exact: true })
    .click()
  await page.waitForTimeout(400)
  await expect(boardItem(page, "Note: Move me")).toHaveCount(0)
  await expect(boardItem(page, "Cursor")).toHaveCount(0)

  await page.goto("/folder/folder-ai")
  await page.locator("[data-board-item]").first().waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: shotPath("mx04-mx15-moved-into-ai") })
  const labels = await boardLabels(page)
  expect(labels.join("|")).toContain("Move me too")
  expect(labels.join("|")).toContain("Cursor")
})

test("MX-38 a note on Home can move into a folder and back @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await page.mouse.click(160, 90, { button: "right" })
  await page.getByRole("menuitem", { name: "New note" }).click()
  await page.waitForTimeout(600)
  await page.keyboard.type("Wander")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
  await boardItem(page, "Note: Wander").click({
    button: "right",
    position: { x: 30, y: 30 },
  })
  await page.getByRole("menuitem", { name: "Move to…" }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "AI", exact: true })
    .click()
  await page.waitForTimeout(300)
  await expect(boardItem(page, "Note: Wander")).toHaveCount(0)
  await openFolderByClick(page, "AI")
  await boardItem(page, "Note: Wander").click({
    button: "right",
    position: { x: 30, y: 30 },
  })
  await page.getByRole("menuitem", { name: "Move to…" }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Home", exact: true })
    .click()
  await page.waitForTimeout(300)
  await page.goto("/")
  await page.locator("[data-board-item]").first().waitFor()
  await expect(boardItem(page, "Note: Wander")).toHaveCount(1)
})

test("MX-17 MX-18 mixed delete on Home deletes the note too, and counts name every kind @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await openFolderByClick(page, "Vibe Coding")
  await createNoteFromSidebar(page)
  await page.keyboard.type("Inside folder")
  await page.keyboard.press("Escape")
  await page.goto("/")
  await page.locator("[data-board-item]").first().waitFor()
  await page.waitForTimeout(300)
  const tile = (await boardItem(page, "Vibe Coding").innerText()).replace(
    /\s+/g,
    " "
  )
  await page.screenshot({ path: shotPath("mx18-folder-tile-count") })
  expect(tile).toContain("3 bookmarks, 1 note")

  await page.mouse.click(160, 90, { button: "right" })
  await page.getByRole("menuitem", { name: "New note" }).click()
  await page.waitForTimeout(600)
  await page.keyboard.type("Home note")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
  await boardItem(page, "Vibe Coding").click()
  await boardItem(page, "Note: Home").click({
    modifiers: ["Control"],
    position: { x: 30, y: 30 },
  })
  await page.keyboard.press("Delete")
  const dialog = page.getByRole("alertdialog")
  await dialog.waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: shotPath("mx17-mx18-confirm-dialog") })
  await expect(dialog).toContainText("3 bookmarks and 1 note")
  await dialog.getByRole("button", { name: "Delete" }).click()
  await page.waitForTimeout(400)
  await expect(boardItem(page, "Vibe Coding")).toHaveCount(0)
  await expect(boardItem(page, "Note: Home")).toHaveCount(0)
})

test("MX-20 opening an image on Home stays on Home @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await page.locator('input[type="file"]').setInputFiles({
    name: "red.png",
    mimeType: "image/png",
    buffer: PNG,
  })
  const image = boardItem(page, "Image")
  await image.waitFor()
  await page.waitForTimeout(400)
  await image.dblclick({ position: { x: 20, y: 20 } })
  await page.waitForTimeout(600)
  expect(new URL(page.url()).pathname).toBe("/")
  await expect(page.getByText("Folder not found")).toHaveCount(0)
})

test("MX-06 Add link rejects text that is not a URL with a visible message @desktop", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await openBoard(page)
  await openFolderByClick(page, "Vibe Coding")
  const before = (await boardLabels(page)).length
  for (const text of ["my reading list", "https://"]) {
    await page.locator("aside").getByRole("button", { name: "Link" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("textbox").fill(text)
    await page.keyboard.press("Enter")
    await page.waitForTimeout(300)
    await expect(dialog.getByRole("alert")).toBeVisible()
    await page.screenshot({
      path: shotPath(
        `mx06-add-link-error-${text === "https://" ? "scheme-only" : "plain-text"}`
      ),
    })
    await page.keyboard.press("Escape")
    await page.waitForTimeout(300)
  }
  expect((await boardLabels(page)).length).toBe(before)
  expect(errors).toEqual([])
})

test("MX-37 a note made from the context menu near the edge stays on screen @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await page.mouse.click(1150, 720, { button: "right" })
  await page.getByRole("menuitem", { name: "New note" }).click()
  await page.waitForTimeout(800)
  const box = (await boardItem(page, "Empty note").boundingBox())!
  const vp = page.viewportSize()!
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
})
