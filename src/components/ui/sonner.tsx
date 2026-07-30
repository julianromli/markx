"use client"

import { Toaster as Sonner } from "sonner"
import type { ToasterProps } from "sonner"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info"
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning"
import { XCircleIcon } from "@phosphor-icons/react/dist/csr/XCircle"
import { SpinnerIcon } from "@phosphor-icons/react/dist/csr/Spinner"

const Toaster = ({ theme = "system", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CheckCircleIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <WarningIcon className="size-4" />,
        error: <XCircleIcon className="size-4" />,
        loading: <SpinnerIcon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
