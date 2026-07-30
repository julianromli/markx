import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  FolderSimpleIcon,
  LinkIcon,
  NoteBlankIcon,
  ImageIcon,
  HandIcon,
  KeyboardIcon,
  CloudIcon,
  CloudSlashIcon,
  CloudWarningIcon,
  CursorIcon,
} from "@phosphor-icons/react"

function usePlatformMod() {
  const [mod, setMod] = useState("Ctrl")
  useEffect(() => {
    setMod(navigator.platform.toLowerCase().includes("mac") ? "\u2318" : "Ctrl")
  }, [])
  return mod
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-foreground/20 bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">
      {children}
    </kbd>
  )
}

export function HelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const mod = usePlatformMod()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick guide</DialogTitle>
          <DialogDescription>
            Everything you need to get started with markx.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-1">
          <BasicsSection />
          <ShortcutsSection mod={mod} />
          <SyncSection />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      {icon}
      {children}
    </h3>
  )
}

function BasicsSection() {
  const items = [
    {
      icon: <FolderSimpleIcon className="size-4" weight="regular" />,
      text: "Create folders on Home to group related links.",
    },
    {
      icon: <LinkIcon className="size-4" weight="regular" />,
      text: "Paste a URL inside a folder to add it as a bookmark.",
    },
    {
      icon: <NoteBlankIcon className="size-4" weight="regular" />,
      text: "Add notes to jot down ideas alongside your links.",
    },
    {
      icon: <ImageIcon className="size-4" weight="regular" />,
      text: "Choose Image or paste an image onto the board.",
    },
    {
      icon: <HandIcon className="size-4" weight="regular" />,
      text: "Drag items to arrange; drag the corner to resize.",
    },
    {
      icon: <HandIcon className="size-4" weight="regular" />,
      text: "On touch: one finger selects or moves cards; two fingers pan and pinch-zoom the board.",
    },
  ]
  return (
    <div className="space-y-2">
      <SectionTitle icon={<CursorIcon className="size-4" weight="regular" />}>
        Basics
      </SectionTitle>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <span className="mt-0.5 shrink-0">{item.icon}</span>
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ShortcutsSection({ mod }: { mod: string }) {
  const items = [
    { keys: [mod, "N"], text: "New folder on Home" },
    { keys: [mod, "Z"], text: "Undo" },
    { keys: [mod, "Shift", "Z"], text: "Redo" },
    {
      keys: ["←", "↑", "↓", "→"],
      text: "Select the next item in that direction",
    },
    {
      keys: ["Alt", "←", "→"],
      text: "Nudge selected items (add Shift for bigger steps)",
    },
    { keys: ["Enter"], text: "Open the selected item" },
    { keys: ["F2"], text: "Rename selected folder or bookmark" },
    { keys: ["Delete"], text: "Delete selected" },
    { keys: ["Esc"], text: "Clear selection or leave note editing" },
  ]
  return (
    <div className="space-y-2">
      <SectionTitle icon={<KeyboardIcon className="size-4" weight="regular" />}>
        Shortcuts
      </SectionTitle>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-2 text-sm text-muted-foreground"
          >
            <span>{item.text}</span>
            <span className="flex items-center gap-1">
              {item.keys.map((k, j) => (
                <Kbd key={j}>{k}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SyncSection() {
  const items = [
    {
      icon: <CloudIcon className="size-4" weight="regular" />,
      text: "Saved — your workspace is synced to the cloud.",
    },
    {
      icon: <CloudSlashIcon className="size-4" weight="regular" />,
      text: "Offline — queued — changes will sync when you reconnect.",
    },
    {
      icon: <CloudWarningIcon className="size-4" weight="regular" />,
      text: "Conflict — pick which version to keep.",
    },
  ]
  return (
    <div className="space-y-2">
      <SectionTitle icon={<CloudIcon className="size-4" weight="regular" />}>
        Sync status
      </SectionTitle>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <span className="mt-0.5 shrink-0">{item.icon}</span>
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  )
}
