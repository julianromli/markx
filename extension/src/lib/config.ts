export const DEFAULT_BASE_URL = "https://markx.app"
const BASE_URL_KEY = "markx.baseUrl"
const LAST_FOLDER_KEY = "markx.lastFolderId"
const SESSION_KEY = "markx.session"

export type ExtensionSession = {
  token: string
  user: { id: string; email: string }
}

export async function getBaseUrl(): Promise<string> {
  const stored = await chrome.storage.local.get(BASE_URL_KEY)
  const value = stored[BASE_URL_KEY]
  return typeof value === "string" && value.length > 0
    ? value.replace(/\/$/, "")
    : DEFAULT_BASE_URL
}

export async function setBaseUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/$/, "")
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Base URL must start with http:// or https://")
  }
  await chrome.storage.local.set({ [BASE_URL_KEY]: trimmed })
}

export async function getLastFolderId(): Promise<string | null> {
  const stored = await chrome.storage.local.get(LAST_FOLDER_KEY)
  const value = stored[LAST_FOLDER_KEY]
  return typeof value === "string" && value.length > 0 ? value : null
}

export async function setLastFolderId(id: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_FOLDER_KEY]: id })
}

export async function getSession(): Promise<ExtensionSession | null> {
  const stored = await chrome.storage.local.get(SESSION_KEY)
  const value = stored[SESSION_KEY] as ExtensionSession | undefined
  if (!value?.token || !value.user?.id) return null
  return value
}

export async function setSession(session: ExtensionSession): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: session })
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(SESSION_KEY)
}

export function originPattern(baseUrl: string): string {
  const url = new URL(baseUrl)
  return `${url.origin}/*`
}
