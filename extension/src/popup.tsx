import { StrictMode, useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import { createRoot } from "react-dom/client"
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise"
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"
import { CloudWarningIcon } from "@phosphor-icons/react/dist/csr/CloudWarning"
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy"
import { CrownIcon } from "@phosphor-icons/react/dist/csr/Crown"
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass"
import { SignInIcon } from "@phosphor-icons/react/dist/csr/SignIn"
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning"
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
import { isMacPlatform, prioritizeLastUsedFolder, tabHost } from "./lib/folders"

type View =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "picker"; folders: ExtensionFolder[] }
  | { kind: "saved"; folderName: string; folderId: string }
  | { kind: "board-full"; count: number; limit: number }
  | {
      kind: "error"
      variant: "network" | "session" | "generic"
      message?: string
    }

type TabInfo = {
  url: string | null
  title: string
  favIconUrl: string | null
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
        <span className="copy-url__lock" aria-hidden="true">
          <span className="copy-url__lock-icon" />
          Couldn't copy
        </span>
        <span className="copy-url__cluster">
          <span className="copy-url__icons" aria-hidden="true">
            <span className="copy-url__icon copy-url__icon--copy">
              <CopyIcon size={16} weight="regular" />
            </span>
            <span className="copy-url__icon copy-url__icon--check">
              <CheckCircleIcon size={16} weight="fill" />
            </span>
            <span className="copy-url__icon copy-url__icon--warning">
              <WarningIcon size={16} weight="fill" />
            </span>
          </span>
          <span className="copy-url__labels">
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

function TabFavicon({ tab }: { tab: TabInfo }) {
  const [broken, setBroken] = useState(false)
  const letter = (tab.title || tabHost(tab.url) || "?").charAt(0).toUpperCase()
  if (!tab.favIconUrl || broken) {
    return (
      <span className="favicon-fallback" aria-hidden="true">
        {letter}
      </span>
    )
  }
  return (
    <img
      className="favicon"
      src={tab.favIconUrl}
      alt=""
      width={20}
      height={20}
      onError={() => setBroken(true)}
    />
  )
}

function TabHeader({ tab }: { tab: TabInfo }) {
  const host = tabHost(tab.url)
  return (
    <header className="tab-header">
      <TabFavicon tab={tab} />
      <div className="tab-meta">
        <div className="tab-title" title={tab.title || host}>
          {tab.title || host || "Untitled"}
        </div>
        {host ? <div className="tab-url">{host}</div> : null}
      </div>
    </header>
  )
}

function ShortcutHint({ enterLabel = "Save" }: { enterLabel?: string }) {
  const mod = isMacPlatform() ? "Cmd" : "Ctrl"
  return (
    <footer className="hint">
      <span>Enter {enterLabel} · esc Close</span>
      <span className="hint-keys">
        <kbd>{mod}</kbd>
        <kbd>⇧</kbd>
        <kbd>S</kbd>
      </span>
    </footer>
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
  const [tab, setTab] = useState<TabInfo>({
    url: null,
    title: "",
    favIconUrl: null,
  })
  const [baseUrl, setBaseUrlState] = useState("https://markx.app")
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

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

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    }
  }, [])

  async function bootstrap() {
    const [base, tabs] = await Promise.all([
      getBaseUrl(),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ])
    setBaseUrlState(base)
    const active = tabs[0]
    setTab({
      url: active?.url ?? null,
      title: active?.title ?? "",
      favIconUrl: active?.favIconUrl ?? null,
    })

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
    const foldersResult = await fetchFolders()
    if (!foldersResult.ok && foldersResult.reason === "unauthorized") {
      await clearSession()
      setView({ kind: "error", variant: "session" })
      return
    }
    if (!foldersResult.ok) {
      setView({ kind: "error", variant: "network" })
      return
    }
    const lastId = await getLastFolderId()
    const folders = prioritizeLastUsedFolder(foldersResult.folders, lastId)
    const initial =
      (lastId && folders.some((folder) => folder.id === lastId)
        ? lastId
        : folders[0]?.id) ?? null
    setSelectedId(initial)
    setView({ kind: "picker", folders })
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

  useEffect(() => {
    if (!selectedId || !listRef.current) return
    const row = listRef.current.querySelector(
      `[data-folder-id="${CSS.escape(selectedId)}"]`
    )
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: "nearest" })
    }
  }, [selectedId])

  useEffect(() => {
    if (view.kind !== "saved") return
    closeTimer.current = window.setTimeout(() => window.close(), 1200)
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current)
    }
  }, [view])

  async function openSignIn() {
    const origin = new URL(baseUrl).origin
    const existing = await chrome.tabs.query({ url: `${origin}/*` })
    const existingTab = existing.at(0)
    if (existingTab != null && existingTab.id != null) {
      await chrome.tabs.update(existingTab.id, { active: true })
      await chrome.windows.update(existingTab.windowId, { focused: true })
    } else {
      await chrome.tabs.create({ url: `${baseUrl}/` })
    }
    window.close()
  }

  async function openUpgrade() {
    await chrome.tabs.create({ url: `${baseUrl}/?upgrade=1` })
  }

  async function openFolder(folderId: string) {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    await chrome.tabs.create({ url: `${baseUrl}/folder/${folderId}` })
    window.close()
  }

  async function saveTo(folderId: string) {
    if (!tab.url || saving) return
    if (!/^https?:/i.test(tab.url)) {
      setView({
        kind: "error",
        variant: "generic",
        message:
          "This page cannot be saved. Open a regular web page and try again.",
      })
      return
    }
    setSaving(true)
    const result: SaveBookmarkResult = await saveBookmark(folderId, tab.url)
    setSaving(false)
    if (result.ok) {
      await setLastFolderId(folderId)
      setView({
        kind: "saved",
        folderName: result.folder.name,
        folderId: result.folder.id,
      })
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

  if (view.kind === "loading") {
    return (
      <div className="popup popup--status">
        <p className="lede lede-tight">Loading…</p>
      </div>
    )
  }

  if (view.kind === "signed-out") {
    return (
      <div className="popup popup--status">
        <img
          className="brand-mark"
          src={chrome.runtime.getURL("markx-logo-flat.svg")}
          alt=""
          width={36}
          height={36}
        />
        <div className="wordmark">markx</div>
        <p className="lede">Save this site to your markx board</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void openSignIn()}
        >
          <SignInIcon size={16} weight="regular" />
          Sign in to markx
        </button>
        <p className="signup">
          Don't have an account?{" "}
          <button
            type="button"
            className="text-link"
            onClick={() => void openSignIn()}
          >
            Create one free
          </button>
        </p>
      </div>
    )
  }

  if (view.kind === "saved") {
    return (
      <div className="popup popup--status">
        <div className="status-icon status-icon--ok">
          <CheckCircleIcon size={32} weight="fill" />
        </div>
        <h1 className="title lede-clip" title={`Saved to ${view.folderName}`}>
          Saved to {view.folderName}
        </h1>
        <button
          type="button"
          className="text-link open-folder"
          onClick={() => void openFolder(view.folderId)}
        >
          Open folder
        </button>
      </div>
    )
  }

  if (view.kind === "board-full") {
    return (
      <div className="popup popup--status">
        <div className="status-icon">
          <WarningIcon size={32} weight="regular" />
        </div>
        <h1 className="title">
          Your board is full ({view.count}/{view.limit} items)
        </h1>
        <p className="lede">Free plan is limited to {view.limit} items.</p>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void openUpgrade()}
          >
            <CrownIcon size={16} weight="fill" />
            Upgrade to Pro
          </button>
          {tab.url ? <CopyUrlButton url={tab.url} /> : null}
        </div>
      </div>
    )
  }

  if (view.kind === "error") {
    const title =
      view.variant === "session"
        ? "Your session expired"
        : view.variant === "network"
          ? "Couldn't reach markx"
          : "Couldn't save"
    const lede =
      view.message ??
      (view.variant === "session"
        ? "Sign in again to save this page."
        : view.variant === "network"
          ? "Check your connection, then try again."
          : "Something went wrong. Try again.")
    return (
      <div className="popup popup--status">
        <div className="status-icon">
          {view.variant === "network" ? (
            <CloudWarningIcon size={32} weight="regular" />
          ) : (
            <WarningIcon size={32} weight="regular" />
          )}
        </div>
        <h1 className="title">{title}</h1>
        <p className="lede">{lede}</p>
        {view.variant === "session" ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void openSignIn()}
          >
            <SignInIcon size={16} weight="regular" />
            Sign in again
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
            <ArrowClockwiseIcon size={16} weight="regular" />
            Try again
          </button>
        )}
      </div>
    )
  }

  const empty = visibleFolders.length === 0

  return (
    <div className="popup popup--picker">
      <TabHeader tab={tab} />
      <div className="picker-body">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (selectedId) void saveTo(selectedId)
          }}
        >
          <div className="search">
            <span className="search-icon">
              <MagnifyingGlassIcon size={16} weight="regular" />
            </span>
            <label htmlFor="folder-search" className="sr-only">
              Search folders
            </label>
            <input
              id="folder-search"
              ref={searchRef}
              type="text"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              data-1p-ignore="true"
              placeholder="Search folders..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              disabled={saving}
            />
          </div>
          {empty ? (
            <div className="empty-search">
              <p className="empty-title">No folders found</p>
            </div>
          ) : (
            <div
              className="folder-list"
              role="listbox"
              aria-label="Folders"
              ref={listRef}
            >
              {visibleFolders.map((folder) => {
                const selected = folder.id === selectedId
                return (
                  <button
                    key={folder.id}
                    type="button"
                    role="option"
                    data-folder-id={folder.id}
                    className={selected ? "folder-row selected" : "folder-row"}
                    aria-selected={selected}
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
                    {selected ? (
                      <span className="check" aria-hidden="true">
                        <CheckIcon size={16} weight="bold" />
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </form>
      </div>
      <ShortcutHint />
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
