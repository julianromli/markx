import { describe, expect, it } from "vitest"

import {
  parseYoutubeVideoId,
  youtubeOptimisticImageUrl,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
} from "./youtube"

const VIDEO_ID = "dQw4w9WgXcQ"

describe("parseYoutubeVideoId", () => {
  it("parses watch, short-link, shorts, embed, live, and m. hosts", () => {
    const cases = [
      `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      `https://youtube.com/watch?v=${VIDEO_ID}&feature=share`,
      `https://www.youtube.com/watch?app=desktop&v=${VIDEO_ID}`,
      `https://m.youtube.com/watch?v=${VIDEO_ID}`,
      `https://youtu.be/${VIDEO_ID}`,
      `https://youtu.be/${VIDEO_ID}?si=abc`,
      `https://www.youtube.com/shorts/${VIDEO_ID}`,
      `https://www.youtube.com/embed/${VIDEO_ID}`,
      `https://www.youtube.com/live/${VIDEO_ID}`,
      `http://www.youtube.com/watch?v=${VIDEO_ID}`,
    ]
    for (const url of cases) {
      expect(parseYoutubeVideoId(url), url).toBe(VIDEO_ID)
    }
  })

  it("rejects playlists, channels, music, and malformed ids", () => {
    const cases = [
      "https://www.youtube.com/playlist?list=PLtest",
      "https://www.youtube.com/@RickAstley",
      "https://www.youtube.com/channel/UCuAXFkgsw1L7ngaELIglo_A",
      "https://music.youtube.com/watch?v=" + VIDEO_ID,
      "https://www.youtube.com/watch?v=short",
      "https://example.com/watch?v=" + VIDEO_ID,
      "not-a-url",
    ]
    for (const url of cases) {
      expect(parseYoutubeVideoId(url), url).toBeNull()
    }
  })
})

describe("youtube thumbnail helpers", () => {
  it("builds watch and thumbnail URLs", () => {
    expect(youtubeWatchUrl(VIDEO_ID)).toBe(
      `https://www.youtube.com/watch?v=${VIDEO_ID}`
    )
    expect(youtubeThumbnailUrl(VIDEO_ID)).toBe(
      `https://img.youtube.com/vi/${VIDEO_ID}/hqdefault.jpg`
    )
    expect(youtubeThumbnailUrl(VIDEO_ID, "maxresdefault")).toBe(
      `https://img.youtube.com/vi/${VIDEO_ID}/maxresdefault.jpg`
    )
  })

  it("returns an optimistic hqdefault image for YouTube URLs only", () => {
    expect(
      youtubeOptimisticImageUrl(`https://youtu.be/${VIDEO_ID}`)
    ).toBe(`https://img.youtube.com/vi/${VIDEO_ID}/hqdefault.jpg`)
    expect(youtubeOptimisticImageUrl("https://example.com")).toBeUndefined()
  })
})
