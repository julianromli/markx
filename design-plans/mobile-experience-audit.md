# Mobile experience audit

- **Status**: IMPLEMENTED
- **Date**: 2026-08-10
- **Scope**: Mobile card arrangement on iPhone Safari, Android Chrome, and iPad
- **Primary task**: Arrange cards on the canvas
- **Research**: [Mobile canvas interaction guidance](./mobile-canvas-interaction-guidance.md)
- **Context7**: Unavailable in this session. Official Apple, MDN, React, and
  TanStack sources were used instead.

## Design language

- **Audited surface**: The authenticated Markx workspace and folder canvas.
- **Design sources**: The current workspace components, mobile research memo,
  Apple Human Interface Guidelines, and MDN Pointer Events guidance.
- **Documented decisions**: The canvas owns touch gestures with Pointer Events.
  The board uses two-finger pan and pinch, one-finger card movement, and a
  mobile delete dock.
- **Governing owners and consumers**: `Board` owns canvas gestures.
  `AppShell` owns mobile sheets and header controls. `DeleteDock` owns mobile
  drag-to-delete feedback.
- **Explicit exceptions**: None documented.

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Users cannot pan the canvas with one finger on blank space. | `Board` assigns a blank pointer to `marquee` in `src/components/markx/board.tsx:610-626`; only a second pointer enters `touchPan` in `src/components/markx/board.tsx:587-590`. Apple recommends simple, familiar gestures for common actions. | On touch, make a blank-space drag pan the canvas. Keep marquee selection for mouse and trackpad input. | `src/components/markx/board.tsx`, gesture tests | High |
| 2 | Mobile users have no visible control to close the Tools or More sheet. | Both mobile sheets set `showCloseButton={false}` in `src/components/markx/app-shell.tsx:466-492`. The sheets depend on backdrop dismissal or selecting an action. Apple requires a clear way to leave a surface. | Add a 44px close button to each mobile sheet header. | `src/components/markx/app-shell.tsx` | Medium |
| 3 | Mobile users have no visible zoom or fit control while arranging cards. | Zoom controls render only with `md:flex` in `src/components/markx/app-shell.tsx:301-348`; the board starts mobile users at 50% in `src/components/markx/board.tsx:163-170`. The Board API already exposes `setZoomPercent` and `fitToContent`. | Add a compact mobile zoom control with `Fit`, using the existing Board API. | `src/components/markx/app-shell.tsx`, `src/components/markx/workspace.tsx` | Medium |

## Improve first

Finding **1** removed the main navigation barrier for the arranging task.
Findings **2** and **3** added visible sheet dismissal and mobile zoom controls.

## Validation

After implementation, test these cases on all three device groups:

1. Drag blank space with one finger and confirm the board pans.
2. Tap blank space and confirm selection clears without moving the board.
3. Drag a card with one finger and confirm the card still moves.
4. Use two fingers to pan and pinch without committing a card move.
5. Confirm mouse and trackpad marquee selection still works.
6. Open and close both mobile sheets using the visible close control.
7. Use mobile `Fit` and zoom controls while cards exist off-screen.
8. Test portrait, landscape, notched screens, and increased text size.
