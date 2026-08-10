# Mobile canvas interaction guidance

- **Status**: RESEARCHED
- **Date**: 2026-08-10
- **Scope**: Mobile web interaction for the Markx canvas
- **Source rule**: Primary sources only
- **Context7**: Unavailable in this session. This memo uses official Apple, MDN,
  and React documentation directly.

## Executive summary

The current canvas uses the correct browser input model for a custom surface:
React Pointer Events, pointer capture, cached active pointers, explicit
`pointercancel` handling, two-finger pan/pinch, and `touch-none`.

The main evidence-based follow-up is a viewport and accessibility check:

1. Confirm the root viewport metadata includes `viewport-fit=cover` before
   relying on safe-area insets for full-screen mobile layout.
2. Keep the canvas gesture region explicit and test cancellation during browser
   viewport gestures, orientation changes, and app switching.
3. Preserve a non-gesture path for core actions, including opening, moving,
   resizing, and deleting items.
4. Keep controls and resize hit regions at least 44 CSS pixels where possible.
5. Make drag feedback continuous and redirectable, and keep drop feedback clear.

This memo does not change product source.

## Current implementation

### `src/components/markx/board.tsx`

- The board handles `onPointerDown`, `onPointerMove`, `onPointerUp`, and
  `onPointerCancel` on one viewport element (`board.tsx:997-1008`).
- The viewport uses Tailwind `touch-none` (`board.tsx:1000-1003`).
- The board stores active pointer positions by `pointerId`
  (`board.tsx:183-185`, `584-589`).
- A second pointer changes the interaction to `touchPan`, aborts the current
  one-finger gesture, and tracks centroid and distance
  (`board.tsx:557-578`).
- The board uses pointer capture for pan, marquee, move, and resize
  (`board.tsx:595-608`, `617-622`, `665-676`, `748-758`).
- The board releases capture on pointer end and treats `pointercancel` as the
  pointer-up path (`board.tsx:867-890`, `1005-1008`).
- Mobile resize hit testing expands the bottom-right zone to at least 44 board
  pixels after zoom conversion (`board.tsx:650-659`).
- Mobile item deletion uses a visible dock and armed drop state
  (`board.tsx:840-861`, `900-925`, `1103-1112`).
- Keyboard users have a separate roving-tab stop, directional navigation,
  Enter to open, F2 to rename, and Alt+Arrow to move
  (`board.tsx:450-501`, `1049-1067`).
- Gesture preview updates are coalesced with `requestAnimationFrame`
  (`board.tsx:299-329`).

### `src/components/markx/app-shell.tsx`

- Mobile tools and overflow actions use sheets instead of the desktop rail
  (`app-shell.tsx:466-522`).
- Mobile header controls use 44px square layout boxes
  (`app-shell.tsx:181-198`, `410-419`).
- The tools sheet and overflow sheet add bottom or top safe-area padding
  (`app-shell.tsx:470-479`, `483-492`).
- Desktop and mobile deletion feedback share the armed state
  (`app-shell.tsx:64-72`, `433-452`).
- Interactive press feedback is gated with `active:scale` and the stylesheet
  gates hover styles to fine pointers (`src/styles.css:8-11`).

### Related viewport metadata

`src/routes/__root.tsx:13-16` currently sets:

```tsx
content: "width=device-width, initial-scale=1"
```

MDN recommends `viewport-fit=cover` when content uses the full display area and
also recommends safe-area variables with that setting. The current shell uses
`env(safe-area-inset-*)`, so verify the intended full-screen behavior on
notched and rounded displays.

## Guidance from primary sources

### Apple Human Interface Guidelines

Apple recommends a 44x44 point default control size on iOS and iPadOS, with
28x28 points as the minimum. Apple also recommends simple gestures for common
actions and an alternate interaction for gesture-only functionality.

Application to Markx:

- The mobile header buttons already use 44px boxes.
- The mobile resize zone follows the 44px target direction, but test the
  smallest visible cards and the lowest zoom levels.
- Do not make move-to-delete the only delete method.
- Keep open, rename, resize, and delete available from visible controls or
  menus, not only from custom gestures.
- Keep labels and focus states available for keyboard, switch, pointer, and
  assistive technology input.

Source: [Apple HIG — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)

Apple says touch and pointing-device input should provide a consistent
experience. It advises distinguishing pointer and finger input only when that
distinction adds value.

Application to Markx:

- Shared pointer handlers are appropriate for mouse, pen, and touch.
- The existing two-finger touch mode can remain a touch-specific exception
  because it provides pan and pinch behavior that a mouse does not provide.
- Keep the same item selection, move, resize, and delete outcomes across input
  types.

