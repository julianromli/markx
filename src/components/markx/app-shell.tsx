import { Link } from "@tanstack/react-router"
import type { CSSProperties, ReactNode, RefObject } from "react"
import { useState } from "react"
import { toast } from "sonner"

import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft"
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown"
import { DotsThreeOutlineIcon } from "@phosphor-icons/react/dist/csr/DotsThreeOutline"
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple"
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image"
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link"
import { ListIcon } from "@phosphor-icons/react/dist/csr/List"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { NoteBlankIcon } from "@phosphor-icons/react/dist/csr/NoteBlank"
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question"
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork"
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash"

import homeIcon from "@/assets/markx/header/home.svg"
import pixelFolder from "@/assets/markx/pixel-folder.svg"
import { HeaderAuth } from "@/components/markx/header-auth"
import { HelpDialog } from "@/components/markx/help-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ZOOM_PRESET_PERCENTS } from "@/lib/markx/geometry"
import { useMarkxActions, useMarkxHistory } from "@/lib/markx/store"
import { cn } from "@/lib/utils"

type BreadcrumbItem = {
  label: string
  to?: string
  /** When true, shows the Home app icon instead of a folder thumb. */
  home?: boolean
  /** Optional crumb image (folder preview). Defaults to folder thumb when not home. */
  imageSrc?: string
}

export type CreateAction = "note" | "link" | "board" | "image"

type AppShellProps = {
  title: string
  breadcrumb?: BreadcrumbItem[]
  mode: "home" | "folder"
  /** Set while the initial cloud sync is still running. */
  syncBlocked?: boolean
  onCreate: (action: CreateAction) => void
  trashRef: RefObject<HTMLButtonElement | null>
  /** Desktop trash mirrors mobile dock armed feedback while dragging. */
  trashArmed?: boolean
  /** True while a board item drag is active (past move threshold). */
  itemMoveDragging?: boolean
  zoomPercent?: number
  onZoomPreset?: (percent: number) => void
  onZoomFit?: () => void
  /** Open the share dialog for the current folder (folder mode only). */
  onShare?: () => void
  /** Whether the current folder is already shared (drives the icon state). */
  shared?: boolean
  children: ReactNode
}

const TOOLS: Array<{
  action: CreateAction
  label: string
  icon: typeof NoteBlankIcon
}> = [
  { action: "note", label: "Note", icon: NoteBlankIcon },
  { action: "link", label: "Link", icon: LinkIcon },
  { action: "board", label: "Folder", icon: FolderSimpleIcon },
  { action: "image", label: "Image", icon: ImageIcon },
]

/**
 * Why a create action can't run right now, or null when it can. Sidebar buttons
 * fire immediately, so an unavailable action has to explain itself up front
 * rather than failing after the click.
 */
function unavailableReason(
  action: CreateAction,
  mode: "home" | "folder",
  syncBlocked: boolean
): string | null {
  if (syncBlocked) return "Syncing your workspace…"
  if (action === "link" && mode === "home") return "Open a folder to add links"
  if (action === "board" && mode === "folder") return "Folders live on Home"
  return null
}

