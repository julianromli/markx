import { defineConfig } from "vite"
import { resolve } from "node:path"

// Content scripts cannot load ES module chunks. Build this entry as a
// single classic IIFE after the main extension build.
export default defineConfig({
  root: resolve(__dirname),
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, "src/content-script.ts"),
      name: "markxContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "content.js",
      },
    },
  },
})
