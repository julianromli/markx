# markx audit: folders, notes, bookmarks, touch, accessibility (mobile)

- Date: 2026-10-25
- Base commit: `ac024f0` (main)
- Scope: folder, note, bookmark, and image logic; sync and persistence; touch interaction; accessibility. Mobile first.
- Type: audit only. This branch changes no product code.

## How this audit was done

- I read the domain, store, sync, board, and UI code.
- I built a feedback loop for each suspected bug. A bug is CONFIRMED only when a test or script reproduced it. A bug is SUSPECTED when only code reading supports it.
- Unit repros: `src/audit/markx-audit.repro.test.ts` at audit time. They asserted the correct behavior, so they failed while the bug existed (`docs/audit/repro/unit-last-run.txt`). In the fix branch each one moved into a normal, non-skipped test next to the code it covers, and the skipped file is gone.
- Browser repros: `docs/audit/repro/mobile-audit.mjs` (Playwright, Chromium). It uses Pixel 7, iPhone 14, iPad (gen 7) with touch, and a 1280x800 desktop. Each check prints REPRODUCED or NOT REPRODUCED. Last result: `docs/audit/repro/last-run.txt`.
- Accessibility scan: `docs/audit/repro/a11y-scan.mjs` (axe-core, Tab order, target sizes). Last result: `docs/audit/repro/a11y-last-run.txt`.
- Working flows: `docs/audit/repro/mobile-sanity.mjs`.
- Screenshots: `docs/audit/img/`.
- The app ran locally in guest mode (`bun run dev`, no database, no auth). Logged-in sync was tested only through unit tests with fake server adapters.

To run the browser scripts:

```bash
npm i --no-save playwright@1.56 axe-core@4 && npx playwright install chromium
bun run dev
node docs/audit/repro/mobile-audit.mjs            # all checks
node docs/audit/repro/mobile-audit.mjs MX-21      # one check
```

## Summary table

File:line points at the audited commit `ac024f0`.

Severity: P0 = data loss or a core flow is broken for most users. P1 = data loss in common cases, or a core flow is broken on one platform. P2 = a feature is wrong or missing, with a workaround. P3 = polish.

| ID | Area | Sev | Audit | Fix status | Mobile-only | File:line | Symptom |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MX-21 | Touch | P0 | Confirmed | Fixed | Yes | `board.tsx:1018`, `note-card.tsx:85` | Dragging a note with a finger makes it jump off-screen. |
| MX-01 | Sync | P1 | Confirmed | Fixed | No | `store.tsx:156-170` | An edit made just before a link preview loads never reaches the cloud. |
| MX-03 | Sync | P1 | Confirmed | Fixed | No | `sync.ts:566-571`, `store.tsx:659-664` | An edit made while a save is in flight disappears when the save returns. |
| MX-10 | Touch, a11y | P1 | Confirmed | Fixed | No (worst on phone) | `note-editor.tsx:106-114,242,267` | Note toolbar buttons are 16px on a phone. |
| MX-12 | Notes | P1 | Confirmed | Fixed | No (worst on phone) | `note-editor.tsx:72-81` | Note text is lost if the page reloads or closes while you type. |
| MX-13 | Touch | P1 | Confirmed | Fixed | Yes | `delete-dock.tsx:29`, `board.tsx:916-918` | Any drop in the bottom 120px of the screen deletes the item. |
| MX-14 | Undo | P1 | Confirmed | Fixed | Yes | `app-shell.tsx:352-375,555-567` | Phones have no Undo. Deleted notes, images, and folders cannot come back. |
| MX-16 | Keyboard | P1 | Confirmed | Fixed | No | `use-workspace-global-events.ts:68-71` | Backspace inside the Move dialog deletes the selected items behind it. |
| MX-02 | Sync, undo | P2 | Confirmed | Fixed | No | `store.tsx:659-664`, `sync.ts:571` | Every successful cloud save erases the undo history. |
| MX-04 | Bookmarks | P2 | Confirmed | Fixed | No | `store.tsx:526-541` | Moved bookmarks pile up at a fixed spot, under existing cards. |
| MX-05 | Restore | P2 | Confirmed | Fixed | No | `store.tsx:556-561`, `workspace.tsx:225-231` | Toast "Undo" can duplicate a bookmark or restore it into a deleted folder. |
| MX-06 | Bookmarks | P2 | Confirmed | Fixed | No | `store.tsx:411-417`, `dialogs.tsx:106-114` | Add link accepts junk text, or fails silently with an uncaught error. |
| MX-11 | A11y | P2 | Confirmed | Fixed | No | `note-editor.tsx:306-323` | Note color, font, and size menus do not open from the keyboard. |
| MX-15 | Move | P2 | Confirmed | Fixed | No | `workspace.tsx:711-722` | "Move to" skips selected notes and images but still says "Moved". |
| MX-17 | Folders | P2 | Confirmed | Fixed | No | `workspace.tsx:193-198,253-258` | Deleting a folder plus a note on Home deletes only the folder. |
| MX-20 | Images | P2 | Confirmed | Fixed | No | `workspace.tsx:164-176` | Opening an image on Home shows "Folder not found". |
| MX-22 | Touch | P2 | Confirmed | Fixed | Yes | `workspace.tsx:511-512` | A long-press menu held for about 1s closes when the finger lifts. |
| MX-23 | Touch | P2 | Confirmed | Fixed | Yes | `board.tsx:614-637` | You cannot select more than one item on a touch screen. |
| MX-24 | Tap targets | P2 | Confirmed | Fixed | Partly | `app-shell.tsx:588-602`, `ui/context-menu.tsx`, sonner | Many touch targets are smaller than 44px. |
| MX-26 | Search | P2 | Confirmed | Fixed | No | `app-shell.tsx:403-408,563-567` | The Search button does nothing. |
| MX-27 | A11y | P2 | Confirmed | Fixed | No | `workspace.tsx:672-688`, `workspace.tsx:184-250` | Focus falls to `<body>` after the rename dialog closes and after a delete. |
| MX-29 | Guest data | P2 | Confirmed | Fixed | No | `storage.ts:130-134` | Two open tabs overwrite each other's work in guest mode. |
| MX-30 | Touch | P2 | Confirmed | Fixed | Yes | `board.tsx:660-688`, `resize-handle.tsx:16-24` | An invisible resize zone takes over drags that start near a card corner. |
| MX-33 | Mobile layout | P2 | Suspected | Needs real device | Yes | `ui/dialog.tsx:58`, `board.tsx` camera | The virtual keyboard can cover dialog inputs and the note being edited. |
| MX-34 | Touch | P2 | Suspected | Needs real device | Yes (iOS) | `note-editor.tsx:72-81`, `board.tsx:614-618` | On iOS, a tap on the canvas may not end note editing. |
| MX-07 | Undo | P3 | Confirmed | Fixed | No | `store.tsx:445-468` | Redo can leave a bookmark with a loading shimmer that never stops. |
| MX-08 | Sync | P3 | Confirmed | Fixed | No | `board.tsx:749`, `store.tsx:225-251` | Every tap on an item writes and syncs the whole workspace. |
| MX-18 | Counts | P3 | Confirmed | Fixed | No | `folder-icon.tsx:56`, `dialogs.tsx:201` | Folder counts call notes and images "bookmarks", or skip them. |
| MX-28 | Hover | P3 | Confirmed | Fixed | No | sonner CSS, `ui/bubble.tsx` | A few vendor `:hover` rules are not gated. App code is fine. |
| MX-31 | Mobile layout | P3 | Confirmed | Fixed | Yes | `board.tsx:166-171`, `__root.tsx:16` | Items are off-screen at first paint. Safe-area padding has no effect. |
| MX-35 | A11y | P3 | Confirmed | Fixed | No | `workspace.tsx:628-629` | Hints show "⌘N" and "⌘V" on Windows, Android, and iOS. |
| MX-36 | A11y | P3 | Confirmed | Fixed | No | `board.tsx:1060-1066`, `app-shell.tsx:294-298` | axe reports name mismatches. Phones have no `h1`. |
| MX-37 | Create | P3 | Confirmed | Fixed | No | `workspace.tsx:279-286` | "New note" from the context menu near an edge lands mostly off-screen. |
| MX-38 | Domain | P3 | Confirmed | Partially fixed | No | `workspace-items.ts:14-45`, `app-shell.tsx:99-108` | Notes and images cannot move between Home and folders. Folders cannot nest. |

