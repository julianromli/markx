# 005 — Transition the empty workspace state

- **Status**: IMPLEMENTED
- **Commit**: 12cbde6
- **Severity**: MEDIUM
- **Category**: Missed opportunities (Preventing a jarring change)
- **Estimated scope**: 2 files, ~30 lines

## Problem

The workspace renders the empty-state panel only while `items.length === 0`.
The panel therefore appears and disappears instantly after creation or
deletion.

```tsx
/* src/components/markx/workspace.tsx:578-580 — current */
      ) : items.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto rounded-2xl bg-white/80 px-6 py-5 text-center shadow-sm outline outline-1 outline-black/5 backdrop-blur">
```

## Target

Keep the state mounted during its exit transition. Add a small fade and scale
change to the panel. Use `scale: 0.97`, `opacity`, `180ms`, and the shared
strong ease-out curve.

The implementation must distinguish these states:

- `items.length === 0`: mount or keep the panel visible.
- `items.length > 0` after the panel was visible: start the exit state.
- Remove the panel only after the exit transition completes.

```css
/* src/styles.css — add inside the existing @layer utilities block */
.workspace-empty-state {
  opacity: 1;
  scale: 1;
  transition:
    opacity 180ms var(--ease-out-strong),
    scale 180ms var(--ease-out-strong);
}
.workspace-empty-state.is-leaving {
  opacity: 0;
  scale: 0.97;
}
@starting-style {
  .workspace-empty-state {
    opacity: 0;
    scale: 0.97;
  }
}
```

Apply the class to the inner panel, not the full-screen positioning wrapper.
This keeps the overlay's pointer behavior and centering unchanged.

## Repo conventions to follow

- Reuse `--ease-out-strong` from `src/styles.css:18`.
- Add the utility to the existing `@layer utilities` block.
- Match `.board-item-in` in `src/styles.css:204` for the entrance values.
- Animate `scale` and `opacity` only.
- Keep reduced-motion behavior through the global rule in
  `src/styles.css:323`.

## Steps

1. Add `.workspace-empty-state`, `.workspace-empty-state.is-leaving`, and the
   `@starting-style` block to `src/styles.css`.
2. Add a mounted-state mechanism in `Workspace` that keeps the empty panel
   present for the `180ms` exit period.
3. Apply `workspace-empty-state` to the inner panel and
   `is-leaving` while items exist.
4. Clear the mounted state after the exit transition.
5. Ignore stale transition callbacks when the workspace becomes empty again
   before the exit period ends.

## Boundaries

- Do not animate the full-screen wrapper.
- Do not animate board items in this plan.
- Do not change empty-state copy, buttons, or item creation behavior.
- Do not use `transition: all`.
- Do not add dependencies.
- If `workspace.tsx:578-580` no longer matches, stop and report.

## Verification

- **Mechanical**: Run `bun run typecheck` and `bun run lint`.
- **Feel check**:
  - Open an empty Home workspace and confirm the panel fades and scales in.
  - Create an item and confirm the panel fades and scales out.
  - Delete the last item and confirm the panel returns with the entrance.
  - Create an item again before the exit ends and confirm no stale callback
    removes the panel.
  - Toggle reduced motion and confirm no scale movement remains.
- **Done when**: empty-state changes never teleport and never block creation.
