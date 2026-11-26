import { execFileSync } from "node:child_process"
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { extname, join, relative, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { assertStoreManifestValid } from "../src/lib/manifest"
import type { ExtensionManifest } from "../src/lib/manifest"

const scriptsDir = fileURLToPath(new URL(".", import.meta.url))
const extensionDir = resolve(scriptsDir, "..")
const repoRoot = resolve(extensionDir, "..")
const distDir = resolve(extensionDir, "dist")

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      MARKX_EXTENSION_TARGET: "store",
    },
  })
}

function collectFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath))
    } else {
      files.push(fullPath)
    }
  }
  return files.sort()
}

function verifyDist(files: string[]): ExtensionManifest {
  const manifestPath = join(distDir, "manifest.json")
  if (!existsSync(manifestPath)) {
    throw new Error("Store build did not produce dist/manifest.json.")
  }

  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8")
  ) as ExtensionManifest
  assertStoreManifestValid(manifest)

  const requiredFiles = [
    "manifest.json",
    manifest.background.service_worker,
    "content.js",
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ]

  for (const relPath of new Set(requiredFiles)) {
    if (!existsSync(join(distDir, relPath))) {
      throw new Error(`Store build is missing required file: ${relPath}`)
    }
  }

  for (const forbidden of ["src/options.html", "options.js"]) {
    if (existsSync(join(distDir, forbidden))) {
      throw new Error(
        `Store build must not include dev-only file: ${forbidden}`
      )
    }
  }

  const remoteTagPattern =
    /<(?:script|link)\b[^>]*(?:src|href)=["'](?:https?:)?\/\//i
  const remoteCssPattern =
    /(?:@import\s+(?:url\()?["'](?:https?:)?\/\/|url\(\s*["']?(?:https?:)?\/\/)/i
  const dynamicCodePattern = /\b(?:eval\s*\(|new\s+Function\s*\()/
  const localHostPattern = /(?:localhost|127\.0\.0\.1)/i

  for (const fullPath of files) {
    const ext = extname(fullPath).toLowerCase()
    if (![".html", ".js", ".css", ".json"].includes(ext)) continue
    const relPath = relative(distDir, fullPath)
    const content = readFileSync(fullPath, "utf8")

    if (ext === ".html" && remoteTagPattern.test(content)) {
      throw new Error(
        `Remote script or stylesheet reference found in ${relPath}.`
      )
    }
    if (ext === ".css" && remoteCssPattern.test(content)) {
      throw new Error(`Remote CSS resource reference found in ${relPath}.`)
    }
    if (ext === ".js" && dynamicCodePattern.test(content)) {
      throw new Error(`Dynamic code execution pattern found in ${relPath}.`)
    }
    if (localHostPattern.test(content)) {
      throw new Error(`Localhost reference found in store bundle: ${relPath}.`)
    }
  }

  return manifest
}

function main(): void {
  const viteBin = resolve(repoRoot, "node_modules/.bin/vite")

  run(viteBin, ["build", "--config", "extension/vite.config.ts"], repoRoot)
  run(
    viteBin,
    ["build", "--config", "extension/vite.content.config.ts"],
    repoRoot
  )

  const files = collectFiles(distDir)
  const manifest = verifyDist(files)

  const zipName = `markx-extension-${manifest.version}.zip`
  const zipPath = resolve(extensionDir, zipName)
  rmSync(zipPath, { force: true })

  execFileSync("zip", ["-r", "-X", "-q", zipPath, "."], {
    cwd: distDir,
    stdio: "inherit",
  })

  console.log(
    `Built store package: extension/${zipName} (${files.length} files, v${manifest.version})`
  )
}

main()
