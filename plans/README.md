# Animation improvement plans

Audit produced by the `improve-animations` skill against commit `12cbde6`.
Each plan is self-contained and can be executed by an agent with no prior
context. Plans are **read-only proposals** — they do not modify source until
executed.

## Plans

| # | Title | Severity | Status | Files touched |
|---|-------|----------|--------|---------------|
| 001 | Animate the note editing toolbar's entrance | HIGH | IMPLEMENTED | `src/styles.css`, `src/components/markx/note-card.tsx` |
| 002 | Animate canvas items in on creation | HIGH | IMPLEMENTED | `src/styles.css`, `src/components/markx/board.tsx` |
| 003 | Animate the note toolbar's custom dropdowns on open | MEDIUM | IMPLEMENTED | `src/styles.css`, `src/components/markx/note-card.tsx` |
| 004 | Crossfade image previews into view | MEDIUM | IMPLEMENTED | `src/styles.css`, `src/components/markx/image-card.tsx` |
| 005 | Transition the empty workspace state | MEDIUM | IMPLEMENTED | `src/styles.css`, `src/components/markx/workspace.tsx` |
| 006 | Animate canvas items out on deletion | MEDIUM | IMPLEMENTED | `src/styles.css`, `src/components/markx/board.tsx`, `src/components/markx/workspace.tsx` |
| 007 | Transition the payment success state | LOW | IMPLEMENTED | `src/styles.css`, `src/components/markx/account-menu.tsx` |
| 008 | Stagger shared-board list entrances | LOW | IMPLEMENTED | `src/styles.css`, `src/routes/shared.tsx` |

## Recommended execution order

1. **001** (toolbar entrance) — smallest, isolated, highest-frequency win.
2. **003** (toolbar dropdowns) — same file as 001 (`note-card.tsx`) and same
   `@layer utilities` block in `styles.css`; do right after 001 so the toolbar
   and its dropdowns ship together.
3. **002** (canvas item entrance) — independent file (`board.tsx`); do last so
   its feel-check (drag/resize lag-free) is validated on its own.
4. **004** (image preview crossfade) — independent and low-risk; verify image
   geometry remains stable.
5. **005** (empty workspace state) — do after 004; it adds mounted exit-state
   handling and needs a focused state-transition test.
6. **006** (canvas item deletion exit) — do after 005; it changes deletion
   retention and needs drag, keyboard, and undo checks.
7. **007** (payment success) — independent; do after functional payment checks.
8. **008** (shared-board list stagger) — independent and lowest priority.

## Dependencies

- **001 → 003**: not strictly required, but both edit `note-card.tsx` and add a
  utility to the same `@layer utilities` block. Execute 001 first to avoid
  merge churn in `styles.css`.
- **002** is independent of 001/003 (different component, different file).
- All three add a utility class to the **same** `@layer utilities { … }` block
  in `src/styles.css`. If executed in parallel by separate agents, expect a
  trivial text conflict in that one block — resolve by keeping all three
  additions.
- **004–008** also add utilities to that same block. Execute them sequentially
  or resolve additive text conflicts carefully.
- **005** should precede **006** because both retain transient board/workspace
  state, but they do not share implementation files.

## Excluded

- The copy-success icon in `src/components/markx/share-dialog.tsx:316` is
  excluded because it already has the `copy-pop` animation.

## Shared conventions (all plans)

- Reuse `--ease-out-strong` (`src/styles.css:18`); never introduce a new curve.
- Add utility classes inside the existing `@layer utilities { … }` block.
- Entrances use `scale: 0.95` (matches the repo's `zoom-95`); press feedback
  uses `0.96` — don't mix them.
- Animate `scale` + `opacity` only (compositor-friendly, independent of
  `transform`). Never animate `transform` on elements whose `transform` is
  written by JS (drag/resize in `board.tsx`, centering in `note-card.tsx`).
- Enter-only via native `@starting-style`; exit is instant on unmount
  (acceptable for these surfaces). The global `prefers-reduced-motion` rule at
  `src/styles.css:172` neutralizes all of these automatically.

## Out of scope (noted, not planned)

- **Account menu dropdown** (`account-menu.tsx:66`) and **conflict-resolution
  dialog** (`sync-status.tsx:138`) are also custom, un-animated surfaces
  (findings #4 and #6). They were not selected for this batch; revisit if you
  want full popover/dialog cohesion.
- **Folder-contents stagger** (missed-opportunity A), **tabs content fade**
  (B), **sync-badge icon crossfade** (C) — additive, not selected.
- **ToolButton sliding indicator** (D) — needs a JS layout-animation library;
  the repo has none and the skill forbids new deps.
