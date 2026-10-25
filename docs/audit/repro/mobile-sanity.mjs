/** AUDIT SANITY FLOWS (2026-10): flows that work on a phone. Prints true when the flow works. Setup as in mobile-audit.mjs. */
import { chromium, devices } from "playwright"
const b = await chromium.launch(); const ctx = await b.newContext({...devices["Pixel 7"]}); const page = await ctx.newPage()
const lp = async (loc) => { const s = await ctx.newCDPSession(page); const bb = await loc.boundingBox(); await s.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:bb.x+bb.width/2,y:bb.y+bb.height/2,id:0}]}); await page.waitForTimeout(700); await s.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]}); await page.waitForTimeout(300) }
await page.goto("http://localhost:3000/"); await page.locator("[data-board-item]").first().waitFor(); await page.waitForTimeout(600)
await lp(page.locator('[data-board-item][aria-label^="Design"]'))
await page.getByRole("menuitem",{name:"Rename"}).click(); await page.getByRole("dialog").getByRole("textbox").fill("Design Eng 2"); await page.getByRole("dialog").getByRole("button",{name:"Save"}).click(); await page.waitForTimeout(300)
console.log("rename via long-press:", await page.locator('[data-board-item][aria-label^="Design Eng 2"]').count()===1)
await page.goto("http://localhost:3000/folder/folder-vibe-coding"); await page.locator("[data-board-item]").first().waitFor(); await page.waitForTimeout(600)
await lp(page.locator('[data-board-item][aria-label*="Linear"]'))
await page.getByRole("menuitem",{name:"Move to…"}).click(); await page.getByRole("dialog").getByRole("button",{name:"AI",exact:true}).click(); await page.waitForTimeout(300)
console.log("move via long-press:", await page.locator('[data-board-item][aria-label*="Linear"]').count()===0)
await lp(page.locator('[data-board-item][aria-label*="Cursor"]'))
await page.getByRole("menuitem",{name:"Delete"}).click(); await page.waitForTimeout(300)
await page.locator("[data-sonner-toast] button", {hasText:"Undo"}).click(); await page.waitForTimeout(300)
console.log("bookmark delete + toast undo:", await page.locator('[data-board-item][aria-label*="Cursor"]').count()===1)
// note delete via menu: any undo?
await page.getByRole("button",{name:"Tools"}).click(); await page.getByRole("dialog").getByRole("button",{name:"Note"}).click(); await page.waitForTimeout(800); await page.keyboard.type("temp"); await page.touchscreen.tap(30,750); await page.waitForTimeout(300)
await lp(page.locator('[data-board-item][aria-label^="Note: temp"]'))
await page.getByRole("menuitem",{name:"Delete"}).click(); await page.waitForTimeout(400)
console.log("note delete toast:", await page.locator("[data-sonner-toast]").allInnerTexts())
await b.close()
