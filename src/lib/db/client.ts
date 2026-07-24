import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

/**
 * Database client factory.
 *
 * In production (Cloudflare Workers with Hyperdrive), uses
 * `env.HYPERDRIVE.connectionString` for pooled, low-latency access.
 *
 * In local development (Cloudflare Vite plugin without Hyperdrive
 * configured), falls back to `env.DATABASE_URL` from `.dev.vars`.
 *
 * A new client is created per request. `postgres` manages its own
 * connection pool internally, and Hyperdrive pools at the edge, so this
 * is the recommended pattern for Workers.
 *
 * `cloudflare:workers` is imported dynamically so that client bundles
 * never include the Cloudflare-specific module.
 */
export async function getDb() {
  const { env } = await import("cloudflare:workers")

  // `DATABASE_URL` is a secret (set via `.dev.vars` or `wrangler secret put`)
  // and is not part of the generated `Env` type. `HYPERDRIVE` is a binding
  // declared in `wrangler.jsonc` and is typed by `wrangler types`.
  const connectionString =
    env.HYPERDRIVE?.connectionString ??
    ((env as unknown as Record<string, unknown>).DATABASE_URL as
      | string
      | undefined)

  if (!connectionString) {
    throw new Error(
      "No database connection available. Set HYPERDRIVE binding or DATABASE_URL.",
    )
  }

  const sql = postgres(connectionString, {
    // Hyperdrive already pools; a small local max keeps Workers memory lean.
    max: 5,
    // Use `prepare: false` so Hyperdrive can cache prepared statements.
    prepare: false,
    ssl: "require",
  })

  return { db: drizzle(sql, { schema }), sql }
}

export type Database = Awaited<ReturnType<typeof getDb>>["db"]
