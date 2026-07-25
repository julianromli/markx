import { defineConfig } from "drizzle-kit"

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error(
    "DATABASE_URL is required for drizzle-kit. Set it in your environment or .dev.vars."
  )
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url },
})
