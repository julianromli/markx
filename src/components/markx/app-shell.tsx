import { Link } from "@tanstack/react-router"
import type { ReactNode, RefObject } from "react"
import { useState } from "react"
import { toast } from "sonner"

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  DotsThreeOutlineIcon,
  FolderSimpleIcon,
  GearIcon,
  ImageIcon,
  LinkIcon,
  ListIcon,
  MagnifyingGlassIcon,
  NoteBlankIcon,
  QuestionIcon,
  TrashIcon,
} from "@phosphor-icons/react"

import homeIcon from "@/assets/markx/header/home.svg"
import pixelFolder from "@/assets/markx/pixel-folder.svg"
import { HeaderAuth } from "@/components/markx/header-auth"
import { HelpDialog } from "@/components/markx/help-dialog"
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
  zoomPercent?: number
  children: ReactNode
}

const TOOLS: Array<{
  action: CreateAction
  label: string
  icon: typeof NoteBlankIcon
}> = [
  { action: "note", label: "Note", icon: NoteBlankIcon },
  { action: "link", label: "Link", icon: LinkIcon },
  { action: "board", label: "Board", icon: FolderSimpleIcon },
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
  zoomPercent,
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
          icon={<item.icon className="size-5" weight="regular" />}
        />
      )
    })

  return (
    <div className="markx-shell grid h-svh grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-[#ebedee] antialiased md:grid-cols-[63px_minmax(0,1fr)]">
      <header className="relative z-30 col-span-full bg-white shadow-[0_1px_1px_rgba(51,61,78,0.2)]">
        <div className="relative flex h-12 w-full items-center justify-between">
          <div className="relative z-10 flex h-12 min-w-0 items-center pl-[env(safe-area-inset-left)]">
            <button
              type="button"
              aria-label="Tools"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen(true)}
              className="flex h-12 w-11 shrink-0 items-center justify-center text-[rgba(32,32,32,0.8)] transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/[0.03] active:scale-[0.96] md:hidden"
            >
              <ListIcon className="size-5" weight="regular" />
            </button>
            <nav
              aria-label="Breadcrumb"
              className="relative z-10 flex h-7 min-w-0 items-center"
            >
              {crumbs.map((crumb, index) => {
                const isLast = index === crumbs.length - 1
                const content = (
                  <>
                    {crumb.home ? (
                      <span className="relative size-[18px] shrink-0 drop-shadow-[0_1px_1px_rgba(51,61,78,0.3)]">
                        <img
                          src={homeIcon}
                          alt=""
                          className="size-full"
                          width={18}
                          height={18}
                        />
                      </span>
                    ) : (
                      <span className="relative size-[18px] shrink-0 overflow-hidden rounded-[3px] outline outline-1 -outline-offset-1 outline-black/10">
                        <img
                          src={crumb.imageSrc ?? pixelFolder}
                          alt=""
                          className="size-full object-contain"
                          width={18}
                          height={18}
                        />
                      </span>
                    )}
                    <span className="max-w-[40vw] truncate text-[12px] leading-3 font-semibold text-[rgba(32,32,32,0.8)] md:max-w-[270px]">
                      {crumb.label}
                    </span>
                  </>
                )

                return (
                  <div
                    key={`${crumb.label}-${index}`}
                    className={cn(
                      "flex h-7 items-center",
                      isLast ? "flex" : "hidden md:flex"
                    )}
                  >
                    {index > 0 ? (
                      <span
                        className="hidden w-[4.32px] text-center text-[12px] leading-3 text-[#cbced2] md:inline"
                        aria-hidden
                      >
                        /
                      </span>
                    ) : null}
                    <div className="flex h-7 items-start pr-1 pl-[9px] md:pl-[9px]">
                      {crumb.to && !isLast ? (
                        <Link
                          to={crumb.to}
                          className="flex h-7 items-center gap-1.5 rounded-[3px] px-[7px] pt-1.5 pb-[7px] transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/[0.04] active:scale-[0.96]"
                        >
                          {content}
                        </Link>
                      ) : (
                        <span
                          className="flex h-7 items-center gap-1.5 rounded-[3px] px-[7px] pt-1.5 pb-[7px]"
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
            <h1 className="max-w-[45vw] truncate text-center text-[19.8px] font-bold tracking-[-0.18px] text-[rgba(32,32,32,0.8)]">
              {centerTitle}
            </h1>
          </div>

          <div className="relative z-10 flex h-12 items-center justify-end pr-[calc(1rem+env(safe-area-inset-right))]">
            {typeof zoomPercent === "number" ? (
              <button
                type="button"
                disabled
                className="mr-1 hidden h-6 items-center px-1 text-[12px] leading-4 text-[rgba(32,32,32,0.8)] md:flex"
              >
                <span className="min-w-[25px] pr-1 text-right tabular-nums">
                  {zoomPercent}%
                </span>
                <CaretDownIcon className="size-[14px]" weight="bold" />
              </button>
            ) : null}

            <div className="flex items-center">
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
              <HeaderIconButton
                label="Settings"
                icon={<GearIcon className="size-5" weight="regular" />}
                frame
              />
            </div>

            <button
              type="button"
              aria-label="More"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
              className="flex h-12 w-11 items-center justify-center text-[rgba(32,32,32,0.8)] transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/[0.03] active:scale-[0.96] md:hidden"
            >
              <DotsThreeOutlineIcon className="size-5" weight="regular" />
            </button>

            <div className="ml-2 flex items-center">
              <HeaderAuth />
            </div>
          </div>
        </div>
      </header>

      <aside className="relative z-10 col-start-1 row-start-2 hidden flex-col items-center bg-[#ebedee] pt-2.5 pb-3 shadow-[1px_0_0_rgba(0,10,20,0.06)] md:flex">
        {renderTools(() => setToolsOpen(false))}

        <div className="flex-1" />

        <button
          ref={trashRef}
          type="button"
          className="flex size-11 items-center justify-center rounded-xl text-black/55 transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/5 active:scale-[0.96]"
          aria-label="Trash"
        >
          <TrashIcon className="size-5" />
        </button>
      </aside>

      <main className="relative col-start-1 row-start-2 min-h-0 min-w-0 md:col-start-2">
        {children}
      </main>

      {/* Mobile tool drawer */}
      <Sheet open={toolsOpen} onOpenChange={setToolsOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          aria-label="Tools"
          className="w-[80%] max-w-[320px] gap-0 p-0 pt-[env(safe-area-inset-top)]"
        >
          <SheetHeader className="px-4 pt-4 pb-2">
            <SheetTitle>Tools</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-1.5 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {renderTools(() => setToolsOpen(false))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile overflow menu (Help / Search / Settings) */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          aria-label="More"
          className="gap-0 p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
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
          <MoreMenuItem
            label="Settings"
            icon={<GearIcon className="size-5" weight="regular" />}
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
        "flex h-12 items-center justify-center text-[rgba(32,32,32,0.8)] transition-[transform,opacity,background-color] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-20 disabled:active:scale-100",
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
        "mb-0.5 flex w-full flex-col items-center gap-1 rounded-xl px-1 py-3 text-[10px] text-black/55 transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-out-strong)] md:mb-0.5 md:w-[56px] md:gap-0.5 md:py-1.5 md:text-[9px]",
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
      className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[15px] font-medium text-[rgba(32,32,32,0.8)] transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/[0.04] active:scale-[0.99]"
    >
      <span className="text-black/55">{icon}</span>
      {label}
    </button>
  )
}
