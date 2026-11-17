export type ExtensionUser = { id: string; email: string }

export type SessionCapture =
  | { kind: "signed-in"; token: string; user: ExtensionUser }
  | { kind: "signed-out" }
  | { kind: "unavailable" }

const JWT_HEADER = "set-auth-jwt"

export function looksLikeJwt(value: string): boolean {
  const parts = value.split(".")
  return parts.length === 3 && parts.every((part) => part.length > 0)
}

export function readJwtFromTokenPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const token = (payload as { token?: unknown }).token
  return typeof token === "string" && looksLikeJwt(token) ? token : null
}

export function readJwtFromHeaders(headers: {
  get: (name: string) => string | null
}): string | null {
  const value = headers.get(JWT_HEADER)
  return typeof value === "string" && looksLikeJwt(value) ? value : null
}

export function readUserFromSessionPayload(
  payload: unknown
): ExtensionUser | null {
  if (!payload || typeof payload !== "object") return null
  const root = payload as {
    user?: { id?: unknown; email?: unknown } | null
    data?: { user?: { id?: unknown; email?: unknown } | null }
  }
  const user = root.data?.user ?? root.user
  if (!user || typeof user.id !== "string" || user.id.length === 0) {
    return null
  }
  const email = typeof user.email === "string" ? user.email : ""
  return { id: user.id, email }
}

/**
 * Combine /api/auth/token and get-session results.
 *
 * Never treat Better Auth's opaque `session.token` as a JWT. Only a
 * `{ token }` body, or the `set-auth-jwt` header, counts.
 * `unavailable` means a network or incomplete response — do not clear
 * a previously stored session.
 */
export function resolveSessionCapture(input: {
  tokenStatus: number | "network"
  tokenPayload: unknown
  sessionStatus: number | "network"
  sessionPayload: unknown
  sessionJwtHeader: string | null
}): SessionCapture {
  const jwt =
    (input.tokenStatus === 200
      ? readJwtFromTokenPayload(input.tokenPayload)
      : null) ??
    (typeof input.sessionJwtHeader === "string" &&
    looksLikeJwt(input.sessionJwtHeader)
      ? input.sessionJwtHeader
      : null)

  if (input.sessionStatus === "network") return { kind: "unavailable" }
  if (input.sessionStatus === 401) return { kind: "signed-out" }
  if (input.sessionStatus < 200 || input.sessionStatus >= 300) {
    return { kind: "unavailable" }
  }

  const user = readUserFromSessionPayload(input.sessionPayload)
  if (!user) return { kind: "signed-out" }
  if (!jwt) return { kind: "unavailable" }
  return { kind: "signed-in", token: jwt, user }
}

export async function captureSession(
  baseUrl: string = ""
): Promise<SessionCapture> {
  const prefix = baseUrl.replace(/\/$/, "")
  let tokenStatus: number | "network" = "network"
  let tokenPayload: unknown = null
  try {
    const tokenResponse = await fetch(`${prefix}/api/auth/token`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
    tokenStatus = tokenResponse.status
    if (tokenResponse.ok) {
      try {
        tokenPayload = await tokenResponse.json()
      } catch {
        tokenPayload = null
      }
    }
  } catch {
    tokenStatus = "network"
  }

  try {
    const sessionResponse = await fetch(`${prefix}/api/auth/get-session`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
    let sessionPayload: unknown = null
    if (sessionResponse.status !== 401) {
      try {
        sessionPayload = await sessionResponse.json()
      } catch {
        sessionPayload = null
      }
    }
    return resolveSessionCapture({
      tokenStatus,
      tokenPayload,
      sessionStatus: sessionResponse.status,
      sessionPayload,
      sessionJwtHeader: sessionResponse.headers.get(JWT_HEADER),
    })
  } catch {
    return { kind: "unavailable" }
  }
}