Counts by severity: P0 1, P1 7, P2 17, P3 9 (34 total, 32 confirmed, 2 suspected).

Fix status (2026-10-25, branch `julianromli/markx-audit-fixes-9d7d`): 31 fixed, 1 partially fixed (MX-38), 2 need a real device to confirm (MX-33, MX-34). See "Fix status" at the end of this report for the test that covers each finding.

Counts by area: folder, note, and bookmark logic 11; touch and mobile gestures 7; accessibility and keyboard 6; sync and persistence 5; tap targets and mobile layout 4; search 1.

## Findings

### MX-21 (P0) Dragging a note with a finger makes it jump off-screen

- Symptom: On a phone, put a finger on a note and drag. The note does not follow the finger. It jumps up and left, usually off-screen, and the move is saved.
- Repro: Pixel 7 emulation. Open "Vibe Coding". Tools, Note, type text, tap blank canvas. Drag the note down 120px.
- Evidence: `node docs/audit/repro/mobile-audit.mjs MX-21`. Note box moved from (167,405) to (-75,-75). The event log shows `pointerdown@242,480 pointercancel@0,0`. Chromium cancels the pointer after the first move, and the cancel event has coordinates (0,0). Part b of the check shows that a folder drag ended by `touchcancel` also commits instead of reverting. Screenshots: `img/mx21-note-before-drag.png`, `img/mx21-note-after-drag.png`.
- Root cause (proven): Two faults combine. First, the note text area uses `overflow-y-auto` (`note-card.tsx:85`). That makes it a scroll container, so the browser takes the touch for native scrolling even though the board has `touch-none`. Second, the board handles `onPointerCancel` with `onPointerUp` (`board.tsx:1018`). A cancel then commits the move with `dx = 0 - startX`, `dy = 0 - startY`.
- Not affected: bookmark and folder drags (tested, they follow the finger).
- Fix direction: Treat `pointercancel` as abort and revert to the origin. Remove native scroll from the note body while it is not in edit mode, or give it `touch-action: none`. Add a gesture test at the board seam (see cluster C4).

### MX-01 (P1) An edit made just before a link preview loads never reaches the cloud

- Symptom: Logged-in user. You make a change. Within 120ms, a background Open Graph result arrives for a bookmark. Your change stays on screen but is never sent to the cloud or written to the per-user cache. It is lost on reload unless you make another edit.
- Repro: unit test `MX-01`. Create a bookmark (enrich takes 300ms). Rename the folder 50ms before the enrich result lands.
- Evidence: `expected "vi.fn()" to be called at least once`. The sync engine never receives the rename.
- Root cause (proven): `persist()` always clears the pending save timer (`store.tsx:157`). Enrich patches call `persist({ sync: false })`, and the new timer returns early (`store.tsx:162`). The earlier user edit's timer is gone.
- Fix direction: Keep one dirty flag. A `sync: false` patch must never cancel a pending user save. Better: move the debounce into one persistence module (cluster C1).

### MX-03 (P1) An edit made while a save is in flight disappears when the save returns

- Symptom: Logged-in user. A cloud save is in flight. You add or move an item. The save returns, and your new item vanishes.
- Repro: unit test `MX-03`. Create folder A. Wait until its save is in flight. Create folder B. Resolve the save.
- Evidence: `expected [ 'A' ] to deeply equal [ 'A', 'B' ]`.
- Root cause (proven): On a successful save, the engine emits the saved state as "authoritative" (`sync.ts:571`). The store replaces its state with it, with no version or generation check (`store.tsx:659-664`). The engine's generation guard only sees edits that already passed the store's 120ms debounce, so an edit inside that window is overwritten.
- Fix direction: A save acknowledgement should update the version only. Do not replace local state on ack. If the server ever changes the state, merge by generation, not by overwrite.

### MX-10 (P1) Note toolbar buttons are 16px on a phone

- Symptom: The note toolbar (color, font, size, B, I, U) renders inside the zoomed canvas. At the default 50% phone zoom every button is about 16px. At 85% desktop zoom they are about 27px.
- Repro: Pixel 7. Open a folder. Tools, Note.
- Evidence: `MX-10`: `Bold=16x16, Italic=16x16, Underline=16x16, Aa=24x16, Medium=39x16`. Screenshot `img/mx10-note-toolbar-mobile.png`.
- Root cause (proven): The toolbar is portaled into the note card (`note-editor.tsx:242`), which sits inside the transformed board layer (`board.tsx:1038-1043`). Buttons are `size-8` before scaling (`note-editor.tsx:267`).
- Fix direction: Render editing chrome in a screen-space overlay that reads the board-to-screen transform. Make each control at least 44px on touch.

### MX-12 (P1) Note text is lost if the page reloads or closes while you type

