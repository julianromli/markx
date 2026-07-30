import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { cloudflare } from "@cloudflare/vite-plugin"
import { clientNodeGuard } from "./scripts/vite-plugin-client-node-guard"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
    clientNodeGuard(),
  ],
  build: {
    rolldownOptions: {
      // `cloudflare:workers` is a runtime-provided module by the
      // Cloudflare Workers runtime. It must be externalized so the
      // bundler doesn't try to resolve it at build time.
      external: ["cloudflare:workers"],
    },
  },
})

export default config
