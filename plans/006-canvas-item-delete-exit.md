# 006 — Animate canvas items out on deletion

- **Status**: IMPLEMENTED
- **Commit**: 12cbde6
- **Severity**: MEDIUM
- **Category**: Missed opportunities (Preventing a jarring change)
- **Estimated scope**: 3 files, ~45 lines

## Problem

Deleting an item removes it from the store immediately. The board maps only the
current `items`, so the item unmounts without showing where it went.

```tsx
/* src/components/markx/board.tsx:944-954 — current */
        {items.map((item) => {
          const live = liveOffsets.get(item.id)
          const resize = liveResize.get(item.id)
          const x = resize?.x ?? live?.x ?? item.data.x
          const y = live?.y ?? item.data.y
          const selected = selectedIds.has(item.id)
          const dragging = liveOffsets.has(item.id) || liveResize.has(item.id)
```

```tsx
/* src/components/markx/board.tsx:975-987 — current */
              style={{
                transform: `translate(${x}px, ${y}px)`,
                zIndex: item.data.z,
              }}
            >
              <div
                className={cn(
                  "origin-center transition-[opacity,transform] duration-150 ease-[var(--ease-out-strong)] motion-reduce:transition-opacity",
                  dragging && trashArmed && "scale-90 opacity-50"
                )}
              >
```

The existing drag-to-trash state already uses a child wrapper for opacity and
scale. Deletion needs a short retained exit state before final store removal.

## Target

When `onTrashDrop` or keyboard/context-menu deletion occurs, mark the affected
IDs as leaving before removing them from the rendered board. Retain their last
position and content for `150ms`, then complete the existing deletion.

```css
/* src/styles.css — add inside the existing @layer utilities block */
.board-item-out {
  opacity: 0;
  scale: 0.95;
  transition:
    opacity 150ms var(--ease-out-strong),
    scale 150ms var(--ease-out-strong);
}
```

Use `scale` and `opacity` only. Do not animate the board item's
`translate(...)` transform, because drag and resize write that transform.

## Repo conventions to follow

- Reuse `--ease-out-strong` from `src/styles.css:18`.
- Add the utility to the existing `@layer utilities` block.
- Match the existing `150ms` press and popover timing.
- Keep `transform` for board positioning and gesture handling.
- The global reduced-motion rule in `src/styles.css:323` removes movement.

## Steps

1. Add `.board-item-out` to `src/styles.css` with the exact target values.
2. Add a leaving-ID set in the board or workspace boundary that receives
   deletion requests.
3. Render deleted items until the `150ms` exit completes.
4. Apply `board-item-out` to the inner visual wrapper while an item leaves.
5. Complete the existing deletion callback after the exit duration.
6. Clear leaving IDs on completion and ignore stale completion callbacks.
7. Preserve the current undo toast and deletion semantics.

## Boundaries

- Do not change item geometry, drag thresholds, camera motion, or hit testing.
- Do not animate `transform` on the board item wrapper.
- Do not delay deletion for non-canvas data or server persistence.
- Do not remove the existing `trashArmed` scale and opacity feedback.
- Do not add dependencies.
- If the current deletion flow cannot retain the item without changing store
  semantics, stop and report that constraint.

## Verification

- **Mechanical**: Run `bun run typecheck` and `bun run lint`.
- **Feel check**:
  - Delete one item through the trash dock and confirm it fades and scales
    down over about `150ms`.
  - Delete several selected items and confirm all exit together.
  - Drag an item to trash and confirm the armed state still uses its current
    feedback before deletion.
  - Drag and resize items normally and confirm no lag.
  - Use keyboard deletion and confirm the same exit treatment.
  - Toggle reduced motion and confirm movement is removed.
- **Done when**: deletion has a clear visual exit without delaying data behavior
  beyond the short visual retention period.
