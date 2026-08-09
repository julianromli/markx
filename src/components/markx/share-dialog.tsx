import { useEffect, useState } from "react"
import { toast } from "sonner"

import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork"
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise"

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
        const view = await getSharedBoardAccess({ data: { boardId: result.boardId } })
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
    try {
      const ok = await removeSharedBoardMember({
        data: { boardId, memberUserId: member.userId },
      })
      if (ok) {
        setAccess((prev) =>
          prev
            ? { ...prev, members: prev.members.filter((m) => m.userId !== member.userId) }
            : prev
        )
        toast.success(`${member.email} removed.`)
      } else {
        toast.error("Could not remove the member.")
      }
    } catch {
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
              Sharing lets others view or edit this folder. The folder
              stays on your canvas — nothing is moved out.
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
                      className="size-4 text-green-600 animate-[copy-pop_200ms_var(--ease-out-strong)]"
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

            {/* Access toggles */}
            <div className="space-y-2 rounded-xl border border-line p-4">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  <span className="font-medium">Allow read</span>
                  <span className="block text-xs text-ink-muted">
                    Anyone with the link can view — no login needed.
                  </span>
                </span>
                <Switch
                  checked={allowRead}
                  onCheckedChange={(v) => void setToggles(v, v ? allowEdit : false)}
                />
              </label>
              <div className="h-px bg-line" />
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  <span className="font-medium">Allow edit</span>
                  <span className="block text-xs text-ink-muted">
                    Anyone with the link can edit after logging in.
                  </span>
                </span>
                <Switch
                  checked={allowEdit}
                  onCheckedChange={(v) => void setToggles(v ? true : allowRead, v)}
                />
              </label>
            </div>

            {linkDisabled ? (
              <p className="flex items-start gap-1.5 text-xs text-ink-muted">
                <WarningIcon weight="regular" className="mt-0.5 shrink-0" />
                The link is disabled — turn on read or edit to share this board.
              </p>
            ) : allowEdit ? (
              <p className="flex items-start gap-1.5 text-xs text-ink-muted">
                <WarningIcon weight="regular" className="mt-0.5 shrink-0" />
                Anyone with the link can edit this board after logging in.
                Turn off edit to stop new editors.
              </p>
            ) : null}

            {/* Editors */}
            <div className="space-y-1.5">
              <Label className="tabular-nums">Editors ({access.members.length})</Label>
              <ul className="space-y-1.5">
                {access.members.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
                  >
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
                  </li>
                ))}
                {access.members.length === 0 ? (
                  <li className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-2">
                    <span
                      aria-hidden
                      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/50 text-[11px] font-medium text-muted-foreground/60"
                    >
                      +
                    </span>
                    <span className="text-sm text-ink-muted">
                      No editors yet. Share the link to invite people.
                    </span>
                  </li>
                ) : null}
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
