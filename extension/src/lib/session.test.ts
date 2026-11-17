import { describe, expect, it } from "vitest"

import {
  looksLikeJwt,
  readJwtFromHeaders,
  readJwtFromTokenPayload,
  readUserFromSessionPayload,
  resolveSessionCapture,
} from "./session"

const JWT = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1MSJ9.signature"
const OPAQUE = "better-auth-opaque-session-token"

describe("looksLikeJwt", () => {
  it("accepts a three-segment token and rejects opaque session tokens", () => {
    expect(looksLikeJwt(JWT)).toBe(true)
    expect(looksLikeJwt(OPAQUE)).toBe(false)
    expect(looksLikeJwt("a.b")).toBe(false)
    expect(looksLikeJwt("")).toBe(false)
  })
})

describe("readJwtFromTokenPayload", () => {
  it("reads { token } only when the value looks like a JWT", () => {
    expect(readJwtFromTokenPayload({ token: JWT })).toBe(JWT)
    expect(readJwtFromTokenPayload({ token: OPAQUE })).toBeNull()
    expect(readJwtFromTokenPayload({ session: { token: JWT } })).toBeNull()
    expect(readJwtFromTokenPayload(null)).toBeNull()
  })
})

describe("readUserFromSessionPayload", () => {
  it("reads the user from a top-level or { data } payload", () => {
    expect(
      readUserFromSessionPayload({
        user: { id: "u1", email: "a@example.com" },
      })
    ).toEqual({ id: "u1", email: "a@example.com" })
    expect(
      readUserFromSessionPayload({
        data: { user: { id: "u1", email: "a@example.com" } },
      })
    ).toEqual({ id: "u1", email: "a@example.com" })
  })

  it("treats a missing user as signed out", () => {
    expect(readUserFromSessionPayload({ user: null })).toBeNull()
    expect(readUserFromSessionPayload({})).toBeNull()
    expect(
      readUserFromSessionPayload({ session: { token: OPAQUE } })
    ).toBeNull()
  })
})

describe("readJwtFromHeaders", () => {
  it("reads set-auth-jwt and ignores a non-JWT value", () => {
    const headers = new Headers({ "set-auth-jwt": JWT })
    expect(readJwtFromHeaders(headers)).toBe(JWT)
    expect(
      readJwtFromHeaders(new Headers({ "set-auth-jwt": OPAQUE }))
    ).toBeNull()
    expect(readJwtFromHeaders(new Headers())).toBeNull()
  })
})

describe("resolveSessionCapture", () => {
  const user = { user: { id: "u1", email: "a@example.com" } }

  it("prefers the JWT from /api/auth/token", () => {
    expect(
      resolveSessionCapture({
        tokenStatus: 200,
        tokenPayload: { token: JWT },
        sessionStatus: 200,
        sessionPayload: user,
        sessionJwtHeader: null,
      })
    ).toEqual({
      kind: "signed-in",
      token: JWT,
      user: { id: "u1", email: "a@example.com" },
    })
  })

  it("falls back to the set-auth-jwt header", () => {
    expect(
      resolveSessionCapture({
        tokenStatus: 404,
        tokenPayload: null,
        sessionStatus: 200,
        sessionPayload: user,
        sessionJwtHeader: JWT,
      })
    ).toEqual({
      kind: "signed-in",
      token: JWT,
      user: { id: "u1", email: "a@example.com" },
    })
  })

  it("does not use Better Auth's opaque session.token as a JWT", () => {
    expect(
      resolveSessionCapture({
        tokenStatus: 200,
        tokenPayload: { token: OPAQUE },
        sessionStatus: 200,
        sessionPayload: {
          user: { id: "u1", email: "a@example.com" },
          session: { token: OPAQUE },
        },
        sessionJwtHeader: null,
      })
    ).toEqual({ kind: "unavailable" })
  })

  it("reports signed-out on a 401 or a session without a user", () => {
    expect(
      resolveSessionCapture({
        tokenStatus: 401,
        tokenPayload: null,
        sessionStatus: 401,
        sessionPayload: null,
        sessionJwtHeader: null,
      })
    ).toEqual({ kind: "signed-out" })
    expect(
      resolveSessionCapture({
        tokenStatus: 401,
        tokenPayload: null,
        sessionStatus: 200,
        sessionPayload: { user: null },
        sessionJwtHeader: null,
      })
    ).toEqual({ kind: "signed-out" })
  })

  it("does not clear on a network error, even if the token endpoint failed", () => {
    expect(
      resolveSessionCapture({
        tokenStatus: "network",
        tokenPayload: null,
        sessionStatus: "network",
        sessionPayload: null,
        sessionJwtHeader: null,
      })
    ).toEqual({ kind: "unavailable" })
    expect(
      resolveSessionCapture({
        tokenStatus: 200,
        tokenPayload: { token: JWT },
        sessionStatus: "network",
        sessionPayload: null,
        sessionJwtHeader: null,
      })
    ).toEqual({ kind: "unavailable" })
  })

  it("can still sign in from get-session when /api/auth/token returns 401", () => {
    expect(
      resolveSessionCapture({
        tokenStatus: 401,
        tokenPayload: null,
        sessionStatus: 200,
        sessionPayload: user,
        sessionJwtHeader: JWT,
      })
    ).toEqual({
      kind: "signed-in",
      token: JWT,
      user: { id: "u1", email: "a@example.com" },
    })
  })
})
