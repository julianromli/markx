# 008 — Stagger shared-board list entrances

- **Status**: IMPLEMENTED
- **Commit**: 12cbde6
- **Severity**: LOW
- **Category**: Missed opportunities (Cohesion / Preventing a jarring change)
- **Estimated scope**: 2 files, ~25 lines

## Problem

The shared-board page replaces its loading spinner with the complete list in
one render. The list is occasional and non-interactive while it enters, so a
small capped stagger can clarify that the results loaded.

```tsx
/* src/routes/shared.tsx:36-40 — current loading state */
  if (boards === undefined) {
    return (
      <div className="flex h-svh items-center justify-center bg-white">
        <Spinner />
      </div>
    )
  }
```

```tsx
/* src/routes/shared.tsx:60-66 — current list */
        <ul className="space-y-2">
          {boards.map((b) => (
            <li
              key={b.boardId}
              className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
            >
```

## Target

Add a `shared-board-list-item-in` entrance with `opacity: 0` and
`translateY(4px)`. Use `180ms` and `var(--ease-out-strong)`. Stagger only the
first five rows by `40ms` using an inline custom property.

```css
/* src/styles.css — add inside the existing @layer utilities block */
.shared-board-list-item-in {
  opacity: 1;
  translate: 0 0;
  transition:
    opacity 180ms var(--ease-out-strong),
    translate 180ms var(--ease-out-strong);
  transition-delay: calc(var(--stagger-index, 0) * 40ms);
}
@starting-style {
  .shared-board-list-item-in {
    opacity: 0;
    translate: 0 4px;
  }
}
```

```tsx
/* src/routes/shared.tsx:61-65 — target shape */
          {boards.map((b, index) => (
            <li
              key={b.boardId}
              style={{ "--stagger-index": Math.min(index, 4) } as React.CSSProperties}
              className="shared-board-list-item-in flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
            >
```

Import the `CSSProperties` type from React if the current TypeScript setup
requires it for the custom property.

## Repo conventions to follow

- Reuse `--ease-out-strong` from `src/styles.css:18`.
- Add the utility inside the existing `@layer utilities` block.
- Use the audit stagger budget of `30–80ms`; this plan uses `40ms`.
- Animate `opacity` and `translate` only.
- The global reduced-motion rule in `src/styles.css:323` removes movement.

## Steps

1. Add `.shared-board-list-item-in` and its `@starting-style` block to
   `src/styles.css`.
2. Add the `index` argument to the `boards.map` callback.
3. Set `--stagger-index` to `Math.min(index, 4)`.
4. Add `shared-board-list-item-in` to each list item.
5. Add the required `CSSProperties` type import without adding a runtime
   dependency.

## Boundaries

- Do not animate the page header, spinner, button, or empty state.
- Do not delay list interaction until the animation ends.
- Do not stagger more than five rows.
- Do not use keyframes; transitions must retarget cleanly.
- Do not add dependencies.
- If `shared.tsx:60-66` no longer matches, stop and report.

## Verification

- **Mechanical**: Run `bun run typecheck` and `bun run lint`.
- **Feel check**:
  - Open Shared with me with multiple boards.
  - Confirm rows enter from `translateY(4px)` with `40ms` spacing.
  - Confirm the sixth and later rows do not increase the delay.
  - Click Open during the entrance and confirm interaction works immediately.
  - Toggle reduced motion and confirm rows appear without translation.
- **Done when**: the occasional list entrance feels ordered without blocking use.