- Symptom: Type in a note, then reload, close the tab, or let the phone discard the tab. The text is gone.
- Repro: Desktop. Open a folder, create a note, type, wait 1.5s, reload.
- Evidence: `MX-12`: after reload the only note is "Empty note".
- Root cause (proven): The editor commits only on blur or Escape (`note-editor.tsx:72-81`, `84-104`). No save happens while typing, and no flush runs on `pagehide` or `visibilitychange`. Phones discard background tabs often, so this hits mobile users hardest.
- Fix direction: Debounce `updateNoteContent` while typing, without one undo entry per keystroke. Flush on `visibilitychange` and `pagehide`.

### MX-13 (P1) Any drop in the bottom 120px of the screen deletes the item

- Symptom: On a phone, drag a card toward the bottom-left corner to tidy the board. The item is deleted, even though the visible "Delete" pill is centered and far from the finger.
- Repro: Pixel 7. Open "Vibe Coding". Drag the shadcn card to x=24, y=779.
- Evidence: `MX-13`: release at x=24; pill spans x=145 to 267; `armed=true`; the bookmark is deleted. Screenshots `img/mx13-delete-dock-left-corner.png`, `img/mx13-after-drop.png`.
- Root cause (proven): The hit area is the whole bottom strip, full width and `h-[7.5rem]` (`delete-dock.tsx:29`). The board tests the pointer against that strip (`board.tsx:870`, `917`). For notes, images, and folders there is no Undo on a phone (MX-14), so the loss is permanent.
- Fix direction: Make the hit area the pill plus a small margin. Require a short dwell before arming. Give every deletion an Undo.

### MX-14 (P1) Phones have no Undo

- Symptom: Undo and Redo exist only in the desktop header. The phone "More" sheet has Help, Search, and Close. Only bookmark deletion shows a toast with Undo. Deleting a note shows "Note deleted" with no action.
- Repro: Pixel 7. Look at the header and the More sheet. Delete a note through the long-press menu.
- Evidence: `MX-14`: visible Undo buttons = 0; More sheet items = Help, Search, Close. `mobile-sanity.mjs`: note delete toast = "Note deleted". Screenshot `img/mx14-more-sheet-no-undo.png`.
- Root cause (proven): Header buttons are `hidden md:flex` (`app-shell.tsx:352`). Toast Undo exists only on the bookmark path (`workspace.tsx:225-231`).
- Fix direction: Add Undo and Redo to the phone UI. Give every delete toast an Undo that calls the same history (cluster C3).

### MX-16 (P1) Backspace inside the Move dialog deletes the selected items behind it

- Symptom: Select a bookmark, open "Move to…", press Backspace or Delete. The bookmark is deleted behind the open dialog. The same applies to any dialog or menu where focus is not in a text field.
- Repro: Desktop. Right-click "Linear", Move to…, press Backspace.
- Evidence: `MX-16`: the Linear bookmark no longer exists. Screenshot `img/mx16-backspace-in-move-dialog.png` shows the "Bookmark deleted" toast behind the dialog.
- Root cause (proven): The window `keydown` handler checks only for editable targets and note editing (`use-workspace-global-events.ts:30-36`). It does not know that a dialog or menu is open.
- Fix direction: Ignore global shortcuts when the event target is inside `[role=dialog]`, `[role=alertdialog]`, or `[role=menu]`, or when any overlay is open.

### MX-02 (P2) Every successful cloud save erases the undo history

- Symptom: Logged-in user. Make a change, wait about 2s, press Undo. Nothing happens.
- Repro: unit test `MX-02`.
- Evidence: `canUndo` is `false` after the save completes.
- Root cause (proven): The store clears `past` and `future` whenever the engine emits an authoritative state (`store.tsx:659-664`). The engine does that on every successful save (`sync.ts:571`).
- Fix direction: Same as MX-03. An ack must not touch history.

### MX-04 (P2) Moved bookmarks pile up at a fixed spot, under existing cards

- Symptom: After "Move to…", bookmarks land at x,y between 140 and 236 in the target folder. Two moved bookmarks can land on the exact same spot. They keep their old `z`, so existing cards can cover them.
- Repro: unit test `MX-04` (move the 1st and 6th bookmark). Browser `MX-15` screenshot `img/mx15-target-folder-overlap.png`.
- Evidence: both bookmarks get `140,140`.
- Root cause (proven): The position uses the bookmark's index in the global array, `140 + (index % 5) * 24` (`store.tsx:535-536`). `z` is not raised.
- Fix direction: Place moved items with the same empty-slot logic as new items (`findEmptySlot`). Raise their `z`.

### MX-05 (P2) Toast "Undo" can duplicate a bookmark or restore it into a deleted folder

- Symptom: Delete a bookmark, press Cmd+Z, then click the toast "Undo". You get two bookmarks with the same id. Or delete a bookmark, delete its folder, then click the toast "Undo". The bookmark comes back with no folder, so it is invisible but still counts toward the plan limit.
- Repro: unit tests `MX-05` and `MX-05b`.
- Evidence: two copies with the same id; one orphan bookmark.
- Root cause (proven): `restoreBookmarks` appends without checks (`store.tsx:556-561`). It is a second undo system next to the snapshot history.
- Fix direction: Use one undo mechanism (cluster C3). If a restore stays, make it idempotent and check that the parent folder exists.

### MX-06 (P2) Add link accepts junk text, or fails silently

- Symptom: "my reading list" creates a bookmark with host `my%20reading%20list`. "https://" throws an uncaught `TypeError`, and the dialog stays open with no message.
- Repro: Desktop. Open a folder, Link, type each value, press Enter.
- Evidence: `MX-06`. Unit test `MX-06` (`TypeError: Invalid URL`). Screenshot `img/mx06-add-link-invalid-input.png`.
- Root cause (proven): `AddLinkDialog` only trims (`dialogs.tsx:108-113`). `createBookmark` prefixes `https://` and calls `new URL()` with no try/catch (`store.tsx:411-417`).
- Fix direction: Validate in the dialog. Show an inline error. Reject hosts with spaces or with no dot (except `localhost`).

### MX-11 (P2) Note color, font, and size menus do not open from the keyboard

- Symptom: Tab to the "Aa" button in the note toolbar and press Enter or Space. Nothing opens. The color button has no accessible name. The menus have no arrow-key support and do not take focus.
- Repro: Desktop. Create a note, focus a toolbar dropdown, press Enter, then Space.
- Evidence: `MX-11`: trigger names `["", "Aa", "Medium"]`; menu open after Enter = false, after Space = false.
- Root cause (proven): The trigger acts only on `onPointerDown` (`note-editor.tsx:311-315`). It has no `onClick`.
- Fix direction: Use the existing Base UI Menu or Popover. Give each trigger a name ("Note color", "Font", "Text size").

### MX-15 (P2) "Move to" skips selected notes and images but still says "Moved"

