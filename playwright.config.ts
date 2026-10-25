import { defineConfig, devices } from "@playwright/test"

/**
 * Browser tests for touch, mobile layout, and keyboard flows.
 *
 * They run against the local dev server in guest mode (no account needed):
 *   bun run dev          # needs .dev.vars, see .dev.vars.example
 *   bun run test:e2e
 *
 * Touch drags use Chromium CDP touch input, so the drag projects run on
 * Chromium with phone descriptors. `iphone14-webkit` runs the layout and tap
 * checks on WebKit, which is closer to iOS Safari but is still not a device.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.MARKX_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: process.env.MARKX_URL
    ? undefined
    : {
        command: "bun run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
  projects: [
    {
      name: "pixel7",
      use: { ...devices["Pixel 7"] },
      grep: /@phone/,
    },
    {
      name: "iphone14",
      use: { ...devices["iPhone 14"], browserName: "chromium" },
      grep: /@phone/,
    },
    {
      name: "iphone14-webkit",
      use: { ...devices["iPhone 14"] },
      grep: /@webkit/,
    },
    {
      name: "ipad",
      use: { ...devices["iPad (gen 7)"], browserName: "chromium" },
      grep: /@tablet/,
    },
    {
      name: "desktop",
      use: { viewport: { width: 1280, height: 800 } },
      grep: /@desktop/,
    },
  ],
})
