/**
 * One-shot "select this item when its board shows" request, used when an
 * action (Search) navigates to another board before the item exists there.
 */
let pending: string | null = null

export function requestItemFocus(id: string): void {
  pending = id
}

/** Returns and clears the request if `isPresent(id)`; otherwise keeps it. */
export function takeItemFocusRequest(
  isPresent: (id: string) => boolean
): string | null {
  if (pending == null || !isPresent(pending)) return null
  const id = pending
  pending = null
  return id
}
