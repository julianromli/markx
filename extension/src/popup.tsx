import { StrictMode, useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource-variable/geist"
import "./popup.css"
import "./copy-url-motion.css"
import { fetchFolders, fetchSession, saveBookmark } from "./lib/api"
import type { ExtensionFolder, SaveBookmarkResult } from "./lib/api"
import {
  clearSession,
  getBaseUrl,
  getLastFolderId,
  getSession,
  setLastFolderId,
} from "./lib/config"

type View =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "picker"; folders: ExtensionFolder[] }
  | { kind: "saved"; folderName: string }
  | { kind: "board-full"; count: number; limit: number }
  | {
      kind: "error"
      variant: "network" | "session" | "generic"
      message?: string
    }

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" aria-hidden="true">
      <path
        fill="currentColor"
        d="M216,32H88a8,8,0,0,0-8,8V80H40a8,8,0,0,0-8,8V216a8,8,0,0,0,8,8H168a8,8,0,0,0,8-8V176h40a8,8,0,0,0,8-8V40A8,8,0,0,0,216,32ZM160,208H48V96H160Zm48-48H176V88a8,8,0,0,0-8-8H96V48H208Z"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" aria-hidden="true">
      <path
        fill="currentColor"
        d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"
      />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" aria-hidden="true">
      <path
        fill="currentColor"
        d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z"
      />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 256 256" aria-hidden="true">
      <path
        fill="currentColor"
        d="M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z"
      />
    </svg>
  )
}

function CopyUrlButton({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle")
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  async function onClick() {
    const already = state === "copied"
    try {
      await navigator.clipboard.writeText(url)
      if (!already) setState("copied")
      const live = document.getElementById("copy-url-live")
      if (live) live.textContent = "URL copied"
    } catch {
      setState("error")
      const live = document.getElementById("copy-url-live")
      if (live) live.textContent = "Couldn't copy"
    }
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setState("idle")
      const live = document.getElementById("copy-url-live")
      if (live) live.textContent = ""
    }, 1500)
  }

  return (
    <>
      <button
        type="button"
        className="copy-url"
        data-state={state}
        onClick={() => void onClick()}
        aria-label="Copy URL"
      >
        <span className="copy-url__icons" aria-hidden="true">
          <span className="copy-url__icon copy-url__icon--copy">
            <CopyIcon />
          </span>
          <span className="copy-url__icon copy-url__icon--check">
            <CheckIcon />
          </span>
          <span className="copy-url__icon copy-url__icon--warning">
            <WarningIcon />
          </span>
        </span>
        <span className="copy-url__labels">
          <span className="copy-url__sizer" aria-hidden="true">
            Couldn't copy
          </span>
          <span className="copy-url__label" data-label="idle">
            Copy URL
          </span>
          <span className="copy-url__label" data-label="copied">
            Copied
          </span>
          <span className="copy-url__label" data-label="error">
            Couldn't copy
          </span>
        </span>
      </button>
      <span
        id="copy-url-live"
        className="copy-url-live sr-only"
        aria-live="polite"
      />
    </>
  )
}

function filterFolders(
  folders: ExtensionFolder[],
  query: string
): ExtensionFolder[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return folders
  return folders.filter((folder) => {
    const name = folder.name.toLowerCase()
    return words.every((word) => name.includes(word))
  })
}

