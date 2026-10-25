/**
 * Floating chrome surface: white glass, hairline border, soft lift. Shared
 * by the phone Selection toolbar and toasts so both read as one family with
 * the zoom pill and header.
 */
export const floatingSurface =
  "rounded-2xl border border-black/10 bg-white/95 shadow-[0_8px_28px_rgba(0,0,0,0.14)] backdrop-blur-xl"

/**
 * CSS variable with the height reserved by bottom chrome (the phone
 * Selection toolbar). Toasts sit above it instead of covering it.
 */
export const BOTTOM_CHROME_VAR = "--markx-bottom-chrome"
