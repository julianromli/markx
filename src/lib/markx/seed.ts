import type { MarkxState } from "./types"

export function createDemoState(): MarkxState {
  const vibeId = "folder-vibe-coding"
  const aiId = "folder-ai"
  const designId = "folder-design-engineer"

  return {
    hasOnboarded: false,
    zCounter: 10,
    folders: [
      { id: vibeId, name: "Vibe Coding", x: 520, y: 280, z: 3 },
      { id: aiId, name: "AI", x: 780, y: 180, z: 2 },
      { id: designId, name: "Design Engineer", x: 320, y: 360, z: 1 },
    ],
    bookmarks: [
      {
        id: "bookmark-cursor",
        folderId: vibeId,
        url: "https://cursor.com",
        title: "Cursor",
        description: "The AI code editor",
        faviconUrl:
          "https://www.google.com/s2/favicons?domain=cursor.com&sz=64",
        x: 120,
        y: 120,
        z: 1,
      },
      {
        id: "bookmark-linear",
        folderId: vibeId,
        url: "https://linear.app",
        title: "Linear",
        description: "Purpose-built for planning and building products",
        faviconUrl:
          "https://www.google.com/s2/favicons?domain=linear.app&sz=64",
        x: 420,
        y: 280,
        z: 2,
      },
      {
        id: "bookmark-shadcn",
        folderId: vibeId,
        url: "https://ui.shadcn.com",
        title: "shadcn/ui",
        description:
          "The Foundation for your Design System. Beautifully designed components you can customize.",
        faviconUrl:
          "https://www.google.com/s2/favicons?domain=ui.shadcn.com&sz=64",
        x: 280,
        y: 480,
        z: 3,
      },
      {
        id: "bookmark-openai",
        folderId: aiId,
        url: "https://openai.com",
        title: "OpenAI",
        faviconUrl:
          "https://www.google.com/s2/favicons?domain=openai.com&sz=64",
        x: 200,
        y: 200,
        z: 1,
      },
      {
        id: "bookmark-animations",
        folderId: designId,
        url: "https://animations.dev",
        title: "animations.dev",
        description: "Emil Kowalski's course on animations",
        faviconUrl:
          "https://www.google.com/s2/favicons?domain=animations.dev&sz=64",
        x: 240,
        y: 240,
        z: 1,
      },
    ],
    notes: [],
    images: [],
  }
}

export function createEmptyState(): MarkxState {
  return {
    folders: [],
    bookmarks: [],
    notes: [],
    images: [],
    hasOnboarded: true,
    zCounter: 1,
  }
}
