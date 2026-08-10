/**
 * Open an external URL from a user gesture.
 *
 * Mobile in-app browsers (Threads, Instagram, etc.) often block
 * `window.open` when a features string like `"noopener,noreferrer"` is
 * passed. Prefer a bare `_blank` open; if the WebView blocks it, navigate
 * this tab so the link still opens.
 */
export function openExternalUrl(url: string): void {
  if (typeof window === "undefined" || !url) return

  const opened = window.open(url, "_blank")
  if (opened) {
    opened.opener = null
    return
  }

  window.location.assign(url)
}