export function AppShell({
  title,
  breadcrumb,
  mode,
  syncBlocked = false,
  onCreate,
  trashRef,
  trashArmed = false,
  itemMoveDragging = false,
  zoomPercent,
  onZoomPreset,
  onZoomFit,
  onShare,
  shared,
  children,
}: AppShellProps) {
  const actions = useMarkxActions()
  const { canUndo, canRedo } = useMarkxHistory()
  const [helpOpen, setHelpOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const crumbs: BreadcrumbItem[] =
    breadcrumb && breadcrumb.length > 0
      ? breadcrumb
      : [{ label: "Home", to: "/", home: true }]

  const backTo =
    crumbs.length > 1
      ? crumbs
          .slice(0, -1)
          .reverse()
          .find((crumb) => crumb.to)?.to
      : undefined

  const centerTitle =
    crumbs.length > 0 ? (crumbs[crumbs.length - 1]?.label ?? title) : title

  const renderTools = (onSelect?: () => void) =>
    TOOLS.map((item) => {
      const reason = unavailableReason(item.action, mode, syncBlocked)
      return (
        <ToolButton
          key={item.action}
          label={item.label}
          reason={reason}
          onClick={() => {
            onCreate(item.action)
            onSelect?.()
          }}
          icon={
            <item.icon
              className={cn(
                "size-5",
                // NoteBlank’s dog-ear pulls visual weight right; nudge left to match peers.
                item.action === "note" && "-translate-x-px"
              )}
              weight="regular"
            />
          }
        />
      )
    })

  return (
    <div
      className="markx-shell grid h-svh grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-canvas antialiased md:grid-cols-[63px_minmax(0,1fr)]"
      style={{ "--rail-pad": "21.5px" } as CSSProperties}
    >
      <header className="relative z-30 col-span-full bg-white shadow-[0_1px_1px_rgba(51,61,78,0.2)]">
        <div className="relative flex h-12 w-full items-center justify-between gap-1">
          <div className="relative z-10 flex h-12 min-w-0 flex-1 items-center pl-[max(0.25rem,env(safe-area-inset-left))] md:pl-0">
            <button
              type="button"
              aria-label="Tools"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen(true)}
              className="flex size-11 shrink-0 items-center justify-center text-ink/80 transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/[0.03] active:scale-[0.96] md:hidden"
            >
              <ListIcon className="size-5" weight="regular" />
            </button>
            {backTo ? (
              <Link
                to={backTo}
                aria-label="Back"
                className="flex size-11 shrink-0 items-center justify-center text-ink/80 transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/[0.03] active:scale-[0.96] md:hidden"
              >
                <ArrowLeftIcon className="size-5" weight="regular" />
              </Link>
            ) : null}
            <nav
              aria-label="Breadcrumb"
              className="relative z-10 flex h-11 min-w-0 items-center"
            >
              {crumbs.map((crumb, index) => {
                const isLast = index === crumbs.length - 1
                const content = (
                  <>
                    {crumb.home ? (
                      <span className="relative size-5 shrink-0 drop-shadow-[0_1px_1px_rgba(51,61,78,0.3)]">
                        <img
                          src={homeIcon}
                          alt=""
                          className="size-full"
                          width={20}
                          height={20}
                        />
                      </span>
                    ) : (
                      <span className="relative size-[18px] shrink-0 overflow-hidden rounded-[3px]">
                        <img
                          src={crumb.imageSrc ?? pixelFolder}
                          alt=""
                          className="size-full object-contain"
                          width={18}
                          height={18}
                        />
                      </span>
                    )}
                    <span className="min-w-0 truncate text-sm leading-none font-semibold text-ink/80 md:max-w-[270px]">
                      {crumb.label}
                    </span>
                  </>
                )

                return (
                  <div
                    key={crumb.to ?? (crumb.home ? "home" : crumb.label)}
                    className={cn(
                      "flex h-11 min-w-0 items-center",
                      // First crumb icon centers in the 63px desktop rail
                      // ((63 − 20) / 2 = 21.5) so it shares an axis with sidebar tools.
                      // --rail-pad is shared with the right section for symmetric white space.
                      index === 0
                        ? "pr-1 md:pl-[var(--rail-pad)]"
                        : "px-1 md:px-0",
                      isLast ? "flex" : "hidden md:flex"
                    )}
                  >
                    {index > 0 ? (
                      <span
                        className="hidden w-[4.32px] text-center text-[12px] leading-none text-[#cbced2] md:inline"
                        aria-hidden
                      >
                        /
                      </span>
                    ) : null}
                    <div
                      className={cn(
                        "flex h-11 min-w-0 items-center",
                        index === 0 ? "pr-1" : "pr-1 pl-1 md:pl-[9px]"
                      )}
                    >
                      {crumb.to && !isLast ? (
                        <Link
                          to={crumb.to}
                          className={cn(
                            "flex h-8 max-w-full items-center gap-1.5 rounded-[3px] transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/[0.04] active:scale-[0.96] md:h-7",
                            index === 0
                              ? "px-1.5 md:pr-[7px] md:pl-0"
                              : "px-1.5 md:px-[7px]"
                          )}
                        >
                          {content}
                        </Link>
                      ) : (
                        <span
                          className={cn(
                            "flex h-8 max-w-full items-center gap-1.5 rounded-[3px] md:h-7",
                            index === 0
                              ? "px-1.5 md:pr-[7px] md:pl-0"
                              : "px-1.5 md:px-[7px]"
                          )}
                          aria-current={isLast ? "page" : undefined}
                        >
                          {content}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </nav>
          </div>

          <div className="pointer-events-none absolute inset-0 hidden items-center justify-center px-4 md:flex">
            <h1 className="max-w-[45vw] truncate text-center text-[19.8px] font-bold tracking-[-0.18px] text-balance text-ink/80">
              {centerTitle}
            </h1>
          </div>

          {/* Right edge padding mirrors the left rail (--rail-pad) for symmetric white space. */}
          <div className="relative z-10 flex h-12 shrink-0 items-center justify-end gap-1 pr-[max(0.25rem,env(safe-area-inset-right))] md:gap-0 md:pr-[var(--rail-pad)]">
            {typeof zoomPercent === "number" && onZoomPreset && onZoomFit ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="mr-1 hidden h-8 items-center gap-0.5 rounded-md px-2 text-[12px] leading-none text-ink/80 transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] outline-none hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-black/10 active:scale-[0.96] md:flex"
                  aria-label="Zoom"
                >
                  <span className="min-w-[2rem] text-right tabular-nums">
                    {zoomPercent}%
                  </span>
                  <CaretDownIcon className="size-[14px]" weight="bold" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[9.5rem]">
                  <DropdownMenuRadioGroup
                    value={
                      (ZOOM_PRESET_PERCENTS as readonly number[]).includes(
                        zoomPercent
                      )
                        ? String(zoomPercent)
                        : undefined
                    }
                    onValueChange={(value) => {
                      const percent = Number(value)
                      if (Number.isFinite(percent)) onZoomPreset(percent)
                    }}
                  >
                    {ZOOM_PRESET_PERCENTS.map((percent) => (
                      <DropdownMenuRadioItem
                        key={percent}
                        value={String(percent)}
                        className="tabular-nums"
                      >
                        {percent}%
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => onZoomFit()}>
                    Fit
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : typeof zoomPercent === "number" ? (
              <div className="mr-1 hidden h-8 items-center px-2 text-[12px] leading-none text-ink/80 md:flex">
                <span className="min-w-[2rem] text-right tabular-nums">
                  {zoomPercent}%
                </span>
              </div>
            ) : null}

            <div className="hidden items-center md:flex">
              <HeaderIconButton
                label="Undo"
                icon={
                  <ArrowCounterClockwiseIcon
                    className="size-[18px]"
                    weight="regular"
                  />
                }
                disabled={!canUndo}
                onClick={() => actions.undo()}
              />
              <HeaderIconButton
                label="Redo"
                icon={
                  <ArrowClockwiseIcon
                    className="size-[18px]"
                    weight="regular"
                  />
                }
                disabled={!canRedo}
                onClick={() => actions.redo()}
              />
            </div>

            <div className="hidden items-center pr-2 md:flex">
              <div
                className="h-6 w-2 border-r border-[rgba(0,10,20,0.08)]"
                aria-hidden
              />
            </div>

            <div className="hidden items-center md:flex">
              {onShare ? (
                <HeaderIconButton
                  label="Share"
                  icon={
                    <ShareNetworkIcon
                      className="size-5"
                      weight={shared ? "fill" : "regular"}
                    />
                  }
                  onClick={onShare}
                />
              ) : null}

              <HeaderIconButton
                label="Help"
                icon={<QuestionIcon className="size-5" weight="regular" />}
                frame
                onClick={() => setHelpOpen(true)}
              />
              <HeaderIconButton
                label="Search"
                icon={
                  <MagnifyingGlassIcon className="size-5" weight="regular" />
                }
                frame
              />
            </div>

            <button
              type="button"
              aria-label="More"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
              className="flex size-11 shrink-0 items-center justify-center text-ink/80 transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/[0.03] active:scale-[0.96] md:hidden"
            >
              <DotsThreeOutlineIcon className="size-5" weight="regular" />
            </button>

            <div className="flex shrink-0 items-center md:ml-2">
              <HeaderAuth />
            </div>
          </div>
        </div>
      </header>

      <aside className="relative z-10 col-start-1 row-start-2 hidden flex-col items-center bg-canvas pt-2.5 pb-3 shadow-[1px_0_0_rgba(0,10,20,0.06)] md:flex">
        {renderTools(() => setToolsOpen(false))}

        <div className="flex-1" />

        <button
          ref={trashRef}
          type="button"
          aria-label="Trash"
          data-armed={trashArmed ? "true" : "false"}
          data-dragging={itemMoveDragging ? "true" : "false"}
          className={cn(
            "flex size-11 items-center justify-center rounded-xl transition-[transform,background-color,box-shadow,color] duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-[background-color,color,opacity] motion-reduce:duration-150",
            !itemMoveDragging &&
              !trashArmed &&
              "text-black/55 hover:bg-black/5 active:scale-[0.96]",
            itemMoveDragging &&
              !trashArmed &&
              "scale-105 bg-ink/88 text-white shadow-[0_8px_28px_rgba(0,0,0,0.18),0_1px_0_rgba(255,255,255,0.12)_inset]",
            trashArmed &&
              "scale-110 bg-destructive text-white shadow-[0_10px_32px_color-mix(in_oklch,var(--destructive)_35%,transparent)]"
          )}
        >
          <TrashIcon
            className={cn(
              "size-5 transition-[transform] duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-none",
              trashArmed ? "scale-110" : "scale-100"
            )}
            weight={trashArmed ? "fill" : "regular"}
          />
        </button>
      </aside>

      <main className="relative col-start-1 row-start-2 min-h-0 min-w-0 md:col-start-2">
        {typeof zoomPercent === "number" &&
        onZoomPreset &&
        onZoomFit ? (
          <div className="pointer-events-none absolute top-3 right-3 z-20 md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger
                className="pointer-events-auto flex h-11 items-center gap-1 rounded-xl border border-black/10 bg-white/90 px-3 text-[13px] font-medium text-ink/80 shadow-sm backdrop-blur-xl transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-black/10 active:scale-[0.96]"
                aria-label="Zoom"
              >
                <span className="tabular-nums" suppressHydrationWarning>
                  {zoomPercent}%
                </span>
                <CaretDownIcon className="size-[14px]" weight="bold" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[9.5rem]">
                <DropdownMenuRadioGroup
                  value={
                    (ZOOM_PRESET_PERCENTS as readonly number[]).includes(
                      zoomPercent
                    )
                      ? String(zoomPercent)
                      : undefined
                  }
                  onValueChange={(value) => {
                    const percent = Number(value)
                    if (Number.isFinite(percent)) onZoomPreset(percent)
                  }}
                >
                  {ZOOM_PRESET_PERCENTS.map((percent) => (
                    <DropdownMenuRadioItem
                      key={percent}
                      value={String(percent)}
                      className="tabular-nums"
                    >
                      {percent}%
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onZoomFit()}>
                  Fit
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
        {children}
      </main>

      {/* Mobile tool drawer */}
      <Sheet open={toolsOpen} onOpenChange={setToolsOpen}>
        <SheetContent
          side="left"
          aria-label="Tools"
          className="w-[80%] max-w-[320px] gap-0 p-0 pt-[env(safe-area-inset-top)] [&_[data-slot=sheet-close]]:top-[max(1rem,env(safe-area-inset-top))] [&_[data-slot=sheet-close]]:size-11"
        >
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle>Tools</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-1.5 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {renderTools(() => setToolsOpen(false))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile overflow menu (Help / Search) */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          aria-label="More"
          className="gap-0 p-2 pt-14 pb-[max(0.75rem,env(safe-area-inset-bottom))] [&_[data-slot=sheet-close]]:size-11"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          {onShare ? (
            <MoreMenuItem
              label="Share"
              icon={
                <ShareNetworkIcon
                  className="size-5"
                  weight={shared ? "fill" : "regular"}
                />
              }
              onClick={() => {
                setMoreOpen(false)
                onShare()
              }}
            />
          ) : null}
          <MoreMenuItem
            label="Help"
            icon={<QuestionIcon className="size-5" weight="regular" />}
            onClick={() => {
              setMoreOpen(false)
              setHelpOpen(true)
            }}
          />
          <MoreMenuItem
            label="Search"
            icon={<MagnifyingGlassIcon className="size-5" weight="regular" />}
            onClick={() => setMoreOpen(false)}
          />
        </SheetContent>
      </Sheet>

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}

function HeaderIconButton({
  label,
  icon,
  disabled,
  frame,
  last,
  onClick,
}: {
  label: string
  icon: ReactNode
  disabled?: boolean
  /** Wider hit target for help/search/bell/settings */
  frame?: boolean
  last?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex h-12 items-center justify-center text-ink/80 transition-[transform,opacity,background-color] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-20 disabled:active:scale-100",
        frame ? (last ? "w-11 md:w-8" : "w-11 md:w-10") : "w-11 md:w-[34px]",
        !disabled && "hover:bg-black/[0.03]"
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center",
          frame
            ? cn("h-6", last ? "w-8 pl-2" : "w-10 px-2")
            : "h-[21px] w-[34px] px-2 pb-0.5"
        )}
      >
        {icon}
      </span>
    </button>
  )
}

/**
 * Uses `aria-disabled` rather than `disabled` when unavailable: a truly disabled
 * button emits no pointer events, so the tooltip explaining *why* would never
 * open. The click handler is gated instead.
 */
function ToolButton({
  label,
  icon,
  reason,
  onClick,
}: {
  label: string
  icon: ReactNode
  /** Why this action can't run, or null when it can. */
  reason?: string | null
  onClick?: () => void
}) {
  const unavailable = reason != null

  const button = (
    <button
      type="button"
      aria-disabled={unavailable || undefined}
      // Tooltips don't open on touch, so a tap on an unavailable tool falls back
      // to a toast carrying the same reason.
      onClick={unavailable ? () => toast(reason) : onClick}
      className={cn(
        "mb-0.5 flex w-full flex-col items-center gap-1 rounded-xl px-1 py-3 text-[11px] text-ink-muted transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-out-strong)] md:mb-0.5 md:w-[56px] md:gap-0.5 md:py-1.5 md:text-[10px]",
        unavailable
          ? "cursor-not-allowed opacity-45"
          : "hover:bg-black/5 active:scale-[0.96]"
      )}
    >
      <span className="flex size-8 items-center justify-center drop-shadow-[0_1px_1px_rgba(51,61,78,0.2)] md:size-7">
        {icon}
      </span>
      {label}
    </button>
  )

  if (!unavailable) return button

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="right">{reason}</TooltipContent>
    </Tooltip>
  )
}

function MoreMenuItem({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[15px] font-medium text-ink/80 transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/[0.04] active:scale-[0.99]"
    >
      <span className="text-black/55">{icon}</span>
      {label}
    </button>
  )
}
