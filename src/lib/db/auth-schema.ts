import { boolean, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Better Auth tables in the `auth` schema.
 *
 * Production data arrives by restoring Neon Auth's `neon_auth` schema and
 * renaming it to `auth` (see docs/self-hosted-auth.md). Column names are the
 * Better Auth defaults (camelCase) and ids are `uuid`, so existing user ids
 * stay the same. Neon-only columns (`role`, `banned`, `impersonatedBy`, ...)
 * may still exist in the table; Better Auth ignores them.
 *
 * These tables are not part of `drizzle.config.ts`. A fresh database gets
 * them from `scripts/sql/auth-schema.sql`.
 */
export const authSchema = pgSchema("auth")

const timestamps = {
  createdAt: timestamp("createdAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true })
    .notNull()
    .defaultNow(),
}

export const authUser = authSchema.table("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  ...timestamps,
})

export const authSession = authSchema.table("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: uuid("userId")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  ...timestamps,
})

export const authAccount = authSchema.table("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: uuid("userId")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  ...timestamps,
})

export const authVerification = authSchema.table("verification", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  ...timestamps,
})

export const authTables = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
}
