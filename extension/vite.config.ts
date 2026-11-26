import { defineConfig } from "vite"
import type { Plugin } from "vite"
import react from "@vitejs/plugin-react"
import { resolve } from "node:path"
import process from "node:process"

import {
  assertStoreManifestValid,
  buildManifest,
  resolveExtensionTarget,
} from "./src/lib/manifest"
import type { ExtensionBuildTarget } from "./src/lib/manifest"

function emitExtensionManifest(target: ExtensionBuildTarget): Plugin {
  return {
    name: "markx-extension-manifest",
    generateBundle() {
      const manifest = buildManifest(target)
      if (target === "store") {
        assertStoreManifestValid(manifest)
      }
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      })
    },
  }
}

export default defineConfig(() => {
  const target = resolveExtensionTarget(process.env.MARKX_EXTENSION_TARGET)
  const input: Record<string, string> = {
    popup: resolve(__dirname, "src/popup.html"),
    background: resolve(__dirname, "src/background.ts"),
  }
  if (target === "dev") {
    input.options = resolve(__dirname, "src/options.html")
  }

  return {
    root: resolve(__dirname),
    plugins: [react(), emitExtensionManifest(target)],
    base: "./",
    publicDir: "public",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input,
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name].js",
          assetFileNames: "assets/[name][extname]",
        },
      },
    },
  }
})
