import { describe, expect, it } from "vitest"

import { filterByKeywords, noteText } from "./search"

describe("search helpers", () => {
  it("MX-26 note text is the visible text, with entities decoded", () => {
    expect(noteText("<p>Tom &amp; Jerry</p><p>a &lt; b</p>")).toBe(
      "Tom & Jerry a < b"
    )
  })

  it("MX-26 matches only visible keywords, never the hidden id", () => {
    expect(
      filterByKeywords("note:x7Qz", "linear", ["Linear", "linear.app"])
    ).toBe(1)
    expect(filterByKeywords("note:x7Qz", "x7q", ["Shopping list"])).toBe(0)
    expect(filterByKeywords("bookmark:abc", "tom jer", ["Tom & Jerry"])).toBe(1)
  })
})
