import type { Plugin } from "vite"

/**
 * Fail the build when Node-only code reaches the browser bundle.
 *
 * Server functions live in modules the client also imports (for the RPC
 * stub), so a single stray export can keep a Node-only dependency alive in
 * the client graph after the Start plugin strips the handler body. The
 * symptom is silent: the bundle only throws once the browser evaluates it —
 * before hydration — leaving the server-rendered loading shell on screen
 * forever with nothing in the SSR HTML to hint at what broke.
 *
 * Two rules, both matching this repo's conventions:
 *  - `*.server.ts` modules are server-only by definition.
 *  - Packages that need Node builtins can never run in a browser.
 */
const SERVER_ONLY_MODULE = /\.server\.[cm]?[jt]sx?$/

const NODE_ONLY_PACKAGES = [
  "open-graph-scraper",
  "undici",
  "drizzle-orm",
  "postgres",
  "sharp",
]

function nodeOnlyReason(moduleId: string): string | null {
  const id = moduleId.replace(/\?.*$/, "")
  if (SERVER_ONLY_MODULE.test(id)) return "server-only module"
  if (/(^|\/)node:/.test(id)) return "Node builtin"
  for (const pkg of NODE_ONLY_PACKAGES) {
    if (id.includes(`/node_modules/${pkg}/`)) return `Node-only package (${pkg})`
  }
  return null
}

export function clientNodeGuard(): Plugin {
  return {
    name: "markx:client-node-guard",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle(_options, bundle) {
      const offenders: string[] = []
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue
        for (const moduleId of output.moduleIds) {
          const reason = nodeOnlyReason(moduleId)
          if (reason) offenders.push(`${output.fileName}: ${moduleId} — ${reason}`)
        }
      }
      if (offenders.length === 0) return
      this.error(
        `Node-only code leaked into the client bundle:\n` +
          offenders.map((line) => `  - ${line}`).join("\n") +
          `\n\nSomething the browser can reach re-exports it. Keep server ` +
          `internals behind a \`.handler()\` body or a \`*.server.ts\` module ` +
          `that only server code imports.`
      )
    },
  }
}