- Symptom: In a folder, select a bookmark and a note, then "Move to…" another folder. The bookmark moves. The note stays. The toast says "Moved".
- Repro: Desktop, `MX-15`.
- Evidence: toast "Moved"; the note is still in the source folder. Screenshot `img/mx15-note-left-behind.png`.
- Root cause (proven): The dialog calls `moveBookmarks([...selectedIds])` (`workspace.tsx:718`). The store has no move for notes or images. See MX-38.
- Fix direction: One move operation for all movable kinds, or disable Move with a reason when the selection has kinds that cannot move.

### MX-17 (P2) Deleting a folder plus a note on Home deletes only the folder

- Symptom: On Home, select a non-empty folder and a note. Press Delete and confirm. The folder is deleted. The note stays.
- Repro: Desktop, `MX-17`.
- Evidence: folder deleted = true; selected note still exists = true. Screenshots `img/mx17-confirm-delete-count.png`, `img/mx17-note-survives.png`.
- Root cause (proven): `deleteSelection` opens the confirm dialog and returns early (`workspace.tsx:193-198`). `confirmDeleteFolders` deletes only folders, and it reads `selectedIds` instead of the ids that were passed in (`workspace.tsx:253-258`). A trash drop or menu delete on a different set of ids can confirm the wrong set.
- Fix direction: Keep the pending ids in state when the confirm opens. Delete all of them on confirm.

### MX-20 (P2) Opening an image on Home shows "Folder not found"

- Symptom: Add an image on Home and double-click it, or focus it and press Enter. The app goes to `/folder/<imageId>` and shows "Folder not found".
- Repro: Desktop, `MX-20`.
- Evidence: URL `/folder/akcj_biS6UC-tx0ah0-LU`. Screenshot `img/mx20-open-image-folder-not-found.png`.
- Root cause (proven): `openItem` treats every non-note id on Home as a folder (`workspace.tsx:174-176`).
- Fix direction: Switch on item kind. Open a preview for images, or do nothing.

### MX-22 (P2) A long-press menu held for about 1s closes when the finger lifts

- Symptom: Long-press a card. The context menu opens. If the finger stays down for about 1s or more, the menu closes on lift. A short hold (700ms) keeps it open. Many users hold longer. The scan in `a11y-scan.mjs` also needed retries now and then for the same reason.
- Repro: Pixel 7, `MX-22`.
- Evidence: `[{"hold":700,"afterLift":true},{"hold":1500,"afterLift":false}]`. Screenshots `img/mx22-long-press-menu-while-holding.png`, `img/mx22-long-press-menu-gone-after-lift.png`.
- Root cause (hypothesis): Base UI's context menu supports "press, drag, release". A `mouseup` more than 500ms after open, outside the menu, closes it (`node_modules/@base-ui/react/context-menu/trigger/ContextMenuTrigger.js:84-102`). On a long hold Chromium fires a native `contextmenu` and, on lift, a compatibility `mouseup` on the card. Real Android devices are not tested. iOS does not fire `contextmenu`, so iOS may not show this.
- Fix direction: Open the menu from the board's own long-press for touch input, and ignore the release-to-close path for touch. Also give phones a visible "item actions" button for the selected item.

### MX-23 (P2) You cannot select more than one item on a touch screen

- Symptom: A one-finger drag on blank space pans. There is no marquee, no Shift or Cmd, and no "select" mode. Bulk move and bulk delete are impossible on a phone.
- Repro: Pixel 7, `MX-23`.
- Evidence: blank drag panned 240px; marquee shown = false; items selected = 0.
- Root cause (proven): Touch on blank space always enters `pan` (`board.tsx:619-627`). Multi-select needs modifier keys (`board.tsx:700-738`).
- Fix direction: Add a selection mode on touch (toggle in the header, or long-press on blank space to start a marquee).

### MX-24 (P2) Many touch targets are smaller than 44px

- Symptom and evidence (`MX-24`, `a11y-last-run.txt`):
  - Phone: "Sign in" is 71x32. Long-press menu items are 180x36 (`img/mx24-long-press-menu-phone.png`). Toast "Undo" is 47x24 (`img/mx24-toast-undo-phone.png`).
  - iPad (touch, desktop layout at 768px and up): Undo 30x30, Redo 30x30, Help 32x32, Search 32x32, Zoom 64x32 (`img/mx24-ipad-header-targets.png`). The iPad also gets the desktop sidebar trash instead of the delete dock.
  - Note toolbar: see MX-10. Resize handle: see MX-30.
- Root cause (proven): `HeaderIconButton` uses `p-1.5` (`app-shell.tsx:595`). Shared menu and toast styles are sized for a mouse. Layout switches on width only (`use-mobile.ts:3`), not on pointer type.
- Fix direction: Use `(pointer: coarse)` to grow hit areas, with a pseudo-element if the visual size must stay small.

### MX-26 (P2) The Search button does nothing

- Symptom: Desktop Search has no handler. Phone "More, Search" only closes the sheet. There is no search or filter anywhere.
- Evidence: `MX-26`: no dialog and no input after the click.
- Root cause (proven): `app-shell.tsx:403-408` (no `onClick`) and `app-shell.tsx:563-567`.
- Fix direction: Hide the control until search exists, or ship a simple title and URL filter.

### MX-27 (P2) Focus falls to `<body>` after the rename dialog closes and after a delete

- Symptom: Focus a card, press F2, press Escape. Focus is on `<body>`. Focus a card and press Delete. Focus is on `<body>`. A keyboard user must Tab from the top again.
- Evidence: `MX-27`: both report `BODY`.
- Root cause (proven): The rename and confirm dialogs open from state, not from a trigger, so the dialog has no element to return focus to. After a delete, nothing moves focus to a neighbor item.
- Fix direction: Save the focused element before opening and restore it on close. After a delete, focus the nearest item or the board.

### MX-29 (P2) Two open tabs overwrite each other's work in guest mode

- Symptom: Open markx in two tabs. Create a folder in tab A, then a folder in tab B. Reload. Only one folder survives.
- Evidence: `MX-29`: tab A folder kept = false, tab B folder kept = true.
- Root cause (proven): Guest state is one IndexedDB value written whole (`storage.ts:130-134`). There is no cross-tab signal or version check.
- Fix direction: Use `BroadcastChannel` or a version stamp. Reload or merge when another tab writes.

### MX-30 (P2) An invisible resize zone takes over drags that start near a card corner

