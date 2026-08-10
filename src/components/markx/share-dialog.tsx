import { useEffect, useState } from "react"
import { toast } from "sonner"

import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork"
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise"
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye"
import { Avatar as OreoAvatar } from "@oreo-design/avatar/react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  createSharedBoard,
  deleteSharedBoard,
  getSharedBoardAccess,
  regenerateSharedBoardLink,
  removeSharedBoardMember,
  updateSharedBoardLinkToggles,
} from "@/lib/server/shared-board"
import type {
  SharedBoardAccessView,
  SharedBoardMemberInfo,
} from "@/lib/markx/shared-board"
import type { Folder } from "@/lib/markx/types"

type ShareDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: Folder
  /** The shared board id when the folder is already shared, or null to show the create view. */
  initialBoardId: string | null
  /** Called after a successful share; the dialog switches to manage mode. */
  onShared: (result: { boardId: string; token: string }) => void
  /** Called after a successful unshare. */
  onUnshared: () => void
}

function shareUrl(token: string): string {
  if (typeof window === "undefined") return `/s/${token}`
  return `${window.location.origin}/s/${token}`
}

function initials(email: string): string {
  const name = email.split("@")[0]
  const parts = name.split(/[._-]/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export function ShareDialog({
  open,
  onOpenChange,
  folder,
  initialBoardId,
  onShared,
  onUnshared,
}: ShareDialogProps) {
  const [boardId, setBoardId] = useState<string | null>(initialBoardId)
  const [access, setAccess] = useState<SharedBoardAccessView | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyToken, setBusyToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  /** userId of the member row currently animating out before removal. */
  const [removingId, setRemovingId] = useState<string | null>(null)
  /** Which warning is shown. Kept mounted (clipped) while collapsing so the
   *  height transition has content to interpolate against in both directions. */
  const [warning, setWarning] = useState<"disabled" | "edit">("disabled")
  // Local toggle state (synced from the link, pushed to the server on change).
  const [allowRead, setAllowRead] = useState(true)
  const [allowEdit, setAllowEdit] = useState(false)

  // Load the manage-access view when the folder is already shared.
  useEffect(() => {
    if (!open || !boardId) {
      setAccess(null)
      return
    }
    let cancelled = false
    setLoading(true)
    getSharedBoardAccess({ data: { boardId } })
      .then((view) => {
        if (cancelled) return
        setAccess(view)
        if (view?.link) {
          setAllowRead(view.link.allowRead)
          setAllowEdit(view.link.allowEdit)
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load sharing settings.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, boardId])

  async function handleCreate() {
    setCreating(true)
    try {
      const result = await createSharedBoard({
        data: { folderId: folder.id, title: folder.name },
      })
      if (result.ok) {
        setBoardId(result.boardId)
        onShared({ boardId: result.boardId, token: result.token })
        const view = await getSharedBoardAccess({
          data: { boardId: result.boardId },
        })
        if (view) {
          setAccess(view)
          setAllowRead(view.link?.allowRead ?? true)
          setAllowEdit(view.link?.allowEdit ?? false)
        }
        toast.success("Board shared.")
      } else if (result.reason === "folder_not_found") {
        toast.error("That folder no longer exists.")
        onOpenChange(false)
      } else if (result.reason === "already_shared") {
        toast.message("This board is already shared.")
      } else {
        toast.error(result.message)
      }
    } catch {
      toast.error("Could not share the board.")
    } finally {
      setCreating(false)
    }
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token))
      toast.success("Link copied.")
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy the link.")
    }
  }

  async function regenerate() {
    if (!boardId) return
    setBusyToken("regen")
    try {
      const result = await regenerateSharedBoardLink({ data: { boardId } })
      if (result) {
        const view = await getSharedBoardAccess({ data: { boardId } })
        if (view) setAccess(view)
        toast.success("Link regenerated.")
      } else {
        toast.error("Could not regenerate the link.")
      }
    } catch {
      toast.error("Could not regenerate the link.")
    } finally {
      setBusyToken(null)
    }
  }

  // Read off → edit off (edit needs read). Edit on → read on (edit implies read).
  async function setToggles(nextRead: boolean, nextEdit: boolean) {
    setAllowRead(nextRead)
    setAllowEdit(nextEdit)
    if (!boardId) return
    try {
      await updateSharedBoardLinkToggles({
        data: { boardId, allowRead: nextRead, allowEdit: nextEdit },
      })
    } catch {
      toast.error("Could not update sharing settings.")
      // Revert on failure.
      setAllowRead(allowRead)
      setAllowEdit(allowEdit)
    }
  }

  async function removeMember(member: SharedBoardMemberInfo) {
    if (!boardId) return
    setBusyToken(`rm-${member.userId}`)
    // Start the exit animation immediately and run the server call in
    // parallel. Removal from the list happens once both the network request
    // resolves and the 120ms exit transition have settled, so the row fades
    // out instead of snapping away.
    setRemovingId(member.userId)
    try {
      const [ok] = await Promise.all([
        removeSharedBoardMember({
          data: { boardId, memberUserId: member.userId },
        }),
        new Promise((r) => setTimeout(r, 150)),
      ])
      if (ok) {
        setAccess((prev) =>
          prev
            ? {
                ...prev,
                members: prev.members.filter((m) => m.userId !== member.userId),
              }
            : prev
        )
        toast.success(`${member.email} removed.`)
      } else {
        setRemovingId(null)
        toast.error("Could not remove the member.")
      }
    } catch {
      setRemovingId(null)
      toast.error("Could not remove the member.")
    } finally {
      setBusyToken(null)
    }
  }

  async function handleDelete() {
    if (!boardId) return
    setBusyToken("delete")
    try {
      const result = await deleteSharedBoard({ data: { boardId } })
      if (result.ok) {
        setBoardId(null)
        onUnshared()
        toast.success("Board unshared. The folder stays on your canvas.")
        onOpenChange(false)
      } else {
        toast.error(result.message)
      }
    } catch {
      toast.error("Could not unshare the board.")
    } finally {
      setBusyToken(null)
    }
  }

  const link = access?.link
  const linkDisabled = !allowRead && !allowEdit

  // Track which warning to render. While the row is open we follow the live
  // toggle state; while closing we keep the last warning mounted so the
  // collapse transition has content to interpolate against (no snap).
  useEffect(() => {
    if (linkDisabled) setWarning("disabled")
    else if (allowEdit) setWarning("edit")
  }, [linkDisabled, allowEdit])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShareNetworkIcon weight="regular" />
            Share board
          </DialogTitle>
          <DialogDescription>
            {boardId
              ? linkDisabled
                ? `“${folder.name}” is shared, but the link is disabled. Turn on read or edit to share it.`
                : `“${folder.name}” is shared. Anyone with the link can see it.`
              : `Share “${folder.name}” so others can view or edit it.`}
          </DialogDescription>
        </DialogHeader>

        {!boardId ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-muted">
              Sharing lets others view or edit this folder. The folder stays on
              your canvas — nothing is moved out.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleCreate} disabled={creating}>
                {creating ? <Spinner /> : null}
                Share board
              </Button>
            </DialogFooter>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        ) : access ? (
          <div className="space-y-5">
            {/* Share link */}
            <div className="space-y-1.5">
              <Label>Share link</Label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={link ? shareUrl(link.token) : "No active link"}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="active:scale-[0.97]"
                  disabled={!link}
                  onClick={() => link && copyLink(link.token)}
                  aria-label="Copy link"
                >
                  {copied ? (
                    <CheckCircleIcon
                      weight="fill"
                      className="size-4 animate-[copy-pop_200ms_var(--ease-out-strong)] text-green-600"
                    />
                  ) : (
                    <CopyIcon weight="regular" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={busyToken === "regen"}
                  onClick={regenerate}
                  aria-label="Regenerate link"
                >
                  <ArrowClockwiseIcon weight="regular" />
                </Button>
              </div>
            </div>

            {/* Lightweight analytics */}
            <div className="border-line flex items-center justify-between rounded-xl border bg-muted/20 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <EyeIcon
                  aria-hidden
                  className="size-4 text-ink-muted"
                  weight="regular"
                />
                <div>
                  <p className="text-sm font-medium tabular-nums">
                    {access.viewCount.toLocaleString()}{" "}
                    {access.viewCount === 1 ? "view" : "views"}
                  </p>
                  <p className="text-xs text-ink-muted">Anonymous visitors</p>
                </div>
              </div>
              {access.recentViewerSeeds.length > 0 ? (
                <div
                  className="flex -space-x-1.5"
                  aria-label={`${access.recentViewerSeeds.length} recent anonymous visitors`}
                >
                  {access.recentViewerSeeds.slice(0, 6).map((seed) => (
                    <OreoAvatar
                      key={seed}
                      aria-hidden
                      shape="bloom"
                      palette="aurora-pink"
                      variantId={seed}
                      drift={8}
                      size={28}
                      className="rounded-full ring-2 ring-background"
                    />
                  ))}
                </div>
              ) : null}
            </div>

            {/* Access toggles */}
            <div className="border-line space-y-2 rounded-xl border p-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  <span className="font-medium">Allow read</span>
                  <span className="block text-xs text-ink-muted">
                    Anyone with the link can view — no login needed.
                  </span>
                </span>
                <Switch
                  checked={allowRead}
                  onCheckedChange={(v) =>
                    void setToggles(v, v ? allowEdit : false)
                  }
                />
              </label>
              <div className="bg-line h-px" />
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  <span className="font-medium">Allow edit</span>
                  <span className="block text-xs text-ink-muted">
                    Anyone with the link can edit after logging in.
                  </span>
                </span>
                <Switch
                  checked={allowEdit}
                  onCheckedChange={(v) =>
                    void setToggles(v ? true : allowRead, v)
                  }
                />
              </label>
            </div>

            <div className="collapsible" data-open={linkDisabled || allowEdit}>
              <div className="collapsible-inner">
                {(linkDisabled ? "disabled" : allowEdit ? "edit" : warning) ===
                "disabled" ? (
                  <p className="flex items-start gap-1.5 text-xs text-ink-muted">
                    <WarningIcon weight="regular" className="mt-0.5 shrink-0" />
                    The link is disabled — turn on read or edit to share this
                    board.
                  </p>
                ) : (
                  <p className="flex items-start gap-1.5 text-xs text-ink-muted">
                    <WarningIcon weight="regular" className="mt-0.5 shrink-0" />
                    Anyone with the link can edit this board after logging in.
                    Turn off edit to stop new editors.
                  </p>
                )}
              </div>
            </div>

            {/* Editors */}
            <div className="space-y-1.5">
              <Label className="tabular-nums">
                Editors ({access.members.length})
              </Label>
              <ul className="space-y-1.5">
                {access.members.map((m) => (
                  <li
                    key={m.userId}
                    className={cn(
                      "share-item",
                      removingId === m.userId && "is-leaving"
                    )}
                  >
                    <div className="share-item-inner">
                      <div className="border-line flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            aria-hidden
                            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground"
                          >
                            {initials(m.email)}
                          </span>
                          <span className="truncate text-sm">{m.email}</span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busyToken === `rm-${m.userId}`}
                          onClick={() => removeMember(m)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
                <li
                  className="collapsible list-none p-0"
                  data-open={access.members.length === 0}
                >
                  <div className="collapsible-inner">
                    <div className="border-line flex items-center gap-2 rounded-md border border-dashed px-3 py-2">
                      <span
                        aria-hidden
                        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/50 text-[11px] font-medium text-muted-foreground/60"
                      >
                        +
                      </span>
                      <span className="text-sm text-ink-muted">
                        No editors yet. Share the link to invite people.
                      </span>
                    </div>
                  </div>
                </li>
              </ul>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={busyToken === "delete"}
              >
                {busyToken === "delete" ? <Spinner /> : null}
                Unshare & return to canvas
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            Could not load sharing settings.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
