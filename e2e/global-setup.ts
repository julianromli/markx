import { chromium } from "@playwright/test"
import type { FullConfig } from "@playwright/test"

/**
 * Warm the dev server before any test runs. Vite compiles lazy chunks (the
 * Tiptap note editor, the Search palette) on first request; on a cold
 * server that can outlast a single test's timeout and fail whichever test
 * happens to run first.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use.baseURL ??
    process.env.MARKX_URL ??
    "http://localhost:3000"
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    })
    const warm = { timeout: 120_000 }
    await page.goto(`${baseURL}/folder/folder-vibe-coding`, warm)
    await page.locator("[data-board-item]").first().waitFor(warm)
    await page.locator("aside").getByRole("button", { name: "Note" }).click()
    await page.locator(".ProseMirror").waitFor(warm)
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Search" }).click()
    await page.getByRole("combobox").waitFor(warm)
    await page.goto(`${baseURL}/`, warm)
    await page.locator("[data-board-item]").first().waitFor(warm)
  } finally {
    await browser.close()
  }
}
