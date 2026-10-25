/**
 * Mirror the visual viewport into CSS variables on <html>:
 *   --vv-top    offset of the visible area from the layout viewport top
 *   --vv-height height of the visible area
 *
 * iOS Safari does not shrink the layout viewport when the virtual keyboard
 * opens, so `fixed; top: 50%` dialogs end up under the keyboard. Centering
 * on these variables keeps them in the visible area.
 */
export function installVisualViewportVars(win: Window = window): () => void {
  const vv = win.visualViewport
  if (!vv) return () => {}
  const root = win.document.documentElement
  const update = () => {
    root.style.setProperty("--vv-top", `${vv.offsetTop}px`)
    root.style.setProperty("--vv-height", `${vv.height}px`)
  }
  update()
  vv.addEventListener("resize", update)
  vv.addEventListener("scroll", update)
  return () => {
    vv.removeEventListener("resize", update)
    vv.removeEventListener("scroll", update)
  }
}
