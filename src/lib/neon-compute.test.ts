import { describe, expect, it } from "vitest"

import { NEON_AUTOSUSPEND_MS, NEON_IDLE_POLL_MS } from "@/lib/neon-compute"
import { SYNC_VERSION_POLL_MS } from "@/lib/markx/sync-timings"
import { SESSION_POLL_MS } from "@/lib/auth/session"

describe("Neon idle poll intervals", () => {
  it("keeps idle polls longer than autosuspend so an open tab can sleep", () => {
    expect(NEON_IDLE_POLL_MS).toBeGreaterThan(NEON_AUTOSUSPEND_MS)
    expect(SESSION_POLL_MS).toBe(NEON_IDLE_POLL_MS)
    expect(SYNC_VERSION_POLL_MS).toBe(NEON_IDLE_POLL_MS)
  })
})
