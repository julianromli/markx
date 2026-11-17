import {
  clearSession,
  getBaseUrl,
  getSession,
  originPattern,
  setSession,
} from "./lib/config"
import type { ExtensionSession } from "./lib/config"
import { captureSession } from "./lib/session"
import type { SessionCapture } from "./lib/session"

const CONTENT_SCRIPT_ID = "markx-session"

type SessionMessage = {
  type: "markx-session"
  signedOut?: boolean
  token?: string | null
  user?: { id: string; email: string } | null
}

type RefreshMessage = { type: "markx-refresh-session" }

function isSessionMessage(value: unknown): value is SessionMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "markx-session"
  )
}

function isRefreshMessage(value: unknown): value is RefreshMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "markx-refresh-session"
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

async function injectIntoOpenMarkxTabs(): Promise<void> {
  const baseUrl = await getBaseUrl()
  const origin = new URL(baseUrl).origin
  const tabs = await chrome.tabs.query({ url: `${origin}/*` })
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) return
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        })
      } catch {
        // Restricted pages or a tab that no longer exists.
      }
    })
  )
}

type TabSessionResult = "signed-in" | "signed-out" | "none"

async function applyTabCapture(
  capture: SessionCapture | undefined
): Promise<TabSessionResult | null> {
  if (!capture) return null
  if (capture.kind === "signed-in") {
    await setSession({ token: capture.token, user: capture.user })
    return "signed-in"
  }
  if (capture.kind === "signed-out") {
    await clearSession()
    return "signed-out"
  }
  return null
}

async function requestSessionFromOpenTabs(
  baseUrl: string
): Promise<TabSessionResult> {
  const origin = new URL(baseUrl).origin
  const tabs = await chrome.tabs.query({ url: `${origin}/*` })
  for (const tab of tabs) {
    if (tab.id == null) continue
    try {
      const capture: SessionCapture | undefined = await chrome.tabs.sendMessage(
        tab.id,
        {
          type: "markx-request-session",
        }
      )
      const applied = await applyTabCapture(capture)
      if (applied) return applied
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        })
        const capture: SessionCapture | undefined =
          await chrome.tabs.sendMessage(tab.id, {
            type: "markx-request-session",
          })
        const applied = await applyTabCapture(capture)
        if (applied) return applied
      } catch {
        // Tab could not run the content script.
      }
    }
  }
  return "none"
}

/**
 * Refresh the stored JWT. The service worker may or may not attach
 * SameSite=Lax cookies on a chrome-extension:// fetch, even with
 * host_permissions. A 401 from that fetch is not proof of sign-out.
 * An open markx tab recaptures same-origin; only a tab-confirmed
 * signed-out result clears storage.
 */
async function refreshSession(): Promise<boolean> {
  const baseUrl = await getBaseUrl()
  const captured = await captureSession(baseUrl)
  if (captured.kind === "signed-in") {
    await setSession({ token: captured.token, user: captured.user })
    return true
  }
  const fromTab = await requestSessionFromOpenTabs(baseUrl)
  if (fromTab === "signed-in") return true
  if (fromTab === "signed-out") return false
  const existing = await getSession()
  return existing != null
}

async function setupScripts(): Promise<void> {
  await registerContentScript()
  await injectIntoOpenMarkxTabs()
}

chrome.runtime.onInstalled.addListener(() => {
  void setupScripts()
})

chrome.runtime.onStartup.addListener(() => {
  void setupScripts()
})

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    if (isRefreshMessage(message)) {
      void refreshSession().then((ok) => sendResponse({ ok }))
      return true
    }
    if (!isSessionMessage(message)) return
    void (async () => {
      if (message.signedOut) {
        await clearSession()
      } else if (message.token != null && message.user != null) {
        const session: ExtensionSession = {
          token: message.token,
          user: message.user,
        }
        await setSession(session)
      }
      sendResponse({ ok: true })
    })()
    return true
  }
)

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "markx.baseUrl" in changes) {
    void setupScripts()
  }
})