function PopupApp() {
  const [view, setView] = useState<View>({ kind: "loading" })
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tabUrl, setTabUrl] = useState<string | null>(null)
  const [baseUrl, setBaseUrlState] = useState("https://markx.app")
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        window.close()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    void bootstrap()
  }, [])

  async function bootstrap() {
    const [base, tab] = await Promise.all([
      getBaseUrl(),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ])
    setBaseUrlState(base)
    const url = tab[0]?.url ?? null
    setTabUrl(url)

    const localSession = await getSession()
    if (!localSession) {
      setView({ kind: "signed-out" })
      return
    }
    const session = await fetchSession()
    if (!session.ok && session.reason === "unauthorized") {
      await clearSession()
      setView({ kind: "error", variant: "session" })
      return
    }
    if (!session.ok) {
      setView({ kind: "error", variant: "network" })
      return
    }
    const folders = await fetchFolders()
    if (!folders.ok && folders.reason === "unauthorized") {
      await clearSession()
      setView({ kind: "error", variant: "session" })
      return
    }
    if (!folders.ok) {
      setView({ kind: "error", variant: "network" })
      return
    }
    const lastId = await getLastFolderId()
    const initial =
      (lastId && folders.folders.some((folder) => folder.id === lastId)
        ? lastId
        : folders.folders[0]?.id) ?? null
    setSelectedId(initial)
    setView({ kind: "picker", folders: folders.folders })
  }

  const visibleFolders = useMemo(() => {
    if (view.kind !== "picker") return []
    return filterFolders(view.folders, query)
  }, [view, query])

  useEffect(() => {
    if (view.kind !== "picker") return
    searchRef.current?.focus()
  }, [view.kind])

  useEffect(() => {
    if (view.kind !== "picker") return
    if (visibleFolders.length === 0) {
      setSelectedId(null)
      return
    }
    if (
      !selectedId ||
      !visibleFolders.some((folder) => folder.id === selectedId)
    ) {
      setSelectedId(visibleFolders[0]?.id ?? null)
    }
  }, [view.kind, visibleFolders, selectedId])

  async function openSignIn() {
    const url = `${baseUrl}/`
    await chrome.tabs.create({ url })
    window.close()
  }

  async function openUpgrade() {
    await chrome.tabs.create({ url: `${baseUrl}/?upgrade=1` })
  }

  async function saveTo(folderId: string) {
    if (!tabUrl || saving) return
    if (!/^https?:/i.test(tabUrl)) {
      setView({
        kind: "error",
        variant: "generic",
        message:
          "This page cannot be saved. Open a regular web page and try again.",
      })
      return
    }
    setSaving(true)
    const result: SaveBookmarkResult = await saveBookmark(folderId, tabUrl)
    setSaving(false)
    if (result.ok) {
      await setLastFolderId(folderId)
      setView({ kind: "saved", folderName: result.folder.name })
      return
    }
    if (result.reason === "board_full") {
      setView({
        kind: "board-full",
        count: result.count,
        limit: result.limit,
      })
      return
    }
    if (result.reason === "unauthorized") {
      await clearSession()
      setView({ kind: "error", variant: "session" })
      return
    }
    if (result.reason === "network") {
      setView({ kind: "error", variant: "network" })
      return
    }
    setView({
      kind: "error",
      variant: "generic",
      message:
        result.reason === "invalid_url"
          ? "That page does not look like a link markx can save."
          : result.reason === "folder_not_found"
            ? "That folder is no longer on your board."
            : "Could not save this page. Try again.",
    })
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (view.kind !== "picker" || visibleFolders.length === 0) {
      if (event.key === "Enter") event.preventDefault()
      return
    }
    const index = visibleFolders.findIndex((folder) => folder.id === selectedId)
    if (event.key === "ArrowDown") {
      event.preventDefault()
      const next =
        visibleFolders[Math.min(index + 1, visibleFolders.length - 1)]
      if (next) setSelectedId(next.id)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      const next = visibleFolders[Math.max(index - 1, 0)]
      if (next) setSelectedId(next.id)
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (selectedId) void saveTo(selectedId)
    }
  }

  useEffect(() => {
    if (!selectedId || !listRef.current) return
    const row = listRef.current.querySelector(
      `[data-folder-id="${CSS.escape(selectedId)}"]`
    )
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: "nearest" })
    }
  }, [selectedId])

  if (view.kind === "loading") {
    return (
      <div className="popup">
        <div className="brand">
          <img
            src={chrome.runtime.getURL("markx-logo-flat.svg")}
            alt=""
            width={36}
            height={36}
          />
          <div className="brand-name">markx</div>
        </div>
        <p className="muted">Loading…</p>
      </div>
    )
  }

  if (view.kind === "signed-out") {
    return (
      <div className="popup">
        <div className="brand">
          <img
            src={chrome.runtime.getURL("markx-logo-flat.svg")}
            alt=""
            width={36}
            height={36}
          />
          <div className="brand-name">markx</div>
        </div>
        <h1 className="title">Sign in to markx</h1>
        <p className="lede">
          Save this tab to a folder on your board. Sign in with the same account
          you use in the markx app.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void openSignIn()}
        >
          Sign in
        </button>
      </div>
    )
  }

  if (view.kind === "saved") {
    return (
      <div className="popup">
        <div className="status-block">
          <div className="status-icon status-icon--ok">
            <CheckIcon />
          </div>
          <h1 className="title">Saved</h1>
          <p className="lede lede-clip" title={`Saved to ${view.folderName}`}>
            Saved to {view.folderName}
          </p>
        </div>
      </div>
    )
  }

  if (view.kind === "board-full") {
    return (
      <div className="popup">
        <h1 className="title">Board is full</h1>
        <p className="lede">
          Free plan is limited to {view.limit} items. This tab was not saved (
          {view.count}/{view.limit}).
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void openUpgrade()}
          >
            Upgrade to Pro
          </button>
          {tabUrl ? <CopyUrlButton url={tabUrl} /> : null}
        </div>
      </div>
    )
  }

  if (view.kind === "error") {
    const title =
      view.variant === "session"
        ? "Session expired"
        : view.variant === "network"
          ? "Can't reach markx"
          : "Couldn't save"
    const lede =
      view.message ??
      (view.variant === "session"
        ? "Sign in again to keep saving tabs to your board."
        : view.variant === "network"
          ? "Check your connection, then try again."
          : "Something went wrong. Try again.")
    return (
      <div className="popup">
        <div className="status-block status-block--start">
          <h1 className="title">{title}</h1>
          <p className="lede">{lede}</p>
          {view.variant === "session" ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void openSignIn()}
            >
              Sign in
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setView({ kind: "loading" })
                void bootstrap()
              }}
            >
              Try again
            </button>
          )}
        </div>
      </div>
    )
  }

  const empty = visibleFolders.length === 0

  return (
    <div className="popup">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (selectedId) void saveTo(selectedId)
        }}
      >
        <div className="search">
          <span className="search-icon">
            <SearchIcon />
          </span>
          <label htmlFor="folder-search" className="sr-only">
            Search folders
          </label>
          <input
            id="folder-search"
            ref={searchRef}
            type="search"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            data-1p-ignore="true"
            placeholder="Search folders"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            disabled={saving}
          />
        </div>
        {empty ? (
          <div className="empty-search">
            <p className="title">No folders match</p>
            <p className="muted muted-clip" title={query.trim() || undefined}>
              {query.trim()
                ? `Nothing named “${query.trim()}”.`
                : "Create a folder in markx first, then save to it here."}
            </p>
          </div>
        ) : (
          <div
            className="folder-list"
            role="listbox"
            aria-label="Folders"
            ref={listRef}
          >
            {visibleFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                role="option"
                data-folder-id={folder.id}
                className={
                  folder.id === selectedId
                    ? "folder-row selected"
                    : "folder-row"
                }
                aria-selected={folder.id === selectedId}
                title={folder.name}
                disabled={saving}
                onMouseEnter={() => setSelectedId(folder.id)}
                onClick={() => void saveTo(folder.id)}
              >
                <img
                  src={chrome.runtime.getURL("pixel-folder.svg")}
                  alt=""
                  width={18}
                  height={18}
                />
                <span className="name">{folder.name}</span>
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  )
}

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <PopupApp />
    </StrictMode>
  )
}
