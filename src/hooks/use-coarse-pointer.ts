import * as React from "react"

const QUERY = "(pointer: coarse)"

/** True when the primary pointer is a finger (phones, tablets). */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = React.useState(false)

  React.useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = () => setCoarse(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return coarse
}
