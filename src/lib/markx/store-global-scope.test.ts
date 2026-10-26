/**
 * Cloudflare Workers forbid random values in global scope. The module-level
 * `store` is created when the server bundle loads, so creating a store must
 * not generate IDs. Regression: markx.app returned 500 on every request.
 */
import { describe, expect, it, vi } from "vitest"

const nanoid = vi.hoisted(() => vi.fn(() => "id"))
vi.mock("nanoid", () => ({ nanoid }))

describe("store module load", () => {
  it("does not generate random IDs at import time", async () => {
    await import("@/lib/markx/store")
    expect(nanoid).not.toHaveBeenCalled()
  })
})
