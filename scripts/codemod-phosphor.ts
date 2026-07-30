/**
 * Codemod: rewrite `@phosphor-icons/react` barrel imports to direct
 * `dist/csr/<Icon>` paths so the whole icon library stays out of the
 * dev module graph and SSR trace (vercel-react-best-practices:
 * `bundle-barrel-imports`).
 *
 * Usage: bun scripts/codemod-phosphor.ts [--dry]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const SRC = new URL("../src", import.meta.url).pathname
const DRY = process.argv.includes("--dry")

const BARREL_RE =
  /import\s*\{([^}]*)\}\s*from\s*"@phosphor-icons\/react";?/g

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (/\.tsx?$/.test(entry)) yield path
  }
}

let changedFiles = 0
for (const file of walk(SRC)) {
  const source = readFileSync(file, "utf8")
  const next = source.replace(BARREL_RE, (_whole, specifiers: string) => {
    const names = specifiers
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean)
    if (names.length === 0) return _whole
    const lines: string[] = []
    for (const name of names) {
      if (!name.endsWith("Icon")) {
        throw new Error(`${file}: unexpected specifier "${name}"`)
      }
      const base = name.slice(0, -"Icon".length)
      lines.push(
        `import { ${name} } from "@phosphor-icons/react/dist/csr/${base}"`
      )
    }
    return lines.join("\n")
  })
  if (next !== source) {
    changedFiles += 1
    if (!DRY) writeFileSync(file, next)
    console.log(`${DRY ? "[dry] " : ""}rewrote ${file}`)
  }
}
console.log(`done — ${changedFiles} file(s) ${DRY ? "would be" : ""} updated`)
