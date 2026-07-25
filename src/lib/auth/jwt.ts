import { createRemoteJWKSet, jwtVerify } from "jose"
import type { VerifiedAuthUser } from "./types"

/**
 * JWKS key set cached at module scope. Workers reuse the same isolate
 * across requests, so this cache persists between invocations. The JWKS
 * endpoint is fetched lazily on first verification and refreshed
 * automatically by `jose` when keys rotate.
 */
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null
let cachedIssuer: string | null = null

function getJwks(jwksUrl: string, issuer: string) {
  if (jwksCache && cachedIssuer === issuer) return jwksCache
  jwksCache = createRemoteJWKSet(new URL(jwksUrl))
  cachedIssuer = issuer
  return jwksCache
}

/**
 * Verify a Neon Auth JWT (EdDSA / Ed25519) against the JWKS endpoint.
 *
 * Returns the user `sub` (Neon Auth user ID) and email, or `null` if the
 * token is missing, expired, or fails signature/issuer/audience
 * verification. The caller must treat `null` as unauthenticated.
 */
export async function verifyNeonJwt(
  token: string | null | undefined,
  env: { NEON_AUTH_JWKS_URL: string; NEON_AUTH_BASE_URL: string }
): Promise<VerifiedAuthUser | null> {
  if (!token) return null

  const issuer = new URL(env.NEON_AUTH_BASE_URL).origin
  const jwks = getJwks(env.NEON_AUTH_JWKS_URL, issuer)

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: issuer,
      algorithms: ["EdDSA"],
    })

    const id = payload.sub
    if (typeof id !== "string" || !id) return null
    const email = typeof payload.email === "string" ? payload.email : ""

    return {
      id,
      email,
      emailVerified: payload.emailVerified === true,
    }
  } catch {
    return null
  }
}

/**
 * Extract the Bearer token from an Authorization header.
 */
export function extractBearer(
  header: string | null | undefined
): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1] : null
}
