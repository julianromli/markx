const FORWARDED_AUTH_HEADERS = [
  "content-type",
  "origin",
  "cookie",
  "authorization",
  "accept",
  "accept-language",
] as const

export function isAuthProxyPath(pathname: string): boolean {
  return pathname.startsWith("/api/auth/")
}

/** Neon/Better Auth endpoint that triggers an OTP email send. */
export function isEmailOtpSendPath(pathname: string): boolean {
  return pathname === "/api/auth/email-otp/send-verification-otp"
}

export function buildAuthTargetUrl(
  requestUrl: string,
  authBaseUrl: string
): URL {
  const source = new URL(requestUrl)
  const subPath = source.pathname.replace(/^\/api\/auth\/?/, "")
  const base = authBaseUrl.endsWith("/") ? authBaseUrl : `${authBaseUrl}/`
  const target = new URL(subPath, base)
  target.search = source.search
  return target
}

export function buildAuthProxyHeaders(source: Headers): Headers {
  const headers = new Headers()
  for (const name of FORWARDED_AUTH_HEADERS) {
    const value = source.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

export function rewriteAuthCookie(cookie: string): string {
  return cookie
    .replace(/;\s*Domain=[^;]*/gi, "")
    .replace(/;\s*SameSite=[^;]*/gi, "; SameSite=Lax")
}
