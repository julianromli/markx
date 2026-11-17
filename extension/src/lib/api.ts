import { getBaseUrl, getSession } from "./config"

export type ExtensionFolder = { id: string; name: string }

export type SaveBookmarkResult =
  | {
      ok: true
      bookmark: { id: string }
      folder: ExtensionFolder
      version: number
    }
  | { ok: false; reason: "board_full"; count: number; limit: number }
  | { ok: false; reason: "folder_not_found" }
  | { ok: false; reason: "invalid_url" }
  | { ok: false; reason: "unauthorized" }
  | { ok: false; reason: "network" }
  | { ok: false; reason: "no_workspace" }
  | { ok: false; reason: "conflict" }
  | { ok: false; reason: "error"; message?: string }

async function request(
  path: string,
  init: RequestInit = {}
): Promise<{ response: Response; data: unknown } | { network: true }> {
  const baseUrl = await getBaseUrl()
  const session = await getSession()
  const headers = new Headers(init.headers)
  headers.set("Accept", "application/json")
  if (init.body) headers.set("Content-Type", "application/json")
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    })
    const text = await response.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    return { response, data }
  } catch {
    return { network: true }
  }
}

export async function fetchSession(): Promise<
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; reason: "unauthorized" | "network" }
> {
  const result = await request("/api/extension/session")
  if ("network" in result) return { ok: false, reason: "network" }
  if (result.response.status === 401) {
    return { ok: false, reason: "unauthorized" }
  }
  if (!result.response.ok) return { ok: false, reason: "network" }
  const data = result.data as { user?: { id: string; email: string } }
  if (!data.user?.id) return { ok: false, reason: "unauthorized" }
  return { ok: true, user: data.user }
}

export async function fetchFolders(): Promise<
  | { ok: true; folders: ExtensionFolder[] }
  | { ok: false; reason: "unauthorized" | "network" }
> {
  const result = await request("/api/extension/folders")
  if ("network" in result) return { ok: false, reason: "network" }
  if (result.response.status === 401) {
    return { ok: false, reason: "unauthorized" }
  }
  if (!result.response.ok) return { ok: false, reason: "network" }
  const data = result.data as { folders?: ExtensionFolder[] }
  return { ok: true, folders: data.folders ?? [] }
}

export async function saveBookmark(
  folderId: string,
  url: string
): Promise<SaveBookmarkResult> {
  const result = await request("/api/extension/bookmarks", {
    method: "POST",
    body: JSON.stringify({ folderId, url }),
  })
  if ("network" in result) return { ok: false, reason: "network" }
  if (result.response.status === 401) {
    return { ok: false, reason: "unauthorized" }
  }
  const data = result.data as SaveBookmarkResult
  if (data && typeof data === "object" && "ok" in data) return data
  return { ok: false, reason: "error" }
}