- Symptom: On a phone, a drag that starts about 30px inside the bottom-right corner of any card resizes the card instead of moving it. The card does not need to be selected, and the handle is invisible until selection. The visible handle is about 16px. The active zone is 44px at 50% zoom. At 25% zoom the zone is larger than a minimum-size note, so that note cannot be moved at all.
- Repro: Pixel 7, `MX-30`. Unit tests `MX-09` and `MX-09b`.
- Evidence: card 240x126 became 180x206; moved 0,0. Zone covers 40% of a minimum note at 50% zoom, and 100% at 25%.
- Root cause (proven): The zone is `max(20, 44 / zoom)` board px (`board.tsx:666`) and applies to unselected items (`board.tsx:660-688`). The handle is 32 board px and `opacity-0` unless selected (`resize-handle.tsx:16-24`).
- Fix direction: Allow resize only on a selected item. Make the zone match the visible handle, drawn in screen space at 44px.

### MX-33 (P2, suspected) The virtual keyboard can cover dialog inputs and the note being edited

- Symptom (expected): On iOS, the dialogs are `fixed top-1/2` (`ui/dialog.tsx:58`). The layout viewport does not shrink when the keyboard opens, so the input can sit under the keyboard. When you edit a note low on the canvas, the camera does not pan to keep the caret visible.
- Evidence: code reading only. Playwright cannot show a virtual keyboard.
- Fix direction: Position dialogs with the `visualViewport` API or `dvh`. Pan the camera to the caret when a note enters edit mode.

### MX-34 (P2, suspected) On iOS, a tap on the canvas may not end note editing

- Symptom (expected): Note editing ends only on blur (`note-editor.tsx:72-81`). A tap on blank canvas clears the selection but does not end editing (`board.tsx:614-618`). iOS Safari does not move focus when you tap a non-focusable element, so the editor can stay focused with the keyboard up.
- Evidence: code reading only. Chromium emulation blurs on tap, so it cannot show this.
- Fix direction: End editing explicitly on a blank-canvas pointerdown. Add a visible "Done" button.

### MX-07 (P3) Redo can leave a bookmark with a loading shimmer that never stops

- Repro: unit test `MX-07`. Create a bookmark while enrich is pending, Undo, let enrich finish, Redo.
- Evidence: `enrichStatus` stays `"pending"`.
- Root cause (proven): The redo snapshot was taken while `pending`. The enrich patch found no bookmark to update (`store.tsx:445-468`).
- Fix direction: Never store `enrichStatus` in history, or settle it on redo.

### MX-08 (P3) Every tap on an item writes and syncs the whole workspace

- Repro: unit test `MX-08`.
- Evidence: one `onStateChange` per tap.
- Root cause (proven): Every pointerdown on an item calls `raiseZ` (`board.tsx:749`). `raiseZ` is a `patch` that persists and syncs (`store.tsx:225-251`). The `zCounter` grows forever.
- Fix direction: Raise z only when a move or resize commits. Keep "on top" as view state until then.

### MX-18 (P3) Folder counts call notes and images "bookmarks", or skip them

- Symptom: A folder with 3 bookmarks and 1 note shows "3 bookmarks" on its tile. The delete dialog says "This folder contains 4 bookmarks".
- Evidence: `MX-17` output. Screenshots `img/mx19-folder-tile-count.png`, `img/mx17-confirm-delete-count.png`.
- Root cause (proven): The tile counts bookmarks only (`workspace.tsx:150-158`, `folder-icon.tsx:56`). The dialog counts all items but labels them bookmarks (`dialogs.tsx:201`). The board label uses a third helper (`workspace.tsx:389-392`).
- Fix direction: One count function that returns counts per kind. Word the text from it.

### MX-28 (P3) A few vendor `:hover` rules are not gated

- Evidence: `MX-28` found 7 ungated rules. They are in Sonner's toast styles and in `components/ui/bubble.tsx`, which the app does not use. App code uses Tailwind v4 `hover:`, which is already gated by `(hover: hover)`, plus a `hover-fine` variant.
- Fix direction: None needed for app code. Optional: drop the unused `bubble` component.

### MX-31 (P3) Items are off-screen at first paint, and safe-area padding has no effect

- Symptom: On iPhone 14 and Pixel 7 the "AI" demo folder is off-screen at first paint. The viewport meta has no `viewport-fit=cover`, so every `env(safe-area-inset-*)` value in the shell is 0.
- Evidence: `MX-31`. Screenshot `img/mx31-iphone-initial-view.png`.
- Root cause (proven): The initial phone camera is fixed at `{ x: 16, y: 24, zoom: 0.5 }` (`board.tsx:166-171`). Viewport meta is `width=device-width, initial-scale=1` (`__root.tsx:16`).
- Fix direction: Fit content on first load on small screens. Add `viewport-fit=cover`, then check the padding on a notched device.

### MX-35 (P3) Hints show "⌘N" and "⌘V" on every platform

- Evidence: `workspace.tsx:628-629`. The handler accepts Ctrl too, but the text always says ⌘. On touch devices the shortcuts do not apply.
- Fix direction: Show Ctrl on non-Mac. Hide shortcut hints on coarse pointers.

### MX-36 (P3) axe findings: name mismatch and no `h1` on phones

- Evidence: `a11y-last-run.txt`. `label-content-name-mismatch` (serious) on folder items and on the context-menu trigger. `page-has-heading-one` on phones, because the `h1` is `hidden md:flex` (`app-shell.tsx:294-298`). Board items are `role="button"` with `aria-pressed` and hold an interactive editor while editing (`board.tsx:1060-1066`).
- Fix direction: Start the aria-label with the visible name. Keep an `h1` for screen readers on phones. Consider `role="option"` in a `listbox`-like pattern for selectable items.

### MX-37 (P3) "New note" from the context menu near an edge lands mostly off-screen

- Evidence: `MX-37`: right-click at (1150,720), only 16% of the new note is visible. Screenshot `img/mx37-context-menu-note-off-screen.png`.
- Root cause (proven): The note's top-left corner goes to the pointer (`workspace.tsx:279-286`) with no clamp to the view.
- Fix direction: Clamp the new item rect into the visible bounds.

### MX-38 (P3) Notes and images cannot move between Home and folders. Folders cannot nest.

- Evidence: Home shows folders, plus notes and images with `folderId == null`. A folder shows its bookmarks, notes, and images (`workspace-items.ts:14-45`). "Move to…" exists only inside a folder and only moves bookmarks. Folders can be created only on Home (`app-shell.tsx:99-108`). A note made on Home stays on Home forever.
- This is a product decision more than a bug. It is listed because the owner asked to test move and nest. See "Domain model" below.

## Checklist results (touch and accessibility rubric)

