import { Link } from "@tanstack/react-router"
import type { ReactNode, RefObject } from "react"
import { useState } from "react"

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CaretDownIcon,
  ChatCircleIcon,
  CheckSquareIcon,
  ColumnsIcon,
  CursorIcon,
  FolderSimpleIcon,
  GearIcon,
  ImageIcon,
  LineSegmentIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  NoteBlankIcon,
  PencilSimpleIcon,
  QuestionIcon,
  TableIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react"

import homeIcon from "@/assets/markx/header/home.svg"
import pixelFolder from "@/assets/markx/pixel-folder.svg"
import { HeaderAuth } from "@/components/markx/header-auth"
import { HelpDialog } from "@/components/markx/help-dialog"
import { useMarkxActions, useMarkxHistory } from "@/lib/markx/store"
import { cn } from "@/lib/utils"
import type { ToolId } from "@/lib/markx/types"

type BreadcrumbItem = {
  label: string
  to?: string
  /** When true, shows the Home app icon instead of a folder thumb. */
  home?: boolean
  /** Optional crumb image (folder preview). Defaults to folder thumb when not home. */
  imageSrc?: string
}

type AppShellProps = {
  title: string
  breadcrumb?: BreadcrumbItem[]
  tool: ToolId
  onToolChange: (tool: ToolId) => void
  trashRef: RefObject<HTMLButtonElement | null>
  trashHot?: boolean
  zoomPercent?: number
  onImageTool?: () => void
  children: ReactNode
}

const TOOLS: Array<{
  id: string
  label: string
  icon: typeof CursorIcon
  tool?: ToolId
  action?: "image"
}> = [
  { id: "select", label: "Select", icon: CursorIcon, tool: "select" },
  { id: "note", label: "Note", icon: NoteBlankIcon, tool: "note" },
  { id: "link", label: "Link", icon: LinkIcon, tool: "link" },
  { id: "todo", label: "To-do", icon: CheckSquareIcon },
  { id: "line", label: "Line", icon: LineSegmentIcon },
  { id: "board", label: "Board", icon: FolderSimpleIcon, tool: "board" },
  { id: "column", label: "Column", icon: ColumnsIcon },
  { id: "comment", label: "Comment", icon: ChatCircleIcon },
  { id: "table", label: "Table", icon: TableIcon },
  { id: "image", label: "Image", icon: ImageIcon, action: "image" },
  { id: "upload", label: "Upload", icon: UploadSimpleIcon },
  { id: "draw", label: "Draw", icon: PencilSimpleIcon },
]

export function AppShell({
  title,
  breadcrumb,
  tool,
  onToolChange,
  trashRef,
  trashHot,
  zoomPercent,
  onImageTool,
  children,
}: AppShellProps) {
  const actions = useMarkxActions()
  const { canUndo, canRedo } = useMarkxHistory()
  const [helpOpen, setHelpOpen] = useState(false)

  const crumbs: BreadcrumbItem[] =
    breadcrumb && breadcrumb.length > 0
      ? breadcrumb
      : [{ label: "Home", to: "/", home: true }]

  const centerTitle =
    crumbs.length > 0 ? (crumbs[crumbs.length - 1]?.label ?? title) : title

  return (
    <div className="grid h-svh grid-cols-[63px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-[#ebedee] antialiased">
      <header className="relative z-30 col-span-2 bg-white shadow-[0_1px_1px_rgba(51,61,78,0.2)]">
        <div className="relative flex h-12 w-full items-center justify-between">
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
                  <span className="max-w-[270px] truncate text-[12px] leading-3 font-semibold text-[rgba(32,32,32,0.8)]">
                    {crumb.label}
                  </span>
                </>
              )

              return (
                <div
                  key={`${crumb.label}-${index}`}
                  className="flex h-7 items-center"
                >
                  {index > 0 ? (
                    <span
                      className="w-[4.32px] text-center text-[12px] leading-3 text-[#cbced2]"
                      aria-hidden
                    >
                      /
                    </span>
                  ) : null}
                  <div className="flex h-7 items-start pr-1 pl-[9px]">
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

          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
            <h1 className="max-w-[45vw] truncate text-center text-[19.8px] font-bold tracking-[-0.18px] text-[rgba(32,32,32,0.8)]">
              {centerTitle}
            </h1>
          </div>

          <div className="relative z-10 flex h-12 items-center justify-end pr-4">
            {typeof zoomPercent === "number" ? (
              <button
                type="button"
                disabled
                className="mr-1 flex h-6 items-center px-1 text-[12px] leading-4 text-[rgba(32,32,32,0.8)]"
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

            <div className="flex items-center pr-2">
              <div
                className="h-6 w-2 border-r border-[rgba(0,10,20,0.08)]"
                aria-hidden
              />
            </div>

            <HeaderIconButton
              label="Help"
              icon={<QuestionIcon className="size-5" weight="regular" />}
              frame
              onClick={() => setHelpOpen(true)}
            />
            <HeaderIconButton
              label="Search"
              icon={<MagnifyingGlassIcon className="size-5" weight="regular" />}
              frame
            />
            <HeaderIconButton
              label="Settings"
              icon={<GearIcon className="size-5" weight="regular" />}
              frame
            />

            <div className="ml-2 flex items-center">
              <HeaderAuth />
            </div>
          </div>
        </div>
      </header>

      <aside className="relative z-10 col-start-1 row-start-2 flex flex-col items-center bg-[#ebedee] pt-2.5 pb-3 shadow-[1px_0_0_rgba(0,10,20,0.06)]">
        {TOOLS.map((item) => {
          const active = item.tool != null && tool === item.tool
          const enabled = item.tool != null || item.action != null
          return (
            <ToolButton
              key={item.id}
              label={item.label}
              active={active}
              disabled={!enabled}
              onClick={
                enabled
                  ? () => {
                      if (item.action === "image") {
                        onImageTool?.()
                      } else if (item.tool) {
                        onToolChange(item.tool)
                      }
                    }
                  : undefined
              }
              icon={<item.icon className="size-5" weight="regular" />}
            />
          )
        })}

        <div className="flex-1" />

        <button
          ref={trashRef}
          type="button"
          className={cn(
            "flex size-11 items-center justify-center rounded-xl text-black/55 transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.96]",
            trashHot
              ? "bg-red-500/15 text-red-600 shadow-[0_0_0_2px_rgba(239,68,68,0.35)]"
              : "hover:bg-black/5"
          )}
          aria-label="Trash"
        >
          <TrashIcon className="size-5" />
        </button>
      </aside>

      <main className="relative col-start-2 row-start-2 min-h-0 min-w-0">
        {children}
      </main>

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
        frame ? (last ? "w-8" : "w-10") : "w-[34px]",
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

function ToolButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string
  icon: ReactNode
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mb-0.5 flex w-[56px] flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[9px] transition-[transform,background-color,box-shadow] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.96]",
        active
          ? "bg-white text-[#202020] shadow-[0_1px_2px_rgba(0,10,20,0.08)]"
          : "text-black/55 hover:bg-black/5",
        disabled &&
          "cursor-not-allowed opacity-45 hover:bg-transparent active:scale-100"
      )}
    >
      <span className="flex size-7 items-center justify-center drop-shadow-[0_1px_1px_rgba(51,61,78,0.2)]">
        {icon}
      </span>
      {label}
    </button>
  )
}
