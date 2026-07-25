const DATA_URL_PATTERN = /^data:([^;,]+);base64,(.*)$/s
const BASE64_CHUNK_SIZE = 8192

export type DecodedDataUrl = {
  mime: string
  bytes: Uint8Array<ArrayBuffer>
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(index, index + BASE64_CHUNK_SIZE)
    binary += String.fromCharCode.apply(null, Array.from(chunk))
  }
  return btoa(binary)
}

export function encodeDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

export function decodeDataUrl(dataUrl: string): DecodedDataUrl {
  const match = DATA_URL_PATTERN.exec(dataUrl)
  if (!match) throw new Error("Invalid data URL")

  let binary: string
  try {
    binary = atob(match[2])
  } catch {
    throw new Error("Invalid data URL")
  }

  return {
    mime: match[1],
    bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return encodeDataUrl(
    new Uint8Array(await blob.arrayBuffer()),
    blob.type || "application/octet-stream"
  )
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const { mime, bytes } = decodeDataUrl(dataUrl)
  return new Blob([bytes], { type: mime })
}
