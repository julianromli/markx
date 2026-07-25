import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useWorkspaceGlobalEvents } from "./use-workspace-global-events"

function Harness({
  selectedIds,
  onDeleteSelection,
}: {
  selectedIds: Set<string>
  onDeleteSelection: (ids: string[]) => void
}) {
  useWorkspaceGlobalEvents({
    blocked: false,
    editing: false,
    mode: "home",
    selectedIds,
    selectedRenamable: false,
    onAddImages: vi.fn(),
    onCreateBookmark: vi.fn(),
    onDeleteSelection,
    onNewFolder: vi.fn(),
    onRedo: vi.fn(),
    onRename: vi.fn(),
    onResetInteraction: vi.fn(),
    onUndo: vi.fn(),
    onNewFolderUnavailable: vi.fn(),
    onPasteUrlAtHome: vi.fn(),
  })
  return null
}

describe("useWorkspaceGlobalEvents", () => {
  it("keeps stable listeners while reading the latest selection", () => {
    const addEventListener = vi.spyOn(window, "addEventListener")
    const removeEventListener = vi.spyOn(window, "removeEventListener")
    const onDeleteSelection = vi.fn()
    const view = render(
      <Harness
        selectedIds={new Set(["first"])}
        onDeleteSelection={onDeleteSelection}
      />
    )

    view.rerender(
      <Harness
        selectedIds={new Set(["latest"])}
        onDeleteSelection={onDeleteSelection}
      />
    )
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }))

    expect(onDeleteSelection).toHaveBeenCalledWith(["latest"])
    expect(
      addEventListener.mock.calls.filter(([type]) =>
        ["keydown", "paste"].includes(String(type))
      )
    ).toHaveLength(2)

    view.unmount()
    expect(
      removeEventListener.mock.calls.filter(([type]) =>
        ["keydown", "paste"].includes(String(type))
      )
    ).toHaveLength(2)
    addEventListener.mockRestore()
    removeEventListener.mockRestore()
  })
})
