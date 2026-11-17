import { describe, expect, it } from "vitest"

import {
  decideUpgradeIntent,
  hasUpgradeParam,
  stripUpgradeParam,
} from "@/lib/markx/upgrade-query"

describe("hasUpgradeParam", () => {
  it("is true only for upgrade=1", () => {
    expect(hasUpgradeParam("?upgrade=1")).toBe(true)
    expect(hasUpgradeParam("upgrade=1")).toBe(true)
    expect(hasUpgradeParam("?foo=1&upgrade=1")).toBe(true)
    expect(hasUpgradeParam("?upgrade=true")).toBe(false)
    expect(hasUpgradeParam("?upgrade=0")).toBe(false)
    expect(hasUpgradeParam("")).toBe(false)
    expect(hasUpgradeParam("?foo=1")).toBe(false)
  })
})

describe("stripUpgradeParam", () => {
  it("removes upgrade and keeps the rest of the URL", () => {
    expect(stripUpgradeParam("https://markx.app/?upgrade=1")).toBe("/")
    expect(stripUpgradeParam("https://markx.app/?upgrade=1&x=2")).toBe("/?x=2")
    expect(stripUpgradeParam("/folder/abc?upgrade=1")).toBe("/folder/abc")
    expect(stripUpgradeParam("/?foo=1#board")).toBe("/?foo=1#board")
    expect(stripUpgradeParam("/?upgrade=1#board")).toBe("/#board")
  })
})

describe("decideUpgradeIntent", () => {
  const free = { billingEnabled: true, plan: "free" as const }
  const pro = { billingEnabled: true, plan: "pro" as const }
  const billingOff = { billingEnabled: false, plan: "free" as const }

  it("ignores a URL with no upgrade param", () => {
    expect(
      decideUpgradeIntent({
        hasParam: false,
        authPending: false,
        signedIn: true,
        entitlements: free,
        entitlementsReady: true,
      })
    ).toBe("ignore")
  })

  it("waits while auth is pending", () => {
    expect(
      decideUpgradeIntent({
        hasParam: true,
        authPending: true,
        signedIn: false,
        entitlements: null,
      })
    ).toBe("wait")
  })

  it("sends a signed-out visitor to sign in", () => {
    expect(
      decideUpgradeIntent({
        hasParam: true,
        authPending: false,
        signedIn: false,
        entitlements: null,
      })
    ).toBe("signin")
  })

  it("waits for entitlements when signed in", () => {
    expect(
      decideUpgradeIntent({
        hasParam: true,
        authPending: false,
        signedIn: true,
        entitlements: null,
      })
    ).toBe("wait")
  })

  it("opens the upgrade dialog for a signed-in free user", () => {
    expect(
      decideUpgradeIntent({
        hasParam: true,
        authPending: false,
        signedIn: true,
        entitlements: free,
        entitlementsReady: true,
      })
    ).toBe("open")
  })

  it("ignores and is ready to strip when the user is already Pro", () => {
    expect(
      decideUpgradeIntent({
        hasParam: true,
        authPending: false,
        signedIn: true,
        entitlements: pro,
        entitlementsReady: true,
      })
    ).toBe("ignore")
  })

  it("ignores when billing is disabled", () => {
    expect(
      decideUpgradeIntent({
        hasParam: true,
        authPending: false,
        signedIn: true,
        entitlements: billingOff,
        entitlementsReady: true,
      })
    ).toBe("ignore")
  })

  it("ignores when entitlements failed to load", () => {
    expect(
      decideUpgradeIntent({
        hasParam: true,
        authPending: false,
        signedIn: true,
        entitlements: null,
        entitlementsReady: true,
      })
    ).toBe("ignore")
  })
})
