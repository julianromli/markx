import { authClient } from "@/lib/auth/client"
import { SyncEngine } from "@/lib/markx/sync"
import { store } from "@/lib/markx/store"
import { loadState } from "@/lib/markx/storage"
import { notifyAuthChange } from "@/lib/markx/hooks"

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
  otp: string,
): Promise<{ error?: string }> {
  try {
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
  const { data } = await authClient.getSession()
  const user = data?.user
  if (!user) throw new Error("No session after OTP verification")

  const engine = await SyncEngine.create(user.id)
  store.attachSync(engine)
  const loaded = engine.getLoadedState()
  if (loaded) {
    store.replaceState(loaded)
  }
  store.markReady()
  notifyAuthChange()
  return engine
}

/**
 * Sign out the current user.
 *
 * Per the sign-out policy:
 *  1. Flush pending changes to the cloud (if online and no conflict).
 *  2. Clear the per-user IndexedDB cache.
 *  3. Detach the SyncEngine from the store.
 *  4. Switch the store back to the guest state from local IndexedDB.
 */
export async function signOut(): Promise<void> {
  const engine = store.getSyncEngine()

  if (engine) {
    // Flush pending changes before destroying the engine.
    await engine.flushAndDestroy()

    // Only clear the per-user cache if the last sync succeeded.
    // If the sync failed (offline/error), keep the cache so the next
    // login can recover pending changes from the local queue.
    if (engine.getStatus() === "saved") {
      await engine.clearCache()
    }
  }

  // Tell Neon Auth to revoke the session.
  try {
    await authClient.signOut()
  } catch {
    // Even if the network call fails, we clear locally.
  }

  // Detach the sync engine and switch to guest mode.
  store.detachSync()

  // Reset the store to the guest state from local IndexedDB so the
  // user can continue as a guest with their previous local data.
  const guestState = await loadState()
  store.replaceState(guestState)
  notifyAuthChange()
}
