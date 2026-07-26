/**
 * Client-side OTP send cooldown, persisted in sessionStorage so closing the
 * auth dialog (or navigating "Change email") cannot bypass the wait.
 *
 * This is a UX / soft guard. The auth proxy also enforces a server-side limit.
 */

export const OTP_SEND_COOLDOWN_SECONDS = 60

const STORAGE_KEY = "markx:otp-send-cooldown"

type CooldownStore = Record<string, number>

function canUseSessionStorage(): boolean {
  return typeof sessionStorage !== "undefined"
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function readStore(): CooldownStore {
  if (!canUseSessionStorage()) return {}
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const store: CooldownStore = {}
    for (const [email, until] of Object.entries(parsed)) {
      if (typeof until === "number" && Number.isFinite(until)) {
        store[email] = until
      }
    }
    return store
  } catch {
    return {}
  }
}

function writeStore(store: CooldownStore): void {
  if (!canUseSessionStorage()) return
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota / private mode — ignore; in-memory React state still applies.
  }
}

function pruneStore(store: CooldownStore, now: number): CooldownStore {
  const next: CooldownStore = {}
  for (const [email, until] of Object.entries(store)) {
    if (until > now) next[email] = until
  }
  return next
}

/** Remaining cooldown seconds for `email` (0 when allowed to send). */
export function getOtpCooldownRemainingSeconds(
  email: string,
  now = Date.now()
): number {
  const key = normalizeEmail(email)
  if (!key) return 0
  const until = readStore()[key]
  if (!until) return 0
  return Math.max(0, Math.ceil((until - now) / 1000))
}

/** Start (or restart) the 60s cooldown after a successful OTP send. */
export function startOtpCooldown(email: string, now = Date.now()): void {
  const key = normalizeEmail(email)
  if (!key) return
  const store = pruneStore(readStore(), now)
  store[key] = now + OTP_SEND_COOLDOWN_SECONDS * 1000
  writeStore(store)
}

/** Clear cooldown for tests / explicit resets. */
export function clearOtpCooldown(email?: string): void {
  if (!canUseSessionStorage()) return
  if (!email) {
    sessionStorage.removeItem(STORAGE_KEY)
    return
  }
  const key = normalizeEmail(email)
  const store = readStore()
  delete store[key]
  writeStore(store)
}
