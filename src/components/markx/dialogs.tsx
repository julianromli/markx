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
import type { Folder } from "@/lib/markx/types"

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
      <DialogContent className="sm:max-w-md">
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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

  useEffect(() => {
    if (open) setUrl("")
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add link</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            const next = url.trim()
            if (!next) return
            onSubmit(next)
            onOpenChange(false)
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="link-input">URL</Label>
            <Input
              id="link-input"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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
  folders,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  folders: Folder[]
  onOpenChange: (open: boolean) => void
  onSubmit: (folderId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to…</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1 overflow-auto">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className="rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-black/5 active:scale-[0.99]"
              onClick={() => {
                onSubmit(folder.id)
                onOpenChange(false)
              }}
            >
              {folder.name}
            </button>
          ))}
          {folders.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No other folders
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDeleteFolderDialog({
  open,
  count,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  count: number
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete folder?</AlertDialogTitle>
          <AlertDialogDescription>
            This folder contains {count} bookmark{count === 1 ? "" : "s"}. Deleting
            it will remove those bookmarks too.
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
