import { useSyncExternalStore } from "react"

const QUERY = "(pointer: coarse)"

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * True when the primary pointer is a finger (phones, tablets). Read during
 * the first client render, so touch layouts do not flash the mouse layout.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
