/**
 * Geometry + haptic helpers for the mobile drag-to-delete dock.
 */

export function pointInElement(
  clientX: number,
  clientY: number,
  el: HTMLElement | null | undefined
): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return (
    clientX >= r.left &&
    clientX <= r.right &&
    clientY >= r.top &&
    clientY <= r.bottom
  )
}

export function vibrateDeleteFeedback(kind: "armed" | "commit"): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return
  }
  try {
    if (kind === "armed") {
      navigator.vibrate(10)
    } else {
      navigator.vibrate([12, 24, 12])
    }
  } catch {
    // Vibration can throw when blocked by the UA — ignore.
  }
}

export function deleteDockLabel(count: number): string {
  if (count <= 1) return "Delete"
  return `Delete ${count}`
}
