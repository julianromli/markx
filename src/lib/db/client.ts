import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

type DatabaseEnv = {
  HYPERDRIVE?: Pick<Hyperdrive, "connectionString">
  DATABASE_URL?: string
}

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

  // Hyperdrive can be absent in local development, where `.dev.vars`
  // supplies the typed DATABASE_URL fallback.
  const bindings: DatabaseEnv = env
  const connectionString =
    bindings.HYPERDRIVE?.connectionString ?? bindings.DATABASE_URL

  if (!connectionString) {
    throw new Error(
      "No database connection available. Set HYPERDRIVE binding or DATABASE_URL."
    )
  }

  const sql = postgres(connectionString, {
    // Hyperdrive already pools; a small local max keeps Workers memory lean.
    max: 5,
    // Use `prepare: false` so Hyperdrive can cache prepared statements.
    prepare: false,
  })

  return { db: drizzle(sql, { schema }), sql }
}

export type DbConnection = Awaited<ReturnType<typeof getDb>>
export type Database = Awaited<ReturnType<typeof getDb>>["db"]

/**
 * Run a database operation and always release its postgres client.
 *
 * Keeping lifecycle management here prevents server services from leaking
 * connections when an operation throws or returns early.
 */
export async function withDb<T>(
  operation: (connection: DbConnection) => Promise<T>
): Promise<T> {
  const connection = await getDb()
  try {
    return await operation(connection)
  } finally {
    await connection.sql.end()
  }
}
