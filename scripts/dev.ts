import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const HYPERDRIVE_ENV = "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"
const DEV_VARS_PATH = resolve(import.meta.dirname, "..", ".dev.vars")

function parseDevVars(contents: string): Record<string, string> {
  const vars: Record<string, string> = {}

  for (const line of contents.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const eq = trimmed.indexOf("=")
    if (eq === -1) continue

    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (key) vars[key] = value
  }

  return vars
}

if (!existsSync(DEV_VARS_PATH)) {
  console.error(
    `Missing ${DEV_VARS_PATH}. Copy .dev.vars.example to .dev.vars and set DATABASE_URL.`,
  )
  process.exit(1)
}

const devVars = parseDevVars(readFileSync(DEV_VARS_PATH, "utf8"))
const databaseUrl = devVars.DATABASE_URL

if (!databaseUrl) {
  console.error("DATABASE_URL is required in .dev.vars for local development.")
  process.exit(1)
}

process.env[HYPERDRIVE_ENV] ??=
  devVars[HYPERDRIVE_ENV] ?? databaseUrl

const vite = Bun.spawn(["vite", "dev", "--port", "3000"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
})

process.exit(await vite.exited)
