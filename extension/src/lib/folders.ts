export function prioritizeLastUsedFolder<T extends { id: string }>(
  folders: readonly T[],
  lastFolderId: string | null | undefined
): T[] {
  if (!lastFolderId) return [...folders]
  const index = folders.findIndex((folder) => folder.id === lastFolderId)
  if (index <= 0) return [...folders]
  const selected = folders[index]
  return [selected, ...folders.slice(0, index), ...folders.slice(index + 1)]
}

export function tabHost(url: string | null | undefined): string {
  if (!url) return ""
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

export function isMacPlatform(): boolean {
  const ua = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  const platform = ua.userAgentData?.platform ?? navigator.platform
  return /mac/i.test(platform)
}
