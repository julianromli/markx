/**
 * AUDIT REPRO SCRIPT (2026-10). See docs/audit/2026-10-markx-audit.md.
 *
 * Drives the guest (logged-out) app in Chromium with mobile and desktop
 * emulation. Each check prints REPRODUCED when the bug shows, or
 * NOT REPRODUCED when the app behaves correctly. Screenshots go to
 * docs/audit/img/.
 *
 * Setup (outside the app's package.json on purpose):
 *   npm i --no-save playwright@1.56 && npx playwright install chromium
 *   bun run dev            # app on http://localhost:3000, guest mode
 *
 * Run all checks, or a subset by id:
 *   node docs/audit/repro/mobile-audit.mjs
 *   node docs/audit/repro/mobile-audit.mjs MX-13 MX-16
 */
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium, devices } from "playwright"

const BASE = process.env.MARKX_URL ?? "http://localhost:3000"
const IMG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "img")
mkdirSync(IMG, { recursive: true })

const PHONE = devices["Pixel 7"]
const IPHONE = devices["iPhone 14"]
const DESKTOP = { viewport: { width: 1280, height: 800 } }
const IPAD = { ...devices["iPad (gen 7)"] }

const results = []
let browser

function report(id, reproduced, detail) {
  results.push({ id, reproduced, detail })
  console.log(
    `${id}: ${reproduced ? "REPRODUCED" : "NOT REPRODUCED"} :: ${detail}`
  )
}

const openContexts = new Set()

