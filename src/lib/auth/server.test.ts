// @vitest-environment node
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createAuth, getSessionUser } from "@/lib/auth/server"
import type { EmailSender } from "@/lib/auth/otp-email"
import type { Database } from "@/lib/db/client"
import * as schema from "@/lib/db/schema"

/**
 * Runs Better Auth against a real Postgres with the `auth` schema from
 * scripts/sql/auth-schema.sql. Skipped unless AUTH_TEST_DATABASE_URL
 * points at a throwaway database. Never use a shared or production DB:
 * the test deletes rows from auth.*.
 */
const url = process.env.AUTH_TEST_DATABASE_URL
const BASE = "http://localhost:3000"

describe.skipIf(!url)("Better Auth email OTP (Postgres)", () => {
  let sql: postgres.Sql
  let db: Database
  const sent: { to: string; otp: string }[] = []
  const mailer: EmailSender = {
    async send(message) {
      const otp = /\b(\d{6})\b/.exec(message.subject)?.[1] ?? ""
      sent.push({ to: String(message.to), otp })
      return { messageId: `m${sent.length}` }
    },
  }

  const auth = () =>
    createAuth(db, {
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
      BETTER_AUTH_URL: BASE,
      EMAIL: mailer,
    })

  const post = (path: string, body: unknown) =>
    auth().handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify(body),
      })
    )

  async function signIn(email: string) {
    const send = await post("/email-otp/send-verification-otp", {
      email,
      type: "sign-in",
    })
    expect(send.status).toBe(200)
    const otp = sent.filter((m) => m.to === email).at(-1)?.otp
    expect(otp).toMatch(/^\d{6}$/)

    const res = await post("/sign-in/email-otp", { email, otp })
    expect(res.status).toBe(200)
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ")
    expect(cookie).toContain("better-auth.session_token=")
    return cookie
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 2, onnotice: () => {} })
    db = drizzle(sql, { schema })
    await sql`delete from auth.verification`
    await sql`delete from auth.session`
    await sql`delete from auth."user" where email like '%@auth-test.local'`
  })

  afterAll(async () => {
    await sql.end()
  })

  it("keeps the id of a user that came over from Neon Auth", async () => {
    const id = "6f0c9a52-2f43-4c1f-9d55-0d2f3c3a1b7e"
    await sql`
      insert into auth."user" (id, name, email, "emailVerified")
      values (${id}, '', 'migrated@auth-test.local', true)
    `

    const cookie = await signIn("migrated@auth-test.local")
    const user = await getSessionUser(auth(), new Headers({ cookie }))
    expect(user).toEqual({
      id,
      email: "migrated@auth-test.local",
      emailVerified: true,
    })

    const users =
      await sql`select count(*)::int as n from auth."user" where email = 'migrated@auth-test.local'`
    expect(users[0].n).toBe(1)
    // The OTP is stored hashed, never as the plain code.
    const rows = await sql`select value from auth.verification`
    for (const row of rows) {
      expect(row.value).not.toMatch(/^\d{6}:/)
    }
  })

  it("creates new users with uuid ids", async () => {
    const cookie = await signIn("new@auth-test.local")
    const user = await getSessionUser(auth(), new Headers({ cookie }))
    expect(user?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(user?.emailVerified).toBe(true)
  })

  it("rejects a wrong code and returns no session for guests", async () => {
    await post("/email-otp/send-verification-otp", {
      email: "wrong@auth-test.local",
      type: "sign-in",
    })
    const res = await post("/sign-in/email-otp", {
      email: "wrong@auth-test.local",
      otp: "000000",
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await getSessionUser(auth(), new Headers())).toBeNull()
  })
})
