# 003 — Animate the note toolbar's custom dropdowns on open

- **Status**: IMPLEMENTED — feel-check pending (mechanical checks pass)
- **Commit**: 934a5bc
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens (Physicality & origin)
- **Estimated scope**: 2 files, ~10 lines

## Problem

The note editing toolbar has three custom dropdowns (Color, Font, Size) built
as plain React conditionals — they pop in/out instantly. Every other
dropdown/popover in the app (Base UI `dropdown-menu`, `select`, `combobox`,
`hover-card`, `context-menu`, `tooltip`) opens with a `zoom-95` + opacity
ease-out from the trigger. These three break that cohesion and feel jumpy
right next to the (now-animated) toolbar from plan 001.

Cited verbatim:

```tsx
/* src/components/markx/note-card.tsx:405 — current */
      {open ? (
        <div
          className="absolute top-full left-0 z-20 mt-1 rounded-xl border border-black/10 bg-white p-0.5 shadow-[0_4px_16px_rgba(0,0,0,0.15)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {children(() => onOpenMenuChange(null))}
        </div>
      ) : null}
```

The dropdown is always `top-full left-0` (below the trigger, left-aligned), so
its origin is the trigger's bottom-left corner — the same trigger-anchored
physicality the repo uses elsewhere.

## Target

Enter-only via native `@starting-style` (exit stays instant on unmount —
acceptable; matches plans 001/002 and the close-on-outside-click behavior).
Animate `scale` + `opacity` (independent of layout); `origin-top-left` anchors
the scale to the trigger's bottom-left corner.

```css
/* src/styles.css — add inside the existing @layer utilities { … } block */
.toolbar-dropdown-in {
  opacity: 1;
  scale: 1;
  transition:
    opacity 150ms var(--ease-out-strong),
    scale 150ms var(--ease-out-strong);
}
@starting-style {
  .toolbar-dropdown-in {
    opacity: 0;
    scale: 0.95;
  }
}
```

```tsx
/* src/components/markx/note-card.tsx:407 — target className */
          className="toolbar-dropdown-in absolute top-full left-0 z-20 mt-1 origin-top-left rounded-xl border border-black/10 bg-white p-0.5 shadow-[0_4px_16px_rgba(0,0,0,0.15)]"
```

`scale: 0.95` matches the repo's `zoom-95` entrance convention exactly (see
`src/components/ui/dropdown-menu.tsx:43`, `select.tsx:87`,
`combobox.tsx:114`). `origin-top-left` makes the dropdown scale from the
trigger's bottom-left, mirroring Base UI's `origin-(--transform-origin)`.

## Repo conventions to follow

- Reuse `--ease-out-strong` (`src/styles.css:18`); no new curve.
- Add the utility in the existing `@layer utilities { … }` block.
- The repo's popover entrance is `duration-150 ease-[var(--ease-out-strong)]
  data-starting-style:zoom-95 data-starting-style:opacity-0` with a
  trigger-anchored origin. This plan is the CSS-only equivalent for a custom
  (non-Base-UI) popover.
- `zoom-95` = `scale: 0.95`. Use 0.95, not 0.96 (0.96 is the repo's *press*
  feedback value; entrances use 0.95).

## Steps

1. In `src/styles.css`, inside the existing `@layer utilities { … }` block,
   add the `.toolbar-dropdown-in` rule and its `@starting-style` block exactly
   as shown in the Target.
2. In `src/components/markx/note-card.tsx`, on the dropdown content `<div>` at
   line 407, prepend `toolbar-dropdown-in ` and add ` origin-top-left` to the
   `className` string (keep `absolute top-full left-0 z-20 mt-1` and the rest).

## Boundaries

- Do NOT change the `{open ? … : null}` conditional, the `onPointerDown`
  handler, the `children(() => onOpenMenuChange(null))` call, or any menu items.
- Do NOT animate `transform` (the dropdown has no transform-based positioning,
  but keep the animation on `scale`/`opacity` to stay compositor-only).
- Do NOT add JS state or a mounted flag — `@starting-style` is CSS-only.
- Do NOT replace this custom dropdown with the Base UI `DropdownMenu` primitive
  (out of scope; that is a larger refactor tracked separately if desired).
- Do NOT add new dependencies.
- If `note-card.tsx:405-410` no longer matches the excerpt (drift since
  934a5bc), STOP and report.

## Verification

- **Mechanical**: `bun run typecheck` passes; `bun run lint` passes.
- **Feel check**: run `bun run dev`, open a folder, double-click a note to show
  the toolbar, and confirm for each of the Color / Font / Size dropdowns:
  - The menu fades in and scales up from ~0.95 at its top-left corner (the
    trigger's bottom-left) over ~150ms — not a pop.
  - The menu stays anchored under its trigger (no position shift); the `mt-1`
    gap is preserved.
  - Clicking a swatch/option closes instantly (exit is intentionally instant).
  - Clicking outside closes instantly (the `onPointerDown` outside-listener at
    `note-card.tsx:378` unmounts it).
  - Opening one dropdown, then another, then back — each re-mounts and re-enters
    with the animation (acceptable; `@starting-style` re-fires per mount).
  - DevTools → Animations panel at 10%: confirm `ease-out` curve, ~150ms,
    `scale` 0.95→1 and `opacity` 0→1, origin at top-left.
  - DevTools → Rendering panel: toggle `prefers-reduced-motion: reduce` →
    dropdowns open with no movement (global `transition-duration: 0.001ms
    !important` at `src/styles.css:172` neutralizes it).
- **Done when**: all three toolbar dropdowns fade+scale in from the trigger's
  bottom-left on open, matching the rest of the app's popovers; reduced-motion
  shows no movement.