| Item | Result |
| --- | --- |
| Hover styles gated by `(hover: hover)` | Pass for app code (MX-28). |
| No function reachable only by hover | Partial. The bookmark URL tooltip with "Copy URL" opens on hover or a 500ms touch long-press, and the context menu also opens on that long-press. In my runs the tooltip did not show reliably on touch. |
| Tap targets at least 44px | Fail (MX-10, MX-24, MX-30). Mobile header buttons, sheet close buttons, and Tools items pass. |
| `touch-action: manipulation` on controls | Pass (`styles.css:159-168`). |
| `touch-action: none` on gesture surfaces | Partial. The board has `touch-none`, but the note body scroller breaks it (MX-21). |
| Autoplay video | Not applicable. |
| Icon-only buttons have `aria-label` | Pass, except the note color trigger (MX-11). |
| Tab order skips hidden content | Pass. On a phone the order is Tools, Back, More, Sign in, Zoom, one board item. The hidden desktop rail is `display: none`. |
| Focus scrolls into view; modals move and restore focus | Partial. Sheets restore focus to their trigger. Rename and confirm dialogs do not (MX-27). |
| `prefers-reduced-motion` | Pass. A global rule cuts animation and transition time (`styles.css:391-399`). |
| Timers pause on `visibilitychange` | Pass for the sync poll (`sync.ts:816-823`). No user-facing countdowns exist. |
| Shortcut hints per OS | Fail (MX-35). |
| Keyboard reachability of the canvas | Pass. Roving tab stop, arrows, Enter, F2, Alt+Arrow, Delete. Shift+F10 opens the context menu on the focused item (`MX-32`, not a bug). |
| Long-press, swipe, drag on touch | Fail (MX-21, MX-22, MX-23, MX-30). Two-finger pan and pinch work. |
| Virtual keyboard covering inputs | Suspected (MX-33). |
| Safe-area insets | Fail as configured (MX-31). |
| Viewport and zoom | Page pinch-zoom is allowed (good). The board takes pinch inside the canvas. |

## Flows that work

Tested and working on Pixel 7 emulation (`mobile-sanity.mjs`): rename a folder from the long-press menu; move a bookmark from the long-press menu; delete a bookmark and restore it with the toast Undo; create a folder and a note from the Tools sheet; double-tap to open a folder; two-finger pan and pinch; bookmark and folder drags.

## Code review: Standards axis

There is no `CONTRIBUTING.md`, `AGENTS.md`, `CONTEXT.md`, or ADR folder. The documented standards are the ESLint config (`@tanstack/eslint-config`) and Prettier. `tsc --noEmit` passes. ESLint reports 16 errors on main, all type-import style and unneeded-condition rules (for example `sync.ts:505`, `bookmark-card.tsx:6-8`, `subscription/success.tsx:60-77`). None of them causes a finding above.

Smell baseline (judgement calls, not hard violations):

- Repeated Switches: `raiseZ`, `updatePositions`, `resizeItem`, and `resetSizes` each map the four kind arrays the same way (`store.tsx:225-524`). Kind rules repeat in `selectWorkspaceItems`, `classifyItemIds`, `getItemLabel`, `openItem`, `deleteSelection`, and `getBoardItemRect`.
- Shotgun Surgery: a change to "what can live where" touches `workspace-items.ts`, `workspace.tsx`, `app-shell.tsx` (`unavailableReason`), `workspace-context-menu.tsx`, `store.tsx`, and `dialogs.tsx`. MX-15, MX-17, MX-18, and MX-20 each come from one of these copies drifting.
- Divergent Change: `board.tsx` (1123 lines) owns pointer gestures, touch pan and pinch, keyboard navigation, the trash and dock geometry, enter and exit animation, and the camera API.
- Feature Envy: `deleteSelection` and `confirmDeleteFolders` in `workspace.tsx` classify store data and choose cascades. That logic belongs with the data.
- Duplicated Code: the zoom dropdown is written twice in `app-shell.tsx` (desktop `304-350`, phone `464-509`).
- Primitive Obsession: `folderId: string | null` encodes "on Home" for notes and images, while bookmarks use `string`. Location has no type of its own.
- Speculative Generality and dead code: `resolveConflictUseCloud` and `resolveConflictOverwriteCloud` stay "for store API compat" though last-writer-wins never sets a conflict (`sync.ts:667-721`). `shouldImportGuest` and `getGuestImportDecision` always return false (`state.ts:48-61`).
- Mysterious Name: `guestImported:{userId}` now means "first-login bootstrap done" (the comment in `storage.ts:29-31` says so). `patch` versus `commit` hides the real difference, which is "in undo history or not" plus a sync flag.

## Domain model

The folder, note, and bookmark model is not written down in one place. This is what the code implies:

- Containment: folders live only on Home. Bookmarks must be in a folder. Notes and images live on Home (`folderId: null`) or in a folder. Folders cannot nest. These rules exist only as filters and UI guards spread over six files.
- Ownership and source of truth: the store holds the working state. The sync engine holds a second copy (`currentState`) and can push it back into the store as "authoritative". The server echoes the client snapshot. So there are two writers to the store state with no version check (MX-02, MX-03).
- Ordering: one global `zCounter`, raised on every tap (MX-08). There is no explicit order inside a folder and no "send backward".
- Delete and move cascades: deleting a folder deletes its bookmarks, notes, and images. Move exists only for bookmarks. Restore exists only for bookmarks and does not check the parent (MX-05, MX-15).
- Undo: an in-memory stack of whole-state snapshots (50 deep), not persisted, cleared by any authoritative replace, with no phone UI. A second partial undo lives in the bookmark toast (MX-05, MX-14).
- Optimistic updates versus server state: edits apply locally first. Persistence has two debounces in two modules (120ms in the store, 1500ms in the engine). Each debounce has a lost-update window (MX-01, MX-03).
- Sync races: logged-in sync is last-writer-wins across devices by design. The git history shows four strategy changes in a short time (cloud-wins, auto-merge, server merge, last-writer-wins). Guest mode has no cross-tab coordination (MX-29).

## Root-cause clusters

### C1. The store and sync engine seam is shallow and leaky (MX-01, MX-02, MX-03, MX-08)

The store interface leaks persistence policy: a `sync: false` flag, its own debounce, and `pendingDeletedImageIds`. The engine keeps a second copy of state and pushes it back through a listener that the store applies blindly. Both modules must be understood together to change either one, so neither is deep. A deep "workspace persistence" module would take local commits, own the single queue, write the cache, push to the cloud, and reconcile acks by generation. The store would never be overwritten by an ack. The existing fake adapters in `sync-engine.test.ts` already give the seam a second adapter, so the seam is real.

### C2. No domain module for containment and item lifecycle (MX-04, MX-05, MX-06, MX-15, MX-17, MX-18, MX-20, MX-37, MX-38)

