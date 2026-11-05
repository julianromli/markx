import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  completeReloginNotice,
  isReloginNoticePending,
  markReloginNeeded,
  subscribeReloginNotice,
} from "@/lib/markx/relogin-notice"

describe("relogin notice", () => {
  beforeEach(() => localStorage.clear())

  it("shows once, then stays done", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeReloginNotice(listener)

    expect(isReloginNoticePending()).toBe(false)
    markReloginNeeded()
    expect(isReloginNoticePending()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    completeReloginNotice()
    expect(isReloginNoticePending()).toBe(false)

    // A later sign-out must not bring it back.
    markReloginNeeded()
    expect(isReloginNoticePending()).toBe(false)
    unsubscribe()
  })
})
