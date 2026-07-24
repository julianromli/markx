import { defineConfig } from "vitest/config"
import viteReact from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

/**
 * Vitest configuration.
 *
 * This is separate from `vite.config.ts` because the Cloudflare Vite
 * plugin tries to start a dev server (miniflare) which doesn't work
 * in the test environment. Tests only need TypeScript path resolution
 * and React JSX transform — no SSR or Cloudflare bindings.
 */
export default defineConfig({
  plugins: [viteReact()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
})