Rules about which kind lives where, and what open, move, delete, restore, and count mean, live in UI handlers. Apply the deletion test to `workspace.tsx` handlers: their logic would move into one "board items" module with `move(items, target)`, `delete(items)` that returns a restorable entry, `restore(entry)`, `open(item)` that returns an intent, and `counts(folder)`. That module would be pure and testable through its interface. Today these rules can only be tested through React.

### C3. Two undo mechanisms, and none on phones (MX-02, MX-05, MX-07, MX-14)

Snapshot history and toast restore conflict. History is lost on every save. Phones cannot reach either for most kinds. One command history, with the toast calling `undo` for its own command, would fix all four.

### C4. The board gesture code mixes input reading with commits (MX-13, MX-21, MX-22, MX-23, MX-30)

`board.tsx` turns raw pointer events into commits directly. Cancel equals up. Hit zones do not match what is drawn. A second library opens the context menu with its own long-press. There is no seam for tests: the gesture test setup was added and then reverted (`git log`: "Revert Fix board gesture test environment"). Per the diagnosing-bugs rubric, the lack of a correct seam is itself a finding. A pure gesture reducer (pointer events in, intents out: move, resize, pan, delete, cancel, open menu) would give a fast test surface for every touch bug here.

### C5. Editing chrome is drawn inside the zoomed canvas (MX-10, MX-24, MX-30)

The note toolbar and resize handle scale with the camera. A screen-space overlay layer, positioned from the board-to-screen transform, would keep them at a fixed, touch-safe size.

### C6. Keyboard routing and focus do not know about overlays (MX-11, MX-16, MX-27)

One window `keydown` handler acts while dialogs and menus are open. Dialogs opened from state do not restore focus. Custom dropdowns skip the Base UI primitives that already handle keyboard and focus.

### C7. Note editing lifecycle depends on blur (MX-12, MX-34)

Note text exists only in the editor until blur. Autosave plus an explicit end-edit path would fix both.

## Proposed fix order (tracer-bullet tickets)

Each ticket is a thin end-to-end slice with its repro as the regression test.

| # | Ticket | Fixes | Blocked by |
| --- | --- | --- | --- |
| T1 | Treat `pointercancel` as abort. Stop native scroll on the note body outside edit mode. Add a board gesture test seam (start with a pure reducer for cancel and move). | MX-21 | None |
| T2 | Guard global shortcuts while any dialog or menu is open. | MX-16 | None |
| T3 | Note autosave while typing, flush on `pagehide` and `visibilitychange`. End edit on blank-canvas tap. | MX-12, MX-34 | None |
| T4 | Persistence queue: a `sync: false` patch never cancels a pending save. An ack never replaces local state or history. Move z-raise off plain taps. | MX-01, MX-02, MX-03, MX-08 | None (unit repros exist) |
| T5 | One undo history. Toast Undo calls it. Undo and Redo on phones. Undo on every delete toast. | MX-05, MX-07, MX-14 | T4 (history must survive saves) |
| T6 | Delete dock hit area equals the pill. Dwell before arming. | MX-13 | T5 for the Undo safety net (can ship the geometry part first) |
| T7 | Board items domain module: move for all kinds with empty-slot placement, delete with pending ids, open by kind, counts, URL validation, clamp placement. | MX-04, MX-06, MX-15, MX-17, MX-18, MX-20, MX-37 | T5 for restore entries |
| T8 | Screen-space editing chrome and coarse-pointer targets: note toolbar, resize handle (selected only, 44px), menu items, toast buttons, Sign in, iPad header. | MX-10, MX-24, MX-30 | T1 (shares the gesture seam) |
| T9 | Keyboard and focus: Base UI menus in the note toolbar with names; restore focus after dialogs and deletes. | MX-11, MX-27 | T2 |
| T10 | Touch menu and multi-select: board-owned long-press for touch, a visible actions button, touch selection mode. | MX-22, MX-23 | T1, T8 |
| T11 | Guest cross-tab coordination. | MX-29 | T4 (same persistence module) |
| T12 | Polish: hide or build Search, first-load fit on phones, `viewport-fit=cover`, OS-aware hints, `h1` and label fixes, keyboard-aware dialogs. | MX-26, MX-31, MX-33, MX-35, MX-36 | None |
| T13 | Product decision: should notes and images move between Home and folders, and should folders nest? | MX-38 | Owner decision |

## What I could not test

- Logged-in cloud sync end to end. There was no database URL and no Neon Auth session. MX-01, MX-02, MX-03, and MX-08 were proven with unit tests against fake server adapters, not against a real server.
- Real iOS Safari and real Android devices. All browser tests ran in Chromium with device emulation. MX-21 and MX-22 depend on Chromium input behavior. iOS WebKit may differ (MX-22 may not occur on iOS; MX-34 may occur only on iOS).
- The virtual keyboard and notched-screen safe areas (MX-33, MX-31). Emulation shows neither.
- Screen readers (VoiceOver, TalkBack). Only axe-core and DOM checks ran.
- Shared boards, billing, image upload to R2, and multi-device sync were out of scope.


## Fix status

All fixes are on branch `julianromli/markx-audit-fixes-9d7d`, one commit per ticket (T1 to T12, each commit message lists its MX ids). Every test below was red before its fix and green after.

