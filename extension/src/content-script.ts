type SessionPayload = {
  user?: { id: string; email: string } | null
  session?: { token?: string | null } | null
}

function readSession(payload: unknown): {
  token: string
  user: { id: string; email: string }
} | null {
  if (!payload || typeof payload !== "object") return null
  const root = payload as SessionPayload & { data?: SessionPayload }
  const data = root.data ?? root
  const user = data.user
  const token = data.session?.token
  if (!user?.id || !user.email || !token) return null
  return { token, user: { id: user.id, email: user.email } }
}

async function reportSession(): Promise<void> {
  try {
    const response = await fetch("/api/auth/get-session", {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
    if (!response.ok) {
      void chrome.runtime.sendMessage({ type: "markx-session" })
      return
    }
    const payload: unknown = await response.json()
    const session = readSession(payload)
    void chrome.runtime.sendMessage({
      type: "markx-session",
      token: session?.token ?? null,
      user: session?.user ?? null,
    })
  } catch {
    // Leave whatever the extension already stored.
  }
}

void reportSession()
