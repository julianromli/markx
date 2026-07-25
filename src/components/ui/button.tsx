import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva } from "class-variance-authority"
import type { VariantProps } from "class-variance-authority"

import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-4xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,filter,transform,translate] duration-150 ease-[var(--ease-out-strong)] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 data-loading:opacity-100 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-linear-to-b from-[oklch(0.3_0_0)] to-[oklch(0.14_0_0)] bg-clip-border text-white shadow-[0_1px_2px_rgba(0,0,0,0.22)] hover:brightness-110 active:not-aria-[haspopup]:scale-[0.97] active:not-aria-[haspopup]:brightness-95 dark:from-[oklch(0.94_0_0)] dark:to-[oklch(0.82_0_0)] dark:text-neutral-900 dark:shadow-[0_1px_2px_rgba(0,0,0,0.35)] dark:hover:brightness-105 dark:active:not-aria-[haspopup]:brightness-95",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const labelMotion =
  "col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 transition-[opacity,translate] duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-opacity"

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** When true, idle content slides down and a spinner slides in from above. */
    loading?: boolean
  }) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading ? "" : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      <span className="relative inline-grid overflow-hidden">
        <span
          className={cn(
            labelMotion,
            loading
              ? "pointer-events-none translate-y-full opacity-0 motion-reduce:translate-y-0"
              : "translate-y-0 opacity-100"
          )}
          aria-hidden={loading || undefined}
        >
          {children}
        </span>
        <span
          className={cn(
            labelMotion,
            loading
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-full opacity-0 motion-reduce:translate-y-0"
          )}
          aria-hidden={!loading}
        >
          <Spinner />
        </span>
      </span>
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
