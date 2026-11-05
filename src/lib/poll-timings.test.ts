import { describe, expect, it } from "vitest"

import { IDLE_POLL_MS } from "@/lib/poll-timings"
import { SYNC_VERSION_POLL_MS } from "@/lib/markx/sync-timings"
import { SESSION_POLL_MS } from "@/lib/auth/session"

describe("idle poll intervals", () => {
  it("shares one slow idle poll for session and workspace checks", () => {
    expect(IDLE_POLL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000)
    expect(SESSION_POLL_MS).toBe(IDLE_POLL_MS)
    expect(SYNC_VERSION_POLL_MS).toBe(IDLE_POLL_MS)
  })
})
