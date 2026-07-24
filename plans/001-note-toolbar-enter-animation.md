# 001 — Animate the note editing toolbar's entrance

- **Status**: IMPLEMENTED — feel-check pending (mechanical checks pass)
- **Commit**: 934a5bc
- **Severity**: HIGH
- **Category**: Missed opportunities (Purpose & frequency / Physicality)
- **Estimated scope**: 2 files, ~10 lines

## Problem

When you double-click a note to edit it, the floating formatting toolbar
appears instantly with no motion. Editing notes is the core interaction of
markx — this pop is seen on every edit and feels unresponsive.

The toolbar is a React conditional render, so it mounts/unmounts with no
transition. Cited verbatim:

```tsx
/* src/components/markx/note-card.tsx:131 — current */
      {editing && editor ? (
        <div
          className="absolute -top-[52px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-[13px] border border-black/10 bg-white px-1.5 py-1 shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
```

## Target

A quick fade + slight scale-up from 0.95 on entrance, using the repo's
`--ease-out-strong` token. Animate the CSS `scale` and `opacity` properties
only — these are independent of the `-translate-x-1/2` centering (which uses
`transform`), so there is no conflict. Enter-only via native `@starting-style`;
exit remains instant (acceptable — focus is leaving the note on blur/Escape,
the disappear is not the jarring moment).

```css
/* src/styles.css — add inside the existing @layer utilities { … } block */
.note-toolbar-in {
  opacity: 1;
  scale: 1;
  transition:
    opacity 150ms var(--ease-out-strong),
    scale 150ms var(--ease-out-strong);
}
@starting-style {
  .note-toolbar-in {
    opacity: 0;
    scale: 0.95;
  }
}
```

```tsx
/* src/components/markx/note-card.tsx:134 — target className */
          className="note-toolbar-in absolute -top-[52px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-[13px] border border-black/10 bg-white px-1.5 py-1 shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]"
```

## Repo conventions to follow

- Easing tokens live in `src/styles.css` under `@theme inline`:
  `--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1);` (line 18). Reuse it; do
  not introduce a new curve.
- Custom utility classes already live in `@layer utilities { … }` in
  `src/styles.css` (see `.markx-dot-bg` at line 149). Add `.note-toolbar-in`
  in that same block.
- The repo already relies on `@starting-style` semantics via Base UI's
  `data-starting-style:` variants (e.g. `src/components/ui/dialog.tsx:35`), so
  native `@starting-style` is within the supported feature set.
- Press/entrance durations in this repo are `duration-150` (see
  `src/components/markx/app-shell.tsx:156`, `282`, `325`). 150ms matches.

## Steps

1. In `src/styles.css`, inside the existing `@layer utilities { … }` block
   (after the `.markx-dot-bg` rule, before the closing `}`), add the
   `.note-toolbar-in` rule and its `@starting-style` block exactly as shown in
   the Target above.
2. In `src/components/markx/note-card.tsx`, on the toolbar `<div>` at line 134,
   prepend `note-toolbar-in ` to the `className` string (keep everything else
   identical).

## Boundaries

- Do NOT touch the toolbar's children, dropdowns, or any other note-card
  markup. Motion properties only.
- Do NOT add JS state, `useEffect`, or a mounted flag — `@starting-style` is
  CSS-only and fires automatically on first render.
- Do NOT animate `transform` (it would fight the `-translate-x-1/2` centering).
  Use `scale` + `opacity` only.
- Do NOT add new dependencies.
- If `note-card.tsx:134` no longer matches the excerpt above (drift since
  commit 934a5bc), STOP and report instead of improvising.

## Verification

- **Mechanical**: `bun run typecheck` passes; `bun run lint` passes.
- **Feel check**: run `bun run dev`, open a folder, double-click a note, and
  confirm:
  - The toolbar fades in and scales up from ~0.95 over ~150ms (subtle, not
    bouncy) instead of popping.
  - The toolbar stays horizontally centered (the `-translate-x-1/2` is
    unchanged) — no horizontal jump.
  - Pressing Escape or clicking away still removes the toolbar instantly
    (exit is intentionally instant — acceptable).
  - In DevTools → Animations panel, set playback to 10% and re-trigger to
    confirm the curve is `ease-out`-shaped (fast start, slow settle) and the
    total duration is ~150ms.
  - In DevTools → Rendering panel, toggle `prefers-reduced-motion: reduce`
    and confirm the toolbar appears with no movement (the global
    `transition-duration: 0.001ms !important` rule in `src/styles.css:172`
    neutralizes it — opacity change still occurs, instantly).
- **Done when**: the toolbar visibly fades+scales in on edit entry; no
  horizontal shift; reduced-motion shows no movement.
