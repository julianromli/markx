import { captureSession } from "./lib/session"

async function reportSession(): Promise<void> {
  const capture = await captureSession()
  if (capture.kind === "unavailable") return
  if (capture.kind === "signed-out") {
    void chrome.runtime.sendMessage({
      type: "markx-session",
      signedOut: true,
    })
    return
  }
  void chrome.runtime.sendMessage({
    type: "markx-session",
    token: capture.token,
    user: capture.user,
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    !message ||
    typeof message !== "object" ||
    (message as { type?: unknown }).type !== "markx-request-session"
  ) {
    return
  }
  void (async () => {
    const capture = await captureSession()
    if (capture.kind === "signed-in") {
      void chrome.runtime.sendMessage({
        type: "markx-session",
        token: capture.token,
        user: capture.user,
      })
    } else if (capture.kind === "signed-out") {
      void chrome.runtime.sendMessage({
        type: "markx-session",
        signedOut: true,
      })
    }
    sendResponse(capture)
  })()
  return true
})

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void reportSession()
})

window.addEventListener("focus", () => {
  void reportSession()
})

void reportSession()
