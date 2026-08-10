import { getAuthClient } from "@/lib/auth/client"
import { refreshAuthSession, setAuthSessionGuest } from "@/lib/auth/session"
import { SyncEngine } from "@/lib/markx/sync"
import { attachEngineAndPaint } from "@/lib/markx/sync-lifecycle"
import { store } from "@/lib/markx/store"
import { clearLastUserId, resetGuestState } from "@/lib/markx/storage"

/**
 * Send a one-time password to the given email address.
 *
 * Neon Auth (Better Auth) uses the `emailOtp.sendVerificationOtp` endpoint
 * with `type: "sign-in"` for both sign-up and sign-in: if the email is not
 * yet registered, a new user is created automatically when the OTP is
 * verified. Returns `{ error }` on failure.
 */
export async function sendOtp(email: string): Promise<{ error?: string }> {
  try {
    const authClient = await getAuthClient()
    const result = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    })
    if (result.error) {
      return { error: result.error.message ?? "Failed to send OTP" }
    }
    return {}
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to send OTP",
    }
  }
}

/**
 * Verify the one-time password and complete the sign-in/sign-up.
 *
 * Neon Auth's `signIn.emailOtp` endpoint both verifies the OTP and creates
 * the session in a single call. On success, the user is authenticated.
 * The caller (UI) should then call {@link onLoginSuccess} to create the
 * SyncEngine and switch from guest mode to cloud sync.
 */
export async function verifyOtp(
  email: string,
  otp: string
): Promise<{ error?: string }> {
  try {
    const authClient = await getAuthClient()
    const result = await authClient.signIn.emailOtp({ email, otp })
    if (result.error) {
      return { error: result.error.message ?? "Invalid or expired code" }
    }
    return {}
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Verification failed",
    }
  }
}

/**
 * Called by the UI after a successful OTP verification. Creates the
 * SyncEngine, attaches it to the store, and replaces the guest state
 * with the cloud workspace (or the imported guest state).
 *
 * Returns the SyncEngine so the caller can subscribe to status updates.
 */
export async function onLoginSuccess(): Promise<SyncEngine> {
  const session = await refreshAuthSession()
  const user = session.user
  if (!user) throw new Error("No session after OTP verification")

  // First login / mode switch — await cloud (or guest import) so the UI
  // switches to the authoritative workspace before closing the dialog.
  const engine = await SyncEngine.create(user.id)
  await attachEngineAndPaint(store, engine)
  return engine
}

/**
 * Sign out the current user.
 *
 * Policy:
 *  1. Flush pending changes to the cloud (best-effort).
 *  2. Clear the per-user cache only after all pending data is synced.
 *  3. Detach the SyncEngine from the store.
 *  4. Reset guest workspace to the demo seed and enter guest mode.
 */
export async function signOut(): Promise<void> {
  const engine = store.getSyncEngine()

  if (engine) {
    const canClearCache = await engine.flushAndDestroy()
    if (canClearCache) {
      await engine.clearCache()
    }
  }

  // Tell Neon Auth to revoke the session.
  try {
    const authClient = await getAuthClient()
    await authClient.signOut()
  } catch {
    // Even if the network call fails, we clear locally.
  }

  store.detachSync()
  await clearLastUserId()

  const guestState = await resetGuestState()
  store.replaceState(guestState, { persist: false })
  setAuthSessionGuest()
}
