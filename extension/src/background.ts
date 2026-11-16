import {
  clearSession,
  getBaseUrl,
  originPattern,
  setSession,
  type ExtensionSession,
} from "./lib/config"

const CONTENT_SCRIPT_ID = "markx-session"

type SessionMessage = {
  type: "markx-session"
  token?: string | null
  user?: { id: string; email: string } | null
}

function isSessionMessage(value: unknown): value is SessionMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "markx-session"
  )
}

async function registerContentScript(): Promise<void> {
  const baseUrl = await getBaseUrl()
  const matches = [originPattern(baseUrl)]
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: [CONTENT_SCRIPT_ID],
    })
  } catch {
    // Not registered yet.
  }
  await chrome.scripting.registerContentScripts([
    {
      id: CONTENT_SCRIPT_ID,
      js: ["content.js"],
      matches,
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ])
}

chrome.runtime.onInstalled.addListener(() => {
  void registerContentScript()
})

chrome.runtime.onStartup.addListener(() => {
  void registerContentScript()
})

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (!isSessionMessage(message)) return
    void (async () => {
      if (message.token && message.user) {
        const session: ExtensionSession = {
          token: message.token,
          user: message.user,
        }
        await setSession(session)
      } else {
        await clearSession()
      }
      sendResponse({ ok: true })
    })()
    return true
  }
)

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes["markx.baseUrl"]) {
    void registerContentScript()
  }
})