- Unit tests run with `bun run test` (277 tests).
- Browser tests run with `bun run test:e2e` against `bun run dev` (67 tests on Pixel 7, iPhone 14 in Chromium, iPhone 14 in WebKit, iPad, and desktop). Last run: `docs/audit/repro/e2e-final-run.txt`.
- The original audit script rerun against the fixed app: `docs/audit/repro/after-fix-audit-run.txt`. Every check prints NOT REPRODUCED except three, which are expected: MX-23 (that check only tests a blank-space drag outside select mode, which still pans by design), MX-28 (it counts rules in the dev server's stale CSS; the production build has none), and MX-06 (the old script expects the dialog to close on bad input; it now stays open with an inline error).
- After screenshots: `docs/audit/img/fixed/`. Before screenshots stay in `docs/audit/img/`.

| ID | Fix status | Tests (file: name) |
| --- | --- | --- |
| MX-01 | Fixed | `store-sync.test.ts`: MX-01 a user edit reaches the sync engine even when an enrich result lands inside the 120ms persist debounce |
| MX-02 | Fixed | `store-sync.test.ts`: MX-02 a successful cloud save keeps the local undo history; MX-02 a save ack never emits an authoritative state |
| MX-03 | Fixed | `store-sync.test.ts`: MX-03 an edit made while a cloud save is in flight is not reverted when the save returns |
| MX-04 | Fixed | `board-items.test.ts`: MX-04 moved bookmarks get distinct spots and are raised |
| MX-05 | Fixed | `undo.test.ts`: MX-05 toast Undo after Cmd+Z does not duplicate a deleted bookmark; MX-05 toast Undo restores the delete when it is still the latest step; MX-05b toast Undo does not restore a bookmark into a folder that no longer exists |
| MX-06 | Fixed | `board-items.test.ts`: MX-06 parseBookmarkUrl (8 cases); `undo.test.ts`: MX-06 createBookmark returns null instead of throwing; `e2e/t07-items.spec.ts`: MX-06 Add link rejects text that is not a URL with a visible message |
| MX-07 | Fixed | `undo.test.ts`: MX-07 redo of a bookmark created while enrich was pending does not leave a stuck loading shimmer |
| MX-08 | Fixed | `store-sync.test.ts`: MX-08 a plain tap (raiseZ) does not schedule a cloud save; MX-08 tapping an item that another item covers still raises it |
| MX-10 | Fixed | `e2e/t08-targets.spec.ts`: MX-10 note toolbar buttons are at least 44px on a phone (Pixel 7, iPhone 14, WebKit) |
| MX-11 | Fixed | `e2e/t09-keyboard.spec.ts`: MX-11 note toolbar menus work from the keyboard and have names |
| MX-12 | Fixed | `note-autosave.test.ts` (5 tests); `e2e/t03-note-editing.spec.ts`: MX-12 survives a reload while typing, an immediate reload, and the tab going to the background |
| MX-13 | Fixed | `board-gesture.test.ts`: MX-13 delete dock (3 tests); `e2e/t06-delete-dock.spec.ts`: bottom-left drop does not delete; holding on the pill deletes |
| MX-14 | Fixed | `e2e/t05-undo.spec.ts`: MX-14 phones show Undo and Redo; a deleted note comes back from the toast Undo and the header Undo |
| MX-15 | Fixed | `board-items.test.ts`: MX-15 moves notes and bookmarks together; `undo.test.ts`: MX-15 moveItems; `e2e/t07-items.spec.ts`: MX-15 Move to… moves the selected note together with the bookmark |
| MX-16 | Fixed | `use-workspace-global-events.test.tsx`: MX-16 (4 tests); `e2e/t02-shortcuts.spec.ts`: MX-16 Backspace inside the Move dialog does not delete the selection |
| MX-17 | Fixed | `board-items.test.ts`: MX-17 deletes every selected kind; `e2e/t07-items.spec.ts`: MX-17 MX-18 mixed delete on Home |
| MX-18 | Fixed | `board-items.test.ts`: MX-18 counts and labels every kind; `e2e/t07-items.spec.ts`: MX-17 MX-18 |
| MX-20 | Fixed | `board-items.test.ts`: MX-20 opening an image does nothing; `e2e/t07-items.spec.ts`: MX-20 opening an image on Home stays on Home |
| MX-21 | Fixed | `board-gesture.test.ts`: MX-21 (3 tests); `e2e/t01-gestures.spec.ts`: MX-21 a touch-dragged note follows the finger; a drag ended by touchcancel reverts |
| MX-22 | Fixed | `e2e/t10-touch-menu-select.spec.ts`: MX-22 the long-press menu stays open after a 700ms and a 1500ms hold |
| MX-23 | Fixed | `board-gesture.test.ts`: MX-23 touch select mode (4 tests); `e2e/t10-touch-menu-select.spec.ts`: MX-23 phones can select several items and delete them together |
| MX-24 | Fixed | `e2e/t08-targets.spec.ts`: MX-24 phone header, Tools sheet, long-press menu, and toast targets; MX-24 iPad header targets |
| MX-26 | Fixed | `e2e/t12-polish.spec.ts`: MX-26 Search finds a bookmark and opens its folder; MX-26 Search opens from the phone More sheet |
| MX-27 | Fixed | `e2e/t09-keyboard.spec.ts`: MX-27 (3 tests: rename dialog, keyboard delete, folder delete confirm) |
| MX-28 | Fixed | `e2e/t12-polish.spec.ts`: MX-28 no ungated :hover rule applies to an element on the page |
| MX-29 | Fixed | `guest-tabs.test.ts` (2 tests); `e2e/t11-guest-tabs.spec.ts`: MX-29 two guest tabs keep each other's work |
| MX-30 | Fixed | `board-gesture.test.ts`: MX-30 resize zone on touch, MX-09, MX-09b; `e2e/t08-targets.spec.ts`: MX-30 (2 tests) |
| MX-31 | Fixed | `geometry.test.ts`: MX-31 first paint fit; `e2e/t12-polish.spec.ts`: MX-31 phones see every item at first paint (Pixel 7, iPhone 14, WebKit) |
| MX-33 | Needs real device | `visual-viewport.test.ts`: MX-33; `geometry.test.ts`: MX-33 cameraToReveal; `e2e/t12-polish.spec.ts`: MX-33 dialogs stay inside the visible area (emulated keyboard) |
| MX-34 | Needs real device | `board-gesture.test.ts`: reports a press on empty canvas; `e2e/t03-note-editing.spec.ts`: MX-34 a tap on blank canvas ends note editing (Chromium and WebKit passed before and after the fix) |
| MX-35 | Fixed | `platform.test.ts`: MX-35; `e2e/t12-polish.spec.ts`: MX-35 (desktop Ctrl hint, no hints on touch) |
| MX-36 | Fixed | `e2e/t12-polish.spec.ts`: MX-36 axe finds no violations on Home and in a folder (phone, WebKit, desktop) |
| MX-37 | Fixed | `board-items.test.ts`: MX-37 clamps a new item into the visible area; `e2e/t07-items.spec.ts`: MX-37 |
| MX-38 | Partially fixed | `board-items.test.ts`: MX-38 offers Home as a target; `e2e/t07-items.spec.ts`: MX-38 a note on Home can move into a folder and back. Folder nesting is not built. |

### Left open

- MX-38 folder nesting. Folders still live on Home only. Nesting changes the stored data model (a parent id on folders), recursive delete and move, breadcrumbs, and the server's shared-board model, which lifts one folder into a board. That needs a product decision and a data migration, so it is out of scope for this fix branch.
- MX-33 and MX-34 have defensive fixes, but only a real iPhone can confirm them. Playwright cannot show a virtual keyboard, and its WebKit is not iOS Safari. Check: open Add link and a low note with the keyboard up, and tap blank canvas while editing a note.
- MX-21 and MX-22 were reproduced and fixed in Chromium mobile emulation. A quick check on a real Android phone and a real iPhone is still worth doing.
- Logged-in sync (MX-01 to MX-03, MX-08) is covered by unit tests with fake server adapters only. There was no database or auth in this environment.
