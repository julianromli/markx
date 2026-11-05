import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { emailOTP } from "better-auth/plugins/email-otp"
import { tanstackStartCookies } from "better-auth/tanstack-start"

import {
  OTP_EXPIRES_IN_SECONDS,
  OTP_LENGTH,
  buildOtpEmail,
  sendOtpEmail,
} from "@/lib/auth/otp-email"
import type { EmailSender } from "@/lib/auth/otp-email"
import type { VerifiedAuthUser } from "@/lib/auth/types"
import type { Database } from "@/lib/db/client"
import { authTables } from "@/lib/db/auth-schema"

export type AuthEnv = {
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  /** Comma-separated extra origins (e.g. a rehearsal preview Worker). */
  BETTER_AUTH_TRUSTED_ORIGINS?: string
  EMAIL?: EmailSender
}

export function parseTrustedOrigins(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
}

/**
 * Better Auth for one request. It holds the per-request db client, and
 * Workers forbid reusing I/O objects across requests, so never cache it in
 * module scope.
 *
 * Email OTP is the only sign-in method. New ids are uuids so they match the
 * ids that came over from Neon Auth.
 */
export function createAuth(db: Database, env: AuthEnv) {
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is not set")
  }

  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema: authTables }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: parseTrustedOrigins(env.BETTER_AUTH_TRUSTED_ORIGINS),
    emailAndPassword: { enabled: false },
    session: {
      // Most requests read the signed session_data cookie, not the DB.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      database: { generateId: "uuid" },
    },
    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp }) {
          await sendOtpEmail(env.EMAIL, buildOtpEmail(email, otp))
        },
      }),
      // Must stay last: copies Set-Cookie into TanStack Start server
      // function responses (session refresh inside authMiddleware).
      tanstackStartCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

/**
 * Resolve the signed-in user from request cookies, or `null` for guests.
 * A database error throws (500), so an outage never looks like a sign-out.
 */
export async function getSessionUser(
  auth: Pick<Auth, "api">,
  headers: Headers
): Promise<VerifiedAuthUser | null> {
  const session = await auth.api.getSession({ headers })
  if (!session?.user.id) return null
  return {
    id: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
  }
}
