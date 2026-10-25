/**
 * AUDIT A11Y SCAN (2026-10). See docs/audit/2026-10-markx-audit.md.
 * axe-core scan (phone + desktop, Home + folder), phone Tab order, focus
 * return from the Tools sheet, long-press menu item size, toast button size.
 *
 * Setup: npm i --no-save playwright@1.56 axe-core@4 && npx playwright install chromium
 * Run:   node docs/audit/repro/a11y-scan.mjs   (app on http://localhost:3000)
 */
import { chromium, devices } from "playwright"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
// Node resolution finds axe-core in the repo root (or a parent) node_modules.
const axe = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8")
const BASE = process.env.MARKX_URL ?? "http://localhost:3000"
const b = await chromium.launch()
for (const [name, dev] of [["phone", devices["Pixel 7"]], ["desktop", {viewport:{width:1280,height:800}}]]) {
  for (const path of ["/", "/folder/folder-vibe-coding"]) {
    const ctx = await b.newContext({...dev}); const page = await ctx.newPage()
    await page.goto(BASE+path); await page.locator("[data-board-item]").first().waitFor(); await page.waitForTimeout(800)
    await page.addScriptTag({content: axe})
    const r = await page.evaluate(async()=> (await axe.run(document,{resultTypes:["violations"]})).violations.map(v=>`${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0,3).map(n=>n.target.join(" ")).join(" ; ")}`))
    console.log(`== axe ${name} ${path}`); for (const l of r) console.log("  ", l)
    await ctx.close()
  }
}
// toast undo size + tab order on phone
const ctx = await b.newContext({...devices["Pixel 7"]}); const page = await ctx.newPage()
await page.goto(BASE+"/folder/folder-vibe-coding"); await page.locator("[data-board-item]").first().waitFor(); await page.waitForTimeout(600)
const seq=[]
for (let i=0;i<14;i++){ await page.keyboard.press("Tab"); seq.push(await page.evaluate(()=>{const a=document.activeElement;const r=a.getBoundingClientRect();return `${a.getAttribute("aria-label")||a.textContent.trim().slice(0,20)||a.tagName}@${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`})) }
console.log("phone tab order:", seq.join(" -> "))
await page.reload(); await page.locator("[data-board-item]").first().waitFor(); await page.waitForTimeout(800)
await page.getByRole("button",{name:"Tools"}).click(); await page.getByRole("dialog").waitFor(); await page.waitForTimeout(500); await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({state:"detached"}); await page.waitForTimeout(300)
console.log("focus after Tools sheet Escape:", await page.evaluate(()=>document.activeElement.getAttribute("aria-label")||document.activeElement.tagName))
// delete a bookmark via long-press menu to get a toast
const s = await ctx.newCDPSession(page); const card = page.locator('[data-board-item][aria-label*="shadcn"]'); const bb = await card.boundingBox()
// The long-press menu does not always survive the lift (see MX-22), so retry.
let attempts = 0
for (; attempts < 5; attempts += 1) {
  await s.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:bb.x+bb.width/2,y:bb.y+bb.height/2,id:0}]}); await page.waitForTimeout(650); await s.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]})
  await page.waitForTimeout(400)
  if (await page.getByRole("menu").count()) break
  await page.touchscreen.tap(30, 780); await page.waitForTimeout(300)
}
console.log("long-press attempts until the menu stayed open:", attempts + 1)
await page.waitForTimeout(300)
const items = await page.getByRole("menuitem").evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return `${e.textContent.trim()}=${Math.round(r.width)}x${Math.round(r.height)}`}))
console.log("long-press menu items:", items.join(", "))
await page.screenshot({path:new URL("../img/mx24-long-press-menu-phone.png", import.meta.url).pathname})
await page.getByRole("menuitem",{name:"Delete"}).click(); await page.waitForTimeout(500)
console.log("toast buttons:", await page.locator("[data-sonner-toast] button").evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return `${e.getAttribute("aria-label")||e.textContent.trim()}=${Math.round(r.width)}x${Math.round(r.height)}`})))
await page.screenshot({path:new URL("../img/mx24-toast-undo-phone.png", import.meta.url).pathname})
await b.close()
