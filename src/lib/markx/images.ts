import { compressImage } from "./compress"
import { store } from "./store"
import { getImageBlob } from "./storage"

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

export type PreparedImage = {
  blob: Blob
  mime: string
  naturalWidth: number
  naturalHeight: number
}

const objectUrlCache = new Map<string, string>()

export function getImageObjectUrl(imageId: string, blob: Blob): string {
  const cached = objectUrlCache.get(imageId)
  if (cached) return cached
  const url = URL.createObjectURL(blob)
  objectUrlCache.set(imageId, url)
  return url
}

export function revokeImageObjectUrl(imageId: string): void {
  const url = objectUrlCache.get(imageId)
  if (url) {
    URL.revokeObjectURL(url)
    objectUrlCache.delete(imageId)
  }
}

/**
 * Resolve an image blob: local IndexedDB cache first, then cloud (R2)
 * via the active SyncEngine if one is attached. Returns `undefined`
 * when the blob cannot be found (e.g. offline and not cached).
 */
export async function resolveImageBlob(
  imageId: string
): Promise<Blob | undefined> {
  const cached = await getImageBlob(imageId)
  if (cached) return cached
  const engine = store.getSyncEngine()
  if (engine) return engine.fetchAsset(imageId)
  return undefined
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const commaIndex = result.indexOf(",")
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function getNaturalDimensions(
  blob: Blob
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const { naturalWidth, naturalHeight } = img
      URL.revokeObjectURL(url)
      resolve({ width: naturalWidth, height: naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: 0, height: 0 })
    }
    img.src = url
  })
}

export async function prepareImage(file: File): Promise<PreparedImage | null> {
  if (!file.type.startsWith("image/")) return null
  if (file.size > MAX_FILE_SIZE) return null

  // GIFs: store as-is to preserve animation
  if (file.type === "image/gif") {
    const blob = new Blob([file], { type: "image/gif" })
    const { width, height } = await getNaturalDimensions(blob)
    return {
      blob,
      mime: "image/gif",
      naturalWidth: width,
      naturalHeight: height,
    }
  }

  try {
    const base64 = await fileToBase64(file)
    const result = await compressImage({ data: { base64, mime: file.type } })
    const blob = base64ToBlob(result.base64, result.mime)
    return {
      blob,
      mime: result.mime,
      naturalWidth: result.width,
      naturalHeight: result.height,
    }
  } catch {
    // Fallback: store original bytes
    const blob = new Blob([file], { type: file.type })
    const { width, height } = await getNaturalDimensions(blob)
    return {
      blob,
      mime: file.type,
      naturalWidth: width,
      naturalHeight: height,
    }
  }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i)
  }
  return new Blob([arr], { type: mime })
}
