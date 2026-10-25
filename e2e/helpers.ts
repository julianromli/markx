import type { CDPSession, Locator, Page } from "@playwright/test"

export type Point = { x: number; y: number }

export async function openBoard(page: Page, path = "/"): Promise<void> {
  await page.goto(path, { waitUntil: "load" })
  await page.locator("[data-board-item]").first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(400)
}

/** Contains-match: background enrich rewrites bookmark titles at runtime. */
export function boardItem(page: Page, label: string): Locator {
  return page.locator(`[data-board-item][aria-label*="${label}"]`).first()
}

export async function centerOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox()
  if (!box) throw new Error("element has no box")
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export async function cdp(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page)
}

export async function touch(
  session: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
  points: Point[]
): Promise<void> {
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((p, id) => ({ x: p.x, y: p.y, id })),
  })
}

/** One-finger drag. Returns the session so the caller can end or cancel. */
export async function touchDrag(
  page: Page,
  from: Point,
  to: Point,
  { steps = 12, hold = 0 }: { steps?: number; hold?: number } = {}
): Promise<CDPSession> {
  const session = await cdp(page)
  await touch(session, "touchStart", [from])
  if (hold) await page.waitForTimeout(hold)
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    await touch(session, "touchMove", [
      { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
    ])
    await page.waitForTimeout(16)
  }
  return session
}

export async function longPress(
  page: Page,
  at: Point,
  hold: number
): Promise<void> {
  const session = await cdp(page)
  await touch(session, "touchStart", [at])
  await page.waitForTimeout(hold)
  await touch(session, "touchEnd", [])
}

export async function doubleTap(page: Page, at: Point): Promise<void> {
  await page.touchscreen.tap(at.x, at.y)
  await page.waitForTimeout(80)
  await page.touchscreen.tap(at.x, at.y)
}

export async function openFolderByTap(page: Page, name: string): Promise<void> {
  await doubleTap(page, await centerOf(boardItem(page, name)))
  await page.waitForURL(/\/folder\//)
  await page.locator("[data-board-item]").first().waitFor()
  await page.waitForTimeout(300)
}

export async function openFolderByClick(
  page: Page,
  name: string
): Promise<void> {
  await boardItem(page, name).dblclick()
  await page.waitForURL(/\/folder\//)
  await page.locator("[data-board-item]").first().waitFor()
  await page.waitForTimeout(300)
}

export async function createNoteFromToolsSheet(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Tools" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Note" }).click()
  await page.locator(".ProseMirror").waitFor()
  // Sheet exit animation and lazy editor focus.
  await page.waitForTimeout(700)
}

export async function createNoteFromSidebar(page: Page): Promise<void> {
  await page.locator("aside").getByRole("button", { name: "Note" }).click()
  await page.locator(".ProseMirror").waitFor()
  await page.waitForTimeout(500)
}

export async function boardLabels(page: Page): Promise<string[]> {
  return page
    .locator("[data-board-item]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))
}

export function shotPath(name: string): string {
  return `docs/audit/img/fixed/${name}.png`
}

/** Every visible control smaller than 44x44 CSS px. */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const selector =
      'button, a[href], [role="button"]:not([data-board-item]), [role="menuitem"], [role="menuitemradio"]'
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden")
        continue
      if (el.closest("[aria-hidden='true'], [inert]")) continue
      if (r.width < 44 || r.height < 44) {
        const name =
          el.getAttribute("aria-label") ||
          el.textContent?.trim().slice(0, 24) ||
          el.tagName
        out.push(`${name}=${Math.round(r.width)}x${Math.round(r.height)}`)
      }
    }
    return out
  })
}
