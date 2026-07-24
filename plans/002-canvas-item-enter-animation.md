# 002 — Animate canvas items in on creation

- **Status**: IMPLEMENTED — feel-check pending (mechanical checks pass)
- **Commit**: 934a5bc
- **Severity**: HIGH
- **Category**: Missed opportunities (Physicality & origin)
- **Estimated scope**: 2 files, ~12 lines

## Problem

When a note, bookmark, image, or folder is created on the canvas, it appears
at full size instantly — no motion explains that it just came into being.
Creation is markx's core action; the instant pop feels unresponsive.

The per-item wrapper is keyed by `item.id` and mounts once per item, so a
CSS-only `@starting-style` entrance fires exactly once on creation (and on
undo/redo re-add), never on drag/resize (the element is not remounted). Cited
verbatim:

```tsx
/* src/components/markx/board.tsx:822 — current */
          <div
              key={item.id}
              data-board-item={item.id}
              className="absolute origin-top-left"
              ref={(el) => {
                if (el) itemElMap.current.set(item.id, el)
                else itemElMap.current.delete(item.id)
              }}
              style={{
                transform: `translate(${x}px, ${y}px)`,
                zIndex: item.data.z,
              }}
            >
```

**Critical constraint**: this wrapper's `transform` is written both by React
(initial position) and by direct-DOM during drag/resize
(`board.tsx:248-262`: `el.style.transform = translate(...)` and
`translate(...) scale(scaleX, scaleY)`). Therefore the entrance MUST NOT
animate `transform` — it would lag the pointer during drag. Animate the CSS
`scale` and `opacity` properties only; they are independent of `transform` and
are never touched by the drag/resize code, so they sit at `1`/`1` after the
entrance completes.

## Target

```css
/* src/styles.css — add inside the existing @layer utilities { … } block */
.board-item-in {
  opacity: 1;
  scale: 1;
  transition:
    opacity 180ms var(--ease-out-strong),
    scale 180ms var(--ease-out-strong);
}
@starting-style {
  .board-item-in {
    opacity: 0;
    scale: 0.95;
  }
}
```

```tsx
/* src/components/markx/board.tsx:825 — target className */
              className="board-item-in absolute origin-top-left"
```

`origin-top-left` is kept (the item grows from its fixed top-left corner —
natural for a canvas item with an absolute origin). 180ms is within the UI
budget (<300ms) and slightly longer than the 150ms toolbar entrance so a
newly created item reads as "settling into place" rather than snapping.

## Repo conventions to follow

- Reuse `--ease-out-strong` from `src/styles.css:18`; do not add a curve.
- Add the utility in the existing `@layer utilities { … }` block (alongside
  `.markx-dot-bg`, `src/styles.css:149`).
- The repo's entrance pattern is `data-starting-style:zoom-95` (≈ scale 0.95)
  + `opacity-0` → `1` (see `src/components/ui/dialog.tsx:35`, `dropdown-menu.tsx:43`).
  `scale: 0.95` matches that physicality. Native `@starting-style` is the
  CSS-only equivalent and is already relied on elsewhere via Base UI.
- Animate only compositor-friendly properties (`scale`, `opacity`) — never
  `transform` here (see constraint above).

## Steps

1. In `src/styles.css`, inside the existing `@layer utilities { … }` block,
   add the `.board-item-in` rule and its `@starting-style` block exactly as
   shown in the Target.
2. In `src/components/markx/board.tsx`, on the item wrapper `<div>` at line
   825, prepend `board-item-in ` to the `className` string. Leave `style`,
   `ref`, `key`, and `data-board-item` untouched.

## Boundaries

- Do NOT add `transform` or `translate` to the transition — drag/resize write
  `transform` directly and must stay instant.
- Do NOT change the `ref` callback, `style` object, `key`, or `data-board-item`.
- Do NOT add JS state, flags, or `useEffect`. CSS-only.
- Do NOT touch `renderItem`, the camera layer, the marquee, or any drag logic.
- Do NOT add new dependencies.
- If `board.tsx:822-838` no longer matches the excerpt (drift since 934a5bc),
  STOP and report.

## Verification

- **Mechanical**: `bun run typecheck` passes; `bun run lint` passes.
- **Feel check**: run `bun run dev`:
  - Select the Note tool, click the canvas → the new note fades+scales in
    from ~0.95 over ~180ms, settling at full size. It does NOT slide (position
    is fixed; only opacity+scale animate).
  - Drag an item → it follows the pointer with NO lag (confirms `transform`
    is not transitioned).
  - Resize an item via the corner handle → size changes with no lag and no
    spurious scale animation (confirms the `scale` property is untouched by
    resize, which writes `transform: … scale(…)`).
  - Undo (⌘Z) after creating an item, then redo (⌘⇧Z) → the item re-enters
    with the same fade+scale (acceptable; re-mount re-fires `@starting-style`).
  - Create several items rapidly → each enters independently (no global
    stagger; that is a separate, optional plan).
  - DevTools → Animations panel at 10%: confirm `ease-out` curve, ~180ms,
    `scale` 0.95→1 and `opacity` 0→1.
  - DevTools → Rendering panel: toggle `prefers-reduced-motion: reduce` →
    items appear with no movement (global `transition-duration: 0.001ms
    !important` at `src/styles.css:172` neutralizes it).
- **Done when**: every newly created canvas item fades+scales in once on
  creation; drag/resize remain lag-free; reduced-motion shows no movement.
