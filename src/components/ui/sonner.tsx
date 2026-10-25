"use client"

import { Toaster as Sonner } from "sonner"
import type { ToasterProps } from "sonner"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info"
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning"
import { XCircleIcon } from "@phosphor-icons/react/dist/csr/XCircle"
import { SpinnerIcon } from "@phosphor-icons/react/dist/csr/Spinner"

import {
  BOTTOM_CHROME_VAR,
  floatingSurface,
} from "@/components/markx/floating-surface"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * markx toasts: the floating chrome surface (same as the phone Selection
 * toolbar), Geist 13px medium ink text, and the shared secondary pill
 * Button for actions. Sonner's own visual styles are off (`unstyled`); its
 * positioning, stacking, swipe, and live region stay.
 *
 * markx has no dark theme (nothing sets `.dark`), so the theme is pinned to
 * light instead of following the OS and switching Sonner's palette alone.
 */
const actionClass = cn(
  buttonVariants({ variant: "secondary", size: "sm" }),
  "shrink-0 pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:px-4"
)

const Toaster = ({ theme = "light", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      // Phones: clear the iOS home indicator and any bottom chrome.
      mobileOffset={{
        bottom: `calc(var(${BOTTOM_CHROME_VAR}, 0px) + max(12px, env(safe-area-inset-bottom)))`,
      }}
      icons={{
        success: <CheckCircleIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <WarningIcon className="size-4" />,
        error: <XCircleIcon className="size-4" />,
        loading: <SpinnerIcon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: cn(
            "markx-toast flex w-full items-center gap-3 py-1.5 pr-1.5 pl-4 font-sans text-[13px] font-medium text-ink",
            // Text-only toasts keep the same height as ones with an action.
            "min-h-[46px] pointer-coarse:min-h-[56px]",
            floatingSurface
          ),
          content: "flex min-w-0 flex-1 flex-col gap-0.5 py-1",
          title: "text-[13px] leading-snug font-medium text-ink/80",
          description: "text-[12px] leading-snug text-ink-muted",
          icon: "shrink-0 text-ink/70",
          actionButton: actionClass,
          cancelButton: cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "shrink-0 pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:px-4"
          ),
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
