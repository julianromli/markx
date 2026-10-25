import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

import { expect, test } from "@playwright/test"

import { boardItem, boardLabels, openBoard, shotPath } from "./helpers"

const require = createRequire(import.meta.url)
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")

test("MX-26 Search finds a bookmark and opens its folder with it selected @desktop", async ({
  page,
}) => {
  await openBoard(page)
  await page.getByRole("button", { name: "Search" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("combobox").fill("linear")
  await page.waitForTimeout(200)
  await page.screenshot({ path: shotPath("mx26-search-desktop") })
  await page.keyboard.press("Enter")
  await page.waitForURL(/\/folder\/folder-vibe-coding/)
  await page.locator("[data-board-item]").first().waitFor()
  await page.waitForTimeout(400)
  await expect(boardItem(page, "Linear")).toHaveAttribute(
    "aria-pressed",
    "true"
  )
})

test("MX-26 Search opens from the phone More sheet @phone @webkit", async ({
  page,
}) => {
  await openBoard(page)
  await page.getByRole("button", { name: "More" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Search" }).click()
  await page.waitForTimeout(400)
  await expect(page.getByRole("combobox")).toBeVisible()
})

test("MX-31 phones see every item at first paint, and the viewport covers safe areas @phone @webkit", async ({
  page,
}) => {
  await openBoard(page)
  const vp = page.viewportSize()!
  const cut = await page
    .locator("[data-board-item]")
    .evaluateAll((els, { width, height }) => {
      const headerBottom =
        document.querySelector("header")?.getBoundingClientRect().bottom ?? 0
      return els
        .filter((e) => {
          const r = e.getBoundingClientRect()
          return (
            r.left < 0 ||
            r.right > width ||
            r.top < headerBottom ||
            r.bottom > height
          )
        })
        .map((e) => e.getAttribute("aria-label"))
    }, vp)
  await page.screenshot({
    path: shotPath(`mx31-first-paint-${test.info().project.name}`),
  })
  expect(cut).toEqual([])
  const meta = await page.evaluate(() =>
    document.querySelector('meta[name="viewport"]')?.getAttribute("content")
  )
  expect(meta).toContain("viewport-fit=cover")
})

test("MX-33 dialogs stay inside the visible area when the keyboard shrinks it @phone @webkit", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  // Emulate a virtual keyboard: the visual viewport shrinks to 300px.
  await page.evaluate(() => {
    const vv = window.visualViewport!
    Object.defineProperty(vv, "height", { configurable: true, get: () => 300 })
    vv.dispatchEvent(new Event("resize"))
  })
  await page.getByRole("button", { name: "Tools" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Link" }).click()
  await page.waitForTimeout(500)
  const box = (await page.getByRole("dialog").boundingBox())!
  await page.screenshot({
    path: shotPath(`mx33-dialog-short-viewport-${test.info().project.name}`),
  })
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(300)
})

test("MX-35 shortcut hints match the platform and are hidden on touch @desktop", async ({
  page,
}) => {
  // Pin a non-Apple platform so the result does not depend on the host OS.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", {
      configurable: true,
      get: () => "Linux x86_64",
    })
    Object.defineProperty(Navigator.prototype, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0",
    })
  })
  await openBoard(page, "/folder/folder-ai")
  await page.keyboard.press("Shift")
  await boardItem(page, "OpenAI").focus()
  await page.keyboard.press("Delete")
  await page.waitForTimeout(400)
  const text = await page.locator(".workspace-empty-state").innerText()
  // The platform is pinned to Linux above, so the hint must say Ctrl.
  expect(text).toContain("Ctrl+V")
  expect(text).not.toContain("⌘")
})

test("MX-35 touch devices get no keyboard shortcut hints @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-ai")
  const item = boardItem(page, "OpenAI")
  const box = (await item.boundingBox())!
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.press("Delete")
  await page.waitForTimeout(400)
  const text = await page.locator(".workspace-empty-state").innerText()
  expect(text).not.toMatch(/⌘|Ctrl/)
})

for (const tag of ["@phone @webkit", "@desktop"]) {
  test(`MX-36 axe finds no violations on Home and in a folder ${tag}`, async ({
    page,
  }) => {
    for (const path of ["/", "/folder/folder-vibe-coding"]) {
      await openBoard(page, path)
      await page.addScriptTag({ content: AXE })
      const violations = await page.evaluate(async () => {
        const axe = (
          window as unknown as {
            axe: {
              run: (n: Document) => Promise<{
                violations: Array<{ id: string; nodes: unknown[] }>
              }>
            }
          }
        ).axe
        const result = await axe.run(document)
        return result.violations.map((v) => `${v.id} x${v.nodes.length}`)
      })
      expect(violations, path).toEqual([])
    }
  })
}

test("MX-28 no ungated :hover rule applies to an element on the page @phone", async ({
  page,
}) => {
  await openBoard(page, "/folder/folder-vibe-coding")
  const matches = await page.evaluate(() => {
    const found: string[] = []
    const walk = (rules: CSSRuleList, gated: boolean) => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule) {
          walk(
            rule.cssRules,
            gated || /hover:\s*hover/.test(rule.conditionText)
          )
        } else if (
          "cssRules" in rule &&
          (rule as CSSGroupingRule).cssRules.length
        ) {
          walk((rule as CSSGroupingRule).cssRules, gated)
        } else if (
          rule instanceof CSSStyleRule &&
          rule.selectorText.includes(":hover") &&
          !gated
        ) {
          const plain = rule.selectorText.replace(/:hover/g, "")
          try {
            if (document.querySelector(plain)) found.push(rule.selectorText)
          } catch {
            // selector the engine cannot query without :hover
          }
        }
      }
    }
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules, false)
      } catch {
        // cross-origin sheet
      }
    }
    return found
  })
  expect(matches).toEqual([])
  expect((await boardLabels(page)).length).toBeGreaterThan(0)
})