async function open(device, path = "/") {
  const context = await browser.newContext({ ...device })
  openContexts.add(context)
  context.on("close", () => openContexts.delete(context))
  const page = await context.newPage()
  page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`))
  await page.goto(BASE + path, { waitUntil: "load" })
  await page.locator("[data-board-item]").first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(400)
  return { context, page }
}

async function shot(page, name) {
  await page.screenshot({ path: resolve(IMG, `${name}.png`) })
}

function item(page, labelStart) {
  // Contains-match: background enrich rewrites bookmark titles at runtime.
  return page.locator(`[data-board-item][aria-label*="${labelStart}"]`).first()
}

async function center(locator) {
  const b = await locator.boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** CDP touch helpers: Chromium turns these into touch pointer events. */
async function cdp(page) {
  return page.context().newCDPSession(page)
}
async function touch(session, type, points) {
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i })),
  })
}
async function touchDrag(page, from, to, { steps = 12, hold = 0 } = {}) {
  const s = await cdp(page)
  await touch(s, "touchStart", [from])
  if (hold) await page.waitForTimeout(hold)
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    await touch(s, "touchMove", [
      { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
    ])
    await page.waitForTimeout(16)
  }
  return s
}
async function doubleTap(page, point) {
  await page.touchscreen.tap(point.x, point.y)
  await page.waitForTimeout(80)
  await page.touchscreen.tap(point.x, point.y)
}
async function openFolderMobile(page, name) {
  await doubleTap(page, await center(item(page, name)))
  await page.waitForURL(/\/folder\//)
  await page.locator("[data-board-item]").first().waitFor()
  await page.waitForTimeout(300)
}
async function openFolderDesktop(page, name) {
  await item(page, name).dblclick()
  await page.waitForURL(/\/folder\//)
  await page.locator("[data-board-item]").first().waitFor()
  await page.waitForTimeout(300)
}
async function createNoteViaToolsMobile(page) {
  await page.getByRole("button", { name: "Tools" }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Note" }).click()
  await page.locator(".ProseMirror").waitFor()
  await page.waitForTimeout(700) // sheet exit animation + lazy editor focus
}
async function createNoteDesktop(page) {
  await page.locator("aside").getByRole("button", { name: "Note" }).click()
  await page.locator(".ProseMirror").waitFor()
  await page.waitForTimeout(300)
}
async function exitEditDesktop(page) {
  await page.keyboard.press("Escape")
  await page.waitForTimeout(200)
}

const checks = {
  /* Note toolbar is rendered inside the zoomed canvas, so it shrinks. */
  async "MX-10"() {
    const { context, page } = await open(PHONE)
    await openFolderMobile(page, "Vibe Coding")
    await createNoteViaToolsMobile(page)
    await page.keyboard.type("Shopping list")
    const sizes = await page
      .locator(".note-toolbar-in button")
      .evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect()
          return `${e.getAttribute("aria-label") ?? e.textContent.trim()}=${Math.round(r.width)}x${Math.round(r.height)}`
        })
      )
    await shot(page, "mx10-note-toolbar-mobile")
    const small = sizes.filter((s) => {
      const [w, h] = s.split("=")[1].split("x").map(Number)
      return w < 44 || h < 44
    })
    report("MX-10", small.length > 0, `toolbar buttons on Pixel 7: ${sizes.join(", ")}`)
    await context.close()
  },

  /* Toolbar dropdowns open only on pointerdown; keyboard cannot open them. */
  async "MX-11"() {
    const { context, page } = await open(DESKTOP)
    await openFolderDesktop(page, "Vibe Coding")
    await createNoteDesktop(page)
    const triggers = page.locator(".note-toolbar-in button[aria-haspopup]")
    const names = await triggers.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label") ?? e.textContent.trim())
    )
    await triggers.nth(1).focus()
    await page.keyboard.press("Enter")
    await page.waitForTimeout(200)
    const enterOpened = await page.locator(".toolbar-dropdown-in").count()
    // Close the Enter menu and refocus the trigger, then test Space alone.
    if (enterOpened) {
      await page.keyboard.press("Escape")
      await page.waitForTimeout(200)
    }
    await triggers.nth(1).focus()
    await page.keyboard.press("Space")
    await page.waitForTimeout(200)
    const spaceOpened = await page.locator(".toolbar-dropdown-in").count()
    report(
      "MX-11",
      enterOpened === 0 && spaceOpened === 0,
      `dropdown trigger names=${JSON.stringify(names)}; menu open after Enter=${enterOpened > 0}, after Space=${spaceOpened > 0}`
    )
    await context.close()
  },

  /* Note text only commits on blur/Escape. Reload mid-edit loses it. */
  async "MX-12"() {
    const { context, page } = await open(DESKTOP)
    await openFolderDesktop(page, "Vibe Coding")
    await createNoteDesktop(page)
    await page.keyboard.type("Call the dentist on Monday")
    await page.waitForTimeout(1500)
    await page.reload({ waitUntil: "load" })
    await page.locator("[data-board-item]").first().waitFor()
    await page.waitForTimeout(500)
    const labels = await page
      .locator('[data-board-item][aria-label*="ote"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
    report(
      "MX-12",
      !labels.some((l) => l.includes("dentist")),
      `note labels after reload: ${JSON.stringify(labels)}`
    )
    await context.close()
  },

  /* Delete dock hit area is the full-width bottom strip, 120px tall. */
  async "MX-13"() {
    const { context, page } = await open(PHONE)
    await openFolderMobile(page, "Vibe Coding")
    const card = item(page, "shadcn")
    const from = await center(card)
    const vp = page.viewportSize()
    // Drag toward the bottom-left corner, far from the centered dock pill.
    const to = { x: 24, y: vp.height - 60 }
    const s = await touchDrag(page, from, to)
    await page.waitForTimeout(250)
    await shot(page, "mx13-delete-dock-left-corner")
    const pill = await page.locator("[data-open][data-armed]").boundingBox()
    const armed = await page.locator("[data-open][data-armed]").getAttribute("data-armed")
    await touch(s, "touchEnd", [])
    await page.waitForTimeout(600)
    const stillThere = await card.count()
    const toastText = await page.locator("[data-sonner-toast]").allInnerTexts()
    await shot(page, "mx13-after-drop")
    report(
      "MX-13",
      stillThere === 0,
      `finger released at x=${to.x},y=${to.y}; dock pill spans x=${Math.round(pill?.x ?? -1)}..${Math.round((pill?.x ?? 0) + (pill?.width ?? 0))}; armed=${armed}; bookmark exists after drop=${stillThere > 0}; toast=${JSON.stringify(toastText)}`
    )
    await context.close()
  },

  /* No Undo/Redo on mobile. */
  async "MX-14"() {
    const { context, page } = await open(PHONE)
    const visibleUndo = await page
      .getByRole("button", { name: "Undo" })
      .filter({ visible: true })
      .count()
    await page.getByRole("button", { name: "More" }).click()
    await page.waitForTimeout(400)
    const moreItems = await page
      .getByRole("dialog")
      .getByRole("button")
      .allInnerTexts()
    await shot(page, "mx14-more-sheet-no-undo")
    report(
      "MX-14",
      visibleUndo === 0 && !moreItems.some((t) => /undo/i.test(t)),
      `visible Undo buttons=${visibleUndo}; More sheet items=${JSON.stringify(moreItems.map((t) => t.trim()).filter(Boolean))}`
    )
    await context.close()
  },

  /* Move to... with a note in the selection moves only bookmarks. Moved
     bookmarks also land in a fixed cascade under existing items. */
  async "MX-15"() {
    const { context, page } = await open(DESKTOP)
    await openFolderDesktop(page, "Vibe Coding")
    await createNoteDesktop(page)
    await page.keyboard.type("Move me too")
    await exitEditDesktop(page)
    await item(page, "Cursor").click({ position: { x: 40, y: 40 } })
    await item(page, "Note: Move me").click({
      modifiers: ["Control"],
      position: { x: 40, y: 40 },
    })
    await item(page, "Note: Move me").click({
      button: "right",
      position: { x: 40, y: 40 },
    })
    await page.getByRole("menuitem", { name: "Move to…" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "AI", exact: true }).click()
    await page.waitForTimeout(400)
    const toastText = await page.locator("[data-sonner-toast]").allInnerTexts()
    const noteStays = await item(page, "Note: Move me").count()
    await shot(page, "mx15-note-left-behind")
    await page.goto(BASE + "/", { waitUntil: "load" })
    await item(page, "AI").waitFor()
    await openFolderDesktop(page, "AI")
    await shot(page, "mx15-target-folder-overlap")
    const labels = await page
      .locator("[data-board-item]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
    report(
      "MX-15",
      noteStays > 0,
      `toast=${JSON.stringify(toastText)}; note still in source=${noteStays > 0}; target items=${JSON.stringify(labels)}`
    )
    await context.close()
  },

  /* Backspace inside the Move dialog deletes the selection behind it. */
  async "MX-16"() {
    const { context, page } = await open(DESKTOP)
    await openFolderDesktop(page, "Vibe Coding")
    await item(page, "Linear").click({ button: "right", position: { x: 40, y: 40 } })
    await page.getByRole("menuitem", { name: "Move to…" }).click()
    await page.getByRole("dialog").waitFor()
    await page.keyboard.press("Backspace")
    await page.waitForTimeout(300)
    await shot(page, "mx16-backspace-in-move-dialog")
    await page.keyboard.press("Escape")
    await page.waitForTimeout(300)
    const exists = await item(page, "Linear").count()
    report("MX-16", exists === 0, `Linear bookmark exists after Backspace in dialog=${exists > 0}`)
    await context.close()
  },

  /* Home: delete note + non-empty folder. Confirm only deletes folders.
     Dialog count and folder tile count both say "bookmarks". */
  async "MX-17"() {
    const { context, page } = await open(DESKTOP)
    await openFolderDesktop(page, "Vibe Coding")
    await createNoteDesktop(page)
    await page.keyboard.type("Inside folder")
    await exitEditDesktop(page)
    await page.goto(BASE + "/", { waitUntil: "load" })
    await item(page, "Vibe Coding").waitFor()
    const tile = await item(page, "Vibe Coding").innerText()
    // New note at a blank spot so it does not cover the folder.
    await shot(page, "mx19-folder-tile-count")
    await page.mouse.click(160, 90, { button: "right" })
    await page.getByRole("menuitem", { name: "New note" }).click()
    await page.waitForTimeout(600)
    await page.keyboard.type("Home note")
    await exitEditDesktop(page)
    await item(page, "Vibe Coding").click()
    await item(page, "Note: Home").click({ modifiers: ["Control"], position: { x: 30, y: 30 } })
    await page.keyboard.press("Delete")
    const dialog = page.getByRole("alertdialog")
    await dialog.waitFor()
    await page.waitForTimeout(400)
    const dialogText = await dialog.innerText()
    await shot(page, "mx17-confirm-delete-count")
    await dialog.getByRole("button", { name: "Delete" }).click()
    await page.waitForTimeout(400)
    const folderGone = (await item(page, "Vibe Coding").count()) === 0
    const homeNote = await item(page, "Note: Home").count()
    await shot(page, "mx17-note-survives")
    report(
      "MX-17",
      folderGone && homeNote > 0,
      `folder tile text=${JSON.stringify(tile.replace(/\n/g, " | "))}; dialog=${JSON.stringify(dialogText.replace(/\n/g, " "))}; folder deleted=${folderGone}; selected home note still exists=${homeNote > 0}`
    )
    await context.close()
  },

  /* Opening an image on Home navigates to /folder/<imageId>. */
  async "MX-20"() {
    const { context, page } = await open(DESKTOP)
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAQklEQVR42u3PMQ0AAAgDILV/5w3hBg0ogEwD1gECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAH3BQ4AUQEBDyNG3QAAAABJRU5ErkJggg==",
      "base64"
    )
    await page.locator('input[type="file"]').setInputFiles({
      name: "red.png",
      mimeType: "image/png",
      buffer: png,
    })
    const image = item(page, "Image")
    await image.waitFor()
    await page.waitForTimeout(400)
    await image.dblclick({ position: { x: 20, y: 20 } })
    await page.waitForTimeout(800)
    const url = page.url()
    const notFound = await page.getByText("Folder not found").count()
    await shot(page, "mx20-open-image-folder-not-found")
    report("MX-20", notFound > 0, `url after double-click on image=${url.replace(BASE, "")}`)
    await context.close()
  },

  /* pointercancel is handled as pointerup, so an interrupted drag commits.
     Real trigger: a touch that starts on a note's scrollable text area. */
  async "MX-21"() {
    const { context, page } = await open(PHONE)
    await openFolderMobile(page, "Vibe Coding")
    await createNoteViaToolsMobile(page)
    await page.keyboard.type("Drag me")
    await page.waitForTimeout(200)
    await page.touchscreen.tap(30, 700) // blank: exit edit
    await page.waitForTimeout(400)
    await page.evaluate(() => {
      window.__ev = []
      for (const t of ["pointerdown", "pointerup", "pointercancel"])
        document.addEventListener(t, (e) => window.__ev.push(`${t}@${Math.round(e.clientX)},${Math.round(e.clientY)}`), true)
    })
    const note = item(page, "Note: Drag me")
    const before = await note.boundingBox()
    const from = await center(note)
    await shot(page, "mx21-note-before-drag")
    const s = await touchDrag(page, from, { x: from.x, y: from.y + 120 })
    await touch(s, "touchEnd", [])
    await page.waitForTimeout(400)
    const after = await note.boundingBox()
    const events = await page.evaluate(() => window.__ev)
    await shot(page, "mx21-note-after-drag")

    // Part b: a folder drag interrupted by touchcancel still commits.
    await page.goto(BASE + "/", { waitUntil: "load" })
    const folder = item(page, "Design Engineer")
    await folder.waitFor()
    const fb = await folder.boundingBox()
    const fc = await center(folder)
    const s2 = await touchDrag(page, fc, { x: fc.x, y: fc.y + 150 })
    await touch(s2, "touchCancel", [])
    await page.waitForTimeout(400)
    const fa = await folder.boundingBox()
    report(
      "MX-21",
      // Part a: the note must follow the finger. Part b: a cancelled folder
      // drag must revert. Either failing reproduces MX-21.
      Math.abs(after.y - (before.y + 120)) > 20 ||
        Math.abs(fa.y - fb.y) > 5,
      `note dragged down 120px: box (${Math.round(before.x)},${Math.round(before.y)}) -> (${Math.round(after.x)},${Math.round(after.y)}); events=${events.join(" ")} | folder drag then touchcancel: y ${Math.round(fb.y)} -> ${Math.round(fa.y)} (expected revert)`
    )
    await context.close()
  },

  /* Long-press menu: a short hold keeps it open after lift; a hold of 1s
     or more opens it and then closes it when the finger lifts. */
  async "MX-22"() {
    const out = []
    for (const hold of [700, 1500]) {
      const { context, page } = await open(PHONE, "/folder/folder-vibe-coding")
      const s = await cdp(page)
      const p = await center(item(page, "Cursor"))
      await touch(s, "touchStart", [p])
      await page.waitForTimeout(hold)
      const during = await page.getByRole("menu").count()
      if (hold === 1500) await shot(page, "mx22-long-press-menu-while-holding")
      await touch(s, "touchEnd", [])
      await page.waitForTimeout(500)
      const after = await page.getByRole("menu").count()
      if (hold === 1500) await shot(page, "mx22-long-press-menu-gone-after-lift")
      out.push({ hold, during: during > 0, afterLift: after > 0 })
      await context.close()
    }
    const long = out.find((o) => o.hold === 1500)
    report("MX-22", long.during && !long.afterLift, JSON.stringify(out))
  },

  /* Touch: one finger on blank pans; there is no touch multi-select. */
  async "MX-23"() {
    const { context, page } = await open(PHONE)
    const before = await item(page, "Vibe Coding").boundingBox()
    const s = await touchDrag(page, { x: 60, y: 600 }, { x: 300, y: 800 })
    await page.waitForTimeout(100)
    const marquee = await page.locator(".border-selection\\/70").count()
    await touch(s, "touchEnd", [])
    await page.waitForTimeout(200)
    const after = await item(page, "Vibe Coding").boundingBox()
    const selected = await page.locator('[data-board-item][aria-pressed="true"]').count()
    report(
      "MX-23",
      marquee === 0 && selected === 0,
      `blank drag panned=${Math.round(after.x - before.x)}px; marquee shown=${marquee > 0}; items selected=${selected}. No other multi-select path on touch.`
    )
    await context.close()
  },

  /* Tap targets under 44px (phone and tablet). */
  async "MX-24"() {
    const measure = (page) =>
      page.evaluate(() => {
        const out = []
        for (const el of document.querySelectorAll(
          'button, a[href], [role="button"]:not([data-board-item]), [role="menuitem"]'
        )) {
          const r = el.getBoundingClientRect()
          const style = getComputedStyle(el)
          if (r.width === 0 || r.height === 0 || style.visibility === "hidden") continue
          if (r.width < 44 || r.height < 44) {
            const name =
              el.getAttribute("aria-label") || el.textContent.trim().slice(0, 24) || el.tagName
            out.push(`${name}=${Math.round(r.width)}x${Math.round(r.height)}`)
          }
        }
        return out
      })
    const phone = await open(PHONE)
    await openFolderMobile(phone.page, "Vibe Coding")
    const phoneSmall = await measure(phone.page)
    await phone.page.getByRole("button", { name: "Tools" }).click()
    await phone.page.waitForTimeout(400)
    const toolsSmall = await measure(phone.page)
    await shot(phone.page, "mx24-tools-sheet-phone")
    await phone.context.close()

    const ipad = await open(IPAD)
    const ipadSmall = await measure(ipad.page)
    await shot(ipad.page, "mx24-ipad-header-targets")
    await ipad.context.close()
    report(
      "MX-24",
      phoneSmall.length + ipadSmall.length > 0,
      `phone folder view: ${phoneSmall.join(", ") || "none"} | phone tools sheet: ${toolsSmall.join(", ") || "none"} | iPad (touch, desktop layout): ${ipadSmall.join(", ")}`
    )
  },

  /* Search does nothing. */
  async "MX-26"() {
    const { context, page } = await open(DESKTOP)
    await page.getByRole("button", { name: "Search" }).click()
    await page.waitForTimeout(400)
    const dialogs = await page.getByRole("dialog").count()
    const inputs = await page.locator("input[type=search], [cmdk-input]").count()
    report("MX-26", dialogs === 0 && inputs === 0, `after Search click: dialogs=${dialogs}, search inputs=${inputs}`)
    await context.close()
  },

  /* Focus after keyboard delete and after the rename dialog closes. */
  async "MX-27"() {
    const { context, page } = await open(DESKTOP)
    await openFolderDesktop(page, "Vibe Coding")
    await item(page, "Cursor").focus()
    await page.keyboard.press("F2")
    await page.getByRole("dialog").waitFor()
    await page.keyboard.press("Escape")
    await page.waitForTimeout(400)
    const afterRename = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName
    )
    await item(page, "Linear").focus()
    await page.keyboard.press("Delete")
    await page.waitForTimeout(400)
    const afterDelete = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName
    )
    report(
      "MX-27",
      afterDelete === "BODY" || afterRename === "BODY",
      `focus after rename dialog Escape=${afterRename}; focus after keyboard Delete=${afterDelete}`
    )
    await context.close()
  },

  /* Unconditional :hover rules (stuck hover on touch). */
  async "MX-28"() {
    const { context, page } = await open(PHONE)
    const ungated = await page.evaluate(() => {
      const found = []
      const walk = (rules, gated) => {
        for (const rule of rules) {
          if (rule instanceof CSSMediaRule) {
            walk(rule.cssRules, gated || /hover:\s*hover/.test(rule.conditionText))
          } else if (rule.cssRules && rule.cssRules.length) {
            walk(rule.cssRules, gated)
          } else if (rule.selectorText && rule.selectorText.includes(":hover") && !gated) {
            found.push(rule.selectorText.slice(0, 80))
          }
        }
      }
      for (const sheet of document.styleSheets) {
        try {
          walk(sheet.cssRules, false)
        } catch {}
      }
      return found
    })
    report("MX-28", ungated.length > 0, `ungated :hover rules=${ungated.length} ${JSON.stringify(ungated.slice(0, 8))}`)
    await context.close()
  },

  /* Guest mode: two tabs overwrite each other's IndexedDB state. */
  async "MX-29"() {
    const context = await browser.newContext({ ...DESKTOP })
    const a = await context.newPage()
    await a.goto(BASE + "/", { waitUntil: "load" })
    await a.locator("[data-board-item]").first().waitFor()
    const b = await context.newPage()
    await b.goto(BASE + "/", { waitUntil: "load" })
    await b.locator("[data-board-item]").first().waitFor()
    await a.bringToFront()
    await a.keyboard.press("Control+n")
    await a.getByRole("dialog").getByRole("textbox").fill("From tab A")
    await a.keyboard.press("Enter")
    await a.waitForTimeout(500)
    await b.bringToFront()
    await b.keyboard.press("Control+n")
    await b.getByRole("dialog").getByRole("textbox").fill("From tab B")
    await b.keyboard.press("Enter")
    await b.waitForTimeout(500)
    await a.reload({ waitUntil: "load" })
    await a.locator("[data-board-item]").first().waitFor()
    await a.waitForTimeout(300)
    const labels = await a
      .locator("[data-board-item]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
    const hasA = labels.some((l) => l.startsWith("From tab A"))
    const hasB = labels.some((l) => l.startsWith("From tab B"))
    report("MX-29", !(hasA && hasB), `after reload: tab A folder kept=${hasA}, tab B folder kept=${hasB}`)
    await context.close()
  },

  /* Mobile: resize zone hijacks drags that start in the lower-right part. */
  async "MX-30"() {
    const { context, page } = await open(PHONE)
    await openFolderMobile(page, "Vibe Coding")
    const card = item(page, "shadcn")
    const box = await card.boundingBox()
    // Grab 30px in from the bottom-right corner (handle is ~16px on screen).
    const from = { x: box.x + box.width - 30, y: box.y + box.height - 30 }
    const s = await touchDrag(page, from, { x: from.x - 60, y: from.y + 80 })
    await touch(s, "touchEnd", [])
    await page.waitForTimeout(300)
    const after = await card.boundingBox()
    const resized = Math.abs(after.width - box.width) > 3 || Math.abs(after.height - box.height) > 3
    // Touch now hides the handle on unselected cards (the MX-30 fix).
    const handle = (await card.locator(".cursor-se-resize").boundingBox()) ?? {
      width: 0,
      height: 0,
    }
    report(
      "MX-30",
      resized,
      `visible handle=${Math.round(handle.width)}x${Math.round(handle.height)}px; card ${Math.round(box.width)}x${Math.round(box.height)} -> ${Math.round(after.width)}x${Math.round(after.height)} (resized=${resized}, moved=${Math.round(after.x - box.x)},${Math.round(after.y - box.y)})`
    )
    await context.close()
  },

  /* iPhone: initial camera hides items; viewport lacks viewport-fit=cover. */
  async "MX-31"() {
    const { context, page } = await open(IPHONE)
    const vp = page.viewportSize()
    const offscreen = await page.locator("[data-board-item]").evaluateAll(
      (els, w) =>
        els
          .filter((e) => {
            const r = e.getBoundingClientRect()
            return r.right > w || r.left < 0
          })
          .map((e) => e.getAttribute("aria-label")),
      vp.width
    )
    const meta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.content)
    await shot(page, "mx31-iphone-initial-view")
    report(
      "MX-31",
      offscreen.length > 0 || !/viewport-fit=cover/.test(meta),
      `items cut off at first paint=${JSON.stringify(offscreen)}; viewport meta="${meta}"`
    )
    await context.close()
  },

  /* Add link has no URL validation. Text with spaces makes a junk bookmark;
     some inputs throw and the dialog stays open with no message. */
  async "MX-06"() {
    const { context, page } = await open(DESKTOP)
    const errors = []
    page.on("pageerror", (e) => errors.push(e.message))
    await openFolderDesktop(page, "Vibe Coding")
    const addLink = async (text) => {
      await page.locator("aside").getByRole("button", { name: "Link" }).click()
      await page.getByRole("dialog").getByRole("textbox").fill(text)
      await page.keyboard.press("Enter")
      await page.waitForTimeout(600)
    }
    await addLink("my reading list")
    const junk = await page
      .locator("[data-board-item]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")).filter((l) => l.includes("%20")))
    // After the MX-06 fix the first dialog stays open with an inline error.
    if (await page.getByRole("dialog").count()) {
      await page.keyboard.press("Escape")
      await page.waitForTimeout(300)
    }
    await addLink("https://")
    const stillOpen = (await page.getByRole("dialog").count()) > 0
    const alert = page.getByRole("dialog").getByRole("alert").filter({ visible: true })
    const shownError =
      stillOpen && (await alert.count()) > 0
        ? (await alert.first().innerText()).trim().length > 0
        : false
    await page.waitForTimeout(400)
    await shot(page, "mx06-add-link-invalid-input")
    report(
      "MX-06",
      junk.length > 0 || (stillOpen && !shownError) || errors.length > 0,
      `"my reading list" created=${JSON.stringify(junk)}; "https://" leaves dialog open=${stillOpen} with an inline error=${shownError}; page errors=${JSON.stringify(errors)}`
    )
    await context.close()
  },

  /* Right-click "New note" near the screen edge puts the note off-screen. */
  async "MX-37"() {
    const { context, page } = await open(DESKTOP)
    await page.mouse.click(1150, 720, { button: "right" })
    await page.getByRole("menuitem", { name: "New note" }).click()
    await page.waitForTimeout(800)
    const box = await item(page, "Empty note").boundingBox()
    const vp = page.viewportSize()
    const visible =
      (Math.max(0, Math.min(box.x + box.width, vp.width) - Math.max(box.x, 0)) *
        Math.max(0, Math.min(box.y + box.height, vp.height) - Math.max(box.y, 0))) /
      (box.width * box.height)
    await shot(page, "mx37-context-menu-note-off-screen")
    report("MX-37", visible < 0.5, `new note visible area=${Math.round(visible * 100)}%`)
    await context.close()
  },

  /* Keyboard: Shift+F10 on a focused item; can keyboard users reach Move/Delete via menu? */
  async "MX-32"() {
    const { context, page } = await open(DESKTOP)
    await openFolderDesktop(page, "Vibe Coding")
    await page.locator("body").press("Tab")
    let reached = null
    for (let i = 0; i < 25; i += 1) {
      const label = await page.evaluate(() => document.activeElement?.getAttribute("data-board-item") ? document.activeElement.getAttribute("aria-label") : null)
      if (label) {
        reached = { label, tabs: i + 1 }
        break
      }
      await page.keyboard.press("Tab")
    }
    await page.keyboard.press("Shift+F10")
    await page.waitForTimeout(400)
    const menu = await page.getByRole("menu").count()
    const menuBox = menu ? await page.getByRole("menu").boundingBox() : null
    // no screenshot: not a bug
    report(
      "MX-32",
      !reached || menu === 0,
      `first board item reached by Tab=${JSON.stringify(reached)}; Shift+F10 opens menu=${menu > 0} at ${menuBox ? `${Math.round(menuBox.x)},${Math.round(menuBox.y)}` : "n/a"}`
    )
    await context.close()
  },
}

browser = await chromium.launch()
const wanted = process.argv.slice(2)
for (const [id, run] of Object.entries(checks)) {
  if (wanted.length && !wanted.includes(id)) continue
  try {
    await run()
  } catch (err) {
    console.log(`${id}: ERROR :: ${err.message.split("\n")[0]}`)
    results.push({ id, reproduced: null, detail: err.message })
  } finally {
    // A check that throws must not leak its browser context.
    for (const context of [...openContexts]) await context.close()
  }
}
await browser.close()
if (results.some((r) => r.reproduced === null)) process.exitCode = 1
