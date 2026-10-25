/** True on macOS, iPadOS, and iOS (Cmd is the modifier there). */
export function isApplePlatform(
  nav:
    Pick<Navigator, "platform" | "userAgent"> | undefined = typeof navigator ===
  "undefined"
    ? undefined
    : navigator
): boolean {
  if (!nav) return false
  return /mac|iphone|ipad|ipod/i.test(`${nav.platform} ${nav.userAgent}`)
}

/** "⌘N" on Apple platforms, "Ctrl+N" elsewhere. */
export function shortcutLabel(key: string, apple = isApplePlatform()): string {
  return apple ? `\u2318${key}` : `Ctrl+${key}`
}
