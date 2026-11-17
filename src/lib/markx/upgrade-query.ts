/** Query key used by the Chrome extension's "Upgrade to Pro" button. */
export const UPGRADE_QUERY_KEY = "upgrade"

export type UpgradeIntent = "open" | "signin" | "ignore" | "wait"

export type UpgradeEntitlements = {
  billingEnabled: boolean
  plan: "free" | "pro" | string
}

/**
 * True when the URL asks the app to open the Pro upgrade dialog
 * (`/?upgrade=1`).
 */
export function hasUpgradeParam(
  search: string = typeof window === "undefined" ? "" : window.location.search
): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search
  return new URLSearchParams(raw).get(UPGRADE_QUERY_KEY) === "1"
}

/**
 * Path + search + hash with `upgrade` removed, leaving any other
 * params in place.
 */
export function stripUpgradeParam(href: string): string {
  const url = new URL(href, "https://markx.app")
  url.searchParams.delete(UPGRADE_QUERY_KEY)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Drop `upgrade` from the current address without a navigation,
 * so a refresh does not reopen the dialog.
 */
export function replaceUpgradeQueryInHistory(): void {
  if (typeof window === "undefined") return
  if (!hasUpgradeParam(window.location.search)) return
  const next = stripUpgradeParam(window.location.href)
  window.history.replaceState(window.history.state, "", next)
}

/**
 * Decide what `?upgrade=1` should do given auth and plan state.
 *
 * - signed in + free + billing on → open the existing checkout dialog
 * - signed out → send to sign-in (leave the param so it can open after login)
 * - already Pro, or billing disabled → ignore
 * - auth or entitlements still loading → wait
 */
export function decideUpgradeIntent(input: {
  hasParam: boolean
  authPending: boolean
  signedIn: boolean
  entitlements: UpgradeEntitlements | null
  entitlementsReady?: boolean
}): UpgradeIntent {
  if (!input.hasParam) return "ignore"
  if (input.authPending) return "wait"
  if (!input.signedIn) return "signin"
  if (!input.entitlementsReady && input.entitlements == null) return "wait"
  if (
    input.entitlements?.billingEnabled === true &&
    input.entitlements.plan !== "pro"
  ) {
    return "open"
  }
  return "ignore"
}
