import { describe, expect, it } from "vitest"

import {
  EXTENSION_PERMISSIONS,
  EXTENSION_VERSION,
  PROD_HOST_PERMISSIONS,
  assertStoreManifestValid,
  buildManifest,
  resolveExtensionTarget,
} from "./manifest"

describe("resolveExtensionTarget", () => {
  it("defaults to dev and accepts store", () => {
    expect(resolveExtensionTarget(undefined)).toBe("dev")
    expect(resolveExtensionTarget("")).toBe("dev")
    expect(resolveExtensionTarget("dev")).toBe("dev")
    expect(resolveExtensionTarget("store")).toBe("store")
  })

  it("rejects unknown build targets", () => {
    expect(() => resolveExtensionTarget("prod")).toThrow(/Invalid/)
  })
})

describe("buildManifest", () => {
  it("builds a store manifest with only production hosts and minimal permissions", () => {
    const manifest = buildManifest("store")

    expect(manifest.manifest_version).toBe(3)
    expect(manifest.version).toBe(EXTENSION_VERSION)
    expect(manifest.permissions).toEqual([...EXTENSION_PERMISSIONS])
    expect(manifest.permissions).not.toContain("tabs")
    expect(manifest.host_permissions).toEqual([...PROD_HOST_PERMISSIONS])
    expect(manifest.options_ui).toBeUndefined()
    expect(manifest.commands._execute_action.suggested_key).toEqual({
      default: "Ctrl+Shift+S",
      mac: "Command+Shift+S",
    })
    expect(() => assertStoreManifestValid(manifest)).not.toThrow()
  })

  it("excludes localhost and 127.0.0.1 from the store manifest", () => {
    const manifest = buildManifest("store")
    const serialized = JSON.stringify(manifest)

    expect(serialized).not.toMatch(/localhost/i)
    expect(serialized).not.toContain("127.0.0.1")
    for (const host of manifest.host_permissions) {
      expect(host.startsWith("https://")).toBe(true)
    }
  })

  it("keeps localhost hosts and options_ui in the dev manifest", () => {
    const manifest = buildManifest("dev")

    expect(manifest.version).toBe(EXTENSION_VERSION)
    expect(manifest.permissions).toEqual([...EXTENSION_PERMISSIONS])
    expect(manifest.permissions).not.toContain("tabs")
    expect(manifest.host_permissions).toEqual([
      "https://markx.app/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ])
    expect(manifest.options_ui).toEqual({
      page: "src/options.html",
      open_in_tab: false,
    })
  })
})

describe("assertStoreManifestValid", () => {
  it("rejects localhost, 127.0.0.1, http hosts, tabs permission, and options_ui", () => {
    const store = buildManifest("store")

    expect(() =>
      assertStoreManifestValid({
        ...store,
        host_permissions: [...store.host_permissions, "http://localhost/*"],
      })
    ).toThrow(/forbidden host permission/i)

    expect(() =>
      assertStoreManifestValid({
        ...store,
        host_permissions: [...store.host_permissions, "http://127.0.0.1/*"],
      })
    ).toThrow(/forbidden host permission/i)

    expect(() =>
      assertStoreManifestValid({
        ...store,
        permissions: [...store.permissions, "tabs"],
      })
    ).toThrow(/"tabs"/)

    expect(() => assertStoreManifestValid(buildManifest("dev"))).toThrow(
      /options_ui/i
    )
  })
})