Source: [Apple HIG — Pointing devices](https://developer.apple.com/design/human-interface-guidelines/pointing-devices)

### Designing Fluid Interfaces

Apple's official WWDC18 session describes fluid touch interactions as
responsive, redirectable, and interruptible. It also recommends designing
visual feedback together with the interaction, not after it.

Application to Markx:

- The requestAnimationFrame preview path supports continuous movement and
  should remain the only visual write path during active gestures.
- A two-finger gesture should take over cleanly from a one-finger move or
  resize. The current `beginTouchPan` path does this by aborting the
  one-finger gesture.
- A user should be able to change direction without a dead zone or forced
  reset. Test item moves, canvas pans, and pinch direction changes.
- The delete dock should appear before the drop decision and show the armed
  state continuously. Test entering, leaving, and re-entering the dock.
- Avoid transitions that delay direct manipulation. Animate state changes only
  when the pointer remains responsive.

Source: [Apple WWDC18 — Designing Fluid Interfaces](https://developer.apple.com/videos/play/wwdc2018/803/)

No official Apple PDF titled “Designing Fluid Interfaces” was found. The
official WWDC18 session is the available Apple source for these principles.

### MDN Pointer Events and `touch-action`

MDN states that Pointer Events provide one event model for mouse, pen, and
touch, and that multiple simultaneous pointers require cached pointer state.
MDN also documents `pointercancel` as the signal that the browser will stop
sending events, including when it takes control for viewport panning, zooming,
or scrolling.

Application to Markx:

- The active-pointer map and `pointerId` lookup match the documented model.
- Keep `pointercancel` on the same cleanup path as `pointerup`.
- Test cancellation while a move, resize, marquee, or pinch is active.
- Ensure cancellation clears previews, armed delete feedback, and pointer
  capture without committing an unintended move or resize.

Sources:

- [MDN — Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [MDN — Multi-touch interaction](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Multi-touch_interaction)
- [MDN — `pointercancel`](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointercancel_event)

MDN states that `touch-action` communicates browser gesture ownership before a
gesture starts. `none` disables browser panning and zooming for the region.
`manipulation` allows panning and pinch zoom while disabling extra gestures
such as double-tap zoom. Changes after a gesture starts do not affect that
gesture.

Application to Markx:

- `touch-none` is consistent with a board that owns single-finger drag,
  marquee, two-finger pan, and pinch.
- Do not change `touch-action` during a live gesture.
- If the board later contains a scrollable child, apply the custom gesture rule
  only to the canvas region and preserve native scrolling inside that child.
- Test whether `touch-none` affects the user's ability to use browser zoom.
  MDN warns that disabling browser zoom can harm low-vision users. The app's
  own canvas zoom must not be treated as a replacement for page zoom.

Source: [MDN — `touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)

### MDN viewport and safe-area guidance

MDN defines `viewport-fit=cover` as filling the device display. It recommends
safe-area inset variables when using this mode, so important content does not
fall under a notch or rounded display edge.

MDN defines `safe-area-inset-top`, `-right`, `-bottom`, and `-left` as the
current safe distances. It also supports a fallback value in `env()`.

Application to Markx:

- Verify the root viewport metadata and safe-area behavior together.
- Keep top and bottom sheet padding tied to safe-area values.
- Keep fixed or docked delete controls above
  `env(safe-area-inset-bottom)`.
- Test portrait, landscape, notched displays, rounded displays, and changing
  browser UI.
- Consider a fallback in new `env()` declarations where the element is
  important and older browsers are in scope.

Sources:

- [MDN — Viewport meta element](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport)
- [MDN — `env()` CSS function](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env)

## Recommended verification cases

1. Tap an item without moving. Confirm selection does not start a drag.
2. Drag one item, cross the delete dock, leave it, and return to it.
3. Start moving an item, place a second finger, and confirm no accidental
   move or resize commits.
4. Pinch while the canvas is zoomed out and confirm the pinch center stays
   stable.
5. Lift one finger during pinch, then move the remaining finger. Confirm the
   board does not start a new one-finger gesture.
6. Trigger `pointercancel` during every active gesture and confirm cleanup.
7. Rotate the device and repeat the tests.
8. Test VoiceOver or TalkBack, keyboard navigation, increased text size, and
   browser page zoom.
9. Test with a mouse or trackpad and confirm the same item outcomes.
10. Test sheets and the delete dock on a device with a home indicator.

## Relevant framework guidance

React's official DOM reference exposes `onPointerDown`, `onPointerMove`,
`onPointerUp`, and `onPointerCancel` handlers. The current board uses these
handlers directly, so no additional React abstraction is required.

Source: [React — Common DOM components and events](https://react.dev/reference/react-dom/components/common)

TanStack Router is present for navigation, but it does not own the canvas
gesture model. Its `Link` guidance is relevant to shell navigation only.
No TanStack-specific mobile canvas change follows from this review.

Source: [TanStack Router — Navigation](https://tanstack.com/router/latest/docs/guide/navigation)

## Decision boundary

This memo recommends verification and, if tests fail, focused follow-up work.
It does not prescribe source edits because the current gesture architecture
already matches the primary web platform guidance.
