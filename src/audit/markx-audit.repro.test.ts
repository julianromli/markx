/**
 * AUDIT REPRO TESTS (2026-10). See docs/audit/2026-10-markx-audit.md.
 *
 * Each test asserts the CORRECT behavior, so it goes red while the bug
 * exists and green after the fix. They are skipped by default so CI stays
 * green. Run them with:
 *
 *   MARKX_AUDIT=1 bunx vitest run src/audit
 *
 * Test names start with the finding id from the audit report.
 */
import { describe, expect, it } from "vitest"

import {
  NOTE_SIZE,
  MIN_NOTE_SIZE,
  MIN_ZOOM,
  RESIZE_HANDLE_SIZE,
  isInBottomRightResizeZone,
} from "@/lib/markx/geometry"

const auditIt = process.env.MARKX_AUDIT ? it : it.skip

describe("audit: geometry", () => {
  auditIt(
    "MX-09 on mobile at minimum zoom a minimum-size note still has a move area outside the resize zone",
    () => {
      // Board.tsx: isMobile ? Math.max(RESIZE_HANDLE_SIZE, 44 / cam.zoom)
      const handle = Math.max(RESIZE_HANDLE_SIZE, 44 / MIN_ZOOM)
      const note = { x: 0, y: 0, ...MIN_NOTE_SIZE }
      // Grab the note near its top-left corner, where a user grabs to move.
      expect(isInBottomRightResizeZone(10, 10, note, handle)).toBe(false)
    }
  )

  auditIt(
    "MX-09b on mobile at the default 50% zoom the resize zone covers less than a quarter of a minimum-size note",
    () => {
      const handle = Math.max(RESIZE_HANDLE_SIZE, 44 / 0.5)
      const zoneArea = handle * handle
      // Sanity: a default 300x300 note is fine (about 9%).
      expect(zoneArea / (NOTE_SIZE.width * NOTE_SIZE.height)).toBeLessThan(0.25)
      // A 160x120 minimum note: 88*88 / (160*120) = 40%.
      const minArea = MIN_NOTE_SIZE.width * MIN_NOTE_SIZE.height
      expect(zoneArea / minArea).toBeLessThan(0.25)
    }
  )
})
