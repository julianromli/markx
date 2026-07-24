# markx

A spatial bookmark board — drop links, notes, images, and folders onto an infinite canvas and arrange them your way. Everything is stored locally in your browser (IndexedDB), so your board is private and works offline.

## Stack

- [TanStack Start](https://tanstack.com/start) + React 19 + TypeScript
- [shadcn/ui](https://ui.shadcn.com/) (base-luma) + Tailwind CSS v4
- [Tiptap](https://tiptap.dev/) for notes
- IndexedDB for local persistence

## Getting started

```bash
bun install
bun run dev      # http://localhost:3000
```

Other scripts:

```bash
bun run build    # production build
bun run preview  # preview the build
bun run typecheck
bun run test
```

## Adding shadcn components

```bash
npx shadcn@latest add button
```

Components live in `src/components/ui` and are imported as:

```tsx
import { Button } from "@/components/ui/button";
```
