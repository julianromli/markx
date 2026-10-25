import { useEffect, useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseBookmarkUrl } from "@/lib/markx/board-items"
import type { Folder } from "@/lib/markx/types"
import type { WorkspaceLocation } from "@/lib/markx/workspace-items"

export function RenameDialog({
  open,
  title,
  initialValue,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  title: string
  initialValue: string
  onOpenChange: (open: boolean) => void
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            const next = value.trim()
            if (!next) return
            onSubmit(next)
            onOpenChange(false)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="rename-input">Name</Label>
            <Input
              id="rename-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AddLinkDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (url: string) => void
}) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setUrl("")
      setError(null)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add link</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            const parsed = parseBookmarkUrl(url)
            if (!parsed.ok) {
              setError(parsed.reason)
              return
            }
            onSubmit(parsed.url)
            onOpenChange(false)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="link-input">URL</Label>
            <Input
              id="link-input"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://…"
              value={url}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "link-input-error" : undefined}
              onChange={(e) => {
                setUrl(e.target.value)
                if (error) setError(null)
              }}
              autoFocus
            />
            {error ? (
              <p
                id="link-input-error"
                role="alert"
                className="text-[13px] text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function MoveToDialog({
  open,
  home,
  folders,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  /** Offer Home as a target (notes and images can live there). */
  home: boolean
  folders: Folder[]
  onOpenChange: (open: boolean) => void
  onSubmit: (target: WorkspaceLocation) => void
}) {
  const targets: Array<{
    key: string
    label: string
    target: WorkspaceLocation
  }> = [
    ...(home
      ? [{ key: "home", label: "Home", target: { mode: "home" } as const }]
      : []),
    ...folders.map((folder) => ({
      key: folder.id,
      label: folder.name,
      target: { mode: "folder", folderId: folder.id } as const,
    })),
  ]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to…</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1 overflow-auto">
          {targets.map(({ key, label, target }) => (
            <button
              key={key}
              type="button"
              className="min-h-11 rounded-lg px-3 py-2 text-left text-sm transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] hover:bg-black/5 active:scale-[0.99]"
              onClick={() => {
                onSubmit(target)
                onOpenChange(false)
              }}
            >
              {label}
            </button>
          ))}
          {targets.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nowhere to move these items
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDeleteFolderDialog({
  open,
  contents,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  /** Sentence form of what will go, e.g. "3 bookmarks and 1 note". */
  contents: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete folder?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes {contents} inside the folder, together with the other
            selected items.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
