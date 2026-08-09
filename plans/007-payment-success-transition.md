# 007 — Transition the payment success state

- **Status**: IMPLEMENTED
- **Commit**: 12cbde6
- **Severity**: LOW
- **Category**: Missed opportunities (State indication / Delight)
- **Estimated scope**: 2 files, ~15 lines

## Problem

The payment dialog changes from the QR payment view to the success view when
`paid` becomes true. React swaps the two conditional branches instantly.

```tsx
/* src/components/markx/account-menu.tsx:323-337 — current */
          {paid ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircleIcon
                className="size-12 text-green-600"
                weight="fill"
              />
              <p className="font-medium">Markx Pro is active</p>
              <p className="text-sm text-muted-foreground">
                You can add more than 100 items to your workspace.
              </p>
              <Button className="mt-2" onClick={() => setUpgradeOpen(false)}>
                Done
              </Button>
            </div>
```

Payment confirmation is rare and high-emotion. A restrained entrance can make
the state change clear without delaying the user's next action.

## Target

Add a one-shot success entrance to the success panel. Use `opacity` and
`scale: 0.97` over `200ms` with the shared strong ease-out curve.

```css
/* src/styles.css — add inside the existing @layer utilities block */
.payment-success-in {
  opacity: 1;
  scale: 1;
  transition:
    opacity 200ms var(--ease-out-strong),
    scale 200ms var(--ease-out-strong);
}
@starting-style {
  .payment-success-in {
    opacity: 0;
    scale: 0.97;
  }
}
```

```tsx
/* src/components/markx/account-menu.tsx:324 — target */
            <div className="payment-success-in flex flex-col items-center gap-3 py-6 text-center">
```

## Repo conventions to follow

- Reuse `--ease-out-strong` from `src/styles.css:18`.
- Add the utility inside the existing `@layer utilities` block.
- Match the existing dialog duration of `200ms` in
  `src/components/ui/dialog.tsx:32`.
- Animate `scale` and `opacity` only.
- The global reduced-motion rule in `src/styles.css:323` removes scale motion.

## Steps

1. Add `.payment-success-in` and its `@starting-style` block to
   `src/styles.css`.
2. Add `payment-success-in` to the success-state wrapper in
   `src/components/markx/account-menu.tsx`.

## Boundaries

- Do not animate the QR code, countdown, or polling behavior.
- Do not change payment state handling or dialog close behavior.
- Do not add a bounce, confetti, sound, or new dependency.
- Do not animate the dialog shell itself.
- If the success branch is no longer conditionally mounted, stop and report.

## Verification

- **Mechanical**: Run `bun run typecheck` and `bun run lint`.
- **Feel check**:
  - Open the Pro payment flow and complete a test payment.
  - Confirm the success content fades and scales in over about `200ms`.
  - Confirm the `Done` button remains available without extra delay.
  - Close and reopen the dialog, then confirm the entrance runs once per
    success-state mount.
  - Toggle reduced motion and confirm the panel changes state without scale.
- **Done when**: payment confirmation is clear, restrained, and immediate to use.
